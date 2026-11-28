# Sinkron server lokal ⇄ Supabase Cloud

Server lokal (`panel.ninokuu.site`) = server utama. Supabase Cloud = cadangan yang dipakai aplikasi otomatis
saat server lokal mati. `sync.sh` menjaga keduanya tetap sama, dua arah, tiap 10 menit.

| Berkas | Untuk |
|---|---|
| `sync-schema.sql` | pencatat perubahan + fungsi penerap. Jalankan di **kedua** database. Aman diulang. |
| `cloud-offset.sql` | **hanya Cloud**: id otomatis Cloud mulai dari 1.000.000.000 (tidak bentrok dengan lokal). |
| `sync.sh` | sinkron. `--dry` = simulasi tanpa menulis apa pun. |

## Aturan

- Yang disinkron: semua tabel `public` + `auth.users` + `auth.identities` (tambah, ubah, **hapus**).
  Sesi login/refresh token tidak (token memang per server). Berkas gambar (`avatars`, `chat-images`)
  yang dirujuk database ikut disalin bila `CLOUD_URL` + `CLOUD_SECRET_KEY` diisi.
- Baris yang berubah di **kedua** sisi sejak sinkron terakhir: **server lokal menang** (versi Cloud dibuang).
  Contoh: nama profil diganti di lokal dan di Cloud → nama dari lokal yang dipakai.
- Saat menerapkan, trigger aplikasi tidak jalan (EXP, notifikasi, dll. tidak terpicu dua kali).
- Baris yang gagal diterapkan (mis. username sama dibuat di dua sisi) dicatat di `sync.errors`, sisanya tetap jalan.
- Pencatat tidak pernah menggagalkan tulisan aplikasi.
- Catatan perubahan yang sudah terkirim dihapus setelah 3 hari.

## Keterbatasan (diketahui)

- Angka yang dinaikkan di dua sisi (mis. total EXP profil) tidak dijumlahkan: versi lokal menang.
  Riwayat EXP (`exp_log`) dari kedua sisi tetap tersimpan.
- `TRUNCATE` tidak tercatat. Jangan pakai `truncate` di tabel public selama sinkron aktif.
- Tabel baru (setelah update skema): jalankan ulang `sync-schema.sql` di kedua sisi.

## ~/.sync-cloud.env (chmod 600, jangan dibagikan)

```
CLOUD_PGHOST=aws-...pooler.supabase.com     # Connect → Session pooler (host)
CLOUD_PGPORT=5432
CLOUD_PGUSER=postgres.ocersqyrztzegwzjvvoh
CLOUD_PGPASSWORD='kata-sandi-database-cloud'
CLOUD_URL=https://ocersqyrztzegwzjvvoh.supabase.co
CLOUD_SECRET_KEY='sb_secret_...'           # Cloud → Settings → API Keys (untuk salin berkas gambar)
```
