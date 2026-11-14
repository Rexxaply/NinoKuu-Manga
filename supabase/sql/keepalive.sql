-- Ninokuu · tabel kecil untuk menjaga proyek Supabase (paket gratis) tetap aktif.
-- Jalankan sekali di Supabase → SQL Editor. Aman dijalankan ulang.
begin;

create table if not exists public.keepalive (
  id int primary key default 1,
  pinged_at timestamptz not null default now(),
  constraint keepalive_one_row check (id = 1)
);

-- RLS langsung aktif sebelum ada data apa pun.
alter table public.keepalive enable row level security;

-- Dari luar hanya boleh membaca. Hak tulis bawaan Supabase dicabut, jadi penolakan
-- tidak bergantung pada RLS saja.
revoke all on table public.keepalive from anon, authenticated;
grant select on table public.keepalive to anon, authenticated;

insert into public.keepalive (id) values (1) on conflict (id) do nothing;

drop policy if exists "keepalive dibaca publik" on public.keepalive;
create policy "keepalive dibaca publik" on public.keepalive for select using (true);

-- Fungsi untuk mencatat waktu ping, dipanggil lewat RPC. Hanya mengubah satu kolom waktu.
create or replace function public.keepalive_ping()
returns timestamptz
language sql
security definer
set search_path = ''
as $$
  update public.keepalive set pinged_at = pg_catalog.now() where id = 1 returning pinged_at;
$$;
revoke all on function public.keepalive_ping() from public;
grant execute on function public.keepalive_ping() to anon, authenticated;

commit;
