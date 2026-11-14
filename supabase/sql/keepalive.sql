-- Ninokuu · tabel kecil untuk menjaga proyek Supabase (paket gratis) tetap aktif.
-- Jalankan sekali di Supabase → SQL Editor.
create table if not exists public.keepalive (
  id int primary key default 1,
  pinged_at timestamptz not null default now(),
  constraint keepalive_one_row check (id = 1)
);
insert into public.keepalive (id) values (1) on conflict (id) do nothing;

alter table public.keepalive enable row level security;

-- Hanya boleh dibaca (anon key). Tidak ada izin tulis dari luar.
drop policy if exists "keepalive dibaca publik" on public.keepalive;
create policy "keepalive dibaca publik" on public.keepalive for select using (true);

-- Fungsi untuk mencatat waktu ping, dipanggil lewat RPC. Hanya mengubah satu kolom waktu.
create or replace function public.keepalive_ping()
returns timestamptz
language sql
security definer
set search_path = public
as $$
  update public.keepalive set pinged_at = now() where id = 1 returning pinged_at;
$$;
revoke all on function public.keepalive_ping() from public;
grant execute on function public.keepalive_ping() to anon, authenticated;
