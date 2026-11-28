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

## Pemasangan (sekali; juga saat pindah ke Mini PC)

1. Backup lokal (`~/backup-supabase.sh`).
2. Cloud (SQL Editor): `sync-schema.sql`, lalu `cloud-offset.sql`.
3. Lokal: `sync-schema.sql`, lalu isi ulang data dari Cloud (data-only `public` tanpa `fallback_log`
   + `auth.users`/`auth.identities`) dalam SATU transaksi dengan `session_replication_role=replica`.
4. **Wajib:** kembalikan urutan id lokal ke bawah 1.000.000.000 (dump Cloud ikut membawa `setval` 1 miliar):
   untuk tiap kolom identity di `public`, `setval(seq, max(id where id < 1000000000) + 1, false)`.
5. `echo 0 > ~/.sync/local_seq; echo 0 > ~/.sync/cloud_seq`, lalu `~/sync.sh --dry` (harus lokal→Cloud 0), lalu `~/sync.sh`.
6. Cron: `*/10 * * * * ~/sync.sh >/dev/null 2>>~/sync.log`.

Pindah server (Mini PC): cukup pindahkan seluruh isi lokal (backup/restore volume) + `~/.sync/`, `~/.sync-cloud.env`,
`~/sync.sh`; cursor ikut, tidak perlu mengulang langkah 2–4.
