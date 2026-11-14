-- Ninokuu · skema database utama.
-- Jalankan di Supabase → SQL Editor → New query → Run. Aman dijalankan ulang:
-- tabel yang sudah ada tidak dihapus dan datanya tidak berubah.
--
-- Prinsip keamanan:
--   * Semua tabel memakai RLS; tiap pengguna hanya bisa membaca/mengubah datanya sendiri.
--   * Hak bawaan Supabase untuk anon/authenticated dicabut dulu, lalu diberikan seperlunya,
--     jadi penolakan tidak bergantung pada RLS saja.
--   * EXP, level, laporan, dan notifikasi tidak bisa diubah langsung dari aplikasi;
--     hanya lewat fungsi/trigger di server.
--
-- Menjadikan akunmu Developer (sekali, setelah akunnya terdaftar):
--   update public.profiles set role = 'developer', verified = true, exp = 203840
--   where id = (select id from auth.users where email = 'emailkamu@gmail.com');
-- Peran hanya bisa diubah dari SQL Editor ini (atau oleh Developer lewat fungsi set_role),
-- tidak pernah langsung dari aplikasi.
begin;

-- =====================================================================
-- 1. Profil (nama tampilan + EXP). Dibuat otomatis saat pengguna mendaftar.
-- =====================================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default 'Pembaca',
  exp integer not null default 0,
  created_at timestamptz not null default now(),
  constraint profiles_name_len check (char_length(btrim(name)) between 1 and 30),
  constraint profiles_exp_range check (exp >= 0)
);
-- foto profil: berkas di bucket "avatars" (folder milik sendiri), kolom ini hanya menyimpan jalurnya
alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles drop constraint if exists profiles_avatar_path;
alter table public.profiles add constraint profiles_avatar_path
  check (avatar_path is null or (char_length(avatar_path) <= 200 and avatar_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]+$'));
alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;
-- Nama dan EXP tampil di chat publik, jadi boleh dibaca semua orang.
grant select on table public.profiles to anon, authenticated;
-- Pengguna hanya boleh mengganti namanya sendiri; kolom exp tidak bisa disentuh.
grant update (name, avatar_path) on table public.profiles to authenticated;

drop policy if exists "profil dibaca publik" on public.profiles;
create policy "profil dibaca publik" on public.profiles for select using (true);
drop policy if exists "profil diubah pemiliknya" on public.profiles;
create policy "profil diubah pemiliknya" on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- Peran & status. role: user | moderator | developer. Kolom ini tidak bisa diubah dari aplikasi
-- (hak update hanya untuk kolom name).
alter table public.profiles add column if not exists role text not null default 'user';
alter table public.profiles add column if not exists verified boolean not null default false;
alter table public.profiles add column if not exists muted_until timestamptz;
alter table public.profiles add column if not exists banned boolean not null default false;
alter table public.profiles drop constraint if exists profiles_role_valid;
alter table public.profiles add constraint profiles_role_valid check (role in ('user', 'moderator', 'developer'));

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role in ('moderator', 'developer') and not p.banned);
$$;
create or replace function public.is_dev()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'developer');
$$;
revoke all on function public.is_staff() from public;
revoke all on function public.is_dev() from public;
grant execute on function public.is_staff() to anon, authenticated;
grant execute on function public.is_dev() to anon, authenticated;

-- Nama yang dicadangkan untuk akun resmi, agar tidak ada yang menyamar.
create or replace function public.name_is_reserved(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select k ~ '(rexxa|ninokuu|admin|developer|moderator|official|resmi)'
      or k in ('dev', 'mod', 'staff', 'cs', 'support')
  from (select pg_catalog.lower(pg_catalog.regexp_replace(coalesce(p_name, ''), '[^a-zA-Z0-9]', '', 'g')) as k) x;
$$;

create or replace function public.profiles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := pg_catalog.btrim(new.name);
  if new.role = 'user' and public.name_is_reserved(new.name) then
    if tg_op = 'INSERT' then
      new.name := 'Pembaca';
    elsif new.name is distinct from old.name then
      raise exception 'Nama ini khusus untuk akun resmi Ninokuu' using errcode = 'P0001', hint = 'reserved_name';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.profiles_guard() from public, anon, authenticated;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before insert or update on public.profiles
  for each row execute function public.profiles_guard();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  nm text := btrim(coalesce(new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1)));
begin
  if nm is null or nm = '' then nm := 'Pembaca'; end if;
  insert into public.profiles (id, name) values (new.id, left(nm, 30)) on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Pengguna yang sudah terdaftar sebelum skema ini dipasang juga dibuatkan profil.
insert into public.profiles (id, name)
select u.id, left(coalesce(nullif(btrim(split_part(coalesce(u.email, ''), '@', 1)), ''), 'Pembaca'), 30)
from auth.users u
on conflict (id) do nothing;

-- =====================================================================
-- 2. Koleksi (Favorit) + lonceng notifikasi per komik
-- =====================================================================
create table if not exists public.library (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source text not null,
  comic_id text not null,
  title text not null,
  cover text,
  notify boolean not null default false,
  added_at timestamptz not null default now(),
  primary key (user_id, source, comic_id),
  constraint library_len check (char_length(source) <= 40 and char_length(comic_id) <= 300
    and char_length(title) <= 300 and char_length(coalesce(cover, '')) <= 1000)
);
create index if not exists library_notify_idx on public.library (source, comic_id) where notify;
alter table public.library enable row level security;
revoke all on table public.library from anon, authenticated;
grant select, insert, update, delete on table public.library to authenticated;
drop policy if exists "koleksi milik sendiri" on public.library;
create policy "koleksi milik sendiri" on public.library for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- =====================================================================
-- 3. Riwayat baca (posisi terakhir per komik)
-- =====================================================================
create table if not exists public.history (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source text not null,
  comic_id text not null,
  title text not null,
  cover text,
  chapter text not null,
  page integer not null default 1,
  read_at timestamptz not null default now(),
  primary key (user_id, source, comic_id),
  constraint history_len check (char_length(source) <= 40 and char_length(comic_id) <= 300
    and char_length(title) <= 300 and char_length(coalesce(cover, '')) <= 1000
    and char_length(chapter) <= 40 and page between 1 and 10000)
);
create index if not exists history_recent_idx on public.history (user_id, read_at desc);
alter table public.history enable row level security;
revoke all on table public.history from anon, authenticated;
grant select, insert, update, delete on table public.history to authenticated;
drop policy if exists "riwayat milik sendiri" on public.history;
create policy "riwayat milik sendiri" on public.history for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- =====================================================================
-- 4. EXP dari membaca. Aplikasi cukup menjalankan
--      insert into read_log (source, comic_id, chapter) values (...) on conflict do nothing
--    setiap kali satu chapter selesai dibuka. Satu chapter hanya memberi EXP sekali, maksimal 300 EXP per hari,
--    level dihitung di aplikasi dari total EXP (maks level 99).
-- =====================================================================
create table if not exists public.read_log (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source text not null,
  comic_id text not null,
  chapter text not null,
  read_at timestamptz not null default now(),
  primary key (user_id, source, comic_id, chapter),
  constraint read_log_len check (char_length(source) <= 40 and char_length(comic_id) <= 300 and char_length(chapter) <= 40)
);
alter table public.read_log enable row level security;
revoke all on table public.read_log from anon, authenticated;
grant select on table public.read_log to authenticated;
grant insert (source, comic_id, chapter) on table public.read_log to authenticated;
drop policy if exists "log baca dibaca sendiri" on public.read_log;
create policy "log baca dibaca sendiri" on public.read_log for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "log baca ditulis sendiri" on public.read_log;
create policy "log baca ditulis sendiri" on public.read_log for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- Penghitung harian, hanya disentuh trigger (tanpa policy = tidak bisa diakses dari aplikasi).
create table if not exists public.exp_daily (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  gained integer not null default 0,
  primary key (user_id, day)
);
alter table public.exp_daily enable row level security;
revoke all on table public.exp_daily from anon, authenticated;

create or replace function public.award_read_exp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  per_chapter constant integer := 10;
  daily_cap constant integer := 300;
  max_exp constant integer := 1000000;
  today date := (pg_catalog.now() at time zone 'Asia/Jakarta')::date;
  got integer;
begin
  insert into public.exp_daily as d (user_id, day, gained) values (new.user_id, today, per_chapter)
  on conflict (user_id, day) do update set gained = d.gained + per_chapter
    where d.gained + per_chapter <= daily_cap
  returning gained into got;
  if got is not null then
    update public.profiles set exp = least(exp + per_chapter, max_exp) where id = new.user_id;
  end if;
  return null;
end;
$$;
revoke all on function public.award_read_exp() from public, anon, authenticated;

drop trigger if exists read_log_award on public.read_log;
create trigger read_log_award after insert on public.read_log
  for each row execute function public.award_read_exp();

-- =====================================================================
-- 5. Pengaturan (mode baca, arah, tampilan, dll.) disimpan sebagai JSON kecil
-- =====================================================================
create table if not exists public.settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint settings_obj check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 16384)
);
alter table public.settings enable row level security;
revoke all on table public.settings from anon, authenticated;
grant select, insert, update, delete on table public.settings to authenticated;
drop policy if exists "pengaturan milik sendiri" on public.settings;
create policy "pengaturan milik sendiri" on public.settings for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- =====================================================================
-- 6. Perangkat untuk notifikasi (token FCM). Edge Function memakai service role untuk mengirim.
-- =====================================================================
create table if not exists public.devices (
  token text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  platform text not null default 'android',
  updated_at timestamptz not null default now(),
  constraint devices_len check (char_length(token) between 10 and 4096),
  constraint devices_platform check (platform in ('android', 'web'))
);
create index if not exists devices_user_idx on public.devices (user_id);
alter table public.devices enable row level security;
revoke all on table public.devices from anon, authenticated;
grant select, insert, update, delete on table public.devices to authenticated;
drop policy if exists "perangkat milik sendiri" on public.devices;
create policy "perangkat milik sendiri" on public.devices for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Token yang pindah akun (logout lalu login akun lain di HP yang sama) diklaim lewat fungsi ini,
-- karena RLS tidak mengizinkan menimpa baris milik akun lain secara langsung.
create or replace function public.register_device(p_token text, p_platform text default 'android')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  insert into public.devices (token, user_id, platform, updated_at)
  values (p_token, auth.uid(), coalesce(p_platform, 'android'), pg_catalog.now())
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = excluded.updated_at;
end;
$$;
revoke all on function public.register_device(text, text) from public, anon;
grant execute on function public.register_device(text, text) to authenticated;

-- =====================================================================
-- 7. Kotak notifikasi (ikon lonceng di Home): maksimal 30 per pengguna, umur maksimal 7 hari.
--    Ditulis oleh Edge Function (service role); pengguna hanya membaca dan menghapus.
-- =====================================================================
create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  body text not null default '',
  source text,
  comic_id text,
  chapter text,
  cover text,
  created_at timestamptz not null default now(),
  constraint notifications_len check (char_length(title) <= 200 and char_length(body) <= 500)
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
revoke all on table public.notifications from anon, authenticated;
grant select, delete on table public.notifications to authenticated;
drop policy if exists "notifikasi dibaca sendiri" on public.notifications;
create policy "notifikasi dibaca sendiri" on public.notifications for select to authenticated
  using ((select auth.uid()) = user_id and created_at > now() - interval '7 days');
drop policy if exists "notifikasi dihapus sendiri" on public.notifications;
create policy "notifikasi dihapus sendiri" on public.notifications for delete to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.trim_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notifications n
  where n.user_id = new.user_id
    and (n.created_at < pg_catalog.now() - interval '7 days'
         or n.id not in (select x.id from public.notifications x where x.user_id = new.user_id
                         order by x.created_at desc, x.id desc limit 30));
  return null;
end;
$$;
revoke all on function public.trim_notifications() from public, anon, authenticated;

drop trigger if exists notifications_trim on public.notifications;
create trigger notifications_trim after insert on public.notifications
  for each row execute function public.trim_notifications();

-- =====================================================================
-- 8. Chat publik + komentar komik/chapter: semua bisa membaca, hanya yang login bisa menulis.
--    Jeda 5 detik antar pesan, maks 300 karakter, gambar opsional (lihat bagian 9).
--    room: 'public' = chat publik, 'c:<sumber>:<id komik>' = komentar komik,
--          'ch:<sumber>:<id komik>:<id chapter>' = komentar chapter.
-- =====================================================================
create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body text not null default '',
  image_path text,
  image_spoiler boolean not null default false,
  hidden boolean not null default false,
  room text not null default 'public',
  created_at timestamptz not null default now(),
  constraint chat_body_len check (char_length(body) <= 300),
  constraint chat_not_empty check (char_length(btrim(body)) > 0 or image_path is not null),
  constraint chat_image_path check (image_path is null or (char_length(image_path) <= 300 and image_path !~ '\.\.'))
);
-- pembaruan dari versi sebelum ada komentar komik/chapter
alter table public.chat_messages add column if not exists room text not null default 'public';
alter table public.chat_messages drop constraint if exists chat_room_fmt;
alter table public.chat_messages add constraint chat_room_fmt
  check (room = 'public' or (char_length(room) <= 300 and room ~ '^(c|ch):[a-z0-9]+:.+'));
create index if not exists chat_recent_idx on public.chat_messages (created_at desc);
create index if not exists chat_room_idx on public.chat_messages (room, id desc);
create index if not exists chat_user_idx on public.chat_messages (user_id, created_at desc);
alter table public.chat_messages enable row level security;
revoke all on table public.chat_messages from anon, authenticated;
grant select on table public.chat_messages to anon, authenticated;
grant insert (body, image_path, image_spoiler, room) on table public.chat_messages to authenticated;
grant delete on table public.chat_messages to authenticated;

drop policy if exists "chat dibaca publik" on public.chat_messages;
create policy "chat dibaca publik" on public.chat_messages for select
  using (created_at > now() - case when room = 'public' then interval '30 days' else interval '180 days' end
         and (not hidden or (select public.is_staff())));
drop policy if exists "chat ditulis yang login" on public.chat_messages;
create policy "chat ditulis yang login" on public.chat_messages for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    -- gambar hanya boleh dari folder milik pengirim sendiri: <user_id>/<nama-file>
    and (image_path is null or split_part(image_path, '/', 1) = (select auth.uid())::text)
  );
drop policy if exists "chat dihapus pengirimnya" on public.chat_messages;
create policy "chat dihapus pengirimnya" on public.chat_messages for delete to authenticated
  using ((select auth.uid()) = user_id or (select public.is_staff()));

create or replace function public.chat_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  last_at timestamptz;
  me public.profiles%rowtype;
begin
  new.created_at := pg_catalog.now();
  new.hidden := false;
  new.body := btrim(new.body);
  select * into me from public.profiles p where p.id = new.user_id;
  if me.banned then
    raise exception 'Akunmu diblokir dari chat publik' using errcode = 'P0001', hint = 'banned';
  end if;
  if me.muted_until is not null and me.muted_until > pg_catalog.now() then
    raise exception 'Kamu sedang dibisukan sampai %', to_char(me.muted_until at time zone 'Asia/Jakarta', 'HH24:MI') || ' WIB'
      using errcode = 'P0001', hint = 'muted';
  end if;
  if me.role in ('moderator', 'developer') then
    return new; -- staf bebas jeda
  end if;
  select max(c.created_at) into last_at from public.chat_messages c where c.user_id = new.user_id;
  if last_at is not null and last_at > pg_catalog.now() - interval '5 seconds' then
    raise exception 'Pelan-pelan ya, tunggu beberapa detik' using errcode = 'P0001', hint = 'cooldown';
  end if;
  return new;
end;
$$;
revoke all on function public.chat_guard() from public, anon, authenticated;

drop trigger if exists chat_messages_guard on public.chat_messages;
create trigger chat_messages_guard before insert on public.chat_messages
  for each row execute function public.chat_guard();

-- Laporan pesan. Pesan otomatis disembunyikan setelah 3 pelapor berbeda.
create table if not exists public.chat_reports (
  message_id bigint not null references public.chat_messages (id) on delete cascade,
  reporter uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reason text not null default '',
  created_at timestamptz not null default now(),
  primary key (message_id, reporter),
  constraint chat_reports_len check (char_length(reason) <= 200)
);
alter table public.chat_reports enable row level security;
revoke all on table public.chat_reports from anon, authenticated;
grant select, insert on table public.chat_reports to authenticated;
drop policy if exists "laporan dibaca pelapor" on public.chat_reports;
create policy "laporan dibaca pelapor" on public.chat_reports for select to authenticated
  using ((select auth.uid()) = reporter or (select public.is_staff()));
drop policy if exists "laporan dibuat pelapor" on public.chat_reports;
create policy "laporan dibuat pelapor" on public.chat_reports for insert to authenticated
  with check ((select auth.uid()) = reporter);

create or replace function public.chat_report_hide()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.chat_reports r where r.message_id = new.message_id) >= 3 then
    update public.chat_messages set hidden = true where id = new.message_id;
  end if;
  return null;
end;
$$;
revoke all on function public.chat_report_hide() from public, anon, authenticated;

drop trigger if exists chat_reports_hide on public.chat_reports;
create trigger chat_reports_hide after insert on public.chat_reports
  for each row execute function public.chat_report_hide();

-- Daftar chat siap tampil (nama + EXP pengirim). Mengikuti RLS pembaca.
create or replace view public.chat_feed with (security_invoker = true) as
select c.id, c.user_id, p.name, p.exp, c.body, c.image_path, c.image_spoiler, c.created_at,
       p.role, p.verified, c.hidden, c.room, p.avatar_path
from public.chat_messages c
join public.profiles p on p.id = c.user_id;
revoke all on table public.chat_feed from anon, authenticated;
grant select on table public.chat_feed to anon, authenticated;

-- Pembersihan berkala (dipanggil cron Edge Function): chat publik lebih dari 30 hari dan
-- komentar komik/chapter lebih dari 180 hari dihapus.
-- File gambarnya dihapus oleh Edge Function lewat Storage API.
create or replace function public.chat_cleanup(older_than interval default interval '30 days')
returns setof text
language sql
security definer
set search_path = ''
as $$
  delete from public.chat_messages
  where (room = 'public' and created_at < pg_catalog.now() - older_than)
     or (room <> 'public' and created_at < pg_catalog.now() - interval '180 days')
  returning image_path;
$$;
revoke all on function public.chat_cleanup(interval) from public, anon, authenticated;
grant execute on function public.chat_cleanup(interval) to service_role;

-- =====================================================================
-- 9. Alat staf (moderator & developer). Semua dicek di server, bukan hanya di aplikasi.
-- =====================================================================
-- Tampilkan / sembunyikan pesan.
create or replace function public.mod_set_hidden(p_message bigint, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_staff() then raise exception 'khusus moderator' using errcode = '42501'; end if;
  update public.chat_messages set hidden = p_hidden where id = p_message;
  if not p_hidden then delete from public.chat_reports where message_id = p_message; end if;
end;
$$;

-- Bisukan (menit > 0), cabut bisu (0), blokir / buka blokir. Moderator hanya bisa menindak
-- pengguna biasa; developer bisa menindak moderator; developer tidak bisa ditindak.
create or replace function public.mod_restrict(p_user uuid, p_mute_minutes integer default null, p_ban boolean default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me text := (select p.role from public.profiles p where p.id = auth.uid());
  target text := (select p.role from public.profiles p where p.id = p_user);
begin
  if not public.is_staff() then raise exception 'khusus moderator' using errcode = '42501'; end if;
  if target is null then raise exception 'pengguna tidak ditemukan' using errcode = 'P0002'; end if;
  if p_user = auth.uid() or target = 'developer' or (target = 'moderator' and me <> 'developer') then
    raise exception 'tidak boleh menindak akun ini' using errcode = '42501';
  end if;
  if p_mute_minutes is not null then
    update public.profiles set muted_until = case when p_mute_minutes > 0
      then pg_catalog.now() + pg_catalog.make_interval(mins => least(p_mute_minutes, 60 * 24 * 30)) end
    where id = p_user;
  end if;
  if p_ban is not null then
    update public.profiles set banned = p_ban where id = p_user;
    if p_ban then update public.chat_messages set hidden = true where user_id = p_user; end if;
  end if;
end;
$$;

-- Khusus developer: atur peran dan centang verifikasi orang lain.
create or replace function public.dev_set_role(p_user uuid, p_role text default null, p_verified boolean default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_dev() then raise exception 'khusus developer' using errcode = '42501'; end if;
  if p_user = auth.uid() and p_role is not null and p_role <> 'developer' then
    raise exception 'developer tidak bisa menurunkan perannya sendiri dari aplikasi' using errcode = '42501';
  end if;
  update public.profiles set role = coalesce(p_role, role), verified = coalesce(p_verified, verified) where id = p_user;
end;
$$;

revoke all on function public.mod_set_hidden(bigint, boolean) from public, anon;
revoke all on function public.mod_restrict(uuid, integer, boolean) from public, anon;
revoke all on function public.dev_set_role(uuid, text, boolean) from public, anon;
grant execute on function public.mod_set_hidden(bigint, boolean) to authenticated;
grant execute on function public.mod_restrict(uuid, integer, boolean) to authenticated;
grant execute on function public.dev_set_role(uuid, text, boolean) to authenticated;

-- Pengumuman dari developer: bisa disematkan di atas chat dan dikirim sebagai notifikasi
-- (pengiriman notifikasinya dilakukan Edge Function, berdasarkan kolom push).
create table if not exists public.announcements (
  id bigint generated always as identity primary key,
  title text not null,
  body text not null default '',
  pinned boolean not null default true,
  push boolean not null default false,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint announcements_len check (char_length(btrim(title)) between 1 and 80 and char_length(body) <= 500)
);
create index if not exists announcements_recent_idx on public.announcements (created_at desc);
-- sematan bisa berakhir otomatis (null = sampai dilepas developer)
alter table public.announcements add column if not exists pinned_until timestamptz;
alter table public.announcements enable row level security;
revoke all on table public.announcements from anon, authenticated;
grant select on table public.announcements to anon, authenticated;
grant insert (title, body, pinned, push, pinned_until), update (title, body, pinned, pinned_until), delete on table public.announcements to authenticated;
drop policy if exists "pengumuman dibaca publik" on public.announcements;
create policy "pengumuman dibaca publik" on public.announcements for select using (true);
drop policy if exists "pengumuman dibuat developer" on public.announcements;
create policy "pengumuman dibuat developer" on public.announcements for insert to authenticated
  with check ((select public.is_dev()) and created_by = (select auth.uid()));
drop policy if exists "pengumuman diubah developer" on public.announcements;
create policy "pengumuman diubah developer" on public.announcements for update to authenticated
  using ((select public.is_dev())) with check ((select public.is_dev()));
drop policy if exists "pengumuman dihapus developer" on public.announcements;
create policy "pengumuman dihapus developer" on public.announcements for delete to authenticated
  using ((select public.is_dev()));

-- notifikasi lonceng dari pengumuman ikut terhapus saat pengumuman ditarik (dihapus)
alter table public.notifications add column if not exists announcement_id bigint;
do $$ begin
  alter table public.notifications add constraint notifications_announcement_fk
    foreign key (announcement_id) references public.announcements (id) on delete cascade;
exception when duplicate_object then null; end $$;
create index if not exists notifications_ann_idx on public.notifications (announcement_id) where announcement_id is not null;

-- Statistik ringkas untuk Panel developer.
-- Laporan masalah komik/chapter dari pembaca (tombol "Laporkan"). Dibaca staf di Panel developer.
create table if not exists public.bug_reports (
  id bigint generated always as identity primary key,
  user_id uuid default auth.uid() references auth.users (id) on delete set null,
  source text not null,
  comic_id text not null,
  chapter_id text,
  title text not null default '',
  chapter text not null default '',
  kind text not null,
  note text not null default '',
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  constraint bug_kind check (kind in ('gambar', 'chapter', 'urutan', 'info', 'lainnya')),
  constraint bug_len check (char_length(source) <= 30 and char_length(comic_id) <= 300 and char_length(coalesce(chapter_id, '')) <= 300
                            and char_length(title) <= 200 and char_length(chapter) <= 30 and char_length(note) <= 300)
);
create index if not exists bug_open_idx on public.bug_reports (resolved, created_at desc);
alter table public.bug_reports enable row level security;
revoke all on table public.bug_reports from anon, authenticated;
grant insert (source, comic_id, chapter_id, title, chapter, kind, note) on table public.bug_reports to authenticated;
grant select, delete on table public.bug_reports to authenticated;
grant update (resolved) on table public.bug_reports to authenticated;
drop policy if exists "laporan bug dibuat pelapor" on public.bug_reports;
create policy "laporan bug dibuat pelapor" on public.bug_reports for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "laporan bug dibaca staf" on public.bug_reports;
create policy "laporan bug dibaca staf" on public.bug_reports for select to authenticated
  using ((select public.is_staff()));
drop policy if exists "laporan bug diubah staf" on public.bug_reports;
create policy "laporan bug diubah staf" on public.bug_reports for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
drop policy if exists "laporan bug dihapus staf" on public.bug_reports;
create policy "laporan bug dihapus staf" on public.bug_reports for delete to authenticated
  using ((select public.is_staff()));

-- Batas: 10 laporan per pengguna per hari, laporan sama untuk chapter yang sama tidak diulang.
create or replace function public.bug_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_at := pg_catalog.now();
  new.resolved := false;
  new.note := btrim(new.note);
  if (select count(*) from public.bug_reports b where b.user_id = new.user_id
      and b.created_at > pg_catalog.now() - interval '1 day') >= 10 then
    raise exception 'Batas laporan hari ini sudah tercapai, coba lagi besok' using errcode = 'P0001', hint = 'limit';
  end if;
  if exists (select 1 from public.bug_reports b where b.user_id = new.user_id and not b.resolved
             and b.source = new.source and b.comic_id = new.comic_id
             and b.chapter_id is not distinct from new.chapter_id and b.kind = new.kind) then
    raise exception 'Kamu sudah melaporkan masalah ini, terima kasih' using errcode = 'P0001', hint = 'dup';
  end if;
  return new;
end;
$$;
revoke all on function public.bug_guard() from public, anon, authenticated;
drop trigger if exists bug_reports_guard on public.bug_reports;
create trigger bug_reports_guard before insert on public.bug_reports
  for each row execute function public.bug_guard();

create or replace function public.dev_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ka timestamptz;
begin
  if not public.is_dev() then raise exception 'khusus developer' using errcode = '42501'; end if;
  if pg_catalog.to_regclass('public.keepalive') is not null then
    execute 'select pinged_at from public.keepalive where id = 1' into ka;
  end if;
  return pg_catalog.jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'messages_today', (select count(*) from public.chat_messages
                       where created_at >= (pg_catalog.now() at time zone 'Asia/Jakarta')::date::timestamp at time zone 'Asia/Jakarta'),
    'reports_open', (select count(distinct r.message_id) from public.chat_reports r
                     join public.chat_messages c on c.id = r.message_id where not c.hidden),
    'hidden', (select count(*) from public.chat_messages where hidden),
    'restricted', (select count(*) from public.profiles where banned or muted_until > pg_catalog.now()),
    'bugs_open', (select count(*) from public.bug_reports where not resolved),
    'last_keepalive', ka,
    'last_cron', case when pg_catalog.to_regclass('public.server_state') is not null
                      then (select v ->> 'at' from public.server_state where k = 'cron') end);
end;
$$;
revoke all on function public.dev_stats() from public, anon;
grant execute on function public.dev_stats() to authenticated;

-- Penanda pengumuman yang notifikasinya sudah dikirim Edge Function.
alter table public.announcements add column if not exists pushed_at timestamptz;

-- =====================================================================
-- 9b. Data kerja server (hanya dipakai Edge Function ninokuu-api lewat kunci server;
--     tanpa policy = tidak bisa dibaca atau diubah dari aplikasi).
-- =====================================================================
-- Chapter terbaru yang terakhir dilihat per komik, dasar notifikasi chapter baru.
create table if not exists public.comic_state (
  source text not null,
  comic_id text not null,
  title text not null default '',
  cover text,
  last_chapter text,
  last_num numeric,
  checked_at timestamptz,
  last_error text,
  primary key (source, comic_id)
);
create index if not exists comic_state_checked_idx on public.comic_state (checked_at nulls first);
alter table public.comic_state enable row level security;
revoke all on table public.comic_state from anon, authenticated;

-- Catatan kecil server (waktu jalan cron terakhir, dll.).
create table if not exists public.server_state (
  k text primary key,
  v jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.server_state enable row level security;
revoke all on table public.server_state from anon, authenticated;

-- =====================================================================
-- 10. Penyimpanan gambar chat: bucket publik "chat-images", maks 30 MB per file,
--    hanya JPG/PNG/WEBP/GIF, tiap pengguna hanya bisa mengunggah ke foldernya sendiri.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-images', 'chat-images', true, 31457280, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "chat-images unggah ke folder sendiri" on storage.objects;
create policy "chat-images unggah ke folder sendiri" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "chat-images hapus milik sendiri" on storage.objects;
create policy "chat-images hapus milik sendiri" on storage.objects for delete to authenticated
  using (bucket_id = 'chat-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- developer boleh menghapus gambar siapa pun (dipakai pembersih penyimpanan di Panel developer)
drop policy if exists "chat-images dihapus developer" on storage.objects;
create policy "chat-images dihapus developer" on storage.objects for delete to authenticated
  using (bucket_id = 'chat-images' and (select public.is_dev()));

-- =====================================================================
-- 11. Kontrol penyimpanan (Panel developer): ukuran database & gambar, lalu pembersih.
--     Paket Free Supabase: database 500 MB, Storage 1 GB.
-- =====================================================================
create or replace function public.dev_storage()
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t text;
  tables json;
begin
  if not public.is_dev() then raise exception 'khusus developer' using errcode = '42501'; end if;
  select json_agg(x order by x.bytes desc) into tables from (
    select c.relname as name, pg_catalog.pg_total_relation_size(c.oid) as bytes,
           coalesce(s.n_live_tup, 0) as rows
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    left join pg_catalog.pg_stat_user_tables s on s.relid = c.oid
    where n.nspname = 'public' and c.relkind = 'r'
  ) x;
  return json_build_object(
    'db_bytes', pg_catalog.pg_database_size(pg_catalog.current_database()),
    'db_quota', 500 * 1024 * 1024,
    'tables', coalesce(tables, '[]'::json),
    'img_bytes', (select coalesce(sum((o.metadata->>'size')::bigint), 0) from storage.objects o where o.bucket_id = 'chat-images'),
    'img_count', (select count(*) from storage.objects o where o.bucket_id = 'chat-images'),
    'img_orphans', (select count(*) from storage.objects o where o.bucket_id = 'chat-images'
                      and not exists (select 1 from public.chat_messages m where m.image_path = o.name)),
    'img_quota', 1024 * 1024 * 1024,
    'avatar_bytes', (select coalesce(sum((o.metadata->>'size')::bigint), 0) from storage.objects o where o.bucket_id = 'avatars'),
    'avatar_count', (select count(*) from storage.objects o where o.bucket_id = 'avatars'),
    'avatar_orphans', (select count(*) from storage.objects o where o.bucket_id = 'avatars'
                         and not exists (select 1 from public.profiles p where p.avatar_path = o.name)),
    'chat_public', (select count(*) from public.chat_messages where room = 'public'),
    'comments', (select count(*) from public.chat_messages where room <> 'public'),
    'oldest_chat', (select min(created_at) from public.chat_messages where room = 'public'),
    'notifications', (select count(*) from public.notifications),
    'read_log', (select count(*) from public.read_log),
    'bugs_done', (select count(*) from public.bug_reports where resolved),
    'comic_orphans', (select count(*) from public.comic_state cs where not exists
                        (select 1 from public.library l where l.source = cs.source and l.comic_id = cs.comic_id and l.notify))
  );
end;
$$;
revoke all on function public.dev_storage() from public, anon;
grant execute on function public.dev_storage() to authenticated;

-- Pembersih. Mengembalikan jumlah yang dihapus dan daftar file gambar yang harus dihapus
-- lewat Storage API oleh aplikasi (Supabase tidak mengizinkan menghapus file langsung dari SQL).
create or replace function public.dev_cleanup(p_kind text, p_days int default 30)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  cutoff timestamptz;
  n int := 0;
  imgs text[] := '{}';
begin
  if not public.is_dev() then raise exception 'khusus developer' using errcode = '42501'; end if;
  if p_days is null or p_days < 1 or p_days > 3650 then raise exception 'Jumlah hari harus 1 sampai 3650' using errcode = '22023'; end if;
  cutoff := pg_catalog.now() - pg_catalog.make_interval(days => p_days);

  if p_kind = 'chat_public' or p_kind = 'comments' then
    with d as (
      delete from public.chat_messages
      where created_at < cutoff and ((p_kind = 'chat_public' and room = 'public') or (p_kind = 'comments' and room <> 'public'))
      returning image_path
    ) select count(*), coalesce(array_agg(image_path) filter (where image_path is not null), '{}') into n, imgs from d;

  elsif p_kind = 'chat_images' then
    -- gambar lama dibuang, teksnya tetap; pesan yang isinya hanya gambar ikut dihapus
    with old as (
      select id, image_path, char_length(btrim(body)) > 0 as has_text from public.chat_messages
      where image_path is not null and created_at < cutoff
    ), u as (
      update public.chat_messages m set image_path = null, image_spoiler = false
      from old where m.id = old.id and old.has_text returning old.image_path
    ), d as (
      delete from public.chat_messages m using old where m.id = old.id and not old.has_text returning old.image_path
    ) select count(*), coalesce(array_agg(image_path), '{}') into n, imgs from (select * from u union all select * from d) z;

  elsif p_kind = 'img_orphans' then
    select count(*), coalesce(array_agg(o.name), '{}') into n, imgs from storage.objects o
    where o.bucket_id = 'chat-images' and not exists (select 1 from public.chat_messages m where m.image_path = o.name);

  elsif p_kind = 'avatar_orphans' then
    -- foto profil lama yang tidak dipakai siapa pun (mis. gagal terhapus saat ganti foto)
    select count(*), coalesce(array_agg(o.name), '{}') into n, imgs from storage.objects o
    where o.bucket_id = 'avatars' and o.created_at < pg_catalog.now() - interval '1 hour'
      and not exists (select 1 from public.profiles p where p.avatar_path = o.name);

  elsif p_kind = 'notifications' then
    delete from public.notifications where created_at < cutoff;
    get diagnostics n = row_count;

  elsif p_kind = 'read_log' then
    -- EXP tetap tersimpan di profil; log baca hanya dipakai untuk batas EXP harian
    if p_days < 90 then raise exception 'Log baca minimal disimpan 90 hari' using errcode = '22023'; end if;
    delete from public.read_log where read_at < cutoff;
    get diagnostics n = row_count;

  elsif p_kind = 'bugs_done' then
    delete from public.bug_reports where resolved;
    get diagnostics n = row_count;

  elsif p_kind = 'comic_orphans' then
    delete from public.comic_state cs where not exists
      (select 1 from public.library l where l.source = cs.source and l.comic_id = cs.comic_id and l.notify);
    get diagnostics n = row_count;

  else
    raise exception 'Jenis pembersihan tidak dikenal: %', p_kind using errcode = '22023';
  end if;
  return json_build_object('kind', p_kind, 'deleted', n, 'images', imgs);
end;
$$;
revoke all on function public.dev_cleanup(text, int) from public, anon;
grant execute on function public.dev_cleanup(text, int) to authenticated;

-- =====================================================================
-- 11b. Foto profil: bucket publik "avatars", maks 10 MB, hanya ke folder sendiri.
--      Aplikasi menghapus foto lama setelah foto baru tersimpan (hemat ruang).
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "avatars unggah ke folder sendiri" on storage.objects;
create policy "avatars unggah ke folder sendiri" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "avatars hapus milik sendiri" on storage.objects;
create policy "avatars hapus milik sendiri" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_dev())));

-- jalur foto profil wajib di folder milik sendiri (tidak bisa memakai foto orang lain)
create or replace function public.profile_avatar_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.avatar_path is not null and new.avatar_path is distinct from old.avatar_path
     and pg_catalog.split_part(new.avatar_path, '/', 1) <> new.id::text then
    raise exception 'Foto profil harus berada di folder milik sendiri' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_avatar_guard on public.profiles;
create trigger profiles_avatar_guard before update of avatar_path on public.profiles
  for each row execute function public.profile_avatar_guard();

-- =====================================================================
-- 12. Kunci server (Edge Function: cron, notifikasi HP, pembersihan) butuh akses penuh.
--     Proyek Supabase baru tidak lagi memberi izin ini otomatis untuk tabel buatan sendiri;
--     tanpa ini server tidak bisa membaca daftar HP (tes notifikasi: "HP belum terdaftar")
--     dan tidak bisa menulis notifikasi ke lonceng. service_role hanya dipakai di server.
-- =====================================================================
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;

commit;
