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

-- Hierarki moderasi: siapa boleh menindak siapa. Pengguna biasa → moderator & developer;
-- moderator → developer saja; developer tidak bisa ditindak oleh siapa pun. Menindak diri sendiri
-- tidak termasuk (lihat mod_set_hidden untuk pesan milik sendiri).
create or replace function public.can_moderate_user(p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles me, public.profiles t
    where me.id = auth.uid() and me.role in ('moderator', 'developer') and not me.banned
      and t.id = p_target and t.id <> me.id
      and (t.role = 'user' or (t.role = 'moderator' and me.role = 'developer'))
  );
$$;
revoke all on function public.can_moderate_user(uuid) from public, anon;
grant execute on function public.can_moderate_user(uuid) to authenticated;

-- Nama yang dicadangkan untuk akun resmi, agar tidak ada yang menyamar.
-- Nama dilipat dulu supaya tipuan tidak lolos: NFKD (huruf lebar penuh/berstyle jadi biasa, aksen dilepas),
-- huruf Cyrillic/Yunani yang mirip Latin, @ dan $, angka pengganti huruf (0=o, 3=e, 4=a, 5=s, 7=t, 1=i atau l),
-- lalu semua karakter selain a-z0-9 (spasi, titik, karakter lebar nol) dibuang.
create or replace function public.name_fold(p_name text, p_one text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.translate(
    pg_catalog.regexp_replace(
      pg_catalog.translate(
        pg_catalog.regexp_replace(pg_catalog.lower(normalize(coalesce(p_name, ''), NFKD)), '[\u0300-\u036f]', '', 'g'),
        'аеорсхуіјѕһԁɡοαεινρτ@$', 'aeopcxyijshdgoaeivptas'),
      '[^a-z0-9]', '', 'g'),
    '013457', 'o' || p_one || 'east');
$$;
revoke all on function public.name_fold(text, text) from public, anon, authenticated;

create or replace function public.name_is_reserved(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(pg_catalog.bool_or(k ~ '(rexxa|ninokuu|admin|developer|moderator|official|resmi)'
                                     or k in ('dev', 'mod', 'staff', 'cs', 'support')), false)
  from unnest(array[public.name_fold(p_name, 'i'), public.name_fold(p_name, 'l')]) as t(k);
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
  -- Nama tidak pernah diambil dari email: nama tampil bersifat publik (chat, profil).
  nm text := btrim(coalesce(new.raw_user_meta_data ->> 'name', ''));
begin
  if nm = '' then nm := 'Pembaca'; end if;
  insert into public.profiles (id, name) values (new.id, left(nm, 30)) on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Pengguna yang sudah terdaftar sebelum skema ini dipasang juga dibuatkan profil (nama netral, bukan dari email).
-- Profil lama yang namanya terlanjur sama dengan bagian depan emailnya TIDAK diubah otomatis. Bila ingin
-- mengembalikannya ke nama netral, jalankan manual (hapus tanda komentar) setelah memeriksa hasilnya:
--   update public.profiles p set name = 'Pembaca' from auth.users u
--   where u.id = p.id and p.role = 'user' and lower(p.name) = lower(split_part(coalesce(u.email, ''), '@', 1));
insert into public.profiles (id, name)
select u.id, 'Pembaca'
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
-- Rak (kategori koleksi buatan pengguna): satu rak per komik, nama maks. 30 huruf.
alter table public.library add column if not exists shelf text;
do $$ begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'library_shelf_len') then
    alter table public.library add constraint library_shelf_len check (shelf is null or char_length(shelf) between 1 and 30);
  end if;
end $$;
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
--    setiap kali satu chapter selesai dibaca sampai habis. Satu chapter hanya memberi EXP sekali;
--    besaran & batas harian diatur grant_exp (bagian 13). Level dihitung di aplikasi (maks 99).
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

-- Ringkasan EXP per hari (WIB) dari riwayat EXP yang sudah dihapus pembersihan (> 7 hari), disimpan 31 hari,
-- supaya Rekap 30 hari tetap menghitung EXP dengan benar. Hanya disentuh fungsi server (tanpa policy).
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
declare t text;
begin
  -- judul diambil dari riwayat baca (untuk tampilan Riwayat EXP); aturan EXP ada di grant_exp (bagian 13)
  select h.title into t from public.history h where h.user_id = new.user_id and h.source = new.source and h.comic_id = new.comic_id;
  perform public.grant_exp(new.user_id, 'read', null, pg_catalog.concat_ws(' · ', t, 'Ch. ' || new.chapter));
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

-- Maksimal 10 perangkat per akun; yang paling lama tidak dipakai disingkirkan (juga untuk insert langsung lewat API).
create or replace function public.devices_trim(p_uid uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.devices d
  where d.user_id = p_uid
    and d.token not in (select x.token from public.devices x where x.user_id = p_uid
                        order by x.updated_at desc, x.token limit 10);
$$;
revoke all on function public.devices_trim(uuid) from public, anon, authenticated;

create or replace function public.devices_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('dev:' || new.user_id::text, 0));
  perform public.devices_trim(new.user_id);
  return null;
end;
$$;
revoke all on function public.devices_cap() from public, anon, authenticated;
drop trigger if exists devices_cap on public.devices;
create trigger devices_cap after insert on public.devices
  for each row execute function public.devices_cap();

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
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('dev:' || auth.uid()::text, 0));
  insert into public.devices (token, user_id, platform, updated_at)
  values (p_token, auth.uid(), coalesce(p_platform, 'android'), pg_catalog.now())
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = excluded.updated_at;
  -- token yang pindah akun menambah jumlah perangkat akun ini: sisakan 10 yang terbaru
  perform public.devices_trim(auth.uid());
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
-- reviewed: staf pernah menayangkan ulang pesan ini → laporan massal tidak menyembunyikannya lagi
alter table public.chat_messages add column if not exists reviewed boolean not null default false;
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
-- Staf hanya bisa menghapus pesan pengguna di bawah levelnya (lihat can_moderate_user).
drop policy if exists "chat dihapus pengirimnya" on public.chat_messages;
create policy "chat dihapus pengirimnya" on public.chat_messages for delete to authenticated
  using ((select auth.uid()) = user_id or (select public.can_moderate_user(user_id)));

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
  new.reviewed := false;
  new.body := btrim(new.body);
  -- satu pengirim = satu antrean: dua kiriman serentak tidak bisa sama-sama lolos jeda
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('chat:' || new.user_id::text, 0));
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

-- Penjaga laporan: tidak boleh melapor pesan sendiri, pesan staf, atau pesan yang sudah ditinjau staf;
-- pelapor harus berakun minimal 1 hari, tidak diblokir, dan maks. 20 laporan per hari.
create or replace function public.chat_report_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m record;
  me record;
begin
  new.created_at := pg_catalog.now();
  new.reason := pg_catalog.left(btrim(new.reason), 200);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('report:' || new.reporter::text, 0));
  select c.user_id, c.reviewed, p.role into m
    from public.chat_messages c join public.profiles p on p.id = c.user_id where c.id = new.message_id;
  if not found then raise exception 'Pesan tidak ditemukan' using errcode = 'P0002'; end if;
  if m.user_id = new.reporter then
    raise exception 'Tidak bisa melaporkan pesanmu sendiri' using errcode = 'P0001', hint = 'self';
  end if;
  if m.role <> 'user' or m.reviewed then
    raise exception 'Pesan ini tidak bisa dilaporkan' using errcode = 'P0001', hint = 'not_reportable';
  end if;
  select p.created_at, p.banned into me from public.profiles p where p.id = new.reporter;
  if me.banned then raise exception 'Akunmu diblokir' using errcode = 'P0001', hint = 'banned'; end if;
  if me.created_at > pg_catalog.now() - interval '1 day' then
    raise exception 'Akun baru belum bisa melaporkan, coba lagi besok' using errcode = 'P0001', hint = 'too_new';
  end if;
  if (select count(*) from public.chat_reports r where r.reporter = new.reporter
      and r.created_at > pg_catalog.now() - interval '1 day') >= 20 then
    raise exception 'Batas laporan hari ini sudah tercapai' using errcode = 'P0001', hint = 'limit';
  end if;
  return new;
end;
$$;
revoke all on function public.chat_report_guard() from public, anon, authenticated;
drop trigger if exists chat_reports_guard on public.chat_reports;
create trigger chat_reports_guard before insert on public.chat_reports
  for each row execute function public.chat_report_guard();

create or replace function public.chat_report_hide()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.chat_reports r where r.message_id = new.message_id) >= 3 then
    -- pesan staf / yang sudah ditinjau staf tidak disembunyikan otomatis
    update public.chat_messages c set hidden = true
    where c.id = new.message_id and not c.reviewed
      and exists (select 1 from public.profiles p where p.id = c.user_id and p.role = 'user');
  end if;
  return null;
end;
$$;
revoke all on function public.chat_report_hide() from public, anon, authenticated;

drop trigger if exists chat_reports_hide on public.chat_reports;
create trigger chat_reports_hide after insert on public.chat_reports
  for each row execute function public.chat_report_hide();

-- Daftar chat siap tampil (nama + EXP pengirim). Mengikuti RLS pembaca.
-- Balas pesan/komentar: reply_to menunjuk pesan lain di ruang yang sama (pesan induk dihapus → balasan tetap ada, kutipannya hilang)
alter table public.chat_messages add column if not exists reply_to bigint references public.chat_messages (id) on delete set null;
create index if not exists chat_reply_idx on public.chat_messages (reply_to) where reply_to is not null;
grant insert (body, image_path, image_spoiler, room, reply_to) on table public.chat_messages to authenticated;
create or replace function public.chat_reply_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- hanya boleh membalas pesan di ruang yang sama (bukan lintas komik/chat publik)
  if new.reply_to is not null and not exists (select 1 from public.chat_messages p where p.id = new.reply_to and p.room = new.room) then
    new.reply_to := null;
  end if;
  return new;
end;
$$;
revoke all on function public.chat_reply_guard() from public, anon, authenticated;
drop trigger if exists chat_messages_reply_guard on public.chat_messages;
create trigger chat_messages_reply_guard before insert on public.chat_messages
  for each row execute function public.chat_reply_guard();
create or replace view public.chat_feed with (security_invoker = true) as
select c.id, c.user_id, p.name, p.exp, c.body, c.image_path, c.image_spoiler, c.created_at,
       p.role, p.verified, c.hidden, c.room, p.avatar_path, c.reply_to
from public.chat_messages c
join public.profiles p on p.id = c.user_id;
revoke all on table public.chat_feed from anon, authenticated;
grant select on table public.chat_feed to anon, authenticated;

-- Pembersihan berkala (dipanggil cron Edge Function): chat publik lebih dari 30 hari,
-- komentar komik/chapter lebih dari 180 hari, dan riwayat EXP lebih dari 7 hari dihapus (diringkas per hari ke exp_daily).
-- File gambarnya dihapus oleh Edge Function lewat Storage API.
create or replace function public.chat_cleanup(older_than interval default interval '30 days')
returns setof text
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- riwayat EXP hanya disimpan 7 hari (hemat ruang; batas EXP harian hanya butuh hari ini, halaman Level
  -- menampilkan 300 terbaru). Sebelum dihapus, jumlahnya diringkas per hari ke exp_daily (31 hari) untuk Rekap 30 hari.
  -- Total EXP di profil tidak berubah.
  if pg_catalog.to_regclass('public.exp_log') is not null then
    insert into public.exp_daily (user_id, day, gained)
      select l.user_id, (l.created_at at time zone 'Asia/Jakarta')::date, sum(l.amount)::integer
      from public.exp_log l where l.created_at < pg_catalog.now() - interval '7 days' group by 1, 2
    on conflict (user_id, day) do update set gained = public.exp_daily.gained + excluded.gained;
    delete from public.exp_log where created_at < pg_catalog.now() - interval '7 days';
    delete from public.exp_daily where day < public.wib_today() - 31;
  end if;
  -- log baca (pencegah EXP ganda) disimpan 1 tahun; HP yang tidak pernah membuka aplikasi 90 hari dilepas
  -- (aplikasi mendaftarkan ulang tokennya setiap dibuka)
  delete from public.read_log where read_at < pg_catalog.now() - interval '365 days';
  delete from public.devices where updated_at < pg_catalog.now() - interval '90 days';
  return query
  delete from public.chat_messages
  where (room = 'public' and created_at < pg_catalog.now() - older_than)
     or (room <> 'public' and created_at < pg_catalog.now() - interval '180 days')
  returning image_path;
end;
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
declare author uuid;
begin
  if not public.is_staff() then raise exception 'khusus moderator' using errcode = '42501'; end if;
  select c.user_id into author from public.chat_messages c where c.id = p_message;
  if author is null then raise exception 'pesan tidak ditemukan' using errcode = 'P0002'; end if;
  -- pesan sendiri boleh diatur; pesan orang lain hanya bila akunnya di bawah level penindak
  if author <> auth.uid() and not public.can_moderate_user(author) then
    raise exception 'tidak boleh menindak akun ini' using errcode = '42501';
  end if;
  update public.chat_messages set hidden = p_hidden, reviewed = (reviewed or not p_hidden) where id = p_message;
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
  -- serialkan per pengguna: kiriman serentak tidak bisa melewati batas harian / cek duplikat
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bug:' || coalesce(new.user_id::text, ''), 0));
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
-- Hapus lewat Storage API butuh izin SELECT juga (DELETE ... RETURNING); tanpa ini file tidak ikut terhapus.
drop policy if exists "chat-images dibaca pemilik/developer" on storage.objects;
create policy "chat-images dibaca pemilik/developer" on storage.objects for select to authenticated
  using (bucket_id = 'chat-images' and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_dev())));
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
drop policy if exists "avatars dibaca pemilik" on storage.objects;
create policy "avatars dibaca pemilik" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
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
-- 13. EXP v2: login harian + streak, riwayat EXP (30 hari), like komik & chapter, rekap bacaan.
--     Cara dapat EXP (semua dicek di server, tidak bisa diubah dari aplikasi):
--       login harian : nomor Day = jumlah login beruntun (Day 1, 2, … 8, 9, …).
--                      Minggu ke-1 (Day 1–7): 10, 15, 20, 25, 30, 35, 40 EXP.
--                      Tiap minggu berikutnya setiap kotak +10 EXP (minggu 2: 20–50, minggu 3: 30–60,
--                      minggu 4: 40–70); minggu ke-5 dan seterusnya tetap memakai besaran minggu ke-4.
--       7 hari beruntun : +50 EXP bonus tiap akhir minggu (Day 7, 14, 21, …)
--       baca chapter sampai habis : +3 EXP (sekali per chapter, maks 100 chapter/hari)
--       like seri komik       : +5 EXP (sekali per komik, maks 20/hari)
--       like chapter          : +3 EXP (sekali per chapter, maks 30/hari)
--       simpan ke koleksi     : +3 EXP (sekali per komik, maks 20/hari)
--     Hari dihitung WIB (reset pukul 00.00 WIB).
-- =====================================================================
create table if not exists public.exp_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  amount integer not null,
  total_after integer not null,
  note text,
  created_at timestamptz not null default now(),
  constraint exp_log_kind check (kind in ('login', 'streak7', 'read', 'like_comic', 'like_chapter', 'library')),
  constraint exp_log_note_len check (char_length(coalesce(note, '')) <= 400)
);
create index if not exists exp_log_user_time on public.exp_log (user_id, created_at desc);
alter table public.exp_log enable row level security;
revoke all on table public.exp_log from anon, authenticated;
grant select on table public.exp_log to authenticated;
drop policy if exists "riwayat exp milik sendiri" on public.exp_log;
create policy "riwayat exp milik sendiri" on public.exp_log for select to authenticated
  using ((select auth.uid()) = user_id);

-- penanda "EXP sudah pernah diberikan" (like/koleksi): permanen agar tidak bisa di-like ulang demi EXP
create table if not exists public.exp_once (
  user_id uuid not null references auth.users (id) on delete cascade,
  k text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, k)
);
alter table public.exp_once enable row level security;
revoke all on table public.exp_once from anon, authenticated;

create table if not exists public.streaks (
  user_id uuid primary key references auth.users (id) on delete cascade,
  streak integer not null default 0,
  best integer not null default 0,
  last_day date,
  updated_at timestamptz not null default now()
);
alter table public.streaks enable row level security;
revoke all on table public.streaks from anon, authenticated;
grant select on table public.streaks to authenticated;
drop policy if exists "streak milik sendiri" on public.streaks;
create policy "streak milik sendiri" on public.streaks for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.wib_today()
returns date
language sql
stable
set search_path = ''
as $$ select (pg_catalog.now() at time zone 'Asia/Jakarta')::date $$;

-- besaran EXP login untuk login beruntun ke-n
create or replace function public.login_exp(n integer)
returns integer
language sql
immutable
set search_path = ''
as $$ select 5 + 5 * (((n - 1) % 7) + 1) + 10 * (least(4, ((n - 1) / 7) + 1) - 1) $$;

-- tambah EXP + catat riwayat (internal, tidak bisa dipanggil aplikasi)
create or replace function public.add_exp(p_uid uuid, p_kind text, p_amount integer, p_note text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare tot integer;
begin
  update public.profiles set exp = least(exp + p_amount, 1000000) where id = p_uid returning exp into tot;
  if tot is null then return 0; end if;
  insert into public.exp_log (user_id, kind, amount, total_after, note)
  values (p_uid, p_kind, p_amount, tot, pg_catalog.left(p_note, 400));
  return p_amount;
end;
$$;
revoke all on function public.add_exp(uuid, text, integer, text) from public, anon, authenticated;

-- aturan EXP aktivitas: besaran, batas harian, dan "sekali saja" (p_once)
create or replace function public.grant_exp(p_uid uuid, p_kind text, p_once text, p_note text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  amt integer; cap integer; n integer;
  day_start timestamptz := (public.wib_today()::timestamp) at time zone 'Asia/Jakarta';
begin
  select r.a, r.c into amt, cap from (values ('read', 3, 100), ('like_comic', 5, 20), ('like_chapter', 3, 30), ('library', 3, 20))
    as r(k, a, c) where r.k = p_kind;
  if amt is null or p_uid is null then return 0; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('exp:' || p_uid::text));
  select pg_catalog.count(*) into n from public.exp_log l
    where l.user_id = p_uid and l.kind = p_kind and l.created_at >= day_start;
  if n >= cap then return 0; end if;
  if p_once is not null then
    insert into public.exp_once (user_id, k) values (p_uid, pg_catalog.left(p_once, 400)) on conflict do nothing;
    if not found then return 0; end if;
  end if;
  return public.add_exp(p_uid, p_kind, amt, p_note);
end;
$$;
revoke all on function public.grant_exp(uuid, text, text, text) from public, anon, authenticated;

-- status login harian + progres EXP hari ini (untuk popup & halaman Level)
create or replace function public.daily_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid(); today date := public.wib_today(); s public.streaks; alive boolean; cur integer;
  day_start timestamptz := (public.wib_today()::timestamp) at time zone 'Asia/Jakarta'; t jsonb;
begin
  if uid is null then return null; end if;
  select * into s from public.streaks where user_id = uid;
  alive := s.last_day is not null and s.last_day >= today - 1;
  cur := case when alive then s.streak else 0 end;
  select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) into t from (
    select l.kind as k, pg_catalog.count(*) as n from public.exp_log l
    where l.user_id = uid and l.created_at >= day_start group by l.kind) x;
  return jsonb_build_object(
    'today', today, 'streak', cur, 'best', coalesce(s.best, 0),
    'claimed', coalesce(s.last_day = today, false),
    -- login beruntun ke berapa yang akan/sudah diklaim hari ini (Day 1, 2, … 8, …)
    'day', case when s.last_day = today then cur else cur + 1 end,
    'counts', t);
end;
$$;
revoke all on function public.daily_status() from public, anon;
grant execute on function public.daily_status() to authenticated;

create or replace function public.claim_daily()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid(); today date := public.wib_today(); s public.streaks; nxt integer; d integer;
  got integer := 0; bonus integer := 0;
begin
  if uid is null then raise exception 'Masuk dulu untuk klaim login harian' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('exp:' || uid::text));
  select * into s from public.streaks where user_id = uid for update;
  if s.last_day = today then
    return public.daily_status() || jsonb_build_object('already', true, 'gained', 0, 'bonus', 0);
  end if;
  nxt := case when s.last_day = today - 1 then s.streak + 1 else 1 end;
  d := ((nxt - 1) % 7) + 1;   -- posisi dalam minggu (1–7)
  insert into public.streaks as t (user_id, streak, best, last_day, updated_at)
  values (uid, nxt, nxt, today, pg_catalog.now())
  on conflict (user_id) do update set streak = nxt, best = greatest(t.best, nxt), last_day = today, updated_at = pg_catalog.now();
  got := public.add_exp(uid, 'login', public.login_exp(nxt), 'Login harian · Day ' || nxt || ' · minggu ke-' || (((nxt - 1) / 7) + 1));
  if d = 7 then bonus := public.add_exp(uid, 'streak7', 50, 'Bonus 7 hari beruntun'); end if;
  return jsonb_build_object('today', today, 'streak', nxt, 'best', greatest(coalesce(s.best, 0), nxt), 'claimed', true,
    'day', nxt, 'gained', got, 'bonus', bonus, 'already', false);
end;
$$;
revoke all on function public.claim_daily() from public, anon;
grant execute on function public.claim_daily() to authenticated;

-- Like seri komik (chapter = '') dan like chapter. Jumlah like dibaca lewat like_info.
create table if not exists public.likes (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source text not null,
  comic_id text not null,
  chapter text not null default '',
  title text,
  created_at timestamptz not null default now(),
  primary key (user_id, source, comic_id, chapter),
  constraint likes_len check (char_length(source) <= 40 and char_length(comic_id) <= 300
    and char_length(chapter) <= 40 and char_length(coalesce(title, '')) <= 300)
);
create index if not exists likes_target_idx on public.likes (source, comic_id, chapter);
alter table public.likes enable row level security;
revoke all on table public.likes from anon, authenticated;
grant select, delete on table public.likes to authenticated;
grant insert (source, comic_id, chapter, title) on table public.likes to authenticated;
drop policy if exists "like dibaca sendiri" on public.likes;
create policy "like dibaca sendiri" on public.likes for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "like ditulis sendiri" on public.likes;
create policy "like ditulis sendiri" on public.likes for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "like dihapus sendiri" on public.likes;
create policy "like dihapus sendiri" on public.likes for delete to authenticated using ((select auth.uid()) = user_id);

create or replace function public.award_like_exp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.grant_exp(new.user_id, case when new.chapter = '' then 'like_comic' else 'like_chapter' end,
    'like:' || new.source || ':' || new.comic_id || ':' || new.chapter,
    case when new.chapter = '' then pg_catalog.concat_ws(' · ', new.title, 'like komik')
         else pg_catalog.concat_ws(' · ', new.title, 'Ch. ' || new.chapter) end);
  return null;
end;
$$;
revoke all on function public.award_like_exp() from public, anon, authenticated;
drop trigger if exists likes_award on public.likes;
create trigger likes_award after insert on public.likes for each row execute function public.award_like_exp();

create or replace function public.like_info(p_source text, p_comic text, p_chapter text default '')
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'n', (select pg_catalog.count(*) from public.likes l where l.source = p_source and l.comic_id = p_comic and l.chapter = coalesce(p_chapter, '')),
    'liked', coalesce((select true from public.likes l where l.user_id = auth.uid() and l.source = p_source
      and l.comic_id = p_comic and l.chapter = coalesce(p_chapter, '')), false));
$$;
revoke all on function public.like_info(text, text, text) from public;
grant execute on function public.like_info(text, text, text) to anon, authenticated;

-- simpan komik ke koleksi
create or replace function public.award_library_exp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.grant_exp(new.user_id, 'library', 'lib:' || new.source || ':' || new.comic_id,
    pg_catalog.concat_ws(' · ', new.title, 'disimpan ke koleksi'));
  return null;
end;
$$;
revoke all on function public.award_library_exp() from public, anon, authenticated;
drop trigger if exists library_award on public.library;
create trigger library_award after insert on public.library for each row execute function public.award_library_exp();

-- Rekap bacaan 7 / 30 hari (untuk kartu yang bisa dibagikan)
create or replace function public.my_recap(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid(); n integer := case when p_days >= 30 then 30 else 7 end;
  d0 date := public.wib_today() - (case when p_days >= 30 then 30 else 7 end) + 1;
  since timestamptz := (d0::timestamp) at time zone 'Asia/Jakarta';
  r jsonb;
begin
  if uid is null then return null; end if;
  select jsonb_build_object(
    'days', n, 'from', d0, 'to', public.wib_today(),
    'chapters', (select pg_catalog.count(*) from public.read_log where user_id = uid and read_at >= since),
    'series', (select pg_catalog.count(distinct (source, comic_id)) from public.read_log where user_id = uid and read_at >= since),
    'exp', (select coalesce(sum(amount), 0) from public.exp_log where user_id = uid and created_at >= since)
         + (select coalesce(sum(gained), 0) from public.exp_daily where user_id = uid and day >= d0),
    'likes', (select pg_catalog.count(*) from public.likes where user_id = uid and created_at >= since),
    'saved', (select pg_catalog.count(*) from public.library where user_id = uid and added_at >= since),
    'active', (select pg_catalog.count(distinct (read_at at time zone 'Asia/Jakarta')::date) from public.read_log where user_id = uid and read_at >= since),
    'per_day', (select coalesce(jsonb_agg(c order by g), '[]'::jsonb) from (
        select g, (select pg_catalog.count(*) from public.read_log where user_id = uid
          and (read_at at time zone 'Asia/Jakarta')::date = g::date) as c
        from pg_catalog.generate_series(d0::timestamp, public.wib_today()::timestamp, interval '1 day') g) x),
    'top', (select coalesce(jsonb_agg(jsonb_build_object('source', t.source, 'comic_id', t.comic_id, 'n', t.c,
        'title', h.title, 'cover', h.cover) order by t.c desc), '[]'::jsonb)
      from (select source, comic_id, pg_catalog.count(*) as c from public.read_log
            where user_id = uid and read_at >= since group by source, comic_id order by c desc limit 3) t
      left join public.history h on h.user_id = uid and h.source = t.source and h.comic_id = t.comic_id)
  ) into r;
  return r;
end;
$$;
revoke all on function public.my_recap(integer) from public, anon;
grant execute on function public.my_recap(integer) to authenticated;

-- =====================================================================
-- 11a. Batas baris per pengguna (cegah satu akun memenuhi database) dan klaim atomik untuk Edge Function.
--      Pemeriksaan memakai kunci per pengguna supaya permintaan serentak tidak bisa melewati batas.
-- =====================================================================
-- Koleksi: maks. 2000 komik (sama dengan batas baca di aplikasi), lonceng notifikasi maks. 100 komik.
-- Format sumber dibatasi huruf kecil/angka agar tidak ada nilai aneh yang ikut dicek server.
alter table public.library drop constraint if exists library_source_ok;
alter table public.library add constraint library_source_ok check (source ~ '^[a-z0-9_-]+$') not valid;

create or replace function public.library_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lib:' || new.user_id::text, 0));
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.library l where l.user_id = new.user_id and l.source = new.source and l.comic_id = new.comic_id) then
      select pg_catalog.count(*) into n from public.library l where l.user_id = new.user_id;
      if n >= 2000 then
        raise exception 'Koleksi penuh (maksimal 2000 komik)' using errcode = 'P0001', hint = 'row_cap';
      end if;
    end if;
    if new.notify then
      select pg_catalog.count(*) into n from public.library l
        where l.user_id = new.user_id and l.notify and not (l.source = new.source and l.comic_id = new.comic_id);
      if n >= 100 then new.notify := false; end if; -- unggahan massal: komik tetap masuk, loncengnya saja yang mati
    end if;
  elsif new.notify and not old.notify then
    select pg_catalog.count(*) into n from public.library l where l.user_id = new.user_id and l.notify;
    if n >= 100 then
      raise exception 'Lonceng notifikasi maksimal untuk 100 komik' using errcode = 'P0001', hint = 'notify_cap';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.library_guard() from public, anon, authenticated;
drop trigger if exists library_guard on public.library;
create trigger library_guard before insert or update of notify on public.library
  for each row execute function public.library_guard();

-- Riwayat: simpan 500 komik terbaru per pengguna (aplikasi hanya memakai 300). Tidak pernah menolak
-- simpan posisi baca; yang paling lama dibuang.
create or replace function public.history_trim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hist:' || new.user_id::text, 0));
  delete from public.history h
  where h.user_id = new.user_id
    and (h.source, h.comic_id) not in (select x.source, x.comic_id from public.history x
                                       where x.user_id = new.user_id order by x.read_at desc limit 500);
  return null;
end;
$$;
revoke all on function public.history_trim() from public, anon, authenticated;
drop trigger if exists history_trim on public.history;
create trigger history_trim after insert on public.history
  for each row execute function public.history_trim();

-- Like: maks. 5000 per pengguna. Log baca: maks. 20000 per pengguna.
create or replace function public.likes_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('like:' || new.user_id::text, 0));
  if (select pg_catalog.count(*) from public.likes l where l.user_id = new.user_id) >= 5000
     and not exists (select 1 from public.likes l where l.user_id = new.user_id and l.source = new.source
                     and l.comic_id = new.comic_id and l.chapter = new.chapter) then
    raise exception 'Batas like tercapai' using errcode = 'P0001', hint = 'row_cap';
  end if;
  return new;
end;
$$;
revoke all on function public.likes_cap() from public, anon, authenticated;
drop trigger if exists likes_cap on public.likes;
create trigger likes_cap before insert on public.likes
  for each row execute function public.likes_cap();

create or replace function public.read_log_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rlog:' || new.user_id::text, 0));
  if (select pg_catalog.count(*) from (select 1 from public.read_log r where r.user_id = new.user_id limit 20000) t) >= 20000 then
    raise exception 'Batas log baca tercapai' using errcode = 'P0001', hint = 'row_cap';
  end if;
  return new;
end;
$$;
revoke all on function public.read_log_cap() from public, anon, authenticated;
drop trigger if exists read_log_cap on public.read_log;
create trigger read_log_cap before insert on public.read_log
  for each row execute function public.read_log_cap();

-- Laporan chapter dari aplikasi (sumber yang memblokir server). Edge Function menunggu dua pelapor berbeda
-- sebelum mengumumkan chapter baru ke banyak orang. Hanya diakses server (tanpa policy).
create table if not exists public.chapter_reports (
  source text not null,
  comic_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  num numeric not null,
  chapter text not null,
  created_at timestamptz not null default now(),
  primary key (source, comic_id, user_id),
  constraint chapter_reports_len check (char_length(source) <= 40 and char_length(comic_id) <= 600 and char_length(chapter) <= 40)
);
create index if not exists chapter_reports_age_idx on public.chapter_reports (created_at);
alter table public.chapter_reports enable row level security;
revoke all on table public.chapter_reports from anon, authenticated;

-- Kunci cek latar belakang per akun (APK mengecek komik berlonceng saat aplikasi ditutup, lalu melapor chapter).
-- Hanya hash kuncinya yang disimpan. Hanya diakses server (tanpa policy).
create table if not exists public.bg_keys (
  user_id uuid primary key references auth.users (id) on delete cascade,
  key_hash text not null unique,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  constraint bg_keys_len check (char_length(key_hash) = 64)
);
alter table public.bg_keys enable row level security;
revoke all on table public.bg_keys from anon, authenticated;
-- Kunci kedua untuk pengecek chapter di Termux (bot WhatsApp yang menyala 24 jam). Berdiri sendiri: membuat kunci
-- Termux tidak mematikan kunci APK, dan sebaliknya. Hanya hash yang disimpan.
alter table public.bg_keys add column if not exists termux_hash text;
alter table public.bg_keys add column if not exists termux_used_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'bg_keys_termux_len') then
    alter table public.bg_keys add constraint bg_keys_termux_len check (termux_hash is null or char_length(termux_hash) = 64);
  end if;
end $$;
create unique index if not exists bg_keys_termux_idx on public.bg_keys (termux_hash) where termux_hash is not null;

-- Klaim chapter baru secara atomik. Dua cron / dua pelapor serentak tidak bisa sama-sama "menang":
-- hanya satu yang mendapat claimed = true dan berhak mengirim notifikasi.
--   first    = kunjungan pertama (hanya dicatat, tidak ada notifikasi)
--   rejected = lompatan nomor melebihi p_max_jump (dicatat sebagai galat, tidak diklaim)
-- Judul & sampul di comic_state hanya diisi sekali (tidak ditimpa kiriman berikutnya).
create or replace function public.claim_chapter(p_source text, p_comic text, p_title text, p_cover text,
                                                p_chapter text, p_num numeric, p_max_jump numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare st public.comic_state%rowtype;
begin
  insert into public.comic_state (source, comic_id, title, cover, checked_at)
  values (p_source, p_comic, pg_catalog.left(coalesce(p_title, ''), 300), pg_catalog.left(p_cover, 1000), pg_catalog.now())
  on conflict (source, comic_id) do nothing;
  select * into st from public.comic_state c where c.source = p_source and c.comic_id = p_comic for update;

  if p_num is null then
    update public.comic_state c set checked_at = pg_catalog.now(), last_error = null where c.source = p_source and c.comic_id = p_comic;
    return pg_catalog.jsonb_build_object('claimed', false);
  end if;
  if st.last_num is null then
    update public.comic_state c set last_chapter = p_chapter, last_num = p_num, checked_at = pg_catalog.now(), last_error = null
      where c.source = p_source and c.comic_id = p_comic;
    return pg_catalog.jsonb_build_object('claimed', false, 'first', true);
  end if;
  if p_num <= st.last_num then
    update public.comic_state c set checked_at = pg_catalog.now(), last_error = null where c.source = p_source and c.comic_id = p_comic;
    return pg_catalog.jsonb_build_object('claimed', false);
  end if;
  if p_max_jump is not null and p_num - st.last_num > p_max_jump then
    update public.comic_state c set checked_at = pg_catalog.now(),
      last_error = pg_catalog.format('lompatan chapter mencurigakan (%s → %s), diabaikan', st.last_num, p_num)
      where c.source = p_source and c.comic_id = p_comic;
    return pg_catalog.jsonb_build_object('claimed', false, 'rejected', true);
  end if;
  update public.comic_state c set last_chapter = p_chapter, last_num = p_num, checked_at = pg_catalog.now(), last_error = null
    where c.source = p_source and c.comic_id = p_comic;
  return pg_catalog.jsonb_build_object('claimed', true, 'prev', st.last_num);
end;
$$;
revoke all on function public.claim_chapter(text, text, text, text, text, numeric, numeric) from public, anon, authenticated;
grant execute on function public.claim_chapter(text, text, text, text, text, numeric, numeric) to service_role;

-- Klaim giliran cron secara atomik: true bila sudah lewat p_gap sejak jalan terakhir (dan langsung ditandai berjalan).
create or replace function public.cron_claim(p_key text, p_gap interval)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare ok boolean;
begin
  insert into public.server_state as s (k, v, updated_at)
  values (p_key, pg_catalog.jsonb_build_object('at', pg_catalog.now(), 'running', true), pg_catalog.now())
  on conflict (k) do update
    set v = pg_catalog.jsonb_build_object('at', pg_catalog.now(), 'running', true), updated_at = pg_catalog.now()
    where coalesce((s.v ->> 'at')::timestamptz, '-infinity'::timestamptz) < pg_catalog.now() - p_gap
  returning true into ok;
  return coalesce(ok, false);
end;
$$;
revoke all on function public.cron_claim(text, interval) from public, anon, authenticated;
grant execute on function public.cron_claim(text, interval) to service_role;

-- Gambar chat yatim: berkas di bucket chat-images yang tidak dipakai pesan mana pun (pesan gagal terkirim, pesan
-- dihapus lewat jalur lain, dll.). Cron Edge Function menghapusnya lewat Storage API (menghapus baris storage.objects
-- langsung dari SQL tidak menghapus berkasnya). Berkas < 1 hari dibiarkan: unggahan dan pesannya tidak serentak.
create or replace function public.chat_orphan_images(p_limit integer default 200)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'chat-images'
    and o.created_at < pg_catalog.now() - interval '1 day'
    and not exists (select 1 from public.chat_messages m where m.image_path = o.name)
  order by o.created_at
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
$$;
revoke all on function public.chat_orphan_images(integer) from public, anon, authenticated;
grant execute on function public.chat_orphan_images(integer) to service_role;

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
