// Koneksi ke Supabase (Auth, database REST, Storage) dan Edge Function ninokuu-api.
// Tanpa library: semua lewat fetch, supaya ringan dan sama di PWA maupun APK.
import { direct, isApp, WEB_URL } from "./native.js";
const C = window.NINOKUU_CONFIG || {};
const BASE = String(C.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = String(C.SUPABASE_ANON_KEY || "");
export const configured = !!(BASE && KEY);
export const FN = BASE + "/functions/v1/ninokuu-api";

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
let session = lsGet("session");
const listeners = new Set();
export const onAuth = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
function setSession(s) {
  session = s && s.access_token ? { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600), user: s.user } : null;
  lsSet("session", session);
  listeners.forEach((f) => { try { f(session); } catch {} });
}
export const currentUser = () => session?.user || null;

async function authCall(path, body, { method = "POST", token } = {}) {
  let r;
  try {
    r = await fetch(BASE + "/auth/v1" + path, {
      method, headers: { apikey: KEY, "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw new ApiError(NET_MSG); }
  if (!r.ok) throw await readErr(r);
  return r.status === 204 ? null : r.json().catch(() => null);
}
let refreshing = null;
async function accessToken() {
  if (!session) return null;
  if (session.expires_at * 1000 - Date.now() > 60e3) return session.access_token;
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
export async function recover(email) { await authCall("/recover?redirect_to=" + encodeURIComponent(appUrl()), { email: email.trim() }); }
// link di email (konfirmasi akun, reset password) selalu ke versi web; di APK alamatnya https://localhost
const VERIFY_URL = "https://ninokuu.site/verified/";
const appUrl = () => (isApp ? WEB_URL : location.origin + location.pathname);
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
  const t = (await accessToken()) || KEY;
  let r;
  try {
    r = await fetch(BASE + "/rest/v1/" + path, {
      method,
      headers: { apikey: KEY, Authorization: "Bearer " + t, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch { throw new ApiError(NET_MSG); }
  if (!r.ok) throw await readErr(r);
  if (r.status === 204) return null;
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}
// jumlah baris tanpa mengunduh isinya (header Content-Range dari PostgREST)
export async function count(path) {
  const t = (await accessToken()) || KEY;
  let r;
  try { r = await fetch(BASE + "/rest/v1/" + path, { method: "HEAD", headers: { apikey: KEY, Authorization: "Bearer " + t, Prefer: "count=exact", Range: "0-0" } }); }
  catch { throw new ApiError(NET_MSG); }
  if (!r.ok && r.status !== 206 && r.status !== 416) throw new ApiError("Gagal menghitung", r.status);
  const n = Number((r.headers.get("content-range") || "").split("/")[1]);
  return Number.isFinite(n) ? n : 0;
}
export const rpc = (fn, args = {}) => rest("rpc/" + fn, { method: "POST", body: args });

/* ---------- Storage (gambar chat) ---------- */
export async function upload(bucket, path, file) {
  const t = await accessToken();
  if (!t) throw new ApiError("Masuk dulu untuk mengunggah.", 401);
  let r;
  try {
    r = await fetch(`${BASE}/storage/v1/object/${bucket}/${path}`, {
      method: "POST", headers: { apikey: KEY, Authorization: "Bearer " + t, "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" }, body: file,
    });
  } catch { throw new ApiError(NET_MSG); }
  if (!r.ok) throw await readErr(r);
  return `${BASE}/storage/v1/object/public/${bucket}/${path}`;
}

export async function removeFile(bucket, path) {
  const t = await accessToken();
  const r = await fetch(`${BASE}/storage/v1/object/${bucket}`, { method: "DELETE", headers: { apikey: KEY, Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [path] }) });
  if (!r.ok) throw await readErr(r);
}
// hapus banyak file sekaligus (per 100)
export async function removeFiles(bucket, paths) {
  for (let i = 0; i < paths.length; i += 100) {
    const t = await accessToken();
    const r = await fetch(`${BASE}/storage/v1/object/${bucket}`, { method: "DELETE", headers: { apikey: KEY, Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: paths.slice(i, i + 100) }) });
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
  const t = (await accessToken()) || KEY;
  let r;
  try {
    r = await fetch(FN, { method: "POST", headers: { apikey: KEY, Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
  } catch { throw new ApiError(NET_MSG); }
  if (!r.ok) throw await readErr(r);
  return r.json();
}
export const pageUrl = (p) => FN + "?" + p;
