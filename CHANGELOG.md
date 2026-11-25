# Changelog Ninokuu

Catatan perubahan per versi. Versi terbaru di atas.
**Cara menulis:** "### Ringkasan" dibaca pengguna (peringatan pembaruan, ninokuu.site/update, halaman rilis): bahasa sederhana, hanya yang penting, tanpa istilah teknis dan tanpa cara pengerjaannya. Awali poin dengan "Baru:" untuk fitur baru; perbaikan cukup sebut bagian yang diperbaiki (mis. "Perbaikan pada pembaca"). Rincian teknis hanya di "### Detail".
Isi pop-up "Yang baru" di aplikasi ada di `app/js/tour.js` (`WHATS_NEW`), gambarnya di `app/img/new/`.

**Aturan nomor versi** (`MAYOR.MINOR.PATCH`, berkas `VERSION`):
- **PATCH** (1.7.0 → 1.7.1): hanya perbaikan bug, ganti alamat situs sumber, dan perubahan kecil tanpa fitur baru.
- **MINOR** (1.7.x → 1.8.0): ada fitur baru atau perubahan tampilan yang terasa, dan masih cocok dengan data/server lama.
- **MAYOR** (1.x → 2.0.0): perubahan besar yang tidak cocok dengan versi lama, misalnya format data atau server baru, atau desain ulang total.
- Setiap naik MINOR/MAYOR, tambahkan entri `WHATS_NEW` di `app/js/tour.js` dengan nomor yang sama, beserta gambar slidenya. Build global gagal bila entri itu tidak ada. Versi PATCH memakai entri MINOR-nya dan tidak memunculkan pop-up lagi.

---

## 1.10.2 — belum dirilis

### Ringkasan
- Pencarian di Shinigami dan WestManga kini tepat sasaran, tidak lagi menampilkan komik yang hanya cocok sebagian kata

### Detail
- Pencarian: API Shinigami & WestManga mencocokkan per kata (mis. "Genius Hitter" memunculkan semua judul berisi "Genius"). Hasil kedua sumber itu kini disaring di aplikasi (`LOOSE_SEARCH`, `matchQ`): setiap kata harus ada sebagai awal kata di judul atau judul alternatif (huruf besar/kecil, aksen, dan tanda kutip diabaikan). Bila satu halaman kosong setelah disaring, sampai 2 halaman berikutnya dicoba. Item daftar membawa `alt` (judul alternatif) dari Edge (`altOf`) dan jalur HP (native.js)

---

## 1.10.1 — 25 Nov 2026 (rilis global)

### Ringkasan
- Baru: sumber komik BacaKomik
- Baru: skor komik tampil di pojok sampul pada daftar dan Top 10
- Baru: di Favorit, pilihan Koleksi/Riwayat/Unduhan tetap terlihat di atas saat menggulir, lengkap dengan tombol cari
- Baru: Komiku menampilkan batas umur pembaca (misalnya 13+ atau 18+)
- Label NEW UPDATE di Koleksi muncul lebih cepat untuk semua sumber, tanpa harus membuka komiknya dulu
- Notifikasi chapter baru Komiku, Shinigami, dan WestManga lebih cepat
- Pindah chapter (termasuk lanjut otomatis) tidak lagi terlihat macet saat jaringan lambat
- Skor komik Kiryuu kini tampil, dan pilihan sumber dirapikan

### Detail
- Favorit: `#favbar` (fixed, kaca buram) muncul saat `#favtop` tergulir keluar layar (`favBarTick` di scroll/resize); isinya kotak segmen tab + tombol cari `.seg-ic` yang menyatu (hanya di Koleksi). Ketuk cari → kolom `#fbq` muncul di bawah kotak pilihan (tab tetap ada; fokus otomatis, sinkron dengan `fav.q`); tombol cari berubah jadi ✕ untuk menutup & menghapus kata kunci, ✕ kecil di kolom hanya menghapus teks; selama mode cari bilah tetap tampil. Pindah tab dari bilah menggulir ke awal daftar. Diuji di Chrome 390 px (tampil saat digulir, cari mengetik & menyaring)
- Rilis global ini membawa juga semua isi 1.10.0 (lihat di bawah). "Yang baru" 1.10.0 + slide `bacakomik`, `favbar`, `tunggu` (screenshot aplikasi dengan data contoh)
- Pembaca: pindah chapter di dalam pembaca yang belum siap dalam 0,25 dtk → chapter lama bergeser keluar (animasi swap yang sama) dan layar tunggu `.r-wait` masuk (cincin putar, "Chapter N", bilah berjalan; 6 dtk: "Jaringan lambat, masih memuat…"; 15 dtk: tombol Coba lagi); dulu chapter lama dibiarkan tampil sampai chapter baru siap sehingga terlihat macet. Galat chapter baru tampil di layar tunggu. Selama hitung mundur lanjut otomatis, daftar halaman chapter berikutnya diambil duluan ke `pagesMem`

---

## 1.10.0 — 25 Nov 2026

### Ringkasan
- Baru: sumber komik BacaKomik
- Pilihan sumber dirapikan supaya 5 sumber muat tanpa terpotong
- Baru: skor komik tampil di pojok sampul pada daftar dan Top 10
- Label NEW UPDATE di Koleksi kini muncul lebih cepat untuk semua sumber, tanpa harus membuka komiknya dulu
- Komiku kini menampilkan batas umur pembaca (misalnya 13+ atau 18+), bukan skor
- Skor komik Kiryuu kini tampil di halaman info komik

### Detail
- Label NEW: notifikasi chapter baru (lonceng) langsung memperbarui `latest`/`latestAt` komik di Koleksi (`applyNotifLatest` di `loadNotifs`, juga saat push masuk); `refreshLatest` kini 45 menit per komik (dulu 3 jam), urut yang paling lama dicek, dan juga berjalan saat aplikasi dibuka / kembali dibuka / tiap 5 menit selama terbuka (putaran paling sering 10 menit sekali), tidak hanya saat Koleksi dibuka
- Rating: Komiku `score: null` + `age` dari baris "Umur Pembaca" (`toAge` → "13+"), di Edge Function dan jalur HP (native.js); Kiryuu: skor dibaca dari `metadata.meta.score` (dulu dicari di `m.meta` yang tidak ada, jadi selalu kosong); info komik menyembunyikan skor lama di cache untuk Komiku dan menampilkan lencana umur `.inf-age` (18+ merah); `scoreFromHtml` dihapus
- BacaKomik (sumber ke-5, dari ekstensi Keiyoushi "BacaKomik", konten aman): Edge `bkPage` (/daftar-komik/ dengan order/title/type/status/genre[]), `bkDetail` (infoanime/spe, skor dari angka di samping sampul, jumlah pembaca), `bkChapters` (#chapter_list .lchx/.dt), `bkPages` (img alt "Chapter", cadangan onerror, tanpa noscript), `bkFilters` (genre[] dari /daftar-komik/); ID komik & chapter = slug, domain lewat secret `BACAKOMIK_SITE` (bawaan https://bacakomik.my); dicek cron server (bukan REPORTABLE). Aplikasi: `SOURCES`, `SRC_SORTS`, titik warna, pilihan sumber lebih rapat untuk 5 penyedia, baris panduan domain
- Pilihan sumber: kotak segmen lama tetap (`.seg.src`), lebar tiap pilihan mengikuti nama (`flex: 1 0 auto`, padding 4px, 11,5px), bisa digeser bila layar < 360 px; diuji 360 & 412 px tanpa luapan
- Skor di sampul: `cv-score` di kartu grid & Top 10 bila item punya `score` (bukan Komiku); daftar dari Edge kini membawa `score` (Shinigami `user_rate`, Kiryuu `metadata.meta.score`, WestManga, BacaKomik dari kartu), juga jalur HP Shinigami/WestManga di native.js
- Edge Function ninokuu-api 1.8.0: kunci kedua untuk pengecek di Termux (`bg_key`/`bg_key_drop` dengan `slot: "termux"`, action baru `bg_key_info`); keluar akun di APK tidak mematikan kunci Termux
- Skema: kolom `bg_keys.termux_hash` & `termux_used_at` (+ indeks unik). Edge 1.7.1 tetap jalan dengan skema lama (kunci Termux saja yang belum bisa dibuat)
- Panel developer: baris "Pengecek chapter di Termux" (status, buat/ganti kunci, matikan)
- Bot WhatsApp rexxa-bot: modul `lib/ninokuu.js` (bg_list → ambil chapter Komiku/Shinigami/WestManga dari HP → bg_report, tiap 5 menit; senggol cron server tiap 10 menit untuk Kiryuu) + perintah `.ninokuu`

---

## 1.9.1 — 22 Nov 2026 (rilis global)

### Ringkasan
- Notifikasi chapter baru Komiku aktif kembali
- Notifikasi chapter baru Komiku, Shinigami, dan WestManga kini terkirim lebih rutin, walau aplikasimu sedang ditutup

### Detail
- Edge Function ninokuu-api 1.7.0: Komiku boleh dilaporkan HP (`REPORTABLE`); action baru `bg_key`, `bg_key_drop` (login, khusus developer), `bg_list`, `bg_report` (kunci latar belakang per akun developer, hanya hash-nya yang disimpan); laporan developer langsung dipercaya (tanpa pelapor kedua)
- Skema: tabel `bg_keys` (hanya server)
- APK: `NinokuuBgWorker` (WorkManager, ±30 menit, butuh internet; unduhan halaman komik berhenti setelah 50 baris chapter) + method `bgSetup`/`bgStop` di plugin NinokuuCache; kunci dibuat saat akun developer login, dihapus saat keluar
- Diuji: Supabase dan Vercel sama-sama ditolak Cloudflare Komiku (403), jadi pengecekan memang harus lewat jaringan HP

---

## 1.9.0 — 22 Nov 2026 (rilis global)

### Ringkasan
- Baru: gulir otomatis saat membaca, dengan kecepatan 1×, 2×, atau 3×
- Baru: lanjut otomatis ke chapter berikutnya di akhir chapter
- Baru: skor komik di halaman info komik
- Baru: Bersihkan cache di menu Lainnya, lengkap dengan perkiraan ukurannya
- Baru: halaman Akun untuk foto profil, nama, email, dan password
- Pindah chapter lebih mulus, tanpa layar hitam
- Mode layar penuh kini sampai ujung atas layar
- Komiku tetap bisa dibaca di aplikasi
- Semua pengaturan baca kini ada di satu halaman Pengaturan
- Keamanan akun dan data ditingkatkan

### Detail
- WHATS_NEW 1.9.0 dengan 4 slide baru: gulir, skor, cache, setelan (app/img/new/)
- Edge Function global `ninokuu-api` diperbarui ke 1.6.1 (sama dengan dev)

---

## 1.8.12 — 22 Nov 2026

### Ringkasan
- Perbaikan: setelah pindah chapter, halaman ke-3 dan seterusnya kosong (hitam) sampai digulir turun lalu naik lagi (sejak animasi geser 1.8.10)

---

## 1.8.11 — 22 Nov 2026

### Ringkasan
- Perbaikan: "Lanjut otomatis" ke chapter berikutnya tidak berjalan setelah pindah chapter (sejak animasi geser 1.8.10)

---

## 1.8.10 — 22 Nov 2026

### Ringkasan
- Pindah chapter di pembaca tidak lagi tampak meloncat: halaman chapter lama digeser keluar sementara chapter baru masuk dari sisi lain (berikutnya dari kanan, sebelumnya dari kiri)
- Komiku: situsnya mulai menolak server Ninokuu (Cloudflare). Di APK, Komiku kini otomatis diambil langsung lewat jaringan HP selama server ditolak (daftar, info komik, halaman chapter), lalu dicoba lewat server lagi setiap 30 menit

---

## 1.8.9 — 22 Nov 2026

### Ringkasan
- Layar penuh di pembaca (APK): bilah status yang ditarik dari atas kini muncul transparan di atas halaman lalu hilang sendiri setelah beberapa detik, tanpa perlu mengetuk halaman dua kali
- Animasi pindah chapter mengikuti arah: chapter berikutnya masuk dari kanan, chapter sebelumnya dari kiri
- Menu bacaan: tombol "Chapter" menampilkan nomor chapter yang sedang dibaca (bukan jumlah chapter)
- Perbaikan keamanan dari audit: server (Edge Function 1.6.1: SSRF & proxy gambar, notifikasi atomik), skema database (hierarki moderasi, batas baris, nama aman), unduhan, restore backup, gambar chat (EXIF dibuang, gambar yatim dibersihkan), dan data lokal saat akun berganti

---

## 1.8.8 — 21 Nov 2026

### Ringkasan
- Bersihkan cache: baris di Lainnya menampilkan perkiraan cache Ninokuu di HP; dialog ringkas berisi angka besar perkiraan cache, rincian (gambar sampul & halaman, data info komik), dan catatan bahwa koleksi, riwayat & unduhan aman; hasilnya cukup pesan kecil di bawah
- Dialog konfirmasi lebih pekat (tidak tembus pandang) dengan tombol selebar kartu

### Detail
- APK: plugin native kecil `NinokuuCache` (apk/native/NinokuuCachePlugin.java, dipasang oleh workflow) untuk menghitung & mengosongkan cache WebView/aplikasi; web: Cache Storage gambar & simpanan info komik
- Dialog Ninokuu bisa dipakai sebagai pemberitahuan satu tombol (`cancel: ""`)

---

## 1.8.7 — 21 Nov 2026

### Ringkasan
- Bar "Lanjut baca" info komik: meluncur naik saat masuk dari Beranda/tab dan meluncur turun saat kembali ke Beranda/tab, meluncur naik lagi (tanpa jeda) saat keluar dari pembaca; saat masuk pembaca bar ini diam (yang beranimasi hanya bar/menu pembaca)
- Semua dialog konfirmasi bawaan Android (hapus riwayat, hapus notifikasi, hapus foto profil, keluar, hapus/blokir pesan, pengumuman, pembersihan data) diganti dialog Ninokuu: kartu kaca di tengah, animasi masuk membesar-memudar & keluar mengecil-memudar, tombol berbahaya berwarna merah; tombol kembali HP = Batal

---

## 1.8.6 — 21 Nov 2026

### Ringkasan
- Pindah chapter di mode layar penuh tidak lagi membuat seluruh layar bergeser naik-turun sesaat: status bilah status HP tidak disentuh sampai chapter baru tampil
- Kembali dari pembaca ke info komik: bilah status tidak ikut disembunyikan sekejap saat bar meluncur keluar
- Layar "Memuat…" baru muncul bila chapter butuh lebih dari 1,2 detik (sebelumnya 0,65 detik); sampai saat itu halaman sebelumnya tetap tampil

---

## 1.8.5 — 21 Nov 2026

### Ringkasan
- Kembali dari pembaca ke info komik: bar "Lanjut baca" langsung ada di tempatnya (tidak lagi hilang lalu meluncur naik terlambat)
- Buka/pindah chapter tanpa layar hitam sekejap: halaman tujuan di situs yang menolak dimuat langsung (mis. Shinigami) diambil lewat jaringan HP sebelum pembaca digambar, lalu langsung digambar
- Kartu profil di Lainnya kembali seperti semula; kartu baru "Akun" di bawah kartu profil yang membuka halaman Akun, berisi Foto profil, Nama tampilan, Email, Ganti password
- Tombol Keluar pindah ke paling bawah Lainnya, setelah Ketentuan pengguna

---

## 1.8.4 — 21 Nov 2026

### Ringkasan
- Bar bawah yang mengecil terbuka penuh lagi sendiri setelah layar diam ±2,5 detik; gulir ke bawah lagi untuk mengecilkannya
- Masuk pembaca dari info komik: bar atas & bawah baru meluncur masuk setelah halaman selesai dimuat (tidak terlihat macet); layar "Memuat…" tampil diam tanpa animasi; pindah chapter di dalam pembaca langsung tampil tanpa animasi bar
- Gulir otomatis di pembaca (mode Scroll): 1×, 2×, 3× lewat menu ⋯ atau Pengaturan; tekan layar untuk berhenti, lepas untuk lanjut
- HP boleh diputar terbalik (atas-bawah) dalam posisi potret, mengikuti pengaturan putar otomatis HP
- Zoom: layar bersih tanpa label persen; perbesaran & geseran terkunci di dalam halaman (tidak ada celah hitam di tepi)
- Skor komik dari situs sumber (★ dari 10) di info komik, bila sumbernya menyediakan
- Lainnya: kartu profil dan pengaturan akun digabung dalam satu panel "Akun"
- Pilihan mode baca (Scroll/Slide & arah geser) pindah dari Lainnya ke halaman Pengaturan
- Panel developer: panduan lengkap ganti API & domain (peta Supabase vs APK, cara mendapatkan alamat baru, ganti di Supabase, ganti di kode sampai jadi APK, ganti project Supabase / ninokuu.site, menambah changelog & "Yang baru")
- Edge Function ninokuu-api 1.6.0: kirim skor komik

### Detail
- Edge Function ninokuu-api-dev 1.6.0: info komik membawa `score` (skala 10) dari Shinigami, WestManga, Kiryuu, dan Komiku bila sumbernya menyediakan
- APK: orientasi `userPortrait` (potret & potret terbalik, mengikuti kunci putar HP)

---

## 1.8.3 — 18 Nov 2026

### Ringkasan
- Mode baca layar penuh kini sampai ujung atas layar (termasuk sekitar lubang kamera), tanpa pita hitam
- Gradasi hitam di atas (di belakang bilah status & bar atas) dan di bawah (di belakang bar halaman & tombol) pembaca; bar dan gradasi meluncur mulus keluar layar saat disembunyikan (tanpa memudar)
- Pembaruan langsung terdeteksi saat aplikasi dibuka ulang (simpanan 10 menit hanya untuk cek berkala & halaman Lainnya)
- Pengaturan baru "Lanjut otomatis ke chapter berikutnya": OFF · 1 · 2 · 3 · 5 detik (bawaan 3 detik), di Lainnya → Pengaturan dan menu ⋯ pembaca; menggantikan pilihan "Di akhir chapter"
- Tanpa pita hitam di sisi kanan (bilah gulir disembunyikan di HP); kembali ke chapter yang sama dari info komik langsung tampil tanpa "Memuat…"; bar Lanjut baca naik utuh tanpa meloncat
- Lanjut dari halaman terakhir tanpa lompatan dan tanpa layar hitam sekejap: halaman sebelumnya tetap tampil sampai gambar halaman tujuan siap (maks 0,6 dtk)
- Info komik ⇄ pembaca dengan animasi yang sama seperti Beranda → info komik: isi halaman meluncur dari samping, bar meluncur dari tepi layar; tombol kembali (juga tombol kembali Android) menurunkan/menaikkan bar dulu sebelum info komik meluncur masuk
- Masuk ke pembaca lebih mulus: halaman langsung tampil tanpa bergeser ke samping, bar atas & bawah meluncur masuk dari tepi layar
- Review desain (Apple HIG): label badge minimal 11 px; Top 10 tanpa celah antara judul & jenis; dukungan "Kurangi transparansi" dan "Tingkatkan kontras"
- Indikator gulir tipis gaya iOS di tepi kanan pembaca: muncul saat halaman bergerak, menghilang sendiri saat berhenti
- Posisi baca dikirim ke server paling sering 1× per 20 detik (sebelumnya setiap ganti halaman); tetap tersimpan di HP seketika
- Kartu unduhan melayang di kiri bawah (pasangan pil +EXP): sampul, judul, chapter & halaman yang sedang diunduh, persentase dan bar berkilau; berubah hijau dengan tanda centang saat selesai, abu-abu saat dijeda/gagal; ketuk untuk membuka Favorit › Unduhan
- Baris Unduhan di Lainnya menampilkan bar progres yang terbuka pelan saat ada unduhan berjalan
- Bilah gulir bawaan Android di pembaca disembunyikan; yang tampil hanya indikator gulir tipis Ninokuu
- Pindah ke Favorit tidak lagi tersendat saat aplikasi baru dibuka: Koleksi tidak digambar ulang belasan kali selama chapter terbaru dicek, cukup kartu yang berubah yang diperbarui (sampul tidak berkedip)

### Detail
- Selama di pembaca mode layar penuh, `StatusBar.setOverlaysWebView({ overlay: true })` tetap menyala; ketukan hanya menyembunyikan/memunculkan bilah status (halaman tidak melompat). Overlay dimatikan sebelum halaman berikutnya digambar saat keluar dari pembaca (info komik tidak melompat turun); pindah chapter tetap memakai overlay. 1.8.2 (shortEdges saja) belum cukup karena jendela masih menyisakan jarak untuk bilah status
- Tidak ada perubahan server

---

## 1.8.2 — 18 Nov 2026

### Ringkasan
- Mode baca layar penuh kini benar-benar penuh: tidak ada lagi pita hitam di atas (area lubang kamera ikut dipakai)

### Detail
- Tema Android: `windowLayoutInDisplayCutoutMode = shortEdges` (dipasang oleh workflow Build APK). Tanpa ini Android menyisakan area lubang kamera kosong saat bilah status disembunyikan
- Tidak ada perubahan server

---

## 1.8.1 — 18 Nov 2026

### Ringkasan
- Cek pembaruan lebih andal: tidak lagi muncul "Tidak bisa memeriksa pembaruan" saat batas API GitHub (60 cek/jam per jaringan) habis; versi terbaru dibaca dari cadangan
- Hasil cek pembaruan disimpan 10 menit, jadi membuka Lainnya berkali-kali tidak menghabiskan batas itu

### Detail
- `latestBuild()`: simpanan 10 menit (cek manual: 1 menit); bila API rilis GitHub menolak, versi global dibaca dari `VERSION` dan ringkasan dari `CHANGELOG.md` di raw.githubusercontent.com
- Tidak ada perubahan server

---

## 1.8.0 — 18 Nov 2026

Naik MINOR (1.7.0 → 1.8.0) karena ada fitur baru (Trakteer, cek pembaruan otomatis, backup ke file, jendela mengambang). 1.7.1 hanya pernah ada di Ninokuu Dev dan isinya ikut di versi ini.

### Ringkasan
- Traktir Ninokuu: dukung Ninokuu lewat Trakteer dari kartu baru di Lainnya
- Pembaruan muncul sendiri tanpa membuka ulang aplikasi (cek tiap 15 menit); saat membaca cukup spanduk kecil di atas
- Backup data jadi file sungguhan di Documents/Ninokuu/Backup, bisa dibagikan ke Drive/WhatsApp
- Label NEW UPDATE hanya untuk chapter yang rilis kurang dari 24 jam; urutan Update terbaru lebih akurat
- Bisa dipakai di jendela mengambang/layar terbagi saat HP miring, tata letak menyesuaikan
- Chat: kolom tulis tepat di atas keyboard dan meluncur halus, judul tidak tertimpa bilah status
- Kaca gaya iOS di menu ⋯ pembaca, bar bawah, dan tombol; efek kaca tidak lagi mati saat pindah halaman
- Menu "Yang baru di versi ini" di Lainnya untuk membuka panduan kapan saja
- Perbaikan tab Level & Rank yang menutupi kartu level
- Perbaikan chip filter Koleksi yang melompat, tombol grid Pencarian kini sejajar
- Pilihan aktif (mis. Scroll) tidak memuat ulang pembaca bila ditekan lagi
- Bar Mulai baca meluncur halus tanpa bayangan melompat

### Detail
- Menu baru di Lainnya: "Yang baru di versi ini", berisi pop-up fitur baru dan panduan bergambar yang bisa dibuka kapan saja
- Perbaikan menu ⋯ pembaca: tanda pilihan aktif (Scroll, Layar, Akhir chapter) tidak lagi hilang setelah menu ditutup lalu dibuka lagi
- Mode jendela mengambang/layar terbagi saat HP miring kini bisa dipakai (pesan "Putar HP" hanya untuk layar penuh); tata letak dipadatkan untuk jendela pendek: bar bawah lebih ramping, kolom kartu lebih banyak, judul dan sampul lebih kecil
- Pembaruan aplikasi kini terdeteksi tanpa perlu membuka ulang aplikasi: dicek tiap 15 menit dan saat kembali ke aplikasi; saat sedang membaca muncul spanduk kecil di atas (tidak menutupi halaman)
- Perbaikan halaman Level & Rank: tab Ringkasan/Riwayat/Tangga tidak lagi turun menutupi kartu level
- Label NEW UPDATE di Koleksi kini konsisten: hanya untuk chapter terbaru yang rilis kurang dari 24 jam, tetap tampil walau sudah dibaca (filter "New update" mengikuti aturan yang sama); urutan "Update terbaru" dibandingkan sebagai waktu sungguhan, bukan teks tanggal
- Perbaikan chip filter Koleksi (Manga/Manhwa/Manhua): deretan chip tidak lagi melompat ke awal setelah memilih, pilihan aktif selalu terlihat penuh
- Pencarian: tombol grid/daftar kini sejajar di ujung deretan chip Semua/Manga/Manhwa/Manhua (keempat chip muat penuh)
- Dukung Ninokuu lewat Trakteer: kartu "Traktir Ninokuu" di Lainnya dengan lembar penjelasan sebelum membuka halaman Trakteer
- Backup data offline di APK kini benar-benar membuat file (Documents/Ninokuu/Backup), lengkap dengan tombol bagikan untuk menyimpannya ke Drive, WhatsApp, atau tempat lain
- Pilihan yang sedang aktif (mis. Scroll di menu ⋯ pembaca) tidak bisa ditekan lagi, jadi tidak memuat ulang pembaca
- Menu ⋯ pembaca, bar bawah, dan semua tombol kaca memakai buram gaya iOS (lebih kuat, warna lebih hidup)
- Efek kaca tidak lagi "mati" sesaat saat pindah halaman, membuka/menutup pop-up, atau membuka pembaca (animasi tanpa memudarkan induknya)
- Perbaikan kolom chat yang terlempar ke atas layar saat keyboard muncul: posisi kolom kini mengikuti bagian layar yang benar-benar terlihat (termasuk saat Android menggeser layar), tidak diangkat dua kali; layar chat kini menyusut di atas keyboard seperti aplikasi chat (judul tetap di atas, pesan terbaru tetap terlihat tepat di atas kolom), kolom meluncur halus mengikuti keyboard, dan judul halaman tidak lagi tertimpa bilah status (tanpa jarak atas berlebih)
- Bayangan di belakang bar Mulai baca ikut naik bersama bar dan tidak lagi melompat saat animasi selesai
- Bar "Mulai baca" di halaman komik dan bar bawah daftar chapter meluncur naik dengan halus saat halaman dibuka (sebelumnya hilang sesaat lalu muncul tiba-tiba)
- Perbaikan bar bawah saat kembali dari halaman komik/chat ke Beranda: isi halaman tidak lagi tembus di balik bar

### Langkah rilis
- `VERSION` 1.8.0, entri `WHATS_NEW["1.8.0"]` + 4 slide baru (`trakteer`, `update`, `baru`, `backup`) di `app/img/new/`
- Tidak ada perubahan server (`ninokuu-api` tetap 1.5.0)

---

## 1.7.0 — 18 Nov 2026

> Sempat dirilis dengan nomor 1.6.3. Karena berisi fitur baru, nomornya diganti ke 1.7.0 tanpa perubahan isi.

### Ringkasan
<!-- 12 baris pertama ini tampil di peringatan pembaruan aplikasi; jangan lebih dari 12 -->
- Lanjut baca 1 ketukan: lencana +N di Koleksi langsung membuka chapter berikutnya
- Koleksi & Riwayat baru (tombol Lanjut / Berikutnya), daftar Beranda & Pencarian lebih ringkas
- Top 10 bermedali (emas bermahkota, perak, perunggu) dan riwayat pencarian
- Bar bawah ringkas & animasi pilihan gaya iOS, semua halaman lebih mulus
- Hemat kuota: halaman chapter dimuat bertahap tanpa melompat, sampul versi kecil
- Mode fullscreen, pilihan di akhir chapter, zoom cubit, tombol muat ulang di pembaca
- Sampul gagal → logo Ninokuu + tombol muat ulang
- Shinigami kembali bisa dibuka (server baru)
- Menu ⋯ pembaca lebih ringkas
- Chapter yang belum selesai lanjut dari halaman terakhir
- Pembaca aktif di Chat dihitung realtime
- Rincian lengkap ada di catatan rilis dan CHANGELOG.md

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
- Pilihan bersegmen (sumber, Koleksi/Riwayat/Unduhan, chip jenis, pengaturan, filter, menu pembaca) memakai "jempol" yang meluncur seperti iOS. Geraknya murni transform (GPU), dan chip tanpa garis tepi supaya tidak ada garis yang tampak saat pil lewat.

### Perbaikan
- Sumber di Beranda dan Pencarian disamakan: memilih di salah satu ikut berlaku di yang lain.
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
1. Gabungkan `dev` → `main` dengan `VERSION` yang sudah dinaikkan sesuai aturan di atas, dan entri `WHATS_NEW` bernomor sama.
2. Deploy `ninokuu-api` 1.5.0 ke fungsi global.
3. Pastikan Redirect URL Auth Supabase berisi `https://ninokuu.site/resetpassword/`.
4. Tunggu APK `apk-terbaru` selesai dibangun, lalu umumkan pembaruan ke pengguna.

---

## 1.6.2 — 18 Nov 2026
- Hemat egress Supabase: gambar langsung dari situs asli, dan proxy hanya cadangan.

## 1.6.1 — 15 Nov 2026
- Tombol update membuka halaman ninokuu.site/update.
