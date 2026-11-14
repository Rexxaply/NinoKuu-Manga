// Ninokuu · Edge Function "ninokuu-api"
// - Jelajah, detail, dan halaman chapter dari Komiku, Kiryuu, Shinigami, WestManga
// - Proxy gambar bertanda tangan (hanya alamat yang dibuat server ini; bukan proxy terbuka)
// - Cron tiap 15 menit: cek chapter baru untuk komik yang loncengnya menyala, kirim notifikasi,
//   kirim pengumuman developer, bersihkan chat & notifikasi lama
// - Notifikasi HP lewat Firebase Cloud Messaging (secret FCM_SERVICE_ACCOUNT)
//
// Deploy: Supabase → Edge Functions → Deploy a new function → Via Editor
//         nama: ninokuu-api → tempel seluruh file ini → Deploy → matikan "Verify JWT".
// Parser sumber diturunkan dari edge function rexxa-manga (REXXA AI). Domain situs sering pindah:
// kalau satu sumber rusak, isi secret KOMIKU_SITE / KIRYUU_SITE / SHNGM_SITE / WEST_SITE dengan domain barunya.
import { createClient } from "npm:@supabase/supabase-js@2.76.1";

const VERSION = "1.1.1";
const NAME = "ninokuu-api";
const SOURCES = ["komiku", "kiryuu", "shinigami", "westmanga"] as const;
type Source = typeof SOURCES[number];
// sumber yang sering menolak server (Cloudflare); aplikasi APK boleh melaporkan chapter-nya sendiri
const BLOCKED: Source[] = ["shinigami", "westmanga"];
const CRON_GAP = 10 * 60e3;   // cron dari luar paling cepat tiap 10 menit
const CHECK_PER_RUN = 40;     // maks. komik dicek per jalan cron (sisanya giliran berikutnya)
const CHECK_DELAY = 900;      // jeda antar komik (ms) agar tidak membebani situs
const PUSH_MAX = 2000;        // maks. perangkat per pengumuman per jalan cron

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
function serviceKey() {
  const direct = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY");
  if (direct) return direct;
  const many = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (many) {
    try { const j = JSON.parse(many); const v = typeof j === "string" ? j : Object.values(j).find((x) => typeof x === "string"); if (v) return v as string; }
    catch { return many.split(",")[0].trim(); }
  }
  return "";
}
const SERVICE_KEY = serviceKey();
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const SELF = `${SUPABASE_URL}/functions/v1/${NAME}`;

/* ---------- fetch aman ---------- */
const WEB_UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const WEB_MAX_HTML = 6 * 1024 * 1024;
const WEB_MAX_IMG = 30 * 1024 * 1024;
const webErr = (msg: string, status = 502) => Object.assign(new Error(msg), { status });

async function fetchT(u: string | URL, init: RequestInit, timeoutMs?: number) {
  const ctl = new AbortController();
  const t = timeoutMs ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try { return await fetch(u, { ...init, signal: ctl.signal }); }
  catch (e: any) { throw webErr(e?.name === "AbortError" ? `timeout ${timeoutMs} ms` : `jaringan: ${e?.message || e}`); }
  finally { if (t) clearTimeout(t); }
}
// tolak alamat lokal/privat agar server tidak bisa dipakai mengintip jaringan internal
function safeUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(String(raw).trim()); } catch { throw webErr("Link tidak valid", 400); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw webErr("Link harus diawali http(s)://", 400);
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (u.username || u.password) throw webErr("Link tidak boleh berisi nama pengguna/sandi", 400);
  if (!h.includes(".") || /(^|\.)(localhost|local|internal|lan|home|arpa)$/.test(h) || /^[\d.]+$/.test(h) || h.includes(":") || /(^|\.)supabase\.(co|in|net)$/.test(h))
    throw webErr("Alamat ini tidak diizinkan", 400);
  if (u.port && !["80", "443"].includes(u.port)) throw webErr("Port tidak diizinkan", 400);
  u.hash = "";
  return u;
}
async function webFetch(raw: string | URL, opt: { referer?: string; json?: boolean; method?: string; body?: BodyInit; headers?: Record<string, string>; timeout?: number } = {}) {
  const u = safeUrl(String(raw));
  const headers: Record<string, string> = {
    "User-Agent": WEB_UA,
    Accept: opt.json ? "application/json, text/plain, */*" : "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
    ...(opt.referer ? { Referer: opt.referer } : {}),
    ...(opt.headers || {}),
  };
  let r: Response;
  try { r = await fetchT(u, { method: opt.method || "GET", headers, body: opt.body, redirect: "follow" }, opt.timeout || 15000); }
  catch (e: any) { throw webErr(`${u.hostname} tidak bisa dihubungi (${e.message})`); }
  if (r.url) safeUrl(r.url);
  if (Number(r.headers.get("content-length") || 0) > WEB_MAX_HTML) throw webErr("Halaman terlalu besar");
  const text = await r.text();
  if (text.length > WEB_MAX_HTML) throw webErr("Halaman terlalu besar");
  if (!r.ok) {
    if ((r.status === 403 || r.status === 503) && /cloudflare|cf-ray|just a moment|challenge-platform/i.test(text + (r.headers.get("server") || "")))
      throw Object.assign(webErr(`${u.hostname} dilindungi Cloudflare dan menolak server.`, 403), { blocked: true });
    if (r.status === 404) throw webErr("Halaman tidak ditemukan (404)", 404);
    throw webErr(`${u.hostname} membalas HTTP ${r.status}`, r.status === 429 ? 429 : 502);
  }
  if (/<title>\s*Just a moment/i.test(text)) throw Object.assign(webErr(`${u.hostname} dilindungi Cloudflare dan menolak server.`, 403), { blocked: true });
  return { text, url: r.url || u.href, json: () => { try { return JSON.parse(text); } catch { throw webErr("Balasan server bukan JSON"); } } };
}

/* ---------- tanda tangan URL gambar ---------- */
let hmacKey: CryptoKey | null = null;
async function hmac(s: string) {
  if (!hmacKey) hmacKey = await crypto.subtle.importKey("raw", new TextEncoder().encode("ninokuu-img:" + (SERVICE_KEY || "dev")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, new TextEncoder().encode(s)));
  return btoa(String.fromCharCode(...sig.slice(0, 18))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function signImg(u: string, ref: string, cover = false) {
  return `img=${encodeURIComponent(u)}&ref=${encodeURIComponent(ref)}${cover ? "&c=1" : ""}&sig=${await hmac((cover ? "c:" : "") + u + "\n" + ref)}`;
}
const coverUrl = async (u: string, ref: string) => (u ? `${SELF}?${await signImg(u, ref, true)}` : "");
async function checkSig(u: string, ref: string, sig: string, cover: boolean) {
  const want = await hmac((cover ? "c:" : "") + u + "\n" + ref);
  if (want.length !== sig.length) return false;
  let d = 0;
  for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return d === 0;
}
async function proxyImage(u: string, ref: string, sig: string, cover: boolean) {
  if (!u || !sig || !(await checkSig(u, ref, sig, cover))) return json({ error: "tanda tangan gambar tidak valid" }, 403);
  let url: URL;
  try { url = safeUrl(u); } catch (e: any) { return json({ error: e.message }, 400); }
  const r = await fetchT(url, { headers: { "User-Agent": WEB_UA, Accept: "image/avif,image/webp,image/*,*/*;q=0.8", ...(ref ? { Referer: ref } : {}) }, redirect: "follow" }, 25000).catch(() => null);
  if (!r || !r.ok) return json({ error: `gagal memuat gambar${r ? " (" + r.status + ")" : ""}` }, 502);
  const type = r.headers.get("Content-Type") || "";
  if (!/^image\//i.test(type) && !/octet-stream/i.test(type)) return json({ error: "bukan file gambar" }, 415);
  const buf = await r.arrayBuffer();
  if (buf.byteLength > WEB_MAX_IMG) return json({ error: "gambar terlalu besar" }, 413);
  return new Response(buf, { status: 200, headers: { ...CORS, "Content-Type": type || "image/jpeg", "Cache-Control": cover ? "public, max-age=604800" : "public, max-age=86400" } });
}

/* ---------- bantuan HTML ringan ---------- */
const decodeEnt = (s: string) => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const stripTags = (s: string) => decodeEnt(s.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
function attr(tag: string, name: string) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? decodeEnt((m[1] ?? m[2] ?? m[3] ?? "").trim()) : null;
}
const abs = (u: string | null, base: string) => { if (!u) return ""; try { return new URL(u.trim(), base).href; } catch { return ""; } };
function imgSrc(tag: string, base: string) {
  for (const a of ["data-lazy-src", "data-src", "data-cfsrc", "data-original", "src"]) {
    const v = attr(tag, a);
    if (v && !/^data:/i.test(v) && !/\.(svg|gif)(\?|$)/i.test(v)) return abs(v, base);
  }
  return "";
}
function block(html: string, openRe: RegExp): string {
  const m = openRe.exec(html);
  if (!m) return "";
  const tag = (m[0].match(/^<(\w+)/) || [])[1]?.toLowerCase() || "div";
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  re.lastIndex = m.index + m[0].length;
  let depth = 1, x: RegExpExecArray | null;
  while ((x = re.exec(html))) {
    depth += x[1] ? -1 : 1;
    if (!depth) return html.slice(m.index, x.index + x[0].length);
  }
  return html.slice(m.index);
}
function metaContent(html: string, prop: string) {
  const t = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, "i"))?.[0];
  return t ? attr(t, "content") || "" : "";
}
const chTitleFrom = (name: string) => (name.match(/^\s*(?:chapter|chap|ch\.?|bab|episode|ep\.?)?\s*[\d.,]+\s*[-–:]\s*(.+)$/i)?.[1] || "").trim();
function chNumFrom(name: string, url = ""): string | null {
  const m = name.match(/(?:chapter|chap|ch\.?|bab|episode|ep\.?)\s*[-:#]?\s*(\d+(?:[.,]\d+)?)/i)
    || url.match(/(?:chapter|ch|bab|episode|ep)[-_]?(\d+(?:[-.]\d+)?)\/?$/i)
    || name.match(/(\d+(?:\.\d+)?)/);
  return m ? m[1].replace(/[,-]/, ".").replace(/^0+(?=\d)/, "") : null;
}
const MONTHS: Record<string, number> = { jan: 0, januari: 0, january: 0, feb: 1, februari: 1, february: 1, mar: 2, maret: 2, march: 2, apr: 3, april: 3, mei: 4, may: 4, jun: 5, juni: 5, june: 5, jul: 6, juli: 6, july: 6, agu: 7, agt: 7, agustus: 7, aug: 7, august: 7, sep: 8, sept: 8, september: 8, okt: 9, oktober: 9, oct: 9, october: 9, nov: 10, november: 10, des: 11, desember: 11, dec: 11, december: 11 };
function parseWebDate(s: string | null | undefined): string | null {
  const t = String(s || "").trim().toLowerCase();
  if (!t) return null;
  const rel = t.match(/(\d+)\s*(detik|second|sec|menit|minute|minggu|min|jam|hour|hari|day|week|bulan|month|tahun|year)/);
  if (rel) {
    const unit: Record<string, number> = { detik: 1e3, second: 1e3, sec: 1e3, menit: 6e4, minute: 6e4, min: 6e4, jam: 36e5, hour: 36e5, hari: 864e5, day: 864e5, minggu: 6048e5, week: 6048e5, bulan: 2592e6, month: 2592e6, tahun: 31536e6, year: 31536e6 };
    return new Date(Date.now() - +rel[1] * unit[rel[2]]).toISOString();
  }
  if (/kemarin|yesterday/.test(t)) return new Date(Date.now() - 864e5).toISOString();
  const d1 = t.match(/([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/), d2 = t.match(/(\d{1,2})\s+([a-z]+)\.?,?\s+(\d{4})/);
  if (d1 && d1[1] in MONTHS) return new Date(Date.UTC(+d1[3], MONTHS[d1[1]], +d1[2])).toISOString();
  if (d2 && d2[2] in MONTHS) return new Date(Date.UTC(+d2[3], MONTHS[d2[2]], +d2[1])).toISOString();
  const p = Date.parse(t);
  return isNaN(p) ? null : new Date(p).toISOString();
}
const chNum = (ch: unknown): number | null => {
  const n = parseFloat(String(ch ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
function newestChapter(list: any[]) {
  return list.reduce((best: any, c: any) => (!best || (chNum(c.ch) ?? -1) > (chNum(best.ch) ?? -1) ? c : best), null);
}

type Status = "" | "ongoing" | "completed" | "hiatus";
type Opt = { sort: "update" | "popular"; type: "" | "manga" | "manhwa" | "manhua"; limit: number; genres: string[]; status: Status };
type Chapter = { id: string; ch: string | null; title: string; at: string | null; url: string };
type Detail = { manga: { id: string; title: string; cover: string; desc: string; status: string; tags: string[]; author: string; url: string }; chapters: Chapter[] };

/* ---------- Shinigami (API JSON) ---------- */
const SHNGM_API = Deno.env.get("SHNGM_API") || "https://api.shngm.io";
const SHNGM_SITE = Deno.env.get("SHNGM_SITE") || "https://11.shinigami.asia";
const shngJson = async (path: string) =>
  (await webFetch(SHNGM_API + path, { json: true, referer: SHNGM_SITE + "/", headers: { Origin: SHNGM_SITE, DNT: "1", "Sec-GPC": "1" } })).json();
const shngCover = (o: any) => String(o?.cover_portrait_url || o?.cover_image_url || "");
const SHNG_STATUS: Record<number, string> = { 1: "ongoing", 2: "completed", 3: "hiatus" };
const shngId = (id: string) => { if (!/^[\w-]{6,64}$/.test(id)) throw webErr("ID Shinigami tidak valid", 400); return id; };
async function shngBrowse(page: number, q: string, o: Opt) {
  const p = new URLSearchParams({ page: String(page), page_size: String(o.limit), sort: o.sort === "popular" ? "popularity" : "latest", sort_order: "desc" });
  if (q) p.set("q", q);
  if (o.type) p.set("format", o.type);
  if (o.genres.length) { p.set("genre_include", o.genres.join(",")); p.set("genre_include_mode", "and"); }
  if (o.status) p.set("status", o.status);
  const j = await shngJson(`/v1/manga/list?${p}`);
  const items = await Promise.all((j?.data || []).filter((m: any) => m?.manga_id).map(async (m: any) => ({
    id: String(m.manga_id), title: String(m.title || ""), cover: await coverUrl(shngCover(m), SHNGM_SITE + "/"), type: o.type || "",
  })));
  const total = j?.meta?.total_page != null ? Number(j.meta.total_page) : null;
  return { items, hasNext: total != null ? page < total : items.length >= o.limit };
}
async function shngChapters(id: string): Promise<Chapter[]> {
  const j = await shngJson(`/v1/chapter/${shngId(id)}/list?page_size=3000`);
  return (j?.data || []).filter((c: any) => c?.chapter_id).map((c: any) => ({
    id: String(c.chapter_id), ch: c.chapter_number != null ? String(c.chapter_number).replace(/\.0+$/, "") : null,
    title: String(c.chapter_title || "").trim(), at: c.release_date ? new Date(c.release_date).toISOString() : null, url: `${SHNGM_SITE}/chapter/${c.chapter_id}`,
  }));
}
async function shngDetail(id: string): Promise<Detail> {
  const [j, chapters] = await Promise.all([shngJson(`/v1/manga/detail/${shngId(id)}`), shngChapters(id)]);
  const d = j?.data;
  if (!d) throw webErr("Seri Shinigami tidak ditemukan", 404);
  const tax = d.taxonomy || {};
  return {
    manga: {
      id, title: String(d.title || ""), cover: await coverUrl(shngCover(d), SHNGM_SITE + "/"), desc: String(d.description || "").trim(),
      status: SHNG_STATUS[Number(d.status)] || "", tags: [...(tax.Genre || []), ...(tax.Format || [])].map((x: any) => x?.name).filter(Boolean).slice(0, 8),
      author: (tax.Author || []).map((x: any) => x?.name).filter(Boolean).join(", "), url: `${SHNGM_SITE}/series/${id}`,
    },
    chapters,
  };
}
async function shngPages(id: string) {
  const d = (await shngJson(`/v1/chapter/detail/${shngId(id)}`))?.data;
  const base = String(d?.base_url || ""), path = String(d?.chapter?.path || "");
  const files: string[] = d?.chapter?.data || [];
  return { ref: SHNGM_SITE + "/", images: files.map((f) => (/^https?:/i.test(f) ? f : base + path + f)) };
}

/* ---------- Komiku (HTML) ---------- */
const KOMIKU_SITE = Deno.env.get("KOMIKU_SITE") || "https://komiku.org";
const KOMIKU_API = Deno.env.get("KOMIKU_API") || "https://api.komiku.org";
const komikuUrl = (id: string) => {
  const u = safeUrl(id);
  if (!/(^|\.)komiku\.(org|to|id)$/.test(u.hostname)) throw webErr("Link bukan dari Komiku", 400);
  return u.href;
};
async function komikuPage(srcPage: number, q: string, o: Opt) {
  const u = new URL(KOMIKU_API + "/manga/" + (srcPage > 1 ? `page/${srcPage}/` : ""));
  if (q) u.searchParams.set("s", q);
  u.searchParams.set("orderby", o.sort === "popular" ? "meta_value_num" : "modified");
  if (o.type) u.searchParams.set("tipe", o.type);
  if (o.genres[0]) u.searchParams.set("genre", o.genres[0]);
  if (o.genres[1]) u.searchParams.set("genre2", o.genres[1]);
  if (o.status === "ongoing" || o.status === "completed") u.searchParams.set("statusmanga", o.status === "ongoing" ? "ongoing" : "end");
  const html = (await webFetch(u.href, { referer: KOMIKU_SITE + "/" })).text;
  const items: any[] = [];
  for (const m of html.matchAll(/<div\b[^>]*class=["'][^"']*\bbge\b[^"']*["'][^>]*>/gi)) {
    const b = block(html.slice(m.index!), /<div\b[^>]*>/i);
    const a = [...b.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].find((x) => /<h3/i.test(x[2]));
    const title = stripTags(b.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1] || "");
    if (!a || !title) continue;
    const img = imgSrc(b.match(/<img\b[^>]*>/i)?.[0] || "", KOMIKU_SITE).replace(/\?.*$/, "");
    const tp = (stripTags(b.match(/class=["'][^"']*\btpe1_inf\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || "").match(/\b(manga|manhwa|manhua)\b/i)?.[1] || o.type || "").toLowerCase();
    items.push({ id: abs(a[1], KOMIKU_SITE), title, cover: await coverUrl(img, KOMIKU_SITE + "/"), type: tp });
  }
  return { items, hasNext: /<span[^>]*\shx-get=/i.test(html) || items.length >= 10 };
}
function komikuDate(s: string) {
  const t = s.trim(), m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])).toISOString() : parseWebDate(t);
}
async function komikuDetail(id: string): Promise<Detail> {
  const page = await webFetch(komikuUrl(id), { referer: KOMIKU_SITE + "/" });
  const h = page.text;
  const row = (label: string) => stripTags(h.match(new RegExp(`<td[^>]*>\\s*(?:<[^>]+>)*\\s*${label}[\\s\\S]*?<\\/td>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`, "i"))?.[1] || "");
  const title = stripTags(h.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "").replace(/^komik\s+/i, "") || metaContent(h, "og:title");
  const cover = imgSrc((block(h, /<div[^>]*class=["'][^"']*\bims\b[^"']*["'][^>]*>/i).match(/<img\b[^>]*>/i) || h.match(/<img\b[^>]*itemprop=["']image["'][^>]*>/i) || [""])[0], page.url).replace(/\?.*$/, "");
  const desc = stripTags(block(h, /<(?:section|div)[^>]*id=["']Sinopsis["'][^>]*>/i).match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || h.match(/<p[^>]*class=["']desc["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] || "");
  const tags = [...block(h, /<ul[^>]*class=["'][^"']*\bgenre\b[^"']*["'][^>]*>/i).matchAll(/<li[^>]*class=["'][^"']*\bgenre\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi)].map((x) => stripTags(x[1])).filter(Boolean);
  const st = row("Status").toLowerCase();
  const chapters: Chapter[] = [];
  for (const tr of block(h, /<table[^>]*id=["']Daftar_Chapter["'][^>]*>/i).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    if (!/class=["'][^"']*\bjudulseries\b/i.test(tr[1])) continue;
    const a = tr[1].match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const url = abs(a[1], page.url), name = stripTags(a[2]);
    chapters.push({ id: url, ch: chNumFrom(name, url), title: chTitleFrom(name), url,
      at: komikuDate(stripTags(tr[1].match(/class=["'][^"']*\btanggalseries\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)?.[1] || "")) });
  }
  return {
    manga: { id: page.url, title, cover: await coverUrl(cover, page.url), desc, tags: tags.slice(0, 8),
      status: /ongoing|on going/.test(st) ? "ongoing" : /end|completed|tamat/.test(st) ? "completed" : "", author: row("(?:Pengarang|Komikus|Author)"), url: page.url },
    chapters,
  };
}
async function komikuPages(id: string) {
  const page = await webFetch(komikuUrl(id), { referer: KOMIKU_SITE + "/" });
  const box = block(page.text, /<(?:div|section)[^>]*id=["']Baca_Komik["'][^>]*>/i);
  return { ref: page.url, images: [...box.matchAll(/<img\b[^>]*>/gi)].map((m) => imgSrc(m[0], page.url)).filter((u) => u && !/komiku-promosi/i.test(u)) };
}

/* ---------- Kiryuu (WordPress NatsuId) ---------- */
const KIRYUU_SITE = (Deno.env.get("KIRYUU_SITE") || "https://v7.kiryuu.to").replace(/\/+$/, "");
const kiryuuJson = async (path: string) => (await webFetch(KIRYUU_SITE + path, { json: true, referer: KIRYUU_SITE + "/", headers: { "X-Requested-With": "XMLHttpRequest" } })).json();
const kiryuuTerms = (m: any, tax: string): string[] => ((m?._embedded?.["wp:term"] || []) as any[][]).find((g) => g?.[0]?.taxonomy === tax)?.map((t: any) => decodeEnt(String(t?.name || ""))) || [];
const kiryuuCover = (m: any) => String(m?._embedded?.["wp:featuredmedia"]?.[0]?.source_url || m?.yoast_head_json?.og_image?.[0]?.url || "");
let kiryuuNonce: string | null = null;
async function kiryuuGetNonce(fresh = false) {
  if (kiryuuNonce && !fresh) return kiryuuNonce;
  const html = (await webFetch(`${KIRYUU_SITE}/wp-admin/admin-ajax.php?type=search_form&action=get_nonce`, { referer: KIRYUU_SITE + "/", headers: { "X-Requested-With": "XMLHttpRequest" } })).text;
  const tag = html.match(/<input\b[^>]*name=["']search_nonce["'][^>]*>/i)?.[0];
  const v = tag ? attr(tag, "value") : null;
  if (!v) throw webErr("Kiryuu: gagal mengambil nonce pencarian", 502);
  return (kiryuuNonce = v);
}
async function kiryuuSearchPage(srcPage: number, q: string, o: Opt, retry = true): Promise<{ items: any[]; hasNext: boolean }> {
  const fd = new FormData();
  fd.set("nonce", await kiryuuGetNonce(!retry));
  fd.set("inclusion", o.genres.length > 1 ? "AND" : "OR"); fd.set("exclusion", "OR"); fd.set("page", String(srcPage));
  fd.set("genre", JSON.stringify(o.genres)); fd.set("genre_exclude", "[]"); fd.set("author", "[]"); fd.set("artist", "[]"); fd.set("project", "0");
  fd.set("type", JSON.stringify(o.type ? [o.type] : [])); fd.set("status", JSON.stringify(o.status ? [o.status === "hiatus" ? "on-hiatus" : o.status] : []));
  fd.set("order", "desc"); fd.set("orderby", o.sort === "popular" ? "popular" : "updated"); fd.set("query", q);
  const html = (await webFetch(`${KIRYUU_SITE}/wp-admin/admin-ajax.php?action=advanced_search`, { method: "POST", body: fd, referer: KIRYUU_SITE + "/", headers: { "X-Requested-With": "XMLHttpRequest" } })).text;
  if (/nonce|invalid|forbidden/i.test(html) && !/\/manga\//.test(html) && retry) return await kiryuuSearchPage(srcPage, q, o, false);
  const slugs: string[] = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    if (!/<img\b/i.test(m[2])) continue;
    const slug = (attr("<a " + m[1] + ">", "href") || "").match(/\/manga\/([^/?#]+)/)?.[1];
    if (slug && !slugs.includes(slug)) slugs.push(slug);
  }
  const hasNext = /<button\b[^>]*>[\s\S]*?<svg/i.test(html);
  if (!slugs.length) return { items: [], hasNext: false };
  const p = new URLSearchParams({ per_page: String(slugs.length + 1), _embed: "1" });
  slugs.forEach((sl) => p.append("slug[]", sl));
  const list: any[] = await kiryuuJson(`/wp-json/wp/v2/manga?${p}`);
  const bySlug = new Map((Array.isArray(list) ? list : []).filter((m) => m?.id && !kiryuuTerms(m, "type").includes("Novel")).map((m) => [m.slug, m]));
  const items = await Promise.all(slugs.map((sl) => bySlug.get(sl)).filter(Boolean).map(async (m: any) => ({
    id: String(m.id), title: decodeEnt(stripTags(m.title?.rendered || m.slug || "")), cover: await coverUrl(kiryuuCover(m), KIRYUU_SITE + "/"),
    type: (kiryuuTerms(m, "type")[0] || "").toLowerCase(),
  })));
  return { items, hasNext };
}
const kiryuuId = (id: string) => { if (!/^\d{1,10}$/.test(id)) throw webErr("ID Kiryuu tidak valid", 400); return id; };
async function kiryuuChapters(id: string): Promise<Chapter[]> {
  const html = (await webFetch(`${KIRYUU_SITE}/wp-admin/admin-ajax.php?manga_id=${kiryuuId(id)}&page=1&action=chapter_list`, { referer: KIRYUU_SITE + "/", headers: { "X-Requested-With": "XMLHttpRequest" } })).text;
  const out: Chapter[] = [];
  for (const a of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    if (!/<time\b/i.test(a[2])) continue;
    const href = attr("<a " + a[1] + ">", "href"); if (!href) continue;
    const url = abs(href, KIRYUU_SITE + "/");
    const span = a[2].match(/<span\b[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "";
    const name = stripTags(span.replace(/<(\w+)\b[^>]*>[\s\S]*?<\/\1>/g, " ")) || stripTags(span);
    const dt = attr(a[2].match(/<time\b[^>]*>/i)?.[0] || "", "datetime");
    const at = dt && !isNaN(Date.parse(dt)) ? new Date(dt).toISOString() : parseWebDate(stripTags(a[2].match(/<time\b[^>]*>([\s\S]*?)<\/time>/i)?.[1] || ""));
    out.push({ id: url, ch: chNumFrom(name, url), title: chTitleFrom(name), at, url });
  }
  return out;
}
const KIRYUU_STATUS: Record<string, string> = { Ongoing: "ongoing", Completed: "completed", "On Hiatus": "hiatus", Cancelled: "completed" };
async function kiryuuDetail(id: string): Promise<Detail> {
  const [m, chapters] = await Promise.all([kiryuuJson(`/wp-json/wp/v2/manga/${kiryuuId(id)}?_embed`), kiryuuChapters(id)]);
  if (!m?.id) throw webErr("Seri Kiryuu tidak ditemukan", 404);
  return {
    manga: {
      id, title: decodeEnt(stripTags(m.title?.rendered || "")), cover: await coverUrl(kiryuuCover(m), KIRYUU_SITE + "/"),
      desc: stripTags(String(m.content?.rendered || "").replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")).trim(),
      tags: [...kiryuuTerms(m, "genre"), ...kiryuuTerms(m, "type")].slice(0, 8), status: kiryuuTerms(m, "status").map((s) => KIRYUU_STATUS[s]).find(Boolean) || "",
      author: kiryuuTerms(m, "series-author").join(", "), url: m.link || `${KIRYUU_SITE}/manga/${m.slug}/`,
    },
    chapters,
  };
}
async function kiryuuPages(id: string) {
  const u = safeUrl(id);
  if (!/(^|\.)kiryuu\.[a-z]+$/.test(u.hostname)) throw webErr("Link bukan dari Kiryuu", 400);
  const page = await webFetch(u.href, { referer: KIRYUU_SITE + "/" });
  const box = block(page.text, /<section\b[^>]*data-image-data[^>]*>/i);
  return { ref: page.url, images: [...box.matchAll(/<img\b[^>]*>/gi)].map((m) => imgSrc(m[0], page.url)).filter(Boolean) };
}

/* ---------- WestManga (API JSON + visit token) ---------- */
const WEST_SITES = (Deno.env.get("WEST_SITE") || "https://v1.westmanga.my,https://v1.westmanga.top").split(",").map((x) => x.trim().replace(/\/+$/, "")).filter(Boolean);
let westBase = WEST_SITES[0];
let westVisit: { token: string; exp: number } | null = null;
const WEST_TYPE: Record<string, string> = { JP: "manga", KR: "manhwa", CN: "manhua" };
const WEST_COUNTRY: Record<string, string> = { manga: "JP", manhwa: "KR", manhua: "CN" };
const westAbs = (u: string | null | undefined) => (!u ? "" : /^https?:/i.test(u) ? u : westBase + (u.startsWith("/") ? "" : "/") + u);
async function westVisitToken(force = false) {
  if (!force && westVisit && Date.now() < westVisit.exp - 5 * 60e3) return westVisit.token;
  try {
    const j = (await webFetch(`${westBase}/api/visit-token`, { json: true, referer: westBase + "/", headers: { "X-Requested-With": "XMLHttpRequest" } })).json();
    if (j?.status && j.token) { westVisit = { token: String(j.token), exp: j.expires_at ? Number(j.expires_at) * 1000 : Date.now() + 3600e3 }; return westVisit.token; }
  } catch (_) { /* tanpa token tetap dicoba */ }
  if (force) westVisit = null;
  return westVisit?.token || "";
}
async function westApi(path: string): Promise<any> {
  let lastErr: any = null;
  for (const base of [westBase, ...WEST_SITES.filter((b) => b !== westBase)]) {
    westBase = base;
    for (const force of [false, true]) {
      try {
        const tok = await westVisitToken(force);
        return (await webFetch(base + path, { json: true, referer: base + "/", headers: { "X-Requested-With": "XMLHttpRequest", ...(tok ? { "X-WM-Visit": tok } : {}) } })).json();
      } catch (e: any) {
        lastErr = e;
        if (!/\b(403|404)\b/.test(e?.message || "") || force) break;
      }
    }
  }
  throw lastErr || webErr("WestManga tidak bisa dihubungi", 502);
}
const westSlug = (s: string) => { if (!/^[\w.%-]{1,200}$/.test(s)) throw webErr("ID WestManga tidak valid", 400); return s; };
async function westBrowse(page: number, q: string, o: Opt) {
  const p = new URLSearchParams({ page: String(page), per_page: String(o.limit), type: "Comic", orderBy: o.sort === "popular" ? "Popular" : "Update" });
  if (q) p.set("q", q);
  if (o.type) p.set("country", WEST_COUNTRY[o.type]);
  if (o.status) p.set("status", o.status[0].toUpperCase() + o.status.slice(1));
  o.genres.forEach((g) => p.append("genre[]", g));
  const j = await westApi(`/api/contents?${p}`);
  const items = await Promise.all((j?.data || []).filter((m: any) => m?.slug).map(async (m: any) => ({
    id: String(m.slug), title: String(m.title || m.slug), cover: await coverUrl(westAbs(m.cover), westBase + "/"), type: WEST_TYPE[String(m.country_id || "")] || o.type || "",
  })));
  const pg = j?.paginator || {};
  const last = pg.last_page != null ? Number(pg.last_page) : null;
  return { items, hasNext: last != null ? Number(pg.current_page || page) < last : items.length >= o.limit };
}
const WEST_STATUS: Record<string, string> = { ongoing: "ongoing", completed: "completed", hiatus: "hiatus" };
async function westDetail(id: string): Promise<Detail> {
  const d = (await westApi(`/api/comic/${encodeURIComponent(westSlug(id))}`))?.data;
  if (!d?.slug) throw webErr("Seri WestManga tidak ditemukan", 404);
  const type = WEST_TYPE[String(d.country_id || "")] || "";
  const chapters: Chapter[] = (d.chapters || []).filter((c: any) => c?.slug).map((c: any) => {
    const num = String(c.number ?? "").trim(), n = Number(num.replace(",", "."));
    return { id: String(c.slug), ch: num ? (Number.isFinite(n) ? String(n) : num) : null, title: "",
      at: c.updated_at?.time ? new Date(Number(c.updated_at.time) * 1000).toISOString() : null, url: `${westBase}/view/${c.slug}` };
  });
  return {
    manga: {
      id: String(d.slug), title: String(d.title || d.slug), cover: await coverUrl(westAbs(d.cover), westBase + "/"),
      desc: stripTags(String(d.sinopsis || "").replace(/<\/p>\s*<p[^>]*>/gi, "\n\n").replace(/<br\s*\/?>/gi, "\n")).trim(),
      tags: [...(type ? [type[0].toUpperCase() + type.slice(1)] : []), ...((d.genres || []).map((g: any) => g?.name).filter(Boolean))].slice(0, 8),
      status: WEST_STATUS[String(d.status || "").toLowerCase()] || "", author: String(d.author || ""), url: `${westBase}/comic/${d.slug}`,
    },
    chapters,
  };
}
async function westPages(id: string) {
  const d = (await westApi(`/api/v/${encodeURIComponent(westSlug(id))}`))?.data;
  return { ref: westBase + "/", images: (d?.images || []).map((x: string) => westAbs(x)).filter(Boolean) as string[] };
}

/* ---------- pintu per sumber ---------- */
const srcPerPage: Record<string, number> = {};
// Komiku & Kiryuu punya ukuran halaman sendiri: ambil halaman sumber yang menutupi rentang yang diminta lalu potong
async function windowed(src: string, page: number, limit: number, fetchPage: (sp: number) => Promise<{ items: any[]; hasNext: boolean }>) {
  const cache = new Map<number, { items: any[]; hasNext: boolean }>();
  const get = async (sp: number) => { if (!cache.has(sp)) cache.set(sp, await fetchPage(sp)); return cache.get(sp)!; };
  const start = (page - 1) * limit, end = start + limit;
  if (!srcPerPage[src]) {
    const f = await get(1);
    if (!f.hasNext) return { items: f.items.slice(start, end), hasNext: f.items.length > end };
    srcPerPage[src] = Math.max(1, f.items.length);
  }
  const per = srcPerPage[src];
  const out: any[] = [];
  let hasNext = false;
  for (let sp = Math.floor(start / per) + 1; sp <= Math.floor((end - 1) / per) + 1; sp++) {
    const r = await get(sp), base = (sp - 1) * per;
    r.items.forEach((it, i) => { if (base + i >= start && base + i < end) out.push(it); });
    hasNext = base + r.items.length > end || r.hasNext;
    if (!r.hasNext || !r.items.length) { hasNext = base + r.items.length > end; break; }
  }
  return { items: out, hasNext };
}
async function browse(src: Source, page: number, q: string, o: Opt) {
  if (src === "shinigami") return await shngBrowse(page, q, o);
  if (src === "komiku") return await windowed("komiku", page, o.limit, (sp) => komikuPage(sp, q, o));
  if (src === "kiryuu") return await windowed("kiryuu", page, o.limit, (sp) => kiryuuSearchPage(sp, q, o));
  return await westBrowse(page, q, o);
}
/* ---------- daftar filter per sumber (genre asli dari penyedia) ---------- */
type Filters = { genres: { id: string; name: string }[]; status: Status[]; maxGenres: number };
const KOMIKU_GENRES = "academy:Academy,action:Action,adaptation:Adaptation,adult:Adult,adventure:Adventure,apocalypse:Apocalypse,beasts:Beasts,blacksmith:Blacksmith,comedy:Comedy,cooking:Cooking,crime:Crime,crossdressing:Crossdressing,dark-fantasy:Dark Fantasy,demons:Demons,doujinshi:Doujinshi,drama:Drama,ecchi:Ecchi,entertainment:Entertainment,fantasy:Fantasy,game:Game,gender-bender:Gender Bender,genderswap:Genderswap,genius:Genius,ghosts:Ghosts,gore:Gore,gyaru:Gyaru,harem:Harem,historical:Historical,horror:Horror,isekai:Isekai,josei:Josei,knight:Knight,magic:Magic,magical-girls:Magical Girls,martial-art:Martial Art,martial-arts:Martial Arts,mature:Mature,mc-rebirth:MC Rebirth,mecha:Mecha,medical:Medical,military:Military,monster:Monster,monster-girls:Monster Girls,monsters:Monsters,murim:Murim,music:Music,mystery:Mystery,office-workers:Office Workers,one-shot:One Shot,police:Police,psychological:Psychological,regression:Regression,reincarnation:Reincarnation,revenge:Revenge,romance:Romance,school:School,school-life:School Life,sci-fi:Sci-fi,seinen:Seinen,sexual-violence:Sexual Violence,shoujo:Shoujo,shoujo-ai:Shoujo Ai,shounen:Shounen,shounen-ai:Shounen Ai,slice-of-life:Slice of Life,slow-life:Slow Life,smut:Smut,sports:Sports,strategy:Strategy,super-power:Super Power,supernatural:Supernatural,survival:Survival,sword-fight:Sword Fight,sword-master:Sword Master,system:System,thriller:Thriller,tragedy:Tragedy,trauma:Trauma,vampire:Vampire,villainess:Villainess,violence:Violence,xianxia:Xianxia,xuanhuan:Xuanhuan,yuri:Yuri";
const SHNG_GENRES = "action:Action,adaptation:Adaptation,adult:Adult,adventure:Adventure,comedy:Comedy,cooking:Cooking,crime:Crime,demons:Demons,drama:Drama,ecchi:Ecchi,fantasy:Fantasy,fight:Fight,game:Game,gender-bender:Gender Bender,harem:Harem,historical:Historical,horror:Horror,isekai:Isekai,josei-genre:Josei,love:Love,magic:Magic,martial-arts:Martial Arts,mature:Mature,mecha:Mecha,medical:Medical,murim:Murim,mystery:Mystery,philosophical:Philosophical,psychological:Psychological,regression:Regression,revenge:Revenge,romance:Romance,school-life:School Life,sci-fi:Sci-fi,seinen:Seinen,shoujo:Shoujo,shounen:Shounen,slice-of-life:Slice of Life,smut:Smut,sports:Sports,supernatural:Supernatural,thriller:Thriller,tragedy:Tragedy,violence:Violence,wuxia:Wuxia";
const parseList = (s: string) => s.split(",").map((x) => { const [id, ...n] = x.split(":"); return { id, name: n.join(":") }; });
const filterCache = new Map<string, { at: number; data: Filters }>();
async function filters(src: Source): Promise<Filters> {
  const hit = filterCache.get(src);
  if (hit && Date.now() - hit.at < 6 * 3600e3) return hit.data;
  let data: Filters;
  if (src === "komiku") data = { genres: parseList(KOMIKU_GENRES), status: ["ongoing", "completed"], maxGenres: 2 };
  else if (src === "shinigami") data = { genres: parseList(SHNG_GENRES), status: ["ongoing", "completed", "hiatus"], maxGenres: 10 };
  else if (src === "kiryuu") {
    const list: any[] = await kiryuuJson("/wp-json/wp/v2/genre?per_page=100&page=1&orderby=count&order=desc&_fields=slug,name,count");
    data = { genres: (Array.isArray(list) ? list : []).filter((t) => t?.slug && Number(t.count ?? 1) > 0)
      .map((t) => ({ id: String(t.slug), name: decodeEnt(String(t.name || t.slug)) })).sort((a, b) => a.name.localeCompare(b.name)), status: ["ongoing", "completed", "hiatus"], maxGenres: 10 };
  } else {
    const j = await westApi("/api/contents/genres");
    data = { genres: (j?.data || []).filter((g: any) => g?.id != null).map((g: any) => ({ id: String(g.id), name: String(g.name || g.slug) })).sort((a: any, b: any) => a.name.localeCompare(b.name)),
      status: ["ongoing", "completed", "hiatus"], maxGenres: 10 };
  }
  if (data.genres.length) filterCache.set(src, { at: Date.now(), data });
  return data;
}

async function detail(src: Source, id: string): Promise<Detail> {
  if (src === "shinigami") return await shngDetail(id);
  if (src === "komiku") return await komikuDetail(id);
  if (src === "kiryuu") return await kiryuuDetail(id);
  return await westDetail(id);
}
async function chaptersOf(src: Source, id: string): Promise<Chapter[]> {
  if (src === "shinigami") return await shngChapters(id);
  if (src === "kiryuu") return await kiryuuChapters(id);
  return (await detail(src, id)).chapters;
}
async function pages(src: Source, chapterId: string) {
  const r = src === "shinigami" ? await shngPages(chapterId) : src === "komiku" ? await komikuPages(chapterId) : src === "kiryuu" ? await kiryuuPages(chapterId) : await westPages(chapterId);
  if (!r.images.length) throw webErr("Tidak menemukan gambar di chapter ini. Mungkin chapter terkunci atau situsnya berubah.", 422);
  return { ref: r.ref, images: await Promise.all(r.images.map(async (u) => ({ u, p: await signImg(u, r.ref) }))) };
}

/* ---------- Firebase Cloud Messaging ---------- */
let fcmAuth: { token: string; exp: number; project: string } | null = null;
const b64url = (x: string | Uint8Array) => {
  const bytes = typeof x === "string" ? new TextEncoder().encode(x) : x;
  let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
async function fcmToken() {
  if (fcmAuth && Date.now() < fcmAuth.exp - 60e3) return fcmAuth;
  const raw = Deno.env.get("FCM_SERVICE_ACCOUNT");
  if (!raw) throw new Error("FCM_SERVICE_ACCOUNT missing: isi secret ini di Edge Functions → Secrets (Langkah 6).");
  let sa: any; try { sa = JSON.parse(raw); } catch { throw new Error("FCM_SERVICE_ACCOUNT bukan JSON yang valid. Tempel seluruh isi file kunci dari { sampai }."); }
  const pem = String(sa.private_key || "").replace(/\\n/g, "\n").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." + b64url(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: unsigned + "." + b64url(sig) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Login FCM gagal: ${j.error_description || j.error || r.status}`);
  fcmAuth = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000, project: String(sa.project_id) };
  return fcmAuth;
}
type Push = { title: string; body: string; url: string; tag: string; image?: string };
async function fcmSend(token: string, p: Push) {
  const a = await fcmToken();
  const message = {
    token,
    notification: { title: p.title, body: p.body, ...(p.image && /^https:\/\//.test(p.image) ? { image: p.image } : {}) },
    data: { url: p.url, tag: p.tag },
    android: { priority: "HIGH", ttl: "21600s", notification: { channel_id: "ninokuu", tag: p.tag, sound: "default", default_vibrate_timings: true } },
  };
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${a.project}/messages:send`, {
    method: "POST", headers: { Authorization: "Bearer " + a.token, "Content-Type": "application/json" }, body: JSON.stringify({ message }),
  });
  if (r.ok) return;
  const t = await r.text();
  // hanya token yang benar-benar tidak terdaftar lagi yang dihapus (bukan 404 karena proyek/kunci salah)
  const gone = /UNREGISTERED|registration-token-not-registered/i.test(t);
  let msg = `FCM ${r.status}: ${t.replace(/\s+/g, " ").slice(0, 180)}`;
  if (/SENDER_ID_MISMATCH|SenderId mismatch/i.test(t)) msg = `Kunci FCM_SERVICE_ACCOUNT milik proyek Firebase "${a.project}", tapi aplikasi memakai proyek Firebase lain. Buat kunci dari proyek Firebase yang sama dengan google-services.json aplikasi.`;
  else if (r.status === 404 && !gone) msg = `Proyek Firebase "${a.project}" tidak ditemukan atau Firebase Cloud Messaging API belum aktif. Periksa FCM_SERVICE_ACCOUNT.`;
  else if (r.status === 403 && /PERMISSION_DENIED|cloudmessaging|disabled/i.test(t)) msg = `Firebase Cloud Messaging API belum aktif di proyek "${a.project}" atau kunci tidak punya izin.`;
  throw Object.assign(new Error(msg), { gone });
}
// kirim ke banyak token sekaligus (8 paralel); token mati dihapus dari tabel devices
async function pushTokens(tokens: string[], p: Push) {
  let sent = 0;
  const errors: string[] = [];
  for (let i = 0; i < tokens.length; i += 8) {
    await Promise.all(tokens.slice(i, i + 8).map(async (t) => {
      try { await fcmSend(t, p); sent++; }
      catch (e: any) {
        if (e?.gone) await admin.from("devices").delete().eq("token", t);
        else if (errors.length < 5 && !errors.includes(e?.message)) errors.push(String(e?.message || e));
      }
    }));
  }
  return { sent, errors };
}
async function tokensOf(userIds: string[]) {
  const out: string[] = [];
  for (let i = 0; i < userIds.length; i += 200) {
    const { data } = await admin.from("devices").select("token").in("user_id", userIds.slice(i, i + 200));
    (data || []).forEach((d: any) => out.push(d.token));
  }
  return out;
}

/* ---------- chapter baru → notifikasi ---------- */
const deepLink = (src: string, id: string) => `ninokuu://comic/${src}/${encodeURIComponent(id)}`;
async function notifyChapter(src: string, id: string, title: string, cover: string, ch: string) {
  const { data: fol } = await admin.from("library").select("user_id").eq("source", src).eq("comic_id", id).eq("notify", true);
  const users: string[] = [...new Set<string>((fol || []).map((f: any) => String(f.user_id)))];
  if (!users.length) return { users: 0, sent: 0 };
  const body = `Chapter ${ch} sudah rilis`;
  for (let i = 0; i < users.length; i += 500) {
    await admin.from("notifications").insert(users.slice(i, i + 500).map((u) => ({ user_id: u, title: title.slice(0, 200), body, source: src, comic_id: id, chapter: ch, cover })));
  }
  const r = await pushTokens(await tokensOf(users), { title, body, url: deepLink(src, id), tag: `ch:${src}:${id}`.slice(0, 100), image: cover });
  return { users: users.length, sent: r.sent };
}
// bandingkan daftar chapter dengan catatan terakhir; kirim notifikasi bila ada nomor yang lebih tinggi
async function applyChapters(src: Source, id: string, list: Chapter[], meta: { title: string; cover: string }, prev: any, opt: { maxJump?: number } = {}) {
  const top = newestChapter(list);
  const n = top ? chNum(top.ch) : null;
  const now = new Date().toISOString();
  const row: any = { source: src, comic_id: id, title: meta.title || prev?.title || "", cover: meta.cover || prev?.cover || null, checked_at: now, last_error: null };
  let notified: { users: number; sent: number } | null = null;
  if (n != null && (!prev || prev.last_num == null || n > Number(prev.last_num))) {
    if (prev && prev.last_num != null && opt.maxJump != null && n - Number(prev.last_num) > opt.maxJump) {
      row.last_error = `lompatan chapter mencurigakan (${prev.last_num} → ${n}), diabaikan`;
    } else {
      row.last_chapter = top.ch; row.last_num = n;
      // kunjungan pertama hanya mencatat; notifikasi baru dikirim saat ada chapter yang lebih baru
      if (prev && prev.last_num != null) notified = await notifyChapter(src, id, row.title, row.cover || "", String(top.ch));
    }
  }
  await admin.from("comic_state").upsert(row, { onConflict: "source,comic_id" });
  return { newest: top?.ch ?? null, notified };
}
async function checkChapters() {
  const { data: libs, error } = await admin.from("library").select("source, comic_id, title, cover").eq("notify", true).limit(20000);
  if (error) throw new Error("library: " + error.message);
  const comics = new Map<string, { source: Source; comic_id: string; title: string; cover: string }>();
  for (const l of libs || []) if ((SOURCES as readonly string[]).includes(l.source)) comics.set(l.source + "|" + l.comic_id, l as any);
  if (!comics.size) return { comics: 0, checked: 0, notified: 0 };
  const { data: states } = await admin.from("comic_state").select("*");
  const stateOf = new Map<string, any>((states || []).map((s: any) => [s.source + "|" + s.comic_id, s]));
  const queue = [...comics.entries()].sort((a, b) => {
    const ta = Date.parse(stateOf.get(a[0])?.checked_at || "") || 0, tb = Date.parse(stateOf.get(b[0])?.checked_at || "") || 0;
    return ta - tb;
  }).slice(0, CHECK_PER_RUN);
  let checked = 0, notified = 0;
  const errors: string[] = [];
  for (const [key, c] of queue) {
    const prev = stateOf.get(key);
    try {
      const r = await applyChapters(c.source, c.comic_id, await chaptersOf(c.source, c.comic_id), { title: c.title, cover: c.cover }, prev);
      checked++;
      if (r.notified) notified += r.notified.users;
    } catch (e: any) {
      const msg = String(e?.message || e).slice(0, 300);
      await admin.from("comic_state").upsert({ source: c.source, comic_id: c.comic_id, title: c.title || prev?.title || "", cover: c.cover || prev?.cover || null,
        last_chapter: prev?.last_chapter ?? null, last_num: prev?.last_num ?? null, checked_at: new Date().toISOString(), last_error: msg }, { onConflict: "source,comic_id" });
      if (errors.length < 5) errors.push(`${c.source}: ${msg}`);
    }
    await sleep(CHECK_DELAY);
  }
  return { comics: comics.size, checked, notified, errors };
}

/* ---------- pengumuman developer ---------- */
async function pushAnnouncements() {
  const { data: anns } = await admin.from("announcements").select("*").eq("push", true).is("pushed_at", null).order("created_at").limit(3);
  const out: any[] = [];
  for (const a of anns || []) {
    // tandai dulu agar tidak terkirim dua kali bila cron berjalan bersamaan
    const { data: claimed } = await admin.from("announcements").update({ pushed_at: new Date().toISOString() }).eq("id", a.id).is("pushed_at", null).select("id");
    if (!claimed?.length) continue;
    const { data: users } = await admin.from("profiles").select("id").eq("banned", false).limit(100000);
    const ids = (users || []).map((u: any) => u.id as string);
    for (let i = 0; i < ids.length; i += 500) {
      await admin.from("notifications").insert(ids.slice(i, i + 500).map((u: string) => ({ user_id: u, title: String(a.title).slice(0, 200), body: String(a.body || "Pengumuman dari Developer").slice(0, 500) })));
    }
    const tokens = (await tokensOf(ids)).slice(0, PUSH_MAX);
    const r = await pushTokens(tokens, { title: a.title, body: a.body || "Pengumuman dari Developer", url: "ninokuu://chat", tag: `ann:${a.id}` });
    out.push({ id: a.id, users: ids.length, sent: r.sent, errors: r.errors });
  }
  return out;
}

/* ---------- bersih-bersih ---------- */
async function cleanup() {
  const { data: paths, error } = await admin.rpc("chat_cleanup", { older_than: "30 days" });
  let images = 0;
  if (!error) {
    const files = (Array.isArray(paths) ? paths : []).map((p: any) => (typeof p === "string" ? p : p?.chat_cleanup)).filter((p: any) => typeof p === "string" && p);
    for (let i = 0; i < files.length; i += 100) { await admin.storage.from("chat-images").remove(files.slice(i, i + 100)); images += Math.min(100, files.length - i); }
  }
  const week = new Date(Date.now() - 7 * 864e5).toISOString();
  await admin.from("notifications").delete().lt("created_at", week);
  return { chatError: error?.message || null, images };
}

async function runCron(force: boolean) {
  const { data: st, error } = await admin.from("server_state").select("v").eq("k", "cron").maybeSingle();
  if (error) throw new Error("Tabel server_state belum ada. Jalankan ulang ninokuu-schema.sql versi terbaru. [" + error.message + "]");
  const last = Date.parse(st?.v?.at || "") || 0;
  if (!force && Date.now() - last < CRON_GAP) return { skipped: true, next_in_s: Math.ceil((CRON_GAP - (Date.now() - last)) / 1000) };
  const at = new Date().toISOString();
  await admin.from("server_state").upsert({ k: "cron", v: { at, running: true }, updated_at: at });
  const result: any = { at };
  for (const [k, fn] of [["chapters", checkChapters], ["announcements", pushAnnouncements], ["cleanup", cleanup]] as const) {
    try { result[k] = await (fn as () => Promise<unknown>)(); } catch (e: any) { result[k] = { error: String(e?.message || e) }; }
  }
  await admin.from("server_state").upsert({ k: "cron", v: { at, result }, updated_at: new Date().toISOString() });
  return result;
}

/* ---------- data chapter dari aplikasi (sumber yang memblokir server) ---------- */
const clip = (x: unknown, n: number) => String(x ?? "").slice(0, n);
function cleanChapters(x: unknown): Chapter[] {
  return (Array.isArray(x) ? x : []).slice(0, 3000).filter((c: any) => c && c.id).map((c: any) => ({
    id: clip(c.id, 300), ch: c.ch == null ? null : clip(c.ch, 20), title: clip(c.title, 150),
    at: c.at && !isNaN(Date.parse(c.at)) ? new Date(c.at).toISOString() : null, url: /^https:\/\//.test(String(c.url || "")) ? clip(c.url, 500) : "",
  }));
}

/* ---------- router ---------- */
const isSource = (s: unknown): s is Source => (SOURCES as readonly string[]).includes(String(s));
async function userOf(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await admin.auth.getUser(token);
  return data?.user || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  try {
    if (req.method === "GET") {
      const img = url.searchParams.get("img");
      if (img) return await proxyImage(img, url.searchParams.get("ref") || "", url.searchParams.get("sig") || "", url.searchParams.get("c") === "1");
      let fcmProject: string | null = null;
      try { fcmProject = JSON.parse(Deno.env.get("FCM_SERVICE_ACCOUNT") || "null")?.project_id || null; } catch { fcmProject = "json-tidak-valid"; }
      return json({ ok: true, name: NAME, version: VERSION, sources: SOURCES, serverKey: !!SERVICE_KEY, fcm: !!Deno.env.get("FCM_SERVICE_ACCOUNT"), fcmProject });
    }
    if (!SERVICE_KEY) return json({ error: "Edge Function tidak menemukan kunci server Supabase (SUPABASE_SERVICE_ROLE_KEY)." }, 500);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    // Dipanggil Supabase Cron tiap 15 menit. Dengan kunci server: selalu jalan; tanpa kunci: paling cepat tiap 10 menit.
    if (action === "cron") {
      const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      return json({ ok: true, ...(await runCron(!!bearer && bearer === SERVICE_KEY)) });
    }

    // Jelajah & baca: terbuka untuk tamu
    if (action === "browse" || action === "detail" || action === "pages" || action === "filters") {
      const src = body.source;
      if (!isSource(src)) return json({ error: "sumber tidak dikenal" }, 400);
      try {
        if (action === "browse") {
          const opt: Opt = {
            sort: body.sort === "popular" ? "popular" : "update",
            type: ["manga", "manhwa", "manhua"].includes(body.type) ? body.type : "",
            limit: Math.min(Math.max(5, Number(body.limit) || 20), 30),
            genres: (Array.isArray(body.genres) ? body.genres : []).map(String).filter((g: string) => /^[\w.-]{1,60}$/.test(g)).slice(0, src === "komiku" ? 2 : 10),
            status: ["ongoing", "completed", "hiatus"].includes(body.status) ? body.status : "",
          };
          const page = Math.min(Math.max(1, Number(body.page) || 1), 500);
          return json({ ok: true, source: src, page, ...(await browse(src, page, clip(body.q, 100).trim(), opt)) });
        }
        if (action === "filters") return json({ ok: true, source: src, ...(await filters(src)) });
        if (action === "detail") return json({ ok: true, source: src, ...(await detail(src, clip(body.comic_id, 2000))) });
        return json({ ok: true, source: src, ...(await pages(src, clip(body.chapter_id, 2000))) });
      } catch (e: any) {
        return json({ error: e?.message || String(e), blocked: !!e?.blocked }, e?.status || 502);
      }
    }

    const user = await userOf(req);
    if (!user) return json({ error: "Masuk dulu untuk memakai fitur ini." }, 401);

    // APK melaporkan daftar chapter dari sumber yang menolak server (Shinigami/WestManga)
    if (action === "report_chapters") {
      const src = body.source, id = clip(body.comic_id, 600);
      if (!isSource(src) || !BLOCKED.includes(src)) return json({ error: "sumber ini dicek langsung oleh server" }, 400);
      const { data: lib } = await admin.from("library").select("title, cover").eq("user_id", user.id).eq("source", src).eq("comic_id", id).maybeSingle();
      if (!lib) return json({ error: "Komik ini tidak ada di koleksimu" }, 404);
      const { data: prev } = await admin.from("comic_state").select("*").eq("source", src).eq("comic_id", id).maybeSingle();
      if (prev?.checked_at && Date.now() - Date.parse(prev.checked_at) < 5 * 60e3) return json({ ok: true, skipped: true });
      const list = cleanChapters(body.chapters);
      if (!list.length) return json({ ok: true, found: 0 });
      return json({ ok: true, ...(await applyChapters(src, id, list, { title: lib.title, cover: lib.cover || "" }, prev, { maxJump: 20 })) });
    }

    // Tes notifikasi ke HP sendiri (Lainnya → Kirim tes / Panel developer)
    if (action === "test_push") {
      const tokens = await tokensOf([user.id]);
      if (!tokens.length) return json({ ok: false, devices: 0, error: "HP ini belum terdaftar untuk notifikasi. Buka aplikasi, izinkan notifikasi, lalu coba lagi." }, 404);
      let r: { sent: number; errors: string[] };
      try { r = await pushTokens(tokens, { title: "Tes notifikasi Ninokuu", body: "Notifikasi chapter baru akan muncul seperti ini.", url: "ninokuu://home", tag: "test" }); }
      catch (e: any) { return json({ ok: false, devices: tokens.length, sent: 0, error: String(e?.message || e) }); }
      return json({ ok: r.sent > 0, devices: tokens.length, ...r, ...(r.sent ? {} : { error: r.errors[0] || "HP ini tidak lagi terdaftar di Firebase. Buka aplikasi lalu coba lagi." }) });
    }

    // Developer: jalankan cron sekarang (mengabaikan jeda 10 menit)
    if (action === "run_cron") {
      const { data: me } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
      if (me?.role !== "developer") return json({ error: "khusus developer" }, 403);
      return json({ ok: true, ...(await runCron(true)) });
    }

    return json({ error: "action tidak dikenal" }, 400);
  } catch (e: any) {
    console.error(e);
    return json({ error: e?.message || String(e) }, e?.status && e.status >= 400 && e.status < 600 ? e.status : 500);
  }
});
