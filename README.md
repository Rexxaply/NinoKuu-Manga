# Ninokuu

Aplikasi baca manga, manhwa, dan manhua (PWA + APK Android).

> Status: PWA bagian 1 (Beranda, Pencarian, Detail, Pembaca, Favorit, Akun). Chat, Level, unduhan, Panel developer, dan APK menyusul.

## Aplikasi (PWA)

Folder [`app/`](app/) — tanpa build step, cukup file statis. Diterbitkan otomatis ke GitHub Pages oleh workflow
**Deploy PWA** setiap ada perubahan di `app/`; `config.js` diisi dari secret `SUPABASE_URL` dan `SUPABASE_ANON_KEY`.
Alamat: `https://rexxaply.github.io/NinoKuu-Manga/`.

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

### EXP, streak, dan like

Semua EXP dihitung server (bagian 13 skema). Hari dihitung WIB, reset pukul 00.00.

| Aktivitas | EXP | Batas |
|---|---|---|
| Login harian (Day 1–7) | 10, 15, 20, 25, 30, 35, 40 | 1× per hari; lewat sehari tanpa klaim → streak mulai dari Day 1 |
| 7 hari beruntun | +50 bonus di Day 7 | siklus mulai lagi tiap 7 hari |
| Baca chapter sampai habis | +3 | sekali per chapter, maks 100/hari |
| Like seri komik | +5 | sekali per komik, maks 20/hari |
| Like chapter | +3 | sekali per chapter, maks 30/hari |
| Simpan komik ke koleksi | +3 | sekali per komik, maks 20/hari |

Like yang dibatalkan lalu diberikan lagi tidak memberi EXP kedua kali (`exp_once`). Riwayat EXP (`exp_log`)
disimpan 30 hari lalu dihapus oleh cron pembersihan; total EXP di profil tidak berkurang. Rekap 7/30 hari
diambil lewat `my_recap` dan bisa dibagikan sebagai gambar 9:16.

## Edge Function `ninokuu-api`

[`supabase/functions/ninokuu-api/index.ts`](supabase/functions/ninokuu-api/index.ts) — jelajah, detail, dan halaman chapter
dari Komiku, Kiryuu, Shinigami, WestManga; proxy gambar bertanda tangan; cron tiap 15 menit untuk notifikasi chapter
baru (FCM), pengumuman developer, dan pembersihan chat/notifikasi lama. Deploy lewat dashboard (Via Editor), matikan
**Verify JWT**, lalu buat Cron `*/15 * * * *` dengan body `{"action":"cron"}`. Detail di panduan instalasi Langkah 7.

| action | login | isi |
|---|---|---|
| `browse` | tidak | `source`, `page`, `q`, `sort` (`update`/`popular`), `type`, `limit`, `status` (`ongoing`/`completed`/`hiatus`), `genres` (id genre dari `filters`; Komiku maks 2) |
| `filters` | tidak | `source` → daftar genre asli penyedia, status yang didukung, batas genre |
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

## Aplikasi Android (APK)

Dibangun dari folder `app/` dengan Capacitor oleh GitHub Actions; hasilnya di Release `apk-terbaru`:
`https://github.com/Rexxaply/NinoKuu-Manga/releases/download/apk-terbaru/ninokuu.apk`

Sekali saja: tab **Actions → Buat kunci APK → Run workflow**. Kunci dibuat dari secret `APK_KEYSTORE_PASSWORD`,
dienkripsi, dan disimpan sebagai `apk/ninokuu.keystore.enc` (sidik jari di `apk/keystore-sha256.txt`).
Setelah itu **Build APK** berjalan otomatis setiap ada perubahan di `app/` atau `apk/` (atau jalankan manual).

Secret yang dipakai: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GOOGLE_SERVICES_JSON`, `APK_KEYSTORE_PASSWORD`.
Nama paket diambil dari `google-services.json` (atau variabel `APP_ID`).

Khusus APK (`app/js/native.js`): Shinigami & WestManga dibuka langsung lewat jaringan HP, notifikasi Firebase
(`register_device`), HP mengecek chapter baru komik berlonceng dari dua sumber itu lalu melapor ke server
(`report_chapters`), tombol kembali Android, dan pemberitahuan versi APK baru.

## Versi & rilis

Versi aplikasi ada di berkas `VERSION` (format **mayor.minor.patch**, mis. `1.2.3`) dan dipakai bersama oleh web,
APK (versionName; versionCode = mayor×1.000.000 + minor×1.000 + patch), judul rilis GitHub, dan pengecek pembaruan di aplikasi.

- **patch** (1.1.0 → 1.1.1): perbaikan bug tanpa fitur baru
- **minor** (1.1.1 → 1.2.0): fitur baru, data lama tetap aman
- **mayor** (1.2.0 → 2.0.0): perubahan besar

Mengubah `VERSION` lalu push ke `main` = rilis APK baru (workflow Build APK). Perubahan di `app/` tanpa menaikkan versi
langsung tayang di versi web saja. Aplikasi menampilkan "Pembaruan tersedia" (dengan jenisnya) saat dibuka bila versi di
Release `apk-terbaru` lebih baru.
