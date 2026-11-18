// Pembaca aktif secara realtime: Supabase Realtime Presence lewat satu WebSocket (tanpa library).
// Tiap aplikasi yang sedang terbuka di layar "hadir" di kanal ninokuu-online dengan kunci akun (atau
// kunci tamu acak per HP), jadi satu orang di beberapa tab/HP dengan akun sama dihitung satu.
// Hemat server: tidak ada query database; koneksi hanya hidup selama aplikasi tampil di layar, ditutup
// 30 detik setelah aplikasi disembunyikan, dan detak (heartbeat) hanya tiap 25 detik.
const TOPIC = "realtime:ninokuu-online";
let cfg = null, ws = null, hb = null, closeT = null, retryT = null, retry = 0, ref = 0, joinRef = "";
// state: kunci → jumlah koneksi (metas). Diff yang datang sebelum snapshot pertama ditahan lalu diterapkan
// setelahnya (urutan pesan Presence bisa diff dulu baru state).
let state = {}, live = false, synced = false, pending = [];
const subs = new Set();
const emit = () => subs.forEach((f) => { try { f(count()); } catch {} });
export const count = () => (live ? Object.keys(state).length : 0);   // 0 = belum tersambung
export const onCount = (fn) => { subs.add(fn); return () => subs.delete(fn); };

const anonKey = () => {
  try { let k = localStorage.getItem("ninokuu:anon"); if (!k) { k = "tamu-" + Math.random().toString(36).slice(2, 10); localStorage.setItem("ninokuu:anon", k); } return k; }
  catch { return "tamu-" + Math.random().toString(36).slice(2, 10); }
};
const applyDiff = (d) => {
  for (const k in d?.joins || {}) state[k] = (state[k] || 0) + (d.joins[k]?.metas?.length || 1);
  for (const k in d?.leaves || {}) { state[k] = (state[k] || 0) - (d.leaves[k]?.metas?.length || 1); if (state[k] <= 0) delete state[k]; }
};
const send = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };

function connect() {
  if (!cfg || ws || document.visibilityState !== "visible") return;
  clearTimeout(retryT);
  const key = cfg.userKey() || anonKey();
  let sock;
  try { sock = new WebSocket(`${cfg.url.replace(/^http/, "ws")}/realtime/v1/websocket?apikey=${encodeURIComponent(cfg.apikey)}&vsn=1.0.0`); }
  catch { return; }
  ws = sock; state = {}; live = false; synced = false; pending = []; joinRef = String(++ref);
  sock.onopen = () => {
    send({ topic: TOPIC, event: "phx_join", payload: { config: { presence: { key }, broadcast: { self: false }, private: false } }, ref: joinRef, join_ref: joinRef });
    hb = setInterval(() => send({ topic: "phoenix", event: "heartbeat", payload: {}, ref: String(++ref) }), 25000);
  };
  sock.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.topic !== TOPIC) return;
    if (m.event === "phx_reply" && m.ref === joinRef && m.payload?.status === "ok") {
      retry = 0;
      send({ topic: TOPIC, event: "presence", payload: { type: "presence", event: "track", payload: {} }, ref: String(++ref), join_ref: joinRef });
    } else if (m.event === "presence_state") {
      state = {};
      for (const k in m.payload || {}) state[k] = m.payload[k]?.metas?.length || 1;
      synced = true; pending.splice(0).forEach(applyDiff); live = true; emit();
    } else if (m.event === "presence_diff") {
      if (!synced) { pending.push(m.payload); return; }
      applyDiff(m.payload); live = true; emit();
    }
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    clearInterval(hb); ws = null; live = false; emit();
    // tersambung lagi dengan jeda makin lama (maks. 1 menit) selama aplikasi masih tampil
    if (document.visibilityState === "visible") retryT = setTimeout(connect, Math.min(60e3, 2000 * 2 ** retry++));
  };
}
function disconnect() {
  clearTimeout(retryT); clearInterval(hb);
  const s = ws; ws = null; live = false; state = {};
  if (s) try { s.close(); } catch {}
  emit();
}
export function restart() { disconnect(); connect(); }
export function start(c) {
  if (cfg || !c.url || !c.apikey || !("WebSocket" in window)) return;
  cfg = c;
  document.addEventListener("visibilitychange", () => {
    clearTimeout(closeT);
    if (document.visibilityState === "visible") connect();
    else closeT = setTimeout(disconnect, 30000);
  });
  connect();
}
