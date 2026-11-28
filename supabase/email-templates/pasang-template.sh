#!/bin/bash
# Memasang template email Ninokuu ke Supabase self-hosted (GoTrue). Jalankan di WSL:  bash pasang-template.sh
# Auth tidak membaca template dari berkas: ia mengambilnya lewat URL, jadi dipasang server berkas kecil (Caddy)
# di jaringan Docker yang sama. Perubahan compose ditaruh di docker-compose.override.yml (berkas utama tidak disentuh).
# Aman diulang: template ditimpa, override dibuat sekali (yang lama dicadangkan bila isinya berbeda).
set -euo pipefail
D=${SUPABASE_DOCKER_DIR:-$HOME/supabase/docker}
[ -f "$D/docker-compose.yml" ] || { echo "Tidak menemukan $D/docker-compose.yml (set SUPABASE_DOCKER_DIR=...)"; exit 1; }
T="$D/volumes/templates"; mkdir -p "$T"

cat > "$T/confirmation.html" <<'HTML_EOF'
<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>Konfirmasi akun Ninokuu</title></head>
<body style="margin:0;padding:0;background:#0B0F17;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Satu langkah lagi untuk mengaktifkan akun Ninokuu-mu.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B0F17;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#141B27;border-radius:18px;border:1px solid #232C3B;">
<tr><td style="padding:28px 28px 8px;font-family:Arial,Helvetica,sans-serif;">
<span style="display:inline-block;width:34px;height:34px;line-height:34px;text-align:center;border-radius:10px;background:#E0242B;color:#fff;font-weight:bold;font-size:18px;vertical-align:middle;">N</span>
<span style="font-size:20px;font-weight:bold;color:#FFFFFF;vertical-align:middle;margin-left:8px;">Ninokuu</span>
</td></tr>
<tr><td style="padding:16px 28px 0;font-family:Arial,Helvetica,sans-serif;">
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#FFFFFF;">Selamat datang di Ninokuu!</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#B8C0CE;">Tekan tombol di bawah untuk mengonfirmasi email ini dan mengaktifkan akunmu. Setelah itu koleksi, riwayat baca, dan raknya tersinkron di semua perangkat.</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:999px;background:#E0242B;">
<a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#FFFFFF;text-decoration:none;border-radius:999px;">Konfirmasi email</a>
</td></tr></table>
<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#7D8798;">Kalau kamu tidak mendaftar di Ninokuu, abaikan saja email ini.</p>
</td></tr>
<tr><td style="padding:24px 28px 28px;font-family:Arial,Helvetica,sans-serif;">
<div style="border-top:1px solid #232C3B;padding-top:16px;font-size:12px;line-height:1.6;color:#5F6878;">
Email ini dikirim otomatis oleh Ninokuu ke {{ .Email }}. Jangan dibalas.<br>Ninokuu · ninokuu.site
</div></td></tr>
</table></td></tr></table></body></html>
HTML_EOF

cat > "$T/recovery.html" <<'HTML_EOF'
<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>Atur ulang kata sandi Ninokuu</title></head>
<body style="margin:0;padding:0;background:#0B0F17;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Permintaan atur ulang kata sandi akun Ninokuu-mu.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B0F17;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#141B27;border-radius:18px;border:1px solid #232C3B;">
<tr><td style="padding:28px 28px 8px;font-family:Arial,Helvetica,sans-serif;">
<span style="display:inline-block;width:34px;height:34px;line-height:34px;text-align:center;border-radius:10px;background:#E0242B;color:#fff;font-weight:bold;font-size:18px;vertical-align:middle;">N</span>
<span style="font-size:20px;font-weight:bold;color:#FFFFFF;vertical-align:middle;margin-left:8px;">Ninokuu</span>
</td></tr>
<tr><td style="padding:16px 28px 0;font-family:Arial,Helvetica,sans-serif;">
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#FFFFFF;">Atur ulang kata sandi</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#B8C0CE;">Kami menerima permintaan untuk mengatur ulang kata sandi akun Ninokuu-mu. Tekan tombol di bawah untuk membuat kata sandi baru.</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:999px;background:#E0242B;">
<a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#FFFFFF;text-decoration:none;border-radius:999px;">Buat kata sandi baru</a>
</td></tr></table>
<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#7D8798;">Kalau kamu tidak memintanya, abaikan email ini. Kata sandimu tidak berubah.</p>
</td></tr>
<tr><td style="padding:24px 28px 28px;font-family:Arial,Helvetica,sans-serif;">
<div style="border-top:1px solid #232C3B;padding-top:16px;font-size:12px;line-height:1.6;color:#5F6878;">
Email ini dikirim otomatis oleh Ninokuu ke {{ .Email }}. Jangan dibalas.<br>Ninokuu · ninokuu.site
</div></td></tr>
</table></td></tr></table></body></html>
HTML_EOF

cat > "$T/email_change.html" <<'HTML_EOF'
<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>Konfirmasi email baru Ninokuu</title></head>
<body style="margin:0;padding:0;background:#0B0F17;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Konfirmasi perubahan email akun Ninokuu-mu.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B0F17;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#141B27;border-radius:18px;border:1px solid #232C3B;">
<tr><td style="padding:28px 28px 8px;font-family:Arial,Helvetica,sans-serif;">
<span style="display:inline-block;width:34px;height:34px;line-height:34px;text-align:center;border-radius:10px;background:#E0242B;color:#fff;font-weight:bold;font-size:18px;vertical-align:middle;">N</span>
<span style="font-size:20px;font-weight:bold;color:#FFFFFF;vertical-align:middle;margin-left:8px;">Ninokuu</span>
</td></tr>
<tr><td style="padding:16px 28px 0;font-family:Arial,Helvetica,sans-serif;">
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#FFFFFF;">Konfirmasi email baru</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#B8C0CE;">Ada permintaan untuk mengganti email akun Ninokuu dari {{ .Email }} ke {{ .NewEmail }}. Tekan tombol di bawah untuk menyetujuinya.</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:999px;background:#E0242B;">
<a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#FFFFFF;text-decoration:none;border-radius:999px;">Setujui perubahan</a>
</td></tr></table>
<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#7D8798;">Kalau kamu tidak memintanya, abaikan email ini dan segera ganti kata sandimu.</p>
</td></tr>
<tr><td style="padding:24px 28px 28px;font-family:Arial,Helvetica,sans-serif;">
<div style="border-top:1px solid #232C3B;padding-top:16px;font-size:12px;line-height:1.6;color:#5F6878;">
Email ini dikirim otomatis oleh Ninokuu ke {{ .Email }}. Jangan dibalas.<br>Ninokuu · ninokuu.site
</div></td></tr>
</table></td></tr></table></body></html>
HTML_EOF

cat > "$T/magic_link.html" <<'HTML_EOF'
<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>Masuk ke Ninokuu</title></head>
<body style="margin:0;padding:0;background:#0B0F17;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Link masuk ke akun Ninokuu-mu.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B0F17;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#141B27;border-radius:18px;border:1px solid #232C3B;">
<tr><td style="padding:28px 28px 8px;font-family:Arial,Helvetica,sans-serif;">
<span style="display:inline-block;width:34px;height:34px;line-height:34px;text-align:center;border-radius:10px;background:#E0242B;color:#fff;font-weight:bold;font-size:18px;vertical-align:middle;">N</span>
<span style="font-size:20px;font-weight:bold;color:#FFFFFF;vertical-align:middle;margin-left:8px;">Ninokuu</span>
</td></tr>
<tr><td style="padding:16px 28px 0;font-family:Arial,Helvetica,sans-serif;">
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#FFFFFF;">Masuk ke Ninokuu</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#B8C0CE;">Tekan tombol di bawah untuk masuk ke akunmu. Link ini hanya bisa dipakai sekali.</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:999px;background:#E0242B;">
<a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#FFFFFF;text-decoration:none;border-radius:999px;">Masuk sekarang</a>
</td></tr></table>
<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#7D8798;">Kalau kamu tidak mencoba masuk, abaikan saja email ini.</p>
</td></tr>
<tr><td style="padding:24px 28px 28px;font-family:Arial,Helvetica,sans-serif;">
<div style="border-top:1px solid #232C3B;padding-top:16px;font-size:12px;line-height:1.6;color:#5F6878;">
Email ini dikirim otomatis oleh Ninokuu ke {{ .Email }}. Jangan dibalas.<br>Ninokuu · ninokuu.site
</div></td></tr>
</table></td></tr></table></body></html>
HTML_EOF

cat > "$T/invite.html" <<'HTML_EOF'
<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>Undangan Ninokuu</title></head>
<body style="margin:0;padding:0;background:#0B0F17;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Kamu diundang bergabung di Ninokuu.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B0F17;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#141B27;border-radius:18px;border:1px solid #232C3B;">
<tr><td style="padding:28px 28px 8px;font-family:Arial,Helvetica,sans-serif;">
<span style="display:inline-block;width:34px;height:34px;line-height:34px;text-align:center;border-radius:10px;background:#E0242B;color:#fff;font-weight:bold;font-size:18px;vertical-align:middle;">N</span>
<span style="font-size:20px;font-weight:bold;color:#FFFFFF;vertical-align:middle;margin-left:8px;">Ninokuu</span>
</td></tr>
<tr><td style="padding:16px 28px 0;font-family:Arial,Helvetica,sans-serif;">
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#FFFFFF;">Kamu diundang ke Ninokuu</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#B8C0CE;">Kamu diundang untuk membuat akun Ninokuu. Tekan tombol di bawah untuk menerima undangan dan mengatur akunmu.</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:999px;background:#E0242B;">
<a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#FFFFFF;text-decoration:none;border-radius:999px;">Terima undangan</a>
</td></tr></table>
<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#7D8798;">Kalau kamu tidak mengenal undangan ini, abaikan saja email ini.</p>
</td></tr>
<tr><td style="padding:24px 28px 28px;font-family:Arial,Helvetica,sans-serif;">
<div style="border-top:1px solid #232C3B;padding-top:16px;font-size:12px;line-height:1.6;color:#5F6878;">
Email ini dikirim otomatis oleh Ninokuu ke {{ .Email }}. Jangan dibalas.<br>Ninokuu · ninokuu.site
</div></td></tr>
</table></td></tr></table></body></html>
HTML_EOF

cat > "$T/reauthentication.html" <<'HTML_EOF'
<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>Kode verifikasi Ninokuu</title></head>
<body style="margin:0;padding:0;background:#0B0F17;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Kode verifikasi akun Ninokuu-mu.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B0F17;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#141B27;border-radius:18px;border:1px solid #232C3B;">
<tr><td style="padding:28px 28px 8px;font-family:Arial,Helvetica,sans-serif;">
<span style="display:inline-block;width:34px;height:34px;line-height:34px;text-align:center;border-radius:10px;background:#E0242B;color:#fff;font-weight:bold;font-size:18px;vertical-align:middle;">N</span>
<span style="font-size:20px;font-weight:bold;color:#FFFFFF;vertical-align:middle;margin-left:8px;">Ninokuu</span>
</td></tr>
<tr><td style="padding:16px 28px 0;font-family:Arial,Helvetica,sans-serif;">
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#FFFFFF;">Kode verifikasi</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#B8C0CE;">Masukkan kode ini di Ninokuu untuk melanjutkan. Jangan berikan kode ini kepada siapa pun.</p>
<div style="display:inline-block;padding:14px 24px;border-radius:12px;background:#0B0F17;border:1px solid #232C3B;font-family:'Courier New',monospace;font-size:30px;font-weight:bold;letter-spacing:8px;color:#FFFFFF;">{{ .Token }}</div>
<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#7D8798;">Kalau kamu tidak memintanya, abaikan email ini dan segera ganti kata sandimu.</p>
</td></tr>
<tr><td style="padding:24px 28px 28px;font-family:Arial,Helvetica,sans-serif;">
<div style="border-top:1px solid #232C3B;padding-top:16px;font-size:12px;line-height:1.6;color:#5F6878;">
Email ini dikirim otomatis oleh Ninokuu ke {{ .Email }}. Jangan dibalas.<br>Ninokuu · ninokuu.site
</div></td></tr>
</table></td></tr></table></body></html>
HTML_EOF

chmod 644 "$T"/*.html

NEW=$(mktemp)
cat > "$NEW" <<'YML_EOF'
# Template email Ninokuu untuk GoTrue (dibuat oleh pasang-template.sh)
services:
  templates-server:
    image: caddy:2-alpine
    restart: unless-stopped
    command: ["caddy", "file-server", "--root", "/templates", "--listen", ":80"]
    volumes:
      - ./volumes/templates:/templates:ro
  auth:
    depends_on:
      templates-server:
        condition: service_started
    environment:
      GOTRUE_MAILER_TEMPLATES_CONFIRMATION: "http://templates-server/confirmation.html"
      GOTRUE_MAILER_TEMPLATES_RECOVERY: "http://templates-server/recovery.html"
      GOTRUE_MAILER_TEMPLATES_EMAIL_CHANGE: "http://templates-server/email_change.html"
      GOTRUE_MAILER_TEMPLATES_MAGIC_LINK: "http://templates-server/magic_link.html"
      GOTRUE_MAILER_TEMPLATES_INVITE: "http://templates-server/invite.html"
      GOTRUE_MAILER_TEMPLATES_REAUTHENTICATION: "http://templates-server/reauthentication.html"
      GOTRUE_MAILER_SUBJECTS_CONFIRMATION: "Konfirmasi akun Ninokuu-mu"
      GOTRUE_MAILER_SUBJECTS_RECOVERY: "Atur ulang kata sandi Ninokuu"
      GOTRUE_MAILER_SUBJECTS_EMAIL_CHANGE: "Konfirmasi email baru akun Ninokuu"
      GOTRUE_MAILER_SUBJECTS_MAGIC_LINK: "Link masuk ke Ninokuu"
      GOTRUE_MAILER_SUBJECTS_INVITE: "Kamu diundang ke Ninokuu"
      GOTRUE_MAILER_SUBJECTS_REAUTHENTICATION: "Kode verifikasi Ninokuu: {{ .Token }}"
YML_EOF
O="$D/docker-compose.override.yml"
if [ -f "$O" ] && ! cmp -s "$O" "$NEW"; then cp "$O" "$O.bak.$(date +%Y%m%d%H%M%S)"; echo "override lama dicadangkan"; fi
cp "$NEW" "$O"; rm -f "$NEW"

cd "$D"
# .env dengan COMPOSE_FILE=... membuat Compose mengabaikan override: tambahkan bila perlu
if grep -q '^COMPOSE_FILE=' .env 2>/dev/null && ! grep '^COMPOSE_FILE=' .env | grep -q 'docker-compose.override.yml'; then
  sed -i 's#^COMPOSE_FILE=\(.*\)$#COMPOSE_FILE=\1:docker-compose.override.yml#' .env && echo ".env: override ditambahkan ke COMPOSE_FILE"
fi
docker compose config -q && echo "compose valid"
docker compose up -d templates-server auth
sleep 5
echo "--- uji: auth mengambil template dari server berkas"
docker compose exec -T auth wget -qO- http://templates-server/recovery.html 2>/dev/null | head -c 120 && echo || echo "(wget tidak ada di kontainer auth; lewati: uji lewat 'Lupa password' saja)"
echo "--- selesai. Uji: aplikasi → Lupa password → cek email (judul 'Atur ulang kata sandi Ninokuu')."
