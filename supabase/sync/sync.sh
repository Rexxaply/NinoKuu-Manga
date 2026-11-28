#!/bin/bash
# Sinkron dua arah: server lokal ⇄ Supabase Cloud (cadangan). Lihat README.md di folder ini.
#   ~/sync.sh --dry   → hanya tampilkan apa yang akan berubah (tidak menulis apa pun)
#   ~/sync.sh         → jalankan
# Butuh ~/.sync-cloud.env (chmod 600). Aman dijalankan berulang; satu proses pada satu waktu.
set -euo pipefail
DRY=0; [ "${1:-}" = "--dry" ] && DRY=1
DIR=~/.sync; mkdir -p "$DIR"; chmod 700 "$DIR"
LOG=~/sync.log
exec 9>"$DIR/lock"; flock -n 9 || { echo "sinkron lain masih berjalan"; exit 0; }
[ -f ~/.sync-cloud.env ] || { echo "~/.sync-cloud.env belum ada"; exit 1; }
set -a; . ~/.sync-cloud.env; set +a
: "${CLOUD_PGHOST:?}" "${CLOUD_PGUSER:?}" "${CLOUD_PGPASSWORD:?}"
CLOUD_PGPORT=${CLOUD_PGPORT:-5432}; CLOUD_PGDATABASE=${CLOUD_PGDATABASE:-postgres}

local_sql() { docker exec -i supabase-db psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -At "$@"; }
cloud_sql() { docker exec -i -e PGPASSWORD="$CLOUD_PGPASSWORD" -e PGSSLMODE=require supabase-db \
  psql -X -q -v ON_ERROR_STOP=1 -h "$CLOUD_PGHOST" -p "$CLOUD_PGPORT" -U "$CLOUD_PGUSER" -d "$CLOUD_PGDATABASE" -At "$@"; }
say() { echo "$(date '+%F %T') $*" | tee -a "$LOG"; }

L0=$(cat "$DIR/local_seq" 2>/dev/null || echo 0); C0=$(cat "$DIR/cloud_seq" 2>/dev/null || echo 0)
Q="select pg_catalog.jsonb_build_object('max', coalesce(max(seq), %s), 'rows', coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('tbl', tbl, 'pk', pk, 'op', op, 'row', row) order by seq), '[]'::jsonb)) from sync.changes where seq > %s"
local_sql -c "$(printf "$Q" "$L0" "$L0")" > "$DIR/L.json" || { say "GAGAL: server lokal tidak bisa dibaca"; exit 1; }
cloud_sql -c "$(printf "$Q" "$C0" "$C0")" > "$DIR/C.json" || { say "GAGAL: Cloud tidak bisa dibaca"; exit 1; }

# satukan: per kunci hanya keadaan terakhir; kunci yang berubah di kedua sisi → lokal menang
python3 - "$DIR" <<'PY'
import json, sys, os, collections
d = sys.argv[1]
L = json.load(open(f"{d}/L.json")); C = json.load(open(f"{d}/C.json"))
def last(rows):
    m = collections.OrderedDict()
    for r in rows:
        k = (r["tbl"], json.dumps(r["pk"], sort_keys=True)); m.pop(k, None); m[k] = r
    return m
l, c = last(L["rows"]), last(C["rows"])
both = [k for k in c if k in l]
to_cloud = list(l.values()); to_local = [v for k, v in c.items() if k not in l]
json.dump(to_cloud, open(f"{d}/to_cloud.json", "w")); json.dump(to_local, open(f"{d}/to_local.json", "w"))
open(f"{d}/max", "w").write(f'{L["max"]} {C["max"]}\n')
cnt = lambda rows: ", ".join(f"{t} {n}" for t, n in collections.Counter(r["tbl"].split(".")[-1] + ("(hapus)" if r["op"] == "D" else "") for r in rows).most_common()) or "-"
print(f"lokal→Cloud {len(to_cloud)}: {cnt(to_cloud)}")
print(f"Cloud→lokal {len(to_local)}: {cnt(to_local)}")
if both: print(f"bentrok {len(both)} (lokal menang): " + "; ".join(f"{k[0]} {k[1]}" for k in both[:10]))
PY

if [ "$DRY" = 1 ]; then echo "(simulasi: tidak ada yang ditulis)"; exit 0; fi

apply_to() {  # $1 = local|cloud, $2 = berkas json
  [ "$(cat "$2")" = "[]" ] && { echo '{"ok": 0, "error": 0}'; return; }
  { echo 'begin; set local session_replication_role = replica; select sync.apply($sync_9f3a$'; cat "$2"; echo '$sync_9f3a$::jsonb); commit;'; } \
    | if [ "$1" = local ]; then local_sql; else cloud_sql; fi
}
RC=$(apply_to cloud "$DIR/to_cloud.json") || { say "GAGAL menerapkan ke Cloud (tidak ada yang berubah di Cloud)"; exit 1; }
RL=$(apply_to local "$DIR/to_local.json") || { say "GAGAL menerapkan ke lokal (Cloud sudah diperbarui; ulangi nanti)"; exit 1; }
read LM CM < "$DIR/max"; echo "$LM" > "$DIR/local_seq"; echo "$CM" > "$DIR/cloud_seq"
say "sinkron OK · ke Cloud $RC · ke lokal $RL"

# bersihkan catatan lama yang sudah terkirim (simpan 3 hari)
local_sql -c "delete from sync.changes where seq <= $LM and at < now() - interval '3 days'" >/dev/null || true
cloud_sql -c "delete from sync.changes where seq <= $CM and at < now() - interval '3 days'" >/dev/null || true

# berkas gambar (foto profil & gambar chat) yang dirujuk tapi belum ada di salah satu sisi
if [ -n "${CLOUD_URL:-}" ] && [ -n "${CLOUD_SECRET_KEY:-}" ]; then
  LK=$(grep '^SUPABASE_SECRET_KEY=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"')
  REF="select 'avatars/' || avatar_path from public.profiles where avatar_path is not null union select 'chat-images/' || image_path from public.chat_messages where image_path is not null"
  HAS="select bucket_id || '/' || name from storage.objects where bucket_id in ('avatars', 'chat-images')"
  local_sql -c "$REF" | sort -u > "$DIR/ref"; local_sql -c "$HAS" | sort -u > "$DIR/has_l"; cloud_sql -c "$HAS" | sort -u > "$DIR/has_c"
  ct() { case "${1##*.}" in jpg|jpeg) echo image/jpeg;; png) echo image/png;; webp) echo image/webp;; gif) echo image/gif;; *) echo application/octet-stream;; esac; }
  n=0
  for f in $(comm -23 "$DIR/ref" "$DIR/has_l"); do  # ada di Cloud, belum di lokal
    curl -sf "$CLOUD_URL/storage/v1/object/public/$f" -o "$DIR/f.bin" && curl -sf -X POST "http://localhost:8000/storage/v1/object/$f" \
      -H "apikey: $LK" -H "Content-Type: $(ct "$f")" -H "x-upsert: true" --data-binary @"$DIR/f.bin" -o /dev/null && n=$((n+1)) || say "berkas gagal ke lokal: $f"
  done
  for f in $(comm -23 "$DIR/ref" "$DIR/has_c"); do  # ada di lokal, belum di Cloud
    curl -sf "http://localhost:8000/storage/v1/object/public/$f" -o "$DIR/f.bin" && curl -sf -X POST "$CLOUD_URL/storage/v1/object/$f" \
      -H "apikey: $CLOUD_SECRET_KEY" -H "Content-Type: $(ct "$f")" -H "x-upsert: true" --data-binary @"$DIR/f.bin" -o /dev/null && n=$((n+1)) || say "berkas gagal ke Cloud: $f"
  done
  rm -f "$DIR/f.bin"; [ "$n" -gt 0 ] && say "berkas gambar disalin: $n"
fi
ERR=$(local_sql -c "select count(*) from sync.errors where at > now() - interval '1 hour'")
ERRC=$(cloud_sql -c "select count(*) from sync.errors where at > now() - interval '1 hour'")
[ "$ERR$ERRC" != "00" ] && say "PERHATIAN: ada baris gagal diterapkan (lokal $ERR, Cloud $ERRC) → lihat tabel sync.errors"
exit 0
