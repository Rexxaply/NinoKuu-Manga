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

## 1.11.0 — 25 Nov 2026

### Ringkasan
- Baru: rak di Koleksi, untuk mengelompokkan komik sendiri (misalnya Sedang dibaca, Nanti, Tamat)
- Baru: pindah sumber, untuk memindahkan komik ke sumber lain beserta posisi baca, lonceng, dan raknya
- Baru: bagian "Mirip ini" di halaman komik, berisi komik populer dengan genre yang sama
- Baru: tekan lama gambar saat membaca untuk membagikan halaman itu
- Baru: tampilan Top 10 di Beranda berupa carousel, dengan kartu tengah yang besar dan menyala

### Detail
- Rak: kolom `library.shelf` (maks. 30 huruf, satu rak per komik; skema + constraint `library_shelf_len`), ikut sinkron (`pull` memilih `shelf`, mundur tanpa kolom bila database lama). Rak kosong disimpan di `settings.shelves`. Store: `shelves`, `addShelf`, `setShelf`, `renameShelf`, `deleteShelf` (PATCH massal per nama rak). Koleksi: chip rak (ikon folder) di antara New update dan jenis komik, chip "+ Rak", baris "Rak X · Ubah nama · Hapus rak". Info komik: tombol "Simpan di rak" (lembar pilih rak / rak baru). `promptText` (kotak isian di `ask`)
- Pindah sumber: tombol "Pindah sumber" (dari koleksi) / "Sumber lain" di info komik. Judul diringkas (`titleQ`), dicari paralel di 4 sumber lain, hasil diurutkan (judul persis / judul alternatif → semua kata cocok), maks. 4 per sumber. `migrateComic`: tambah koleksi baru (+lonceng, +rak), tanda baca & posisi baca dicocokkan lewat nomor chapter (`mergeReadChs`, `saveHistory`), lalu koleksi lama dilepas. Diuji: Kiryuu → Shinigami (koleksi, rak, Ch. 3, tanda Ch. 2–3 ikut)
- Mirip ini: genre komik dicocokkan dengan daftar filter sumber (`loadFilters`), `browse` populer dengan 2 genre pertama (cukup 1 bila hasil < 6; Komiku 1 genre), tanpa komik itu sendiri, maks. 12, dimuat saat bagiannya hampir terlihat (IntersectionObserver), cache 30 komik; judul maks. 2 baris utuh dengan elipsis (`.sim-row .t2`, tidak memakai tinggi 34 px milik Top 10)
- Bagikan halaman: tekan lama gambar ±0,55 dtk (batal bila jari bergeser, cubit, atau menggulir; tidak saat diperbesar) → lembar berisi pratinjau + "Bagikan gambar ini". `DL.sharePage`: gambar diambil seperti unduhan (APK lewat jaringan HP, cadangan proxy; chapter unduhan dari file), APK: cache + plugin Share; web: Web Share API (file) atau unduh. Ketukan yang mengakhiri tekan lama tidak memunculkan menu; menu tekan lama bawaan browser dimatikan pada gambar
- Top 10 (gaya NinoNime): `.cf` carousel snap-tengah, kartu `min(60vw, 236px)` rasio 2:2,85; `coverflow()` mengatur skala (−15%) & redup (−50%) kartu sesuai jarak ke tengah per rAF, kartu tengah `.on` berbingkai + cahaya warna peringkat (emas/perak/perunggu, lainnya putih), mahkota di atas peringkat 1 saat di tengah; judul 2 baris + bintang (skor/2, isi parsial) di dalam kartu; nomor peringkat kotak kiri atas, skor kanan atas; kartu samping yang diketuk digeser ke tengah dulu. Berputar tanpa ujung: daftar digambar 3× (salinan `aria-hidden`), saat gulir berhenti posisi dilompatkan ke salinan tengah. Ringan: jarak kartu diukur sekali, hanya ±3 kartu di sekitar tengah yang diubah per frame (200 langkah gulir ±2 ms di Chrome), tanpa transisi CSS pada skala, nomor peringkat tanpa blur. Ruang atas/bawah diperbesar supaya mahkota & cahaya tidak terpotong
- Ikon baru: `plus`, `swap`, `spark`
- Perbaikan setelah uji Dev 1.11.0 (tetap versi 1.11.0):
  - Top 10: mahkota terpotong karena aturan lama `#pop { padding-top: 16px }` menimpa ruang atas carousel (dihapus). Carousel kini digerakkan sendiri (pointer events, `touch-action: pan-y`, tanpa gulir/snap bawaan WebView): kartu mengikuti jari, dilepas meluncur ke kartu terdekat mengikuti kecepatan (kibasan cepat sampai 2 kartu) dengan kurva ease-out 240–520 ms; ketukan setelah geser tidak membuka komik. Cahaya kartu tengah jadi lapisan `::before` yang hanya berubah opacity (bukan box-shadow yang dianimasikan); ±3 kartu di sekitar tengah dijadikan lapisan GPU (`translateZ(0)`). Diuji di Chrome mobile: geser, kibas melewati ujung (loop), ketuk kartu samping
  - Masuk chapter yang lambat (> 1,2 dtk): kerangka halaman abu-abu (`sk-page`, tampak seperti kotak hitam bergaris di layar gelap) diganti layar tunggu yang sama dengan saat pindah chapter (cincin, "Chapter N", bilah berjalan), judul komik di bilah atas bila sudah diketahui
  - Top 10 (uji kedua): di WebView Android geseran sering diambil sebagai gulir halaman (pointer events + `touch-action: pan-y`, WebView memutuskan arah lebih dulu). Kini sentuhan memakai touch events dengan `touchmove` tidak-pasif: gerakan condong mendatar (sudut < ±50°) mencegah gulir halaman dan menggeser kartu; gerakan vertikal tetap menggulir halaman; mouse tetap pointer events. Diuji dengan sentuhan simulasi (CDP): geser miring 160×55 px → pindah kartu tanpa halaman bergulir, geser vertikal → halaman bergulir
  - "Hapus animasi" (prefers-reduced-motion) aktif di HP: kerangka loading kini berdenyut terang-redup pelan (dulu diam total sehingga tampak tidak ada animasi loading); skala kartu Top 10 tetap mengikuti jari, luncuran dipersingkat 140 ms
  - Top 10 (uji ketiga): kedipan/kartu bertumpuk saat melewati #10 ↔ #1. Penyebab: daftar digambar 3× dan `scrollLeft` dilompatkan ke salinan tengah di akhir luncuran; di WebView lompatan gulir & transform kartu tidak selalu tergambar di frame yang sama, dan kelas `on` pindah ke salinan lain sehingga mahkota/cahaya memudar lalu muncul lagi. Kini tanpa gulir & tanpa salinan: posisi carousel berupa angka (indeks kartu), tiap kartu ditempatkan dengan `translate3d` + skala, jarak ke tengah dihitung melingkar (modulo jumlah kartu); kartu di luar ±2,6 disembunyikan. Diuji: lompatan posisi maks 19 px/frame saat melewati ujung, mahkota tetap di kartu yang sama
  - Masuk chapter terasa berat: daftar halaman kini mulai diambil saat jari menyentuh tautan chapter (`pointerdown`, sebelum ketukan selesai), dipakai bersama oleh pembaca (`pagesLoad`: ingatan 30 mnt + permintaan yang sedang berjalan, tanpa permintaan ganda); layar tunggu muncul setelah 0,3 dtk (dulu 1,2 dtk, halaman lama tampak diam seperti tidak menanggapi)
  - Pembaca: blok hitam di antara halaman = halaman yang belum selesai diunduh (situs gambar lambat), dulu hanya kotak #141414 kosong. Kini kotak itu menampilkan cincin + "Memuat halaman…" yang berdenyut (animasi CSS opacity; cincin berputar SMIL di SVG latar tidak bergerak di WebView sebelum layar digambar ulang). Unduhan juga lebih jauh ke depan: jarak pantau 4 layar (dulu 3), dan tiap halaman yang selesai di dekat posisi baca (≤ 5 halaman di depan) langsung menyusulkan 2 halaman berikutnya, tidak menunggu masuk jarak pantau
  - Pembaca: halaman yang macet (server situs menggantung tanpa galat, mis. halaman 13 tetap hitam walau chapter dimuat ulang). Pengawas tiap 2 dtk: halaman di dekat posisi baca yang > 8 dtk belum tampil dicoba lewat jaringan HP (APK), lalu dimuat ulang langsung dari situsnya dengan alamat baru; maks 3×, tidak pernah lewat proxy Supabase, tercatat di Log error (Dev)
  - Bagikan halaman: baru "Pilih bagian lalu bagikan". Layar pilih bagian: gambar selebar layar (bisa digulir), kotak pilihan dengan garis atas/bawah/kiri/kanan yang bisa diseret dan kotak yang bisa digeser, gulir otomatis saat menyeret di dekat tepi layar; pilihan awal = bagian halaman yang sedang terlihat saat ditekan lama. Gambar dipotong dari berkas aslinya (`createImageBitmap` + canvas → JPEG 92%), "Bagikan seluruh halaman" tetap ada
  - Pilih bagian (uji Dev 70): panel terpotong karena panel bisa terbelah di batas 2 gambar halaman, sedangkan layar pilih bagian hanya memuat 1 halaman. Kini (mode gulir) halaman sebelum & sesudahnya yang sudah termuat ikut ditumpuk, pilihan awal = persis bagian yang terlihat di layar saat ditekan lama (dihitung melintasi batas gambar), dan gambar diperkecil secukupnya supaya garis atas & bawah langsung terlihat. Hasil digabung dari berkas asli tiap halaman (`DL.sharePages`, lebar disamakan, kanvas maks 4096×12000). Diuji: pilihan melintasi 2 halaman → JPEG 300×615 tanpa sambungan
  - Tekan lama halaman tidak lagi memblok teks di lembar "Halaman N dari M" (jari masih menempel saat lembar muncul): lembar itu & layar pilih bagian tanpa seleksi teks / menu salin
  - Pembaca diperbesar: di pojok gambar tidak bisa digeser ke samping (hanya naik-turun). WebView Android mengunci gulir wadah panjang ke satu sumbu. Kini selama diperbesar gulir bawaan dimatikan (`touch-action: none`) dan geser satu jari ditangani sendiri ke dua arah sekaligus, dengan luncuran saat dilepas; cubit tetap seperti sebelumnya. Diuji dengan sentuhan CDP: geser kiri/kanan/miring mengubah posisi mendatar & tegak
  - Pembaca diperbesar: efek "jeli" di tepi gambar. Jari yang terus menarik melewati tepi membuat gambar ikut tertarik dengan hambatan makin berat (rumus karet ala iOS, maks ±55% layar), lalu kembali halus (380 ms) saat dilepas; bisa ditangkap lagi saat sedang kembali. Luncuran berhenti di tepi. Posisi FIT (tidak diperbesar) tanpa efek. Diuji: tarik 200 px di tepi kiri → gambar bergeser 86 px, dilepas → kembali ke 0. Revisi: jeli hanya muncul bila jari jelas mendorong ke samping (arah ditentukan setelah 8 px, mendatar > 1,2× tegak) melewati tepi kiri/kanan — seperti gambar menolak digeser ke sisi itu; gulir naik-turun yang sedikit miring dan tepi atas/bawah tidak pernah berjeli. Diuji: gulir tegak dengan miring 90 px di tepi kiri → tanpa jeli
  - Bagikan: layar hitam dengan cincin berputar "Menyiapkan gambar…" sampai lembar bagikan HP muncul (ditutup saat aplikasi berpindah ke lembar bagikan, atau 1,2 dtk setelah dipanggil). Pilih bagian lebih cepat: hanya halaman yang kena pilihan yang diunduh, bersamaan (ukuran tiap halaman diambil dari gambar di layar)
  - Baru: efek parallax. Info komik: latar sampul buram di belakang judul bergerak 45% kecepatan gulir dan memudar sampai 30% (transform + opacity lewat rAF). Top 10: sampul di dalam kartu bergeser berlawanan arah kartunya (maks ±10% lebar kartu, sampul 1,24×). Keduanya mati saat "Hapus animasi"
  - APK akun developer: pengecek chapter latar belakang di HP (WorkManager ±30 mnt) otomatis dimatikan saat bot Termux aktif (melapor ≤ 30 mnt terakhir, `bg_key_info`) — dobel, boros baterai & kuota. Bila Termux berhenti melapor, dinyalakan lagi sebagai cadangan saat aplikasi dibuka. Kunci Termux tidak tersentuh
  - Baru: jumlah pembaca aktif tampil di samping ikon chat publik Beranda ("● 3"), dari Realtime Presence yang sudah ada (tanpa kueri tambahan); hilang bila belum tersambung; titik pesan baru pindah ke ikon supaya tidak menutupi angka
  - Favorit: tab Koleksi → Riwayat / Unduhan tampak "terlempar" (jempol tab langsung di tujuan lalu bergoyang ±3 px) — dua pilihan kembar (tab judul & tab bilah menempel) berbagi ingatan posisi jempol. Kunci ingatan kini ikut wadah ber-id terdekat (`ui.js` segKey), jadi jempol meluncur dari tab sebelumnya. Diuji: 4→120, 120→236, 236→4 px meluncur halus
  - Daftar chapter: saat mencari chapter dengan keyboard masih terbuka, ketukan pertama pada chapter tidak membuka apa-apa (harus 2×). Penyebab: sentuhan itu melepas fokus kolom cari dulu → kolom cari pindah ke bawah & daftar bergeser sebelum jari diangkat, ketukan meleset. Kini fokus ditahan saat yang diketuk baris chapter (`pointerdown`/`mousedown` preventDefault), jadi sekali ketuk langsung membuka chapter. Diuji dengan sentuhan: sebelum diperbaiki tetap di daftar, sesudahnya langsung ke pembaca
  - Perawatan (tanpa perubahan tampilan/perilaku): `main.js` (±2.970 baris) dipecah per halaman — `home.js` (Beranda, Top 10), `search.js` (Pencarian), `detail.js` (Info komik, daftar chapter, pindah sumber, Mirip ini), `fav.js` (Favorit), `reader.js` (Pembaca, zoom/jeli, bagikan & pilih bagian). `main.js` tinggal ±1.040 baris: router, lembar bawah, potongan tampilan bersama, notifikasi, Lainnya, khusus APK, mulai. Modul halaman menerima fungsi bersama lewat `bindX({...})` sekali sebelum halaman pertama; status bersama: `setHomeSrc` (sumber Beranda/Pencarian), `setCleanup`, `sheet()`, `closeCrop()`. Diuji: rute Beranda, Info komik (rak, pindah sumber, Mirip ini), daftar chapter, Pencarian (ganti sumber ikut ke Beranda), Favorit (3 tab), Lainnya, Level, Chat, Pembaca (zoom, jeli, bagikan, pilih bagian, kembali) — hasil sama persis dengan sebelum dipecah, tanpa galat
  - Efek jeli (uji Dev 74): diberi batas. Tarikan sejauh apa pun paling banyak meregangkan gambar 9% (dulu bisa sampai 50%); hambatan makin berat lebih cepat. Diuji: tarik 200 px → regangan 5,3% (dulu 10,3%)
  - Efek jeli (uji Dev 73): gambar bergetar/goyang saat ditarik di tepi. Penyebab: posisi gulir & regangan ditulis di setiap touchmove (sentuhan bisa 120 Hz) dan tata letak dibaca ulang tiap kejadian, jadi gambar ikut setiap getaran kecil jari. Kini jari hanya mencatat sasaran; gulir & regangan digambar sekali per frame (rAF), regangan mengejar sasarannya dengan peredam (34 ms saat ditarik, 95 ms saat kembali), posisi gambar dibaca sekali di awal sentuhan. Diuji dengan sentuhan bergetar ±4 px: perubahan regangan per frame maks 0,0007 (±0,3 px)
  - Efek jeli (uji Dev 72): saat ditarik, gambar digeser sehingga latar hitam pembaca terlihat di sampingnya. Kini meniru regangan gulir bawaan Android di halaman mentok: gambar DIREGANGKAN (`scale`) dari tepi yang ditarik — tepi itu tetap di tempatnya, tidak ada latar hitam. Berlaku saat diperbesar untuk tepi kiri/kanan (dorong ke samping) dan juga awal/akhir chapter (tarik naik/turun); arah ditentukan setelah 8 px sehingga gulir tegak yang miring tidak meregang ke samping. Diuji: tepi kiri & atas tetap di posisi 0 saat ditarik
  - Pilih bagian: bagian bawah tumpukan halaman tetap putih (tidak digelapkan) karena penggelap berupa bayangan kotak yang jangkauannya terbatas (100vmax). Kini 4 lapisan penggelap (atas/bawah/kiri/kanan) menutupi seluruh tumpukan. Menyiapkan gambar lebih cepat: berkas halaman mulai diunduh begitu lembar bagikan dibuka (selagi memilih bagian) dan diingat sebentar; hasil potongan maks lebar 1600 px, JPEG 90%
  - Info komik: "Simpan di rak" & "Pindah sumber" sama lebar dan memenuhi baris (sejajar baris Mulai baca, diuji 360 & 412 px), tinggi 44 px; tanpa koleksi tombolnya "Cari di sumber lain" selebar baris

---

## 1.10.5 — 25 Nov 2026

### Ringkasan
- Baru: indikator gulir di tepi kanan pembaca bisa dipegang dan diseret untuk melompat cepat di dalam chapter

### Detail
- Pembaca (mode gulir): `.r-sb i` bisa dipegang selama indikator tampil (setelah halaman bergerak), area sentuh 44 px; saat diseret membesar (8 px, merah), getar singkat, posisi jari di jalur = posisi di chapter (`scrollTop` dihitung dari rasio jalur), bilah atas/bawah tidak ikut tersembunyi-tampil (`seeking`). Ketukan di tepi kanan saat indikator tersembunyi tetap untuk membaca biasa; tombol bilah atas tetap di atas (z-index 6). Indikator kini bertahan 1,4 dtk setelah berhenti (dulu 0,9) supaya sempat dipegang. Diuji di Chrome mobile: seret 150 px → gulir ±3.300 px

---

## 1.10.4 — 25 Nov 2026

### Ringkasan
- Tombol Muat lagi di pencarian Shinigami dan WestManga tidak lagi muncul bila hasil yang cocok sudah habis

### Detail
- Pencarian Shinigami/WestManga: halaman berikutnya diambil otomatis (maks. 3) selama masih ada hasil cocok-sebagian yang dibuang dan hasil cocok < 24; `hasNext` dipaksa false bila halaman terakhir masih campuran (API memberi `has_next` karena masih ada judul lain yang memuat salah satu kata). Hasil digabung tanpa duplikat

---

## 1.10.3 — 25 Nov 2026

### Ringkasan
- Tombol Muat lagi tidak lagi muncul saat hasil pencarian sudah habis
- Riwayat pencarian juga muncul saat mengetik, disaring sesuai teks yang diketik
- Aplikasi lebih ringan saat membaca, berpindah halaman, dan berganti sumber di Pencarian

### Detail
- Muat lagi: penyebab sebenarnya `.btn { display: inline-flex }` menimpa atribut `hidden` (server sudah mengirim `hasNext: false`); ditambah `.btn[hidden] { display: none }` (juga untuk tombol Coba lagi di layar tunggu pembaca)
- Riwayat pencarian: tampil juga saat kolom berisi (maks. 5 yang memuat teks itu, selain yang persis sama); dulu hanya saat kolom kosong
- Riwayat pencarian: `.s-wrap`/`.sh-pop` diberi z-index (pilihan sumber yang bisa digeser bisa menjadi lapisan sendiri di WebView Android dan menutupi panel), dan riwayat juga muncul saat kolom yang sudah fokus diketuk lagi
- Kuota database: laporan chapter dari pengecek latar belakang (Termux/APK) berhenti setelah 2 kueri bila chapter terbarunya sama dengan laporan sebelumnya (dulu 6 kueri + klaim per komik tiap putaran)
- Kinerja: `saveLocal` (seluruh koleksi + riwayat diubah ke JSON, riwayat diurutkan) dulu berjalan di setiap ganti halaman pembaca dan setiap pembaruan koleksi; kini digabung paling sering 1× per 400 ms dan langsung ditulis saat `pagehide`/aplikasi ke latar belakang (`flushLocal`). Pencarian: cache hasil per sumber/kata kunci/filter (`sCache`, 10 menit, 12 entri) sehingga pindah sumber bolak-balik langsung tampil tanpa memuat ulang

---

## 1.10.2 — 25 Nov 2026

### Ringkasan
- Pencarian di Shinigami dan WestManga kini tepat sasaran, tidak lagi menampilkan komik yang hanya cocok sebagian kata
- Tanda "sudah dibaca" di daftar chapter kini hanya untuk chapter yang benar-benar pernah dibuka, dan tidak hilang saat membuka chapter sebelumnya
- Tombol Muat lagi tidak muncul lagi saat hasil pencarian Komiku dan BacaKomik sudah habis

### Detail
- Pencarian: API Shinigami & WestManga mencocokkan per kata (mis. "Genius Hitter" memunculkan semua judul berisi "Genius"). Hasil kedua sumber itu kini disaring di aplikasi (`LOOSE_SEARCH`, `matchQ`): setiap kata harus ada sebagai awal kata di judul atau judul alternatif (huruf besar/kecil, aksen, dan tanda kutip diabaikan). Bila satu halaman kosong setelah disaring, sampai 2 halaman berikutnya dicoba. Item daftar membawa `alt` (judul alternatif) dari Edge (`altOf`) dan jalur HP (native.js)
- Tanda baca: dulu semua chapter bernomor di bawah chapter terakhir dibaca dianggap sudah dibaca, dan pindah ke chapter lebih awal menghapus tandanya. Kini per chapter: `readChs` (HP) mencatat chapter yang pernah dibuka (`S.markChRead` saat pembaca dibuka, termasuk chapter unduhan); `chRowFor` memakai `S.chReadSet`. Ikut backup/pulihkan (`readChs`, divalidasi). Tanda lama (hanya dari nomor) tidak dipindahkan; "Terakhir dibaca" tetap
- Muat lagi: Komiku (Edge & HP) & BacaKomik: `hasNext` hanya bila satu halaman penuh (≥ 10 item); penanda hx-get / tautan next ikut tampil walau hasil cuma 1

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
