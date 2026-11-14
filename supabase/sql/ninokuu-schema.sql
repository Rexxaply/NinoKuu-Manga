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
alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;
-- Nama dan EXP tampil di chat publik, jadi boleh dibaca semua orang.
grant select on table public.profiles to anon, authenticated;
-- Pengguna hanya boleh mengganti namanya sendiri; kolom exp tidak bisa disentuh.
grant update (name) on table public.profiles to authenticated;

drop policy if exists "profil dibaca publik" on public.profiles;
create policy "profil dibaca publik" on public.profiles for select using (true);
drop policy if exists "profil diubah pemiliknya" on public.profiles;
create policy "profil diubah pemiliknya" on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

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
-- 8. Chat publik: semua bisa membaca, hanya yang login bisa menulis.
--    Jeda 5 detik antar pesan, maks 300 karakter, gambar opsional (lihat bagian 9).
-- =====================================================================
create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body text not null default '',
  image_path text,
  image_spoiler boolean not null default false,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  constraint chat_body_len check (char_length(body) <= 300),
  constraint chat_not_empty check (char_length(btrim(body)) > 0 or image_path is not null),
  constraint chat_image_path check (image_path is null or (char_length(image_path) <= 300 and image_path !~ '\.\.'))
);
create index if not exists chat_recent_idx on public.chat_messages (created_at desc);
create index if not exists chat_user_idx on public.chat_messages (user_id, created_at desc);
alter table public.chat_messages enable row level security;
revoke all on table public.chat_messages from anon, authenticated;
grant select on table public.chat_messages to anon, authenticated;
grant insert (body, image_path, image_spoiler) on table public.chat_messages to authenticated;
grant delete on table public.chat_messages to authenticated;

drop policy if exists "chat dibaca publik" on public.chat_messages;
create policy "chat dibaca publik" on public.chat_messages for select
  using (not hidden and created_at > now() - interval '30 days');
drop policy if exists "chat ditulis yang login" on public.chat_messages;
create policy "chat ditulis yang login" on public.chat_messages for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    -- gambar hanya boleh dari folder milik pengirim sendiri: <user_id>/<nama-file>
    and (image_path is null or split_part(image_path, '/', 1) = (select auth.uid())::text)
  );
drop policy if exists "chat dihapus pengirimnya" on public.chat_messages;
create policy "chat dihapus pengirimnya" on public.chat_messages for delete to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.chat_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  last_at timestamptz;
begin
  new.created_at := pg_catalog.now();
  new.hidden := false;
  new.body := btrim(new.body);
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
  using ((select auth.uid()) = reporter);
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
select c.id, c.user_id, p.name, p.exp, c.body, c.image_path, c.image_spoiler, c.created_at
from public.chat_messages c
join public.profiles p on p.id = c.user_id;
revoke all on table public.chat_feed from anon, authenticated;
grant select on table public.chat_feed to anon, authenticated;

-- Pembersihan berkala (dipanggil cron Edge Function): pesan lebih dari 30 hari dihapus.
-- File gambarnya dihapus oleh Edge Function lewat Storage API.
create or replace function public.chat_cleanup(older_than interval default interval '30 days')
returns setof text
language sql
security definer
set search_path = ''
as $$
  delete from public.chat_messages where created_at < pg_catalog.now() - older_than
  returning image_path;
$$;
revoke all on function public.chat_cleanup(interval) from public, anon, authenticated;

-- =====================================================================
-- 9. Penyimpanan gambar chat: bucket publik "chat-images", maks 30 MB per file,
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

commit;
