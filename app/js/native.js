// Fitur khusus aplikasi Android (APK Capacitor). Di browser semua fungsi di sini tidak aktif.
// - Shinigami & WestManga menolak server (Cloudflare) → di APK diambil langsung lewat jaringan HP (CapacitorHttp)
// - Notifikasi chapter baru lewat Firebase Cloud Messaging
// - Tombol kembali Android, cek versi APK terbaru
const CAP = () => window.Capacitor;
export const isApp = (() => { try { return !!CAP()?.isNativePlatform?.(); } catch { return false; } })();
const plugin = (n) => (isApp ? CAP()?.Plugins?.[n] || null : null);
const CFG = window.NINOKUU_CONFIG || {};
export const BUILD = Number(CFG.BUILD || 0);
// versi mayor.minor.patch dari berkas VERSION di repo (sama untuk web, APK, dan rilis GitHub)
export const VERSION = String(CFG.VERSION || "0.0.0");
const vp = (v) => String(v).split(".").map((n) => parseInt(n, 10) || 0);
export function cmpVersion(a, b) { const x = vp(a), y = vp(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1; return 0; }
// jenis pembaruan: mayor (perubahan besar), minor (fitur baru), patch (perbaikan)
export function updateKind(from, to) { const x = vp(from), y = vp(to); return y[0] !== x[0] ? "mayor" : y[1] !== x[1] ? "minor" : "patch"; }
// Ninokuu Dev: APK terpisah (paket .dev) dari branch dev, memakai Edge Function ninokuu-api-dev
export const DEV = !!CFG.DEV;
const RELEASE_TAG = CFG.RELEASE_TAG || "apk-terbaru";
export const REPO = CFG.REPO || "Rexxaply/NinoKuu-Manga";
export const WEB_URL = CFG.WEB_URL || `https://${REPO.split("/")[0].toLowerCase()}.github.io/${REPO.split("/")[1]}/`;
export const APK_URL = DEV ? `https://github.com/${REPO}/releases/download/${RELEASE_TAG}/ninokuu-dev.apk` : `https://github.com/${REPO}/releases/download/apk-terbaru/ninokuu.apk`;
// halaman unduh (landing page, repo Rexxaply/ninokuu-site)
export const SITE_URL = "https://ninokuu.site/";

/* ---------- HTTP lewat jaringan HP (tanpa batas CORS) ---------- */
const b64bytes = (s) => { const bin = atob(String(s || "")); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
// info tambahan komik (nama field tiap sumber berbeda; yang tidak ada dibiarkan kosong) — sama dengan Edge Function
export const normStatus = (s) => {
  const t = String(s ?? "").toLowerCase();
  return /drop|cancel|discontinu|batal|berhenti/.test(t) ? "dropped" : /hiatus|jeda/.test(t) ? "hiatus"
    : /complet|tamat|end|finish|selesai/.test(t) ? "completed" : /ongoing|on going|berjalan|publishing|lanjut/.test(t) ? "ongoing" : "";
};
export const toNum = (v) => {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
  const m = String(v ?? "").trim().toLowerCase().replace(/\s+/g, "").match(/^([\d.,]+)(k|rb|ribu|m|jt|juta)?/);
  if (!m) return null;
  const mul = m[2] ? (/^(k|rb|ribu)$/.test(m[2]) ? 1e3 : 1e6) : 1;
  const n = mul > 1 ? parseFloat(m[1].replace(",", ".")) : parseFloat(m[1].replace(/[.,](?=\d{3}(\D|$))/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * mul) : null;
};
const VIEW_KEYS = ["view_count", "views_count", "total_views", "total_view", "views", "view", "viewer", "viewers", "read_count", "total_read", "readers", "post_views", "hits"];
const pickViews = (...objs) => {
  for (const o of objs) if (o && typeof o === "object") for (const k of VIEW_KEYS) { const n = toNum(o[k]); if (n != null && n > 0) return n; }
  return null;
};
const pickPublisher = (o) => {
  if (!o || typeof o !== "object") return "";
  for (const [k, v] of Object.entries(o)) if (/publisher|penerbit|serializ|serialis|magazine|majalah/i.test(k)) {
    const s = Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : x?.name)).filter(Boolean).join(", ") : typeof v === "string" ? v : v?.name || "";
    if (s) return String(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  }
  return "";
};

export async function nget(url, { headers = {}, type = "json" } = {}) {
  const H = plugin("CapacitorHttp");
  if (!H) throw new Error("Fitur ini hanya tersedia di aplikasi APK.");
  // tiru permintaan dari browser Chrome biasa: UA tanpa penanda WebView, Referer situs aslinya
  const org = new URL(url).origin;
  const ua = navigator.userAgent.replace(/; wv\)/, ")").replace(/ Version\/[\d.]+/, "");
  const base = type === "json"
    ? { "User-Agent": ua, Accept: "application/json, text/plain, */*", "Accept-Language": "id-ID,id;q=0.9,en;q=0.7", Referer: org + "/", "Sec-Fetch-Dest": "empty", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Site": "same-origin" }
    : { "User-Agent": ua, Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8", "Accept-Language": "id-ID,id;q=0.9,en;q=0.7", "Sec-Fetch-Dest": "image", "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Site": "cross-site" };
  const r = await H.request({ url, method: "GET", headers: { ...base, ...headers }, responseType: type, connectTimeout: 15000, readTimeout: 30000 });
  if (r.status < 200 || r.status >= 300) {
    const txt = typeof r.data === "string" ? r.data : JSON.stringify(r.data || "");
    const cf = /Just a moment|cf-chl|challenge-platform|Attention Required/i.test(txt);
    const msg = cf ? "tantangan Cloudflare" : (r.data && typeof r.data === "object" && (r.data.message || r.data.error)) || txt.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    throw Object.assign(new Error(`HTTP ${r.status}${msg ? " (" + msg + ")" : ""}`), { status: r.status, cf });
  }
  if (type === "json") return typeof r.data === "string" ? JSON.parse(r.data) : r.data;
  const h = Object.fromEntries(Object.entries(r.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return { bytes: typeof r.data === "string" ? b64bytes(r.data) : new Uint8Array(r.data || []), type: h["content-type"] || "image/jpeg" };
}
// Hemat kuota (egress) Supabase: gambar sampul & halaman selalu dicoba langsung dari situs aslinya.
// Alamat proxy ninokuu-api / ninokuu-api-dev (…?img=…&ref=…&sig=…) hanya dipakai sebagai cadangan terakhir.
export function imgParts(url) {
  const s = String(url || "");
  if (!/\/functions\/v1\/ninokuu-api(-dev)?\?/.test(s)) return { src: s, d: "", ref: "", px: "" };
  const q = new URLSearchParams(s.slice(s.indexOf("?") + 1)), d = q.get("img") || "";
  return /^https:\/\//i.test(d) ? { src: d, d, ref: q.get("ref") || "", px: s } : { src: s, d: "", ref: "", px: "" };
}
// atribut <img>: src langsung + data cadangan (dipakai oleh penangan error di ui.js)
export function imgAttrs(url, { ref = "", px = "" } = {}) {
  const p = imgParts(url), e = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const d = p.d || (/^https:\/\//i.test(p.src) ? p.src : ""), r = p.ref || ref, x = p.px || px;
  return `src="${e(p.src)}"${d ? ` data-d="${e(d)}"` : ""}${r ? ` data-ref="${e(r)}"` : ""}${x ? ` data-px="${e(x)}"` : ""}`;
}
// gambar langsung gagal: APK → ambil lewat jaringan HP (dengan Referer, tanpa Supabase); lalu proxy; lalu menyerah
export async function imgFallback(im) {
  const st = Number(im.dataset.fb || 0);
  im.dataset.fb = String(st + 1);
  if (st === 0 && isApp && im.dataset.d) {
    try { im.src = await imageViaNative(im.dataset.d, im.dataset.ref || ""); return true; } catch {}
  }
  if (st <= 1 && im.dataset.px && im.getAttribute("src") !== im.dataset.px) { im.dataset.fb = "2"; im.src = im.dataset.px; return true; }
  return false;
}

// gambar yang menolak dimuat langsung oleh WebView (mis. butuh Referer) → ambil lewat jaringan HP
const blobUrls = new Map();
export async function imageViaNative(url, referer) {
  if (blobUrls.has(url)) return blobUrls.get(url);
  const r = await nget(url, { type: "arraybuffer", headers: referer ? { Referer: referer } : {} });
  const u = URL.createObjectURL(new Blob([r.bytes], { type: r.type }));
  if (blobUrls.size > 300) { const [k, v] = blobUrls.entries().next().value; URL.revokeObjectURL(v); blobUrls.delete(k); }
  blobUrls.set(url, u);
  return u;
}

/* ---------- Shinigami (API JSON) ---------- */
const SHNG = (() => {
  const API = "https://api.shngm.io", SITE = "https://11.shinigami.asia";
  const get = (path) => nget(API + path, { headers: { Origin: SITE, Referer: SITE + "/" } });
  const coverOf = (o) => String(o?.cover_portrait_url || o?.cover_image_url || "");
  const STATUS = { 1: "ongoing", 2: "completed", 3: "hiatus" };
  async function chapters(id) {
    const j = await get(`/v1/chapter/${encodeURIComponent(id)}/list?page_size=3000`);
    return (j?.data || []).filter((c) => c?.chapter_id).map((c) => ({
      id: String(c.chapter_id), ch: c.chapter_number != null ? String(c.chapter_number).replace(/\.0+$/, "") : null,
      title: String(c.chapter_title || "").trim(), at: c.release_date ? new Date(c.release_date).toISOString() : null, url: `${SITE}/chapter/${c.chapter_id}`,
    }));
  }
  return {
    referer: SITE + "/",
    chapters,
    async browse(b) {
      const page = Math.max(1, Number(b.page) || 1), limit = Math.min(30, Number(b.limit) || 20);
      const p = new URLSearchParams({ page: String(page), page_size: String(limit), sort: b.sort === "popular" ? "popularity" : "latest", sort_order: "desc" });
      if (b.q) p.set("q", b.q);
      if (b.type) p.set("format", b.type);
      if (b.genres?.length) { p.set("genre_include", b.genres.join(",")); p.set("genre_include_mode", "and"); }
      if (b.status) p.set("status", b.status);
      const j = await get(`/v1/manga/list?${p}`);
      const items = (j?.data || []).filter((m) => m?.manga_id).map((m) => ({ id: String(m.manga_id), title: String(m.title || ""), cover: coverOf(m), type: b.type || "" }));
      const total = j?.meta?.total_page != null ? Number(j.meta.total_page) : null;
      return { ok: true, items, hasNext: total != null ? page < total : items.length >= limit };
    },
    async detail(b) {
      const id = b.comic_id;
      const [d, chs] = await Promise.all([get(`/v1/manga/detail/${encodeURIComponent(id)}`).then((j) => j?.data), chapters(id)]);
      if (!d) throw new Error("Seri Shinigami tidak ditemukan");
      const tax = d.taxonomy || {};
      return { ok: true, manga: { id, title: String(d.title || ""), cover: coverOf(d), desc: String(d.description || "").trim(), status: STATUS[Number(d.status)] || normStatus(d.status_name || d.status_label || d.status),
        tags: [...(tax.Genre || []), ...(tax.Format || [])].map((x) => x?.name).filter(Boolean).slice(0, 8),
        author: (tax.Author || []).map((x) => x?.name).filter(Boolean).join(", "), url: `${SITE}/series/${id}`,
        views: pickViews(d, d.stats, d.statistic), publisher: pickPublisher(tax) || pickPublisher(d) }, chapters: chs };
    },
    async pages(b) {
      const d = (await get(`/v1/chapter/detail/${encodeURIComponent(b.chapter_id)}`))?.data;
      const base = String(d?.base_url || ""), path = String(d?.chapter?.path || "");
      const images = (d?.chapter?.data || []).map((f) => ({ u: /^https?:/i.test(f) ? f : base + path + f, direct: true }));
      if (!images.length) throw new Error("Chapter ini tidak berisi gambar.");
      return { ok: true, ref: SITE + "/", images };
    },
  };
})();

/* ---------- WestManga (API JSON + token kunjungan) ---------- */
const WEST = (() => {
  const SITES = ["https://v1.westmanga.my", "https://v1.westmanga.top"];
  const TYPE = { JP: "manga", KR: "manhwa", CN: "manhua" }, COUNTRY = { manga: "JP", manhwa: "KR", manhua: "CN" };
  let base = SITES[0], tok = null, exp = 0;
  const abs = (u) => (!u ? "" : /^https?:/i.test(u) ? u : base + (u.startsWith("/") ? "" : "/") + u);
  async function token(force) {
    if (!force && tok && Date.now() < exp - 5 * 60e3) return tok;
    try { const j = await nget(base + "/api/visit-token"); if (j?.status && j.token) { tok = String(j.token); exp = j.expires_at ? j.expires_at * 1000 : Date.now() + 3600e3; } } catch {}
    return tok || "";
  }
  // token kunjungan wajib (header X-WM-Visit); 403/404 = token kedaluwarsa → ambil baru sekali; coba domain cermin bila gagal
  async function get(path) {
    let last = null;
    for (const b of [base, ...SITES.filter((x) => x !== base)]) {
      base = b;
      for (const force of [false, true]) {
        try { const t = await token(force); return await nget(b + path, t ? { headers: { "X-WM-Visit": t } } : {}); }
        catch (e) { last = e; if (!(e.status === 403 || e.status === 404)) break; }
      }
    }
    throw last || new Error("WestManga tidak bisa dihubungi");
  }
  const mapCh = (c) => {
    const num = String(c.number ?? "").trim(), n = Number(num.replace(",", "."));
    return { id: String(c.slug), ch: num ? (Number.isFinite(n) ? String(n) : num) : null, title: "", at: c.updated_at?.time ? new Date(Number(c.updated_at.time) * 1000).toISOString() : null, url: `${base}/view/${c.slug}` };
  };
  async function detailRaw(id) {
    const d = (await get(`/api/comic/${encodeURIComponent(id)}`))?.data;
    if (!d?.slug) throw new Error("Seri WestManga tidak ditemukan");
    return d;
  }
  return {
    get referer() { return base + "/"; },
    chapters: async (id) => ((await detailRaw(id)).chapters || []).filter((c) => c?.slug).map(mapCh),
    async browse(b) {
      const page = Math.max(1, Number(b.page) || 1), limit = Math.min(30, Number(b.limit) || 20);
      const p = new URLSearchParams({ page: String(page), per_page: String(limit), type: "Comic", orderBy: b.sort === "popular" ? "Popular" : "Update" });
      if (b.q) p.set("q", b.q);
      if (b.type) p.set("country", COUNTRY[b.type]);
      if (b.status) p.set("status", b.status[0].toUpperCase() + b.status.slice(1));
      (b.genres || []).forEach((g) => p.append("genre[]", g));
      const j = await get(`/api/contents?${p}`);
      const items = (j?.data || []).filter((m) => m?.slug).map((m) => ({ id: String(m.slug), title: String(m.title || m.slug), cover: abs(m.cover), type: TYPE[m.country_id] || b.type || "" }));
      const last = j?.paginator?.last_page != null ? Number(j.paginator.last_page) : null;
      return { ok: true, items, hasNext: last != null ? page < last : items.length >= limit };
    },
    async detail(b) {
      const d = await detailRaw(b.comic_id), type = TYPE[d.country_id] || "";
      const tmp = document.createElement("div");
      tmp.innerHTML = String(d.sinopsis || "").replace(/<\/p>\s*<p[^>]*>/gi, "\n\n").replace(/<br\s*\/?>/gi, "\n");
      return { ok: true, manga: { id: String(d.slug), title: String(d.title || d.slug), cover: abs(d.cover), desc: (tmp.textContent || "").trim(),
        tags: [...(type ? [type[0].toUpperCase() + type.slice(1)] : []), ...(d.genres || []).map((g) => g?.name).filter(Boolean)].slice(0, 8),
        status: normStatus(d.status), views: pickViews(d, d.stats), publisher: pickPublisher(d),
        author: String(d.author || ""), url: `${base}/comic/${d.slug}` }, chapters: (d.chapters || []).filter((c) => c?.slug).map(mapCh) };
    },
    async pages(b) {
      const d = (await get(`/api/v/${encodeURIComponent(b.chapter_id)}`))?.data;
      const images = (d?.images || []).map((x) => ({ u: abs(x), direct: true })).filter((x) => x.u);
      if (!images.length) throw new Error("Chapter ini tidak berisi gambar.");
      return { ok: true, ref: base + "/", images };
    },
    async filters() {
      const j = await get("/api/contents/genres");
      return { ok: true, genres: (j?.data || []).filter((g) => g?.id != null).map((g) => ({ id: String(g.id), name: String(g.name || g.slug) })).sort((a, b) => a.name.localeCompare(b.name)),
        status: ["ongoing", "completed", "hiatus"], maxGenres: 10 };
    },
  };
})();

export const DIRECT = isApp && plugin("CapacitorHttp") ? { shinigami: SHNG, westmanga: WEST } : {};
// dipanggil api.call(): kembalikan null bila sumber/aksi ini tetap lewat server
export async function direct(action, body) {
  const s = DIRECT[body?.source];
  if (!s || typeof s[action] !== "function") return null;
  try { return await s[action](body); }
  catch (e) { throw new Error(`${body.source === "shinigami" ? "Shinigami" : "WestManga"} tidak bisa dijangkau dari HP: ${e.message}`); }
}

/* ---------- Notifikasi (Firebase Cloud Messaging) ---------- */
// Ninokuu Dev tanpa Firebase (paket .dev belum didaftarkan) → plugin notifikasi tidak dipanggil sama sekali
const PN = () => (CFG.PUSH === false ? null : plugin("PushNotifications"));
export const pushSupported = () => !!PN();
export async function pushStatus() {
  if (!PN()) return "unsupported";
  const p = await PN().checkPermissions().catch(() => ({}));
  return p.receive === "granted" ? "on" : p.receive === "denied" ? "denied" : "off";
}
let lastToken = null, lastError = "";
export const pushError = () => lastError;
export const pushToken = () => lastToken;
async function registerToken() {
  const P = PN();
  try { await P.createChannel({ id: "ninokuu", name: "Chapter baru & pengumuman", description: "Chapter baru dari komik yang loncengnya menyala", importance: 5, visibility: 1, vibration: true }); } catch {}
  return await new Promise((ok, no) => {
    const hs = [];
    const done = () => { clearTimeout(t); hs.forEach((h) => Promise.resolve(h).then((x) => x?.remove?.()).catch(() => {})); };
    const t = setTimeout(() => { done(); no(new Error("Firebase tidak merespons. Periksa koneksi lalu coba lagi.")); }, 20000);
    hs.push(P.addListener("registration", (r) => { done(); ok(String(r?.value || "")); }));
    hs.push(P.addListener("registrationError", (e) => { done(); no(new Error(e?.error || "Pendaftaran notifikasi gagal")); }));
    Promise.resolve(P.register()).catch((e) => { done(); no(e); });
  });
}
// ask=true: tampilkan dialog izin bila belum pernah ditanya. Mengembalikan "on" | "off" | "denied" | "unsupported"
// force=true: daftarkan ulang ke server walau token sama (mis. setelah tes gagal "belum terdaftar")
export async function pushEnable(rpc, ask = false, force = false) {
  if (!PN()) return "unsupported";
  let st = await PN().checkPermissions().catch(() => ({}));
  // izin yang dinyalakan dari Pengaturan HP kadang belum terbaca → minta sekali lagi (tanpa dialog bila sudah diizinkan)
  if (st.receive !== "granted" && st.receive !== "denied" && (ask || force)) st = await PN().requestPermissions().catch(() => ({}));
  if (st.receive !== "granted") return st.receive === "denied" ? "denied" : "off";
  try {
    const tok = await registerToken();
    if (!tok) throw new Error("Firebase tidak memberi token");
    if (tok !== lastToken || force) { await rpc("register_device", { p_token: tok, p_platform: "android" }); lastToken = tok; }
    lastError = "";
    return "on";
  } catch (e) { lastError = e.message || String(e); lastToken = null; throw e; }
}
// notifikasi masuk saat aplikasi terbuka → perbarui lonceng
export function onPushReceived(cb) { PN()?.addListener("pushNotificationReceived", () => cb()); }
// ketuk notifikasi → buka halaman yang dituju (ninokuu://comic/<sumber>/<id>, ninokuu://chat, ninokuu://home)
function openLink(u, go) {
  const m = u.match(/^ninokuu:\/\/comic\/([a-z0-9]+)\/(.+)$/i);
  if (m) go(`#/c/${m[1]}/${m[2]}`);
  else if (/^ninokuu:\/\/chat/i.test(u)) go("#/chat");
  else if (/^ninokuu:\/\/verified/i.test(u)) go("#/more", "verified");
  else if (/^https?:/i.test(u)) window.open(u, "_blank");
  else go("#/home");
}
export function onPushOpen(go) {
  PN()?.addListener("pushNotificationActionPerformed", (a) => openLink(String(a?.notification?.data?.url || ""), go));
}
// aplikasi dibuka lagi dari latar belakang (event bawaan Capacitor)
export function onResume(fn) { plugin("App")?.addListener("resume", () => fn()); }
// tautan ninokuu://… dari browser (mis. tombol "Kembali ke aplikasi" setelah verifikasi email)
export function onUrlOpen(go) {
  plugin("App")?.addListener("appUrlOpen", (e) => { const u = String(e?.url || ""); if (/^ninokuu:/i.test(u)) openLink(u, go); });
}

/* ---------- keyboard (tinggi keyboard dari Android) ---------- */
// cb(tinggiKeyboardPx) saat muncul, cb(0) saat disembunyikan
export function onKeyboard(cb) {
  const K = plugin("Keyboard"); if (!K) return false;
  K.addListener("keyboardWillShow", (i) => cb(Number(i?.keyboardHeight) || 0, "will"));
  K.addListener("keyboardDidShow", (i) => cb(Number(i?.keyboardHeight) || 0, "did"));
  K.addListener("keyboardWillHide", () => cb(0, "will"));
  K.addListener("keyboardDidHide", () => cb(0, "did"));
  return true;
}

/* ---------- tombol kembali Android ---------- */
export function onBack(handler) {
  plugin("App")?.addListener("backButton", () => handler(() => plugin("App")?.exitApp()));
}

/* ---------- cek chapter baru untuk sumber yang menolak server ---------- */
// Server tidak bisa membuka Shinigami/WestManga, jadi HP yang mengecek komik berlonceng lalu melapor ke server;
// server yang mengirim notifikasi ke semua pengikut.
export async function checkBlockedSources(lib, call) {
  const items = lib.filter((x) => x.notify && DIRECT[x.source]);
  for (const it of items) {
    const k = "ninokuu:chk:" + it.source + "|" + it.comic_id;
    try { if (Date.now() - Number(localStorage.getItem(k) || 0) < 20 * 60e3) continue; } catch {}
    try {
      const chs = await DIRECT[it.source].chapters(it.comic_id);
      if (chs.length) await call("report_chapters", { source: it.source, comic_id: it.comic_id, chapters: chs.slice(-50).map((c) => ({ id: c.id, ch: c.ch })) });
      try { localStorage.setItem(k, String(Date.now())); } catch {}
    } catch {}
  }
}

/* ---------- versi APK terbaru (GitHub Release "apk-terbaru") ---------- */
export async function latestBuild() {
  if (!isApp) return null;
  try {
    const j = await nget(`https://api.github.com/repos/${REPO}/releases/tags/${RELEASE_TAG}`, { headers: { Accept: "application/vnd.github+json" } });
    const name = String(j?.name || "");
    const n = Number(name.match(/build (\d+)/i)?.[1] || 0);
    const version = name.match(/v(\d+\.\d+\.\d+)/i)?.[1] || null;
    // catatan rilis: baris "Yang baru" dari pesan commit (tanpa baris atribusi)
    const notes = String(j?.body || "").split(/\r?\n/).map((x) => x.trim())
      .filter((x) => x && !/^(Co-Authored-By|Claude-Session|Dibangun otomatis|Unduh |Pembaruan bisa)/i.test(x)).slice(0, 12);
    if (!version && !n) return null;
    // rilis lama tanpa nomor versi dibandingkan lewat nomor build
    // Dev: setiap build baru dihitung pembaruan (nomor versi bisa sama selama belum rilis global)
    const newer = DEV ? n > BUILD : version ? cmpVersion(version, VERSION) > 0 : n > BUILD;
    return { version, build: n, newer, kind: version ? updateKind(VERSION, version) : "patch", url: DEV ? `https://github.com/${REPO}/releases/tag/${RELEASE_TAG}` : `${SITE_URL}update/`, notes, at: j?.published_at || null };
  } catch { return null; }
}

/* ---------- Ninokuu Dev: catatan error untuk dikirim ke developer ---------- */
const LOGK = "ninokuu:devlog";
export const devLog = () => { try { return JSON.parse(localStorage.getItem(LOGK)) || []; } catch { return []; } };
export const clearDevLog = () => { try { localStorage.removeItem(LOGK); } catch {} };
export function logDev(kind, msg, extra = "") {
  if (!DEV) return;
  const l = devLog();
  l.push({ t: new Date().toISOString(), k: kind, m: String(msg || "").slice(0, 500), x: String(extra || "").slice(0, 1500), r: location.hash });
  try { localStorage.setItem(LOGK, JSON.stringify(l.slice(-80))); } catch {}
}
if (DEV) {
  addEventListener("error", (e) => { if (e.target === window || e.error) logDev("error", e.message || e.error?.message, e.error?.stack || `${e.filename}:${e.lineno}`); });
  addEventListener("unhandledrejection", (e) => logDev("promise", e.reason?.message || e.reason, e.reason?.stack || ""));
}
