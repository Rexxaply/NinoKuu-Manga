// Koneksi ke Supabase (Auth, database REST, Storage) dan Edge Function ninokuu-api.
// Tanpa library: semua lewat fetch, supaya ringan dan sama di PWA maupun APK.
import { direct, logDev, canDirectFallback, serverBlocked } from "./native.js";
const C = window.NINOKUU_CONFIG || {};
// Server utama (self-hosted) dan server cadangan (Supabase Cloud). Bila server utama mati, aplikasi pindah otomatis ke cadangan.
const clean = (u) => String(u || "").replace(/\/+$/, "");
const MAIN = { url: clean(C.SUPABASE_URL), key: String(C.SUPABASE_ANON_KEY || "") };
const BACKUP = { url: clean(C.FALLBACK_URL), key: String(C.FALLBACK_KEY || "") };
const hasBackup = !!(BACKUP.url && BACKUP.key && BACKUP.url !== MAIN.url);
let useBackup = false;
let BASE = MAIN.url, KEY = MAIN.key;
export const configured = !!(BASE && KEY);
export let SB_URL = BASE, SB_KEY = KEY;
// Ninokuu Dev memakai function terpisah (ninokuu-api-dev) supaya perubahan server bisa diuji tanpa mengganggu versi global
const FN_NAME = /^ninokuu-api(-dev)?$/.test(C.FN || "") ? C.FN : "ninokuu-api";
export let FN = BASE + "/functions/v1/" + FN_NAME;
export const onBackup = () => useBackup;
function applyBackend() {
  const b = useBackup ? BACKUP : MAIN;
  BASE = b.url; KEY = b.key; SB_URL = BASE; SB_KEY = KEY; FN = BASE + "/functions/v1/" + FN_NAME;
}

const LS = "ninokuu:";
const lsGet = (k, d = null) => { try { const v = localStorage.getItem(LS + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(LS + k) : localStorage.setItem(LS + k, JSON.stringify(v)); } catch {} };
export { lsGet, lsSet };

export class ApiError extends Error {
  constructor(msg, status = 0, extra = {}) { super(msg); this.status = status; Object.assign(this, extra); }
}
const NET_MSG = "Tidak ada koneksi internet. Periksa jaringanmu lalu coba lagi.";
async function readErr(r) {
  let j = null; try { j = await r.json(); } catch {}
  const m = j?.error_description || j?.msg || j?.message || j?.error || `HTTP ${r.status}`;
  return new ApiError(translate(String(m)), r.status, { code: j?.code || j?.error_code, hint: j?.hint, blocked: !!j?.blocked });
}
// pesan Supabase yang umum diterjemahkan agar mudah dipahami
function translate(m) {
  const T = [
    [/Invalid login credentials/i, "Email atau password salah."],
    [/Email not confirmed/i, "Email belum dikonfirmasi. Cek kotak masuk (dan folder spam)."],
    [/User already registered/i, "Email ini sudah terdaftar. Silakan masuk."],
    [/Password should be at least/i, "Password minimal 8 karakter."],
    [/email rate limit exceeded|over_email_send_rate_limit/i, "Terlalu banyak email dikirim. Coba lagi beberapa saat lagi."],
    [/Unable to validate email address|invalid format/i, "Format email tidak valid."],
    [/JWT expired/i, "Sesi berakhir, silakan masuk lagi."],
  ];
  for (const [re, t] of T) if (re.test(m)) return t;
  return m;
}

/* ---------- sesi login ---------- */
// token login hanya berlaku di server yang menerbitkannya, jadi sesi disimpan terpisah per server
const sKey = () => (useBackup ? "session:cadangan" : "session");
let session = lsGet(sKey());
const listeners = new Set();
export const onAuth = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
function setSession(s) {
  session = s && s.access_token ? { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600), user: s.user } : null;
  lsSet(sKey(), session);
  listeners.forEach((f) => { try { f(session); } catch {} });
}
export const currentUser = () => session?.user || null;

/* ---------- server utama ⇄ cadangan ---------- */
// Cloudflare Tunnel mati / server di rumah padam → 502, 503, 504 atau 52x. Sebelum pindah, server utama dites langsung
// (supaya satu galat biasa tidak memindahkan semua orang). Server utama dites lagi tiap 90 detik; pulih → kembali.
const DOWN = (st) => st === 502 || st === 503 || st === 504 || (st >= 520 && st <= 530);
const probeMain = async () => {
  try {
    const c = new AbortController(), t = setTimeout(() => c.abort(), 6000);
    const r = await fetch(MAIN.url + "/rest/v1/app_config?select=key&limit=1", { headers: { apikey: MAIN.key }, signal: c.signal, cache: "no-store" });
    clearTimeout(t); return r.ok;
  } catch { return false; }
};
let probeT = null, lastOn = 0;
function logBackup(event, detail) {
  // dicatat di Cloud (tabel fallback_log) supaya kelihatan kapan & berapa kali server cadangan dipakai
  if (!hasBackup) return;
  if (event === "on") { if (Date.now() - lastOn < 10 * 60e3) return; lastOn = Date.now(); }
  fetch(BACKUP.url + "/rest/v1/fallback_log", { method: "POST", keepalive: true,
    headers: { apikey: BACKUP.key, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ event, app: C.DEV ? "ninokuu-dev" : "ninokuu", version: String(C.VERSION || ""), detail: String(detail || "").slice(0, 150) }) }).catch(() => {});
}
function switchTo(backup, detail) {
  if (useBackup === backup) return;
  useBackup = backup; applyBackend();
  session = lsGet(sKey()); listeners.forEach((f) => { try { f(session); } catch {} });
  logBackup(backup ? "on" : "off", detail);
  try { window.dispatchEvent(new CustomEvent("ninokuu:backend", { detail: { backup } })); } catch {}
  clearInterval(probeT); probeT = null;
  if (backup) probeT = setInterval(async () => { if (await probeMain()) switchTo(false, "pulih"); }, 90e3);
}
async function failover(status) {
  if (!hasBackup || useBackup) return false;
  if (await probeMain()) return false;           // server utama sehat: galatnya hanya milik permintaan ini
  switchTo(true, status ? "HTTP " + status : "tidak terjangkau");
  return true;
}
// satu pintu untuk semua permintaan ke Supabase: path diawali "/", build(token) membuat init fetch (dipanggil ulang setelah pindah server)
// token login milik server lain / rusak → server menjawab 401 (PostgREST: PGRST301 "No suitable key or wrong key type")
const badToken = async (r) => { try { return /PGRST30[123]|JWT|key type|invalid_token|bad_jwt/i.test(JSON.stringify(await r.clone().json())); } catch { return false; } };
async function net(path, build, { auth = true, failover: fo = true } = {}) {
  let reauth = false, moved = false;
  for (let i = 0; i < 3; i++) {
    const t = auth ? await accessToken() : null;
    const init = build(t);
    // kunci baru (sb_publishable_) bukan JWT: cukup di header apikey, jangan dikirim sebagai Bearer
    const bearer = auth ? (t ? { Authorization: "Bearer " + t } : KEY.startsWith("sb_") ? {} : { Authorization: "Bearer " + KEY }) : {};
    init.headers = { apikey: KEY, ...bearer, ...(init.headers || {}) };
    let r = null;
    try { r = await fetch(BASE + path, init); } catch {}
    // token ditolak: coba perbarui; refresh token juga ditolak → sesi dihapus (masuk lagi), permintaan diulang tanpa login
    if (r && r.status === 401 && auth && t && !reauth && await badToken(r)) { reauth = true; forceRefresh = true; await accessToken(); continue; }
    if (r && !DOWN(r.status)) return r;
    if (!moved && fo) { moved = true; if (await failover(r ? r.status : 0)) continue; }
    if (r) return r;
    throw new ApiError(NET_MSG);
  }
}

async function authCall(path, body, { method = "POST", token } = {}) {
  // token eksplisit / refresh token milik satu server: jangan dialihkan ke server lain
  const r = await net("/auth/v1" + path, () => ({
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }), { auth: false, failover: !token && !/grant_type=refresh_token/.test(path) });
  if (!r.ok) throw await readErr(r);
  return r.status === 204 ? null : r.json().catch(() => null);
}
let refreshing = null, forceRefresh = false;   // forceRefresh: token ditolak server → perbarui walau belum kedaluwarsa
async function accessToken() {
  if (!session) return null;
  if (!forceRefresh && session.expires_at * 1000 - Date.now() > 60e3) return session.access_token;
  forceRefresh = false;
  if (!refreshing) {
    refreshing = authCall("/token?grant_type=refresh_token", { refresh_token: session.refresh_token })
      .then((s) => { setSession(s); return s.access_token; })
      .catch((e) => { if (e.status === 400 || e.status === 401) setSession(null); return null; })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}
export async function signIn(email, password) {
  setSession(await authCall("/token?grant_type=password", { email: email.trim(), password }));
  return session;
}
export async function signUp(email, password, name) {
  // tautan verifikasi email membuka halaman "Email berhasil diverifikasi" di ninokuu.site (tombol kembali ke aplikasi)
  const r = await authCall("/signup?redirect_to=" + encodeURIComponent(VERIFY_URL), { email: email.trim(), password, data: { name: name.trim() } });
  if (r?.access_token) { setSession(r); return { session }; }
  return { confirm: true }; // Confirm email aktif: tunggu konfirmasi
}
// link "lupa password" membuka halaman ninokuu.site/resetpassword (form password baru + tombol kembali ke aplikasi)
const RESET_URL = "https://ninokuu.site/resetpassword/";
export async function recover(email) { await authCall("/recover?redirect_to=" + encodeURIComponent(RESET_URL), { email: email.trim() }); }
// link di email (konfirmasi akun, reset password) selalu ke versi web; di APK alamatnya https://localhost
const VERIFY_URL = "https://ninokuu.site/verified/";
// link dari email (konfirmasi daftar / reset password) kembali ke aplikasi dengan token di #
export async function sessionFromUrl() {
  const h = location.hash.replace(/^#/, "");
  if (!/(^|&)(access_token|error_description)=/.test(h)) return null;
  const q = new URLSearchParams(h);
  history.replaceState(null, "", location.pathname + location.search + "#/more");
  if (q.get("error_description")) throw new ApiError(translate(q.get("error_description").replace(/\+/g, " ")));
  const access_token = q.get("access_token"), user = await authCall("/user", null, { method: "GET", token: access_token });
  setSession({ access_token, refresh_token: q.get("refresh_token"), expires_in: Number(q.get("expires_in")) || 3600, user });
  return q.get("type") || "signup";
}
export async function signOut() {
  const t = session?.access_token;
  setSession(null);
  if (t) authCall("/logout", null, { token: t }).catch(() => {});
}
export async function updateUser(attrs) {
  const t = await accessToken();
  const u = await authCall("/user", attrs, { method: "PUT", token: t });
  if (session && u) setSession({ ...session, user: u });
  return u;
}

/* ---------- database (PostgREST) ---------- */
export async function rest(path, { method = "GET", body, prefer, headers = {} } = {}) {
  const r = await net("/rest/v1/" + path, () => ({
    method, headers: { "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  if (!r.ok) throw await readErr(r);
  if (r.status === 204) return null;
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}
// jumlah baris tanpa mengunduh isinya (header Content-Range dari PostgREST)
export async function count(path) {
  const r = await net("/rest/v1/" + path, () => ({ method: "HEAD", headers: { Prefer: "count=exact", Range: "0-0" } }));
  if (!r.ok && r.status !== 206 && r.status !== 416) throw new ApiError("Gagal menghitung", r.status);
  const n = Number((r.headers.get("content-range") || "").split("/")[1]);
  return Number.isFinite(n) ? n : 0;
}
export const rpc = (fn, args = {}) => rest("rpc/" + fn, { method: "POST", body: args });

/* ---------- Storage (gambar chat) ---------- */
export async function upload(bucket, path, file) {
  if (!(await accessToken())) throw new ApiError("Masuk dulu untuk mengunggah.", 401);
  const r = await net(`/storage/v1/object/${bucket}/${path}`, () => ({
    method: "POST", headers: { "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" }, body: file,
  }));
  if (!r.ok) throw await readErr(r);
  return `${BASE}/storage/v1/object/public/${bucket}/${path}`;
}

export async function removeFile(bucket, path) { await removeFiles(bucket, [path]); }
// hapus banyak file sekaligus (per 100)
export async function removeFiles(bucket, paths) {
  for (let i = 0; i < paths.length; i += 100) {
    const r = await net(`/storage/v1/object/${bucket}`, () => ({ method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: paths.slice(i, i + 100) }) }));
    if (!r.ok) throw await readErr(r);
  }
}
export const publicUrl = (bucket, path) => `${BASE}/storage/v1/object/public/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
export const userId = () => session?.user?.id || null;

/* ---------- Edge Function ninokuu-api ---------- */
export async function call(action, payload = {}) {
  // APK: Shinigami & WestManga diambil langsung lewat jaringan HP (server diblokir Cloudflare)
  const d = await direct(action, payload);
  if (d) return d;
  let r;
  try { r = await net("/functions/v1/" + FN_NAME, () => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) })); }
  catch (e) { logDev("api", `${action}: jaringan gagal`, JSON.stringify(payload).slice(0, 300)); throw e; }
  if (!r.ok) {
    const e = await readErr(r); logDev("api", `${action}: HTTP ${r.status} ${e.message}`, JSON.stringify(payload).slice(0, 300));
    // sumber menolak server (Cloudflare) → APK mencoba mengambilnya sendiri lewat jaringan HP
    if (e.blocked && canDirectFallback(payload?.source)) { serverBlocked(payload.source); const d2 = await direct(action, payload); if (d2) return d2; }
    throw e;
  }
  return r.json();
}
export const pageUrl = (p) => FN + "?" + p;
