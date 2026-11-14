# Ninokuu

Aplikasi baca manga, manhwa, dan manhua (PWA + APK Android).

> Status: tahap persiapan. Desain UI/UX sudah ada di canvas Claude; kode aplikasi menyusul.

## Database

Jalankan di Supabase → **SQL Editor**, berurutan. Keduanya aman dijalankan ulang.

1. [`supabase/sql/ninokuu-schema.sql`](supabase/sql/ninokuu-schema.sql) — profil & EXP, koleksi (+ lonceng per komik),
   riwayat, pengaturan, perangkat notifikasi, kotak notifikasi (maks 30 / 7 hari), chat publik
   (jeda 5 detik, laporan, sembunyi otomatis setelah 3 laporan), dan bucket `chat-images` (maks 30 MB, JPG/PNG/WEBP/GIF).
2. [`supabase/sql/keepalive.sql`](supabase/sql/keepalive.sql) — lihat bagian berikut.

Akun Developer (centang verifikasi, badge DEV, Level 99, Panel developer) diberikan sekali lewat SQL Editor:

```sql
update public.profiles set role = 'developer', verified = true, exp = 203840
where id = (select id from auth.users where email = 'emailkamu@gmail.com');
```

Ganti `'developer'` dengan `'moderator'` untuk mengangkat moderator chat. Nama seperti "Rexxa", "Ninokuu",
dan "Admin" dicadangkan untuk akun resmi.

Semua tabel memakai RLS. Hak bawaan `anon`/`authenticated` dicabut lalu diberikan seperlunya;
EXP, notifikasi, dan status sembunyi pesan hanya diubah oleh trigger/fungsi di server.

## Edge Function `ninokuu-api`

[`supabase/functions/ninokuu-api/index.ts`](supabase/functions/ninokuu-api/index.ts) — jelajah, detail, dan halaman chapter
dari Komiku, Kiryuu, Shinigami, WestManga; proxy gambar bertanda tangan; cron tiap 15 menit untuk notifikasi chapter
baru (FCM), pengumuman developer, dan pembersihan chat/notifikasi lama. Deploy lewat dashboard (Via Editor), matikan
**Verify JWT**, lalu buat Cron `*/15 * * * *` dengan body `{"action":"cron"}`. Detail di panduan instalasi Langkah 7.

| action | login | isi |
|---|---|---|
| `browse` | tidak | `source`, `page`, `q`, `sort` (`update`/`popular`), `type`, `limit` |
| `detail` | tidak | `source`, `comic_id` |
| `pages` | tidak | `source`, `chapter_id` → gambar via `?img=…&sig=…` |
| `cron` | — | dipanggil Supabase Cron |
| `report_chapters` | ya | APK melaporkan chapter Shinigami/WestManga |
| `test_push` | ya | tes notifikasi ke HP sendiri |
| `run_cron` | developer | jalankan cron sekarang |

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
