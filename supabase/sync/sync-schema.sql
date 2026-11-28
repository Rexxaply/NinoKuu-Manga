-- =====================================================================
-- Sinkron dua arah server lokal ⇄ Supabase Cloud (cadangan).
-- Jalankan di KEDUA database (lokal & Cloud). Aman dijalankan ulang.
--
-- Cara kerja: tiap tulis/ubah/hapus di tabel public.* + auth.users/identities dicatat ke sync.changes
-- (isi baris lengkap). Skrip sync.sh mengambil catatan baru dari kedua sisi lalu menerapkannya ke sisi
-- lain. Kunci yang berubah di kedua sisi sejak sinkron terakhir: server lokal menang.
-- Pencatat TIDAK PERNAH menggagalkan tulisan aplikasi (galat apa pun ditelan).
-- =====================================================================
create schema if not exists sync;
revoke all on schema sync from public, anon, authenticated;

create table if not exists sync.changes (
  seq bigint generated always as identity primary key,
  at timestamptz not null default now(),
  tbl text not null,          -- skema.tabel
  pk jsonb not null,          -- nilai kunci utama
  op char(1) not null,        -- I / U / D
  row jsonb                   -- isi baris (null untuk D)
);
create table if not exists sync.errors (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  tbl text, pk jsonb, op char(1), err text
);
revoke all on all tables in schema sync from public, anon, authenticated;

create or replace function sync.pk_cols(t oid) returns text[] language sql stable set search_path = '' as $$
  select array_agg(a.attname::text order by k.ord)
  from pg_catalog.pg_index i
  cross join lateral unnest(i.indkey) with ordinality k(attnum, ord)
  join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
  where i.indrelid = t and i.indisprimary
$$;

create or replace function sync.capture() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cols text[]; r jsonb; o jsonb; k jsonb; ko jsonb;
begin
  if pg_catalog.current_setting('sync.off', true) = 'on' then return null; end if;
  cols := sync.pk_cols(TG_RELID);
  if cols is null then return null; end if;
  if TG_OP <> 'INSERT' then o := pg_catalog.to_jsonb(OLD); select pg_catalog.jsonb_object_agg(c, o -> c) into ko from unnest(cols) c; end if;
  if TG_OP <> 'DELETE' then r := pg_catalog.to_jsonb(NEW); select pg_catalog.jsonb_object_agg(c, r -> c) into k from unnest(cols) c; end if;
  -- kunci utama berubah: hapus kunci lama di sisi lain
  if TG_OP = 'DELETE' or (TG_OP = 'UPDATE' and ko is distinct from k) then
    insert into sync.changes (tbl, pk, op, row) values (TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, ko, 'D', null);
  end if;
  if TG_OP <> 'DELETE' then
    insert into sync.changes (tbl, pk, op, row) values (TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, k, pg_catalog.left(TG_OP, 1), r);
  end if;
  return null;
exception when others then
  return null;   -- jangan pernah menggagalkan tulisan aplikasi
end $$;
revoke all on function sync.capture() from public, anon, authenticated;

-- Terapkan sekumpulan perubahan dari sisi lain. Dipanggil sync.sh dengan session_replication_role = replica
-- (trigger aplikasi, FK, dan pencatat tidak jalan → tidak memantul balik). Galat per baris dicatat, tidak menghentikan.
create or replace function sync.apply(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  c jsonb; t regclass; pkc text[]; cols text[]; upd text; ov text; n_ok int := 0; n_err int := 0;
begin
  perform pg_catalog.set_config('sync.off', 'on', true);
  for c in select value from pg_catalog.jsonb_array_elements(p) loop
    begin
      t := (c ->> 'tbl')::regclass;
      pkc := sync.pk_cols(t);
      if c ->> 'op' = 'D' then
        execute format('delete from %s where (%s) = (select %s from pg_catalog.jsonb_populate_record(null::%s, $1))',
          t, (select string_agg(quote_ident(x), ',') from unnest(pkc) x), (select string_agg(quote_ident(x), ',') from unnest(pkc) x), t)
          using c -> 'pk';
      else
        select array_agg(a.attname::text order by a.attnum) into cols
        from pg_catalog.pg_attribute a
        where a.attrelid = t and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
          and (c -> 'row') ? a.attname;
        select string_agg(format('%1$I = excluded.%1$I', x), ', ') into upd from unnest(cols) x where x <> all (pkc);
        ov := case when exists (select 1 from pg_catalog.pg_attribute a where a.attrelid = t and a.attidentity = 'a' and a.attname = any (cols))
                   then 'overriding system value' else '' end;
        execute format('insert into %s (%s) %s select %s from pg_catalog.jsonb_populate_record(null::%s, $1) on conflict (%s) do %s',
          t, (select string_agg(quote_ident(x), ',') from unnest(cols) x), ov,
          (select string_agg(quote_ident(x), ',') from unnest(cols) x), t,
          (select string_agg(quote_ident(x), ',') from unnest(pkc) x),
          coalesce('update set ' || upd, 'nothing'))
          using c -> 'row';
      end if;
      n_ok := n_ok + 1;
    exception when others then
      n_err := n_err + 1;
      insert into sync.errors (tbl, pk, op, err) values (c ->> 'tbl', c -> 'pk', c ->> 'op', sqlerrm);
    end;
  end loop;
  return pg_catalog.jsonb_build_object('ok', n_ok, 'error', n_err);
end $$;
revoke all on function sync.apply(jsonb) from public, anon, authenticated;

-- Pasang pencatat di semua tabel public + auth.users/identities (tabel baru: jalankan ulang file ini).
do $$
declare r record;
begin
  for r in
    select n.nspname, c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and (n.nspname = 'public' or (n.nspname = 'auth' and c.relname in ('users', 'identities')))
  loop
    execute format('drop trigger if exists zz_sync_capture on %I.%I', r.nspname, r.relname);
    execute format('create trigger zz_sync_capture after insert or update or delete on %I.%I for each row execute function sync.capture()', r.nspname, r.relname);
  end loop;
end $$;
