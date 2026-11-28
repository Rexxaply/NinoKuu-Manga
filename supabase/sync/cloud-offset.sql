-- HANYA di Supabase Cloud, sekali (aman diulang): nomor id otomatis di Cloud dimulai dari 1.000.000.000
-- supaya baris baru di Cloud (saat server lokal mati / APK lama) tidak pernah bentrok dengan id di server lokal.
do $$
declare r record; s text;
begin
  for r in
    select n.nspname, c.relname, a.attname from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and a.attidentity <> '' and not a.attisdropped
  loop
    s := pg_catalog.pg_get_serial_sequence(format('%I.%I', r.nspname, r.relname), r.attname);
    if s is not null then
      execute format('select pg_catalog.setval(%L, greatest(1000000000, (select last_value from %s)))', s, s);
    end if;
  end loop;
end $$;
