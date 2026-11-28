#!/bin/bash
# Skrip hari-H: urus sisi SERVER saat semua pengguna dipindah ke server lokal. Lihat README.md di folder ini.
#   ~/cutover.sh --cek   → hanya periksa (tidak mengubah apa pun, tidak menjalankan sinkron)
#   ~/cutover.sh         → periksa → sinkron terakhir → minta kamu mematikan Cloud Cron → pasang cron lokal
# Tidak menyentuh GitHub, APK, atau bot: langkah itu tetap manual (daftar di akhir skrip).
# Tidak memuat kunci rahasia. Aman dijalankan berulang.
set -uo pipefail
CEK=0; [ "${1:-}" = "--cek" ] && CEK=1
PUB_URL=${PUB_URL:-https://panel.ninokuu.site}
# kunci publishable lokal (kunci publik, memang tampil di aplikasi); boleh ditimpa lewat env PUB_KEY
PUB_KEY=${PUB_KEY:-sb_publishable_uXYQxNec4Lp46GcWlm2phf_5vK4c5pC}
CRON_LINE='*/15 * * * * ~/ninokuu-cron.sh >> ~/ninokuu-cron.log 2>&1'
OK=0; BAD=0
ok()  { echo "  ✔ $*"; OK=$((OK+1)); }
bad() { echo "  ✘ $*"; BAD=$((BAD+1)); }
local_sql() { docker exec -i supabase-db psql -X -q -U supabase_admin -d postgres -At "$@" </dev/null; }
code() { curl -s -o /dev/null -m 10 -w '%{http_code}' -H "apikey: $PUB_KEY" "$@" 2>/dev/null || echo 000; }

echo "1) Server lokal"
for c in supabase-db; do
  [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = true ] && ok "kontainer $c berjalan" || bad "kontainer $c tidak berjalan"
done
local_sql -c "select 1" >/dev/null 2>&1 && ok "database menjawab" || bad "database tidak menjawab"
[ "$(code "$PUB_URL/auth/v1/health")" = 200 ] && ok "login (auth) sehat lewat $PUB_URL" || bad "login (auth) tidak sehat lewat $PUB_URL (cek tunnel Cloudflare)"
[ "$(code "$PUB_URL/rest/v1/app_config?select=key&limit=1")" = 200 ] && ok "REST API sehat" || bad "REST API tidak sehat"
F=$(local_sql -c "select count(*) from sync.errors" 2>/dev/null || echo "?")
[ "$F" = 0 ] && ok "tabel sync.errors kosong" || bad "sync.errors berisi $F baris (lihat: select tbl, op, err from sync.errors order by id desc limit 5;)"
S=$(local_sql -c "select coalesce(max(last_value),0) from pg_sequences where schemaname='public'" 2>/dev/null || echo "")
if [ -n "$S" ] && [ "$S" -lt 1000000000 ] 2>/dev/null; then ok "urutan ID lokal di bawah 1 miliar"; else bad "urutan ID lokal ≥ 1 miliar (lihat bagian reset di README.md)"; fi

echo "2) Jadwal (crontab)"
CT=$(crontab -l 2>/dev/null || true)
echo "$CT" | grep -q 'sync.sh' && ok "cron sinkron terpasang" || bad "cron sinkron belum terpasang"
echo "$CT" | grep -q 'backup-supabase.sh' && ok "cron backup terpasang" || bad "cron backup belum terpasang"
if echo "$CT" | grep -q 'ninokuu-cron.sh'; then ok "cron Ninokuu sudah terpasang"; HAVE_CRON=1; else echo "  · cron Ninokuu belum terpasang (akan dipasang di langkah 4)"; HAVE_CRON=0; fi
[ -x ~/ninokuu-cron.sh ] && ok "~/ninokuu-cron.sh ada dan bisa dijalankan" || bad "~/ninokuu-cron.sh tidak ada / tidak executable (chmod +x)"
LAST=$(tail -n 1 ~/sync.log 2>/dev/null || true)
echo "  · sinkron terakhir: ${LAST:-tidak ada log}"

if [ "$CEK" = 1 ] || [ "$BAD" -gt 0 ]; then
  echo; echo "Ringkasan: $OK lolos, $BAD bermasalah."
  [ "$BAD" -gt 0 ] && echo "Perbaiki yang bertanda ✘ lalu jalankan ulang. Tidak ada yang diubah." && exit 1
  echo "Siap. Jalankan tanpa --cek untuk melanjutkan."; exit 0
fi

echo; echo "3) Sinkron terakhir (dua kali; kedua-duanya harus 'error 0')"
for i in 1 2; do
  OUT=$(~/sync.sh 2>&1); echo "$OUT" | sed 's/^/  /'
  echo "$OUT" | grep -q 'PERHATIAN\|GAGAL' && { echo "  ✘ ada masalah sinkron; berhenti. Perbaiki dulu."; exit 1; }
  echo "$OUT" | grep -q '"error": [1-9]' && { echo "  ✘ ada baris gagal; berhenti. Perbaiki dulu."; exit 1; }
done
ok "sinkron terakhir bersih"

echo; echo "4) Cron Ninokuu (notifikasi chapter baru, dll.)"
echo "  Cloud masih punya Cron sendiri. Kalau dua-duanya jalan, notifikasi terkirim dua kali."
echo "  Matikan dulu di dashboard Cloud: Integrations → Cron → matikan/hapus job Ninokuu"
echo "  (kalau tidak ada job di sana, berarti kamu memakai pemicu lain: matikan pemicu itu)."
read -r -p "  Sudah mati di Cloud? Ketik 'sudah' untuk lanjut: " A
if [ "$A" != sudah ]; then echo "  Dibatalkan. Tidak ada yang berubah. Jalankan ulang saat siap."; exit 1; fi
if [ "$HAVE_CRON" = 1 ]; then echo "  cron lokal sudah terpasang, dilewati."
else
  ( echo "$CT"; echo "$CRON_LINE" ) | sed '/^$/d' | crontab - && ok "cron lokal dipasang (tiap 15 menit)"
  ~/ninokuu-cron.sh 2>&1 | tail -n 3 | sed 's/^/  /'
fi

cat <<'EOF'

Server siap. Langkah SISA (manual, urutannya begini):
  1. Gabung dev → main untuk Ninokuu dan NinoNime (bilang "update" ke Claude). Web otomatis ikut server lokal.
  2. Rilis APK baru dari main, lalu kirim kabar ke teman-teman lewat WhatsApp: "update APK, tiba-tiba minta login sekali".
  3. Bot (Termux): ubah NINOKUU_* dan NINONIME_SUPABASE_* di .env ke server lokal, lalu restart bot.
  4. Pantau 1–2 hari: ~/sync.log, WhatsApp dari .pantau, dan halaman Usage di dashboard Cloud.
  5. Rotasi secret yang pernah tampil (password DB Cloud, secret GitHub OAuth, dll.) setelah semuanya stabil.
EOF
