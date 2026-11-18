# Changelog Ninokuu

Catatan perubahan per versi. Versi terbaru di atas.
Isi pop-up "Yang baru" di aplikasi ada di `app/js/tour.js` (`WHATS_NEW`), gambarnya di `app/img/new/`.

---

## 1.6.3 — (belum dirilis global, sedang diuji di Ninokuu Dev)

### Fitur baru
- **Lanjut baca 1 ketukan.** Lencana `+N` di Koleksi langsung membuka chapter sesudah chapter terakhir yang dibaca. Kalau sudah di chapter terbaru, aplikasi hanya memberi tahu dan tidak pindah halaman.
- **Riwayat baru.** Setiap baris menampilkan sumber, waktu, "Ch. X · hal a / b", dan bar halaman. Tombol **Lanjut** membuka chapter yang belum selesai di halaman terakhir, tombol **Berikutnya** membuka chapter sesudahnya.
- **Riwayat pencarian.** Berisi 10 kata kunci terakhir dan muncul di bawah kolom cari saat kolomnya diketuk dan masih kosong. Bisa dihapus satu-satu atau semuanya. Kata kunci disimpan saat menekan Enter, memilih hasil, atau meninggalkan halaman.
- **Top 10 bermedali.** Nomor peringkat berupa medali di pojok sampul: #1 emas dengan mahkota, #2 perak, #3 perunggu.
- **Bar bawah ringkas.** Saat digulir ke bawah, bar mengecil jadi satu tombol bulat (gaya iOS). Ketuk untuk membukanya lagi.
- **Sampul cadangan.** Sampul yang gagal dimuat diganti logo Ninokuu dengan tombol muat ulang, dan dicoba ulang otomatis saat internet kembali.
- **Pengaturan bacaan.** Sembunyikan menu otomatis, Mode standar/fullscreen, dan pilihan di akhir chapter (Tampilkan menu / Otomatis lanjut).
- **Lanjut dari halaman terakhir**, **zoom cubit** yang mengikuti jari, dan **tombol muat ulang** di bar atas pembaca.
- **Urutkan** Beranda (sesuai sumber) dan Koleksi, plus Koleksi grid 3 kolom.
- **Pembaca aktif** di Chat dihitung realtime (Supabase Realtime Presence).
- **Komik ribuan chapter** dimuat lengkap sampai chapter 1, dan ada halaman reset password di ninokuu.site.

### Tampilan
- Koleksi tampilan daftar lebih ramping: titik warna sumber, chapter yang dibaca ditebalkan, bar progres, dan lencana `+N` atau centang.
- Daftar Beranda dan Pencarian minimalis, dengan tanda hati untuk komik yang sudah ada di koleksi.
- Menu ⋯ pembaca ringkas, kira-kira sepertiga tinggi sebelumnya.
- Pop-up "Yang baru" memakai slide gambar (carousel) yang mengikuti jari.

### Perbaikan
- Shinigami pindah ke server baru (`api.shinigami.io`, situs `s1.shinigami.mx`). Daftar komik memakai `limit/offset`, daftar chapter memakai `cursor`.
- Gambar chapter tidak lagi melompat saat dimuat. Tinggi sementara mengikuti ukuran gambar sebelumnya, dan halaman dimuat 3 layar atau 2 halaman ke depan.
- Animasi lebih mulus:
  - Indikator tab, sakelar, dan bar bawah memakai transform.
  - Hiasan avatar hanya bergerak saat terlihat dan dijeda saat pindah halaman.
  - Bingkai rank komentar dibuat 5× lebih cepat.
  - Kilau kerangka "memuat" memakai transform.
- Halaman komik tidak lagi menggambar ulang seluruh isinya saat komentar datang.
- Menu ⋯ pembaca tidak terpotong, file CBZ/ZIP besar bisa dibuka, dan pop-up "Yang baru" di Dev hanya muncul ulang bila isinya berubah.

### Server & biaya (Supabase)
- **Hemat egress.** Gambar dimuat langsung dari situs sumber, dan proxy server hanya dipakai sebagai cadangan terakhir. Sampul memakai versi kecil (Komiku `?w=`, Kiryuu ukuran WordPress).
- Secret `IMG_PROXY=cover` sudah dipasang sejak 18 Nov 2026, sehingga server hanya mengirim sampul. APK 1.6.1 ke bawah tidak bisa membuka halaman chapter Komiku, Kiryuu, dan Shinigami sampai pengguna memperbarui aplikasi.
- `ninokuu-api` 1.5.0: aksi `more_chapters`, `latest`, urutan per sumber, dan cron yang mati otomatis di fungsi `-dev`.
- Build global gagal otomatis bila changelog "Yang baru" atau gambar slidenya untuk versi itu tidak ada (`.github/workflows/apk.yml`).

### Langkah rilis global (saat "update")
1. Gabungkan `dev` → `main`. Ubah `VERSION` bila nomor versinya naik, dan pindahkan entri `WHATS_NEW` ke versi baru itu.
2. Deploy `ninokuu-api` 1.5.0 ke fungsi global.
3. Pastikan Redirect URL Auth Supabase berisi `https://ninokuu.site/resetpassword/`.
4. Tunggu APK `apk-terbaru` selesai dibangun, lalu umumkan pembaruan ke pengguna.

---

## 1.6.2 — 18 Nov 2026
- Hemat egress Supabase: gambar langsung dari situs asli, dan proxy hanya cadangan.

## 1.6.1 — 15 Nov 2026
- Tombol update membuka halaman ninokuu.site/update.
