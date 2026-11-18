// Data pengguna: koleksi, riwayat, profil, pengaturan.
// Tamu: tersimpan di HP saja. Setelah masuk: digabung ke server lalu selalu tersinkron.
import * as api from "./api.js";

const keyOf = (src, id) => src + "|" + id;
const subs = new Set();
export const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const emit = () => subs.forEach((f) => { try { f(); } catch {} });

export const state = {
  lib: new Map(Object.entries(api.lsGet("lib", {}))),     // key → {source, comic_id, title, cover, notify, added_at}
  hist: new Map(Object.entries(api.lsGet("hist", {}))),   // key → {source, comic_id, title, cover, chapter, chapter_id, page, read_at}
  profile: api.lsGet("profile"),                          // {name, exp, role, verified}
  // autoHide: menu bacaan hilang saat menggulir · screenMode: "standard" | "fullscreen" (bilah status HP disembunyikan
  // saat layar bacaan diketuk) · nextDelay: jeda lanjut otomatis ke chapter berikutnya "off" | "1" | "2" | "3" | "5" (detik)
  // (menggantikan chapterEnd "menu"/"auto" sejak 1.8.3; bawaan 3 detik)
  settings: { readMode: "scroll", updView: "list", searchView: "grid", autoHide: true, screenMode: "standard", nextDelay: "3", ...api.lsGet("settings", {}) },
};
const saveLocal = () => {
  api.lsSet("lib", Object.fromEntries(state.lib));
  api.lsSet("hist", Object.fromEntries([...state.hist.entries()].sort((a, b) => (b[1].read_at || "").localeCompare(a[1].read_at || "")).slice(0, 300)));
  api.lsSet("profile", state.profile);
  api.lsSet("settings", state.settings);
};
export const setSetting = (k, v) => { state.settings[k] = v; saveLocal(); emit(); };
export const loggedIn = () => !!api.currentUser();

/* ---------- level & rank ---------- */
// 8 rank. tier = bingkai avatar kosmik yang dipakai (bingkai 5 tidak dipakai lagi), ri = urutan rank.
export const RANK_LIST = [
  ["Peasant", 1, 12, "#AEB6C4", 0], ["Apprentice", 13, 24, "#F0BE84", 1], ["Adventurer", 25, 37, "#FFA36B", 2],
  ["Fighter", 38, 50, "#6FC3F2", 3], ["Paladin", 51, 62, "#5DD39E", 4], ["Archmage", 63, 75, "#B48CFF", 6],
  ["Hero of Legend", 76, 87, "#FF9CC0", 7], ["Dragon Emperor", 88, 99, "#F2B33D", 8],
];
export const RANKS = RANK_LIST.map((r) => r[0]);
export const need = (lv) => 100 + lv * 40;
const rankOf = (lv) => { let ri = 0; RANK_LIST.forEach((r, i) => { if (lv >= r[1]) ri = i; }); return ri; };
export function levelOf(p = state.profile) {
  if (!p) return { lv: 1, rank: RANKS[0], tier: 0, ri: 0, cur: 0, need: need(1), max: false };
  if (p.role === "developer") return { lv: 99, rank: RANKS[7], tier: 8, ri: 7, cur: 0, need: 0, max: true };
  let lv = 1, e = Math.max(0, Number(p.exp) || 0);
  while (lv < 99 && e >= need(lv)) { e -= need(lv); lv++; }
  const ri = rankOf(lv);
  return { lv, rank: RANKS[ri], tier: RANK_LIST[ri][4], ri, cur: e, need: need(lv), max: lv >= 99 };
}

/* ---------- koleksi ---------- */
export const inLib = (src, id) => state.lib.has(keyOf(src, id));
export const libItem = (src, id) => state.lib.get(keyOf(src, id));
export async function toggleLib(m) {
  const k = keyOf(m.source, m.comic_id);
  if (state.lib.has(k)) {
    const old = state.lib.get(k);
    state.lib.delete(k); saveLocal(); emit();
    if (loggedIn()) await api.rest(`library?source=eq.${enc(m.source)}&comic_id=eq.${enc(m.comic_id)}`, { method: "DELETE" }).catch((e) => { state.lib.set(k, old); saveLocal(); emit(); throw e; });
    return false;
  }
  const row = { source: m.source, comic_id: m.comic_id, title: m.title.slice(0, 300), cover: (m.cover || "").slice(0, 1000), notify: false, added_at: new Date().toISOString() };
  state.lib.set(k, row); saveLocal(); emit();
  if (loggedIn()) {
    await api.rest("library?on_conflict=user_id,source,comic_id", { method: "POST", body: row, prefer: "resolution=merge-duplicates,return=minimal" })
      .catch((e) => { state.lib.delete(k); saveLocal(); emit(); throw e; });
    refreshExp();
  }
  return true;
}
// lonceng: butuh login karena notifikasi dikirim server ke HP
export async function setNotify(m, on) {
  const k = keyOf(m.source, m.comic_id);
  if (!state.lib.has(k)) await toggleLib(m);
  const row = state.lib.get(k);
  row.notify = on; saveLocal(); emit();
  await api.rest(`library?source=eq.${enc(m.source)}&comic_id=eq.${enc(m.comic_id)}`, { method: "PATCH", body: { notify: on }, prefer: "return=minimal" })
    .catch((e) => { row.notify = !on; saveLocal(); emit(); throw e; });
}

// info tambahan yang hanya disimpan di HP: tipe komik & chapter terbaru (untuk label "New update")
export function updateLibMeta(src, id, meta) {
  const k = keyOf(src, id), row = state.lib.get(k);
  if (!row) return;
  const changed = Object.entries(meta).some(([kk, v]) => v != null && row[kk] !== v);
  if (!changed) return;
  Object.entries(meta).forEach(([kk, v]) => { if (v != null) row[kk] = v; });
  saveLocal(); emit();
}

/* ---------- riwayat & EXP ---------- */
export async function clearHistory() {
  const old = state.hist;
  state.hist = new Map(); saveLocal(); emit();
  if (loggedIn()) await api.rest("history?source=neq.__", { method: "DELETE" }).catch((e) => { state.hist = old; saveLocal(); emit(); throw e; });
}
export const histItem = (src, id) => state.hist.get(keyOf(src, id));
export const history = () => [...state.hist.values()].sort((a, b) => (b.read_at || "").localeCompare(a.read_at || ""));
let histTimer = null;
const histDirty = new Set();
export function saveHistory(h) {
  const k = keyOf(h.source, h.comic_id);
  state.hist.set(k, { ...state.hist.get(k), ...h, read_at: new Date().toISOString() });
  saveLocal(); emit();
  if (!loggedIn()) return;
  histDirty.add(k);
  // posisi halaman berubah terus saat membaca: dikirim paling sering 1× per 20 detik (bukan setiap ganti halaman).
  // Tetap aman: tersimpan di HP seketika, dan dikirim langsung saat keluar dari pembaca / aplikasi ke latar belakang.
  if (!histTimer) histTimer = setTimeout(() => { histTimer = null; flushHistory(); }, 20000);
}
export async function flushHistory() {
  clearTimeout(histTimer); histTimer = null;
  const rows = [...histDirty].map((k) => state.hist.get(k)).filter(Boolean).map(histRow);
  histDirty.clear();
  if (rows.length && loggedIn()) await api.rest("history?on_conflict=user_id,source,comic_id", { method: "POST", body: rows, prefer: "resolution=merge-duplicates,return=minimal" }).catch(() => {});
}
const histRow = (h) => ({ source: h.source, comic_id: h.comic_id, title: (h.title || "").slice(0, 300), cover: (h.cover || "").slice(0, 1000),
  chapter: String(h.chapter ?? "").slice(0, 40) || "?", page: Math.max(1, Math.min(10000, h.page || 1)), read_at: h.read_at });
// chapter dibaca sampai habis = sekali EXP (dicek server). Profil diperbarui setelahnya.
export async function awardRead(src, id, chapter) {
  if (!loggedIn() || chapter == null) return;
  await api.rest("read_log?on_conflict=user_id,source,comic_id,chapter", { method: "POST", body: { source: src, comic_id: id, chapter: String(chapter).slice(0, 40) }, prefer: "resolution=ignore-duplicates,return=minimal" }).catch(() => {});
  refreshExp();
}
// muat ulang profil; bila EXP bertambah, kabari layar (pil "+EXP" & progres level)
export async function refreshExp() {
  const before = Number(state.profile?.exp) || 0;
  const p = await loadProfile().catch(() => null);
  const after = Number(p?.exp) || 0;
  if (p && after > before) window.dispatchEvent(new CustomEvent("nk:exp", { detail: { from: before, to: after } }));
}

/* ---------- like komik & chapter (chapter "" = seri komik) ---------- */
export async function likeInfo(src, id, chapter = "") {
  return api.rpc("like_info", { p_source: src, p_comic: id, p_chapter: String(chapter ?? "") }).catch(() => null);
}
export async function setLike(src, id, chapter, title, on) {
  if (!loggedIn()) throw new Error("Masuk dulu untuk memberi like.");
  const ch = String(chapter ?? "").slice(0, 40);
  if (on) await api.rest("likes?on_conflict=user_id,source,comic_id,chapter", { method: "POST", body: { source: src, comic_id: id, chapter: ch, title: (title || "").slice(0, 300) }, prefer: "resolution=ignore-duplicates,return=minimal" });
  else await api.rest(`likes?source=eq.${enc(src)}&comic_id=eq.${enc(id)}&chapter=eq.${enc(ch)}`, { method: "DELETE" });
  if (on) refreshExp();
}

/* ---------- profil ---------- */
export async function loadProfile() {
  const u = api.currentUser();
  if (!u) return null;
  // avatar_path baru ada setelah skema terbaru dijalankan → coba ulang tanpa kolom itu
  const rows = await api.rest(`profiles?id=eq.${u.id}&select=name,exp,role,verified,avatar_path`)
    .catch(() => api.rest(`profiles?id=eq.${u.id}&select=name,exp,role,verified`));
  state.profile = rows?.[0] || null; saveLocal(); emit();
  return state.profile;
}
export async function setName(name) {
  const u = api.currentUser();
  await api.rest(`profiles?id=eq.${u.id}`, { method: "PATCH", body: { name }, prefer: "return=minimal" });
  state.profile = { ...state.profile, name }; saveLocal(); emit();
}

/* ---------- sinkron saat masuk ---------- */
export async function syncAfterLogin() {
  await loadProfile();
  // kirim data tamu yang belum ada di server, lalu ambil versi server
  const libRows = [...state.lib.values()].map(({ source, comic_id, title, cover, notify, added_at }) => ({ source, comic_id, title, cover, notify: !!notify, added_at }));
  if (libRows.length) await api.rest("library?on_conflict=user_id,source,comic_id", { method: "POST", body: libRows, prefer: "resolution=ignore-duplicates,return=minimal" }).catch(() => {});
  const histRows = [...state.hist.values()].map(histRow);
  if (histRows.length) await api.rest("history?on_conflict=user_id,source,comic_id", { method: "POST", body: histRows, prefer: "resolution=merge-duplicates,return=minimal" }).catch(() => {});
  await pull();
}
export async function pull() {
  if (!loggedIn()) return;
  const [lib, hist] = await Promise.all([
    api.rest("library?select=source,comic_id,title,cover,notify,added_at&order=added_at.desc&limit=2000"),
    api.rest("history?select=source,comic_id,title,cover,chapter,page,read_at&order=read_at.desc&limit=300"),
  ]);
  const oldLib = state.lib;
  state.lib = new Map((lib || []).map((r) => { const k = keyOf(r.source, r.comic_id); return [k, { ...oldLib.get(k), ...r }]; }));
  const local = state.hist;
  state.hist = new Map((hist || []).map((r) => { const k = keyOf(r.source, r.comic_id); return [k, { ...local.get(k), ...r }]; }));
  saveLocal(); emit();
}
export function clearUserData() {
  state.lib = new Map(); state.hist = new Map(); state.profile = null; saveLocal(); emit();
}
const enc = (s) => encodeURIComponent(s);
