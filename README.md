# Ninokuu

Aplikasi baca manga, manhwa, dan manhua (PWA + APK Android).

> Status: tahap persiapan. Desain UI/UX sudah ada di canvas Claude; kode aplikasi menyusul.

## Menjaga Supabase tetap aktif (paket gratis)

Supabase paket gratis menjeda proyek setelah 7 hari tanpa aktivitas. Repo ini punya
workflow `Supabase keepalive` yang melakukan ping ke database tiap 2 hari.

Pasang sekali saja:

1. Supabase → **SQL Editor** → jalankan isi [`supabase/sql/keepalive.sql`](supabase/sql/keepalive.sql).
2. GitHub repo ini → **Settings → Secrets and variables → Actions → New repository secret**:
   - `SUPABASE_URL` — contoh `https://abcdxyz.supabase.co`
   - `SUPABASE_ANON_KEY` — kunci **anon / publishable** (bukan `service_role`)
3. Tab **Actions → Supabase keepalive → Run workflow** untuk tes. Hasil yang benar: `HTTP 200`.

Catatan:
- Ping hanya memanggil fungsi `keepalive_ping()` yang mengubah satu kolom waktu. Tidak ada data pengguna yang disentuh.
- Dari luar, tabel `keepalive` hanya bisa dibaca. Hak tulis dicabut dan RLS aktif.
- Log workflow hanya menampilkan kode HTTP, bukan isi respons.
- Workflow juga membuat commit kosong `chore: keepalive` bila repo tidak ada commit lebih dari 45 hari,
  karena GitHub mematikan jadwal otomatis di repo yang sepi sekitar 60 hari.
- Kalau proyek sudah terlanjur dijeda, pulihkan dulu lewat tombol **Restore** di dashboard Supabase.
