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

const VERSION = "1.7.0";
const NAME = "ninokuu-api";
const SOURCES = ["komiku", "kiryuu", "shinigami", "westmanga"] as const;
type Source = typeof SOURCES[number];
// sumber yang sering menolak server (Cloudflare); aplikasi APK boleh melaporkan chapter-nya sendiri
const BLOCKED: Source[] = ["shinigami", "westmanga"];
// sumber yang chapter-nya boleh dilaporkan HP (lewat aplikasi terbuka atau cek latar belakang): yang selalu menolak
// server, plus Komiku (sejak Nov 2026 Cloudflare Komiku menolak server Supabase & Vercel; cron tetap mencoba)
const REPORTABLE: Source[] = [...BLOCKED, "komiku"];
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
// Nama function diambil dari alamat permintaan: kode yang sama dipasang sebagai ninokuu-api (global)
// dan ninokuu-api-dev (Ninokuu Dev). Alamat proxy gambar menunjuk ke function yang sedang dipakai.
let FN_NAME = NAME;
let SELF = `${SUPABASE_URL}/functions/v1/${FN_NAME}`;
const IS_DEV = () => FN_NAME.endsWith("-dev");

/* ---------- fetch aman ---------- */
const WEB_UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const WEB_MAX_HTML = 8 * 1024 * 1024;      // dibaca bertahap; HTML yang lebih besar dipotong, JSON ditolak (batas memori Edge Function)
const WEB_MAX_IMG = 30 * 1024 * 1024;
const CUT_MARK = "\n<!-- dipotong Ninokuu -->";
const webErr = (msg: string, status = 502) => Object.assign(new Error(msg), { status });

async function fetchT(u: string | URL, init: RequestInit, timeoutMs?: number) {
  const ctl = new AbortController();
  // init.signal = pembatalan dari klien: bila klien putus, permintaan ke situs sumber (dan bacaan isinya) ikut dihentikan
  const ext = init.signal;
  if (ext) { if (ext.aborted) ctl.abort(); else ext.addEventListener("abort", () => ctl.abort(), { once: true }); }
  const t = timeoutMs ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try { return await fetch(u, { ...init, signal: ctl.signal }); }
  catch (e: any) {
    if (ext?.aborted) throw webErr("dibatalkan", 499);
    throw webErr(e?.name === "AbortError" ? `timeout ${timeoutMs} ms` : `jaringan: ${e?.message || e}`);
  }
  finally { if (t) clearTimeout(t); }
}
// ikuti pengalihan (redirect) sendiri, maks. 5 kali: setiap tujuan dicek safeUrl SEBELUM diminta,
// jadi situs luar tidak bisa mengalihkan server ke alamat internal
async function fetchSafe(u: URL, init: RequestInit, timeoutMs?: number): Promise<{ r: Response; url: URL }> {
  let cur = u, opt: RequestInit = { ...init, redirect: "manual" };
  for (let hop = 0; hop <= 5; hop++) {
    await assertPublicHost(cur);
    const r = await fetchT(cur, opt, timeoutMs);
    const loc = r.status >= 300 && r.status < 400 ? r.headers.get("Location") : null;
    if (!loc) return { r, url: cur };
    await r.body?.cancel().catch(() => {});
    cur = safeUrl(new URL(loc, cur).href);
    const m = String(opt.method || "GET").toUpperCase();
    if (r.status === 303 || ((r.status === 301 || r.status === 302) && m !== "GET" && m !== "HEAD")) opt = { ...opt, method: "GET", body: undefined };
  }
  throw webErr("Terlalu banyak pengalihan (redirect)", 400);
}
// baca isi balasan sedikit demi sedikit sampai batas: komik dengan ribuan chapter bisa membuat halaman
// sangat besar. HTML dipotong di batas (bagian awal sudah berisi info komik & chapter terbaru), JSON ditolak.
async function readCapped(r: Response, max: number, strict: boolean): Promise<string> {
  if (!r.body) return "";
  // potongan langsung diubah jadi teks (tidak menyimpan salinan byte), supaya hemat memori
  const rd = r.body.getReader(), dec = new TextDecoder(), out: string[] = []; let n = 0, cut = false;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    if (n + value.length > max) {
      if (strict) { await rd.cancel().catch(() => {}); throw webErr("Data dari sumber terlalu besar untuk dimuat"); }
      out.push(dec.decode(value.subarray(0, max - n))); n = max; cut = true; await rd.cancel().catch(() => {}); break;
    }
    out.push(dec.decode(value, { stream: true })); n += value.length;
  }
  if (!cut) out.push(dec.decode());
  if (cut) out.push(CUT_MARK);
  return out.join("");
}
// tolak alamat lokal/privat agar server tidak bisa dipakai mengintip jaringan internal
function safeUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(String(raw).trim()); } catch { throw webErr("Link tidak valid", 400); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw webErr("Link harus diawali http(s)://", 400);
  // titik di ujung ("localhost." / "example.com.") adalah nama yang sama; buang dulu sebelum diperiksa
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (u.username || u.password) throw webErr("Link tidak boleh berisi nama pengguna/sandi", 400);
  if (!h.includes(".") || /(^|\.)(localhost|localdomain|local|internal|intranet|corp|lan|home|arpa|test|invalid|example|onion)$/.test(h)
    || /^[\d.]+$/.test(h) || /\.(\d+|0x[0-9a-f]+)$/.test(h) || h.includes(":") || /(^|\.)supabase\.(co|in|net)$/.test(h))
    throw webErr("Alamat ini tidak diizinkan", 400);
  if (u.port && !["80", "443"].includes(u.port)) throw webErr("Port tidak diizinkan", 400);
  if (u.hostname.replace(/^\[|\]$/g, "").toLowerCase() !== h) u.hostname = h;
  u.hash = "";
  return u;
}
// Alamat IP yang tidak boleh dituju server (loopback, privat, link-local, CGNAT, multicast, dll.)
function isPrivateIp(ip: string): boolean {
  const s = ip.toLowerCase();
  const v4 = s.match(/^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = +v4[1], b = +v4[2], c = +v4[3];
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && c === 0))) || (a === 198 && (b === 18 || b === 19));
  }
  const m = s.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);   // IPv4-mapped bentuk heksadesimal
  if (m) { const hi = parseInt(m[1], 16), lo = parseInt(m[2], 16); return isPrivateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`); }
  if (s === "::" || s === "::1") return true;
  return /^(fc|fd|fe[89a-f]|ff)/.test(s) || /^(64:ff9b:|2001:0?:|2001:db8:|2002:)/.test(s);
}
// Nama domain yang menunjuk ke IP privat (mis. 127.0.0.1) lolos pemeriksaan nama di safeUrl, jadi alamat hasil DNS
// diperiksa juga sebelum setiap permintaan (termasuk tiap pengalihan). Hasil aman disimpan 5 menit.
// Catatan: ini mengecilkan celah, bukan menutup total (DNS bisa berganti antara pemeriksaan dan koneksi).
const dnsOk = new Map<string, number>();
async function assertPublicHost(u: URL) {
  const h = u.hostname.replace(/^\[|\]$/g, "");
  if (isPrivateIp(h)) throw webErr("Alamat ini tidak diizinkan", 400);
  if ((dnsOk.get(h) || 0) > Date.now()) return;
  const resolve = (Deno as any).resolveDns;
  if (typeof resolve !== "function") return;   // runtime tanpa API DNS: hanya pemeriksaan nama
  const addrs: string[] = [];
  for (const type of ["A", "AAAA"]) {
    try { addrs.push(...((await resolve.call(Deno, h, type)) as string[])); } catch { /* tidak ada catatan jenis ini */ }
  }
  if (addrs.some(isPrivateIp)) throw webErr("Alamat ini tidak diizinkan", 400);
  if (dnsOk.size > 500) dnsOk.clear();
  dnsOk.set(h, Date.now() + 5 * 60e3);
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
  let r: Response, final: URL;
  try { ({ r, url: final } = await fetchSafe(u, { method: opt.method || "GET", headers, body: opt.body }, opt.timeout || 15000)); }
  catch (e: any) { if (e?.status === 400) throw e; throw webErr(`${u.hostname} tidak bisa dihubungi (${e.message})`); }
  const text = await readCapped(r, WEB_MAX_HTML, !!opt.json);
  if (!r.ok) {
    if ((r.status === 403 || r.status === 503) && /cloudflare|cf-ray|just a moment|challenge-platform/i.test(text + (r.headers.get("server") || "")))
      throw Object.assign(webErr(`${u.hostname} dilindungi Cloudflare dan menolak server.`, 403), { blocked: true });
    if (r.status === 404) throw webErr("Halaman tidak ditemukan (404)", 404);
    throw webErr(`${u.hostname} membalas HTTP ${r.status}`, r.status === 429 ? 429 : 502);
  }
  if (/<title>\s*Just a moment/i.test(text)) throw Object.assign(webErr(`${u.hostname} dilindungi Cloudflare dan menolak server.`, 403), { blocked: true });
  return { text, url: final.href, cut: text.endsWith(CUT_MARK), json: () => { try { return JSON.parse(text); } catch { throw webErr("Balasan server bukan JSON"); } } };
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
// Sampul Komiku: server gambarnya bisa mengecilkan sendiri (?w=lebar). Diukur 18-11-2026: sampul Solo Leveling
// asli 365 KB (720 px) → ?w=300 79 KB; Martial Peak 305 KB → 17 KB. Daftar memakai 300 px, halaman komik 500 px.
const komikuCover = (c: string, w = 300) => {
  if (!c) return c;
  try {
    const u = komikuImgHost(new URL(c)) || new URL(c);
    if (/^thumbnail\.komiku\./i.test(u.hostname)) { u.search = ""; u.searchParams.set("w", String(w)); }
    return u.href;
  } catch { return c; }
};
// thumbnail.komiku.to / .id / … → thumbnail.komiku.org (null bila bukan gambar Komiku di domain lain)
function komikuImgHost(u: URL): URL | null {
  const m = u.hostname.toLowerCase().match(/^(thumbnail|img|cover)\.komiku\.([a-z]+)$/);
  if (!m || m[2] === "org") return null;
  const x = new URL(u.href); x.hostname = `${m[1]}.komiku.org`; return x;
}
// Proxy gambar memakai kuota Egress Supabase (setiap byte gambar dikirim ulang dari server).
// Sejak 1.4.0 aplikasi memuat gambar langsung dari situs aslinya; proxy hanya cadangan bila itu gagal.
// Rem darurat lewat secret IMG_PROXY: "on" (bawaan) · "cover" (hanya sampul) · "off" (matikan semua).
const IMG_PROXY = (Deno.env.get("IMG_PROXY") || "on").trim().toLowerCase();
// batasi byte yang dialirkan ke klien: gambar yang ternyata lebih besar dari batas dihentikan di tengah jalan
function capStream(body: ReadableStream<Uint8Array>, max: number) {
  let n = 0;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) { n += chunk.length; if (n > max) ctl.error(new Error("gambar terlalu besar")); else ctl.enqueue(chunk); },
  }));
}
async function proxyImage(u: string, ref: string, sig: string, cover: boolean, signal?: AbortSignal) {
  if (IMG_PROXY === "off" || (IMG_PROXY === "cover" && !cover)) return json({ error: "proxy gambar dimatikan (IMG_PROXY)" }, 403);
  if (!u || !sig || !(await checkSig(u, ref, sig, cover))) return json({ error: "tanda tangan gambar tidak valid" }, 403);
  let url: URL;
  try { url = safeUrl(u); } catch (e: any) { return json({ error: e.message }, 400); }
  const get = (x: URL) => fetchSafe(x, { signal, headers: { "User-Agent": WEB_UA, Accept: "image/avif,image/webp,image/*,*/*;q=0.8", ...(ref ? { Referer: ref } : {}) } }, 25000).then((v) => v.r).catch(() => null);
  let r = await get(url);
  // server gambar Komiku di domain lain (mis. thumbnail.komiku.to) sering gagal → coba domain .org yang stabil
  const alt = komikuImgHost(url);
  if ((!r || !r.ok) && alt) { await r?.body?.cancel().catch(() => {}); r = await get(alt); }
  if (!r || !r.ok) return json({ error: `gagal memuat gambar${r ? " (" + r.status + ")" : ""}` }, 502);
  const type = r.headers.get("Content-Type") || "";
  // SVG dapat memuat skrip dan dilayani dari domain Supabase kita: tolak
  if ((!/^image\//i.test(type) && !/octet-stream/i.test(type)) || /svg/i.test(type)) { await r.body?.cancel().catch(() => {}); return json({ error: "bukan file gambar" }, 415); }
  const len = Number(r.headers.get("Content-Length"));
  if (Number.isFinite(len) && len > WEB_MAX_IMG) { await r.body?.cancel().catch(() => {}); return json({ error: "gambar terlalu besar" }, 413); }
  if (!r.body) return json({ error: "gambar kosong" }, 502);
  // dialirkan (tanpa menampung seluruh gambar di memori); Content-Length bisa dibohongi, jadi byte dihitung juga
  return new Response(capStream(r.body, WEB_MAX_IMG), { status: 200, headers: {
    ...CORS, "Content-Type": type || "image/jpeg", "Cache-Control": cover ? "public, max-age=604800" : "public, max-age=86400",
    "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox",
  } });
}

/* ---------- bantuan HTML ringan ---------- */
const decodeEnt = (s: string) => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
// ASCII saja yang dihuruf-kecilkan (panjang teks tetap sama, jadi indeksnya cocok dengan teks asli)
const lowerAscii = (s: string) => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
// Regex seperti <tag[\s\S]*?</tag> bisa menjadi kuadratik pada HTML yang sengaja tidak menutup tag. Dua pemindai di bawah
// memakai indexOf (waktu linear); tag tanpa penutup menghentikan pemindaian.
function dropBlocks(s: string, tag: string): string {
  if (!s.includes("<")) return s;
  const low = lowerAscii(s), out: string[] = []; let i = 0;
  for (;;) {
    const a = low.indexOf("<" + tag, i);
    if (a < 0) { out.push(s.slice(i)); break; }
    out.push(s.slice(i, a));
    const b = low.indexOf("</" + tag, a), c = b < 0 ? -1 : low.indexOf(">", b);
    if (c < 0) break;
    i = c + 1;
  }
  return out.join("");
}
function* tagPairs(html: string, tag: string): Generator<{ attrs: string; inner: string }> {
  const low = lowerAscii(html), open = "<" + tag, close = "</" + tag;
  let i = 0;
  for (;;) {
    const a = low.indexOf(open, i);
    if (a < 0) return;
    const after = low.charAt(a + open.length);
    if (after && !/[\s>/]/.test(after)) { i = a + open.length; continue; }   // bukan tag ini (mis. <table untuk "t")
    const gt = low.indexOf(">", a);
    if (gt < 0) return;
    const e = low.indexOf(close, gt + 1);
    if (e < 0) return;
    const e2 = low.indexOf(">", e);
    yield { attrs: html.slice(a + open.length, gt), inner: html.slice(gt + 1, e) };
    if (e2 < 0) return;
    i = e2 + 1;
  }
}
const stripTags = (s: string) => decodeEnt(dropBlocks(s, "script").replace(/<[^<>]+>/g, " ")).replace(/\s+/g, " ").trim();
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
// Urutan yang didukung tiap sumber (dari ekstensi Mihon/Keiyoushi; yang tidak didukung → "update"):
// komiku: update, popular · kiryuu: update, popular, az, za, rating · shinigami: update, popular, rating · westmanga: update, popular, az, za
type Sort = "update" | "popular" | "az" | "za" | "rating";
const SORTS: Record<string, Sort[]> = { komiku: ["update", "popular"], kiryuu: ["update", "popular", "az", "za", "rating"], shinigami: ["update", "popular", "rating"], westmanga: ["update", "popular", "az", "za"] };
type Opt = { sort: Sort; type: "" | "manga" | "manhwa" | "manhua"; limit: number; genres: string[]; status: Status };
type Chapter = { id: string; ch: string | null; title: string; at: string | null; url: string };
type Detail = { manga: { id: string; title: string; cover: string; desc: string; status: string; tags: string[]; author: string; url: string; views?: number | null; score?: number | null; publisher?: string }; chapters: Chapter[]; more?: { offset: number } | null };
// info tambahan (tiap sumber menamai field-nya berbeda; yang tidak ada dibiarkan kosong)
const normStatus = (s: unknown): string => {
  const t = String(s ?? "").toLowerCase();
  return /drop|cancel|discontinu|batal|berhenti/.test(t) ? "dropped" : /hiatus|jeda/.test(t) ? "hiatus"
    : /complet|tamat|end|finish|selesai/.test(t) ? "completed" : /ongoing|on going|berjalan|publishing|lanjut/.test(t) ? "ongoing" : "";
};
const toNum = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
  const m = String(v ?? "").trim().toLowerCase().replace(/\s+/g, "").match(/^([\d.,]+)(k|rb|ribu|m|jt|juta)?/);
  if (!m) return null;
  const mul = m[2] ? (/^(k|rb|ribu)$/.test(m[2]) ? 1e3 : 1e6) : 1;
  const n = mul > 1 ? parseFloat(m[1].replace(",", ".")) : parseFloat(m[1].replace(/[.,](?=\d{3}(\D|$))/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * mul) : null;
};
// skor/rating komik dari sumber (skala 10). 0–10 apa adanya, 10–100 dibagi 10; selain itu dianggap tidak ada.
const toScore = (v: unknown): number | null => {
  if (v && typeof v === "object") v = (v as any).average ?? (v as any).avg ?? (v as any).value ?? (v as any).score;
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").trim().replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  const x = n <= 10 ? n : n <= 100 ? n / 10 : NaN;
  return Number.isFinite(x) ? Math.round(x * 10) / 10 : null;
};
const SCORE_KEYS = ["user_rate", "rating", "score", "rate", "rating_avg", "avg_rating", "average_rating", "rating_value", "ratingValue", "star", "stars"];
const pickScore = (...objs: any[]): number | null => {
  for (const o of objs) if (o && typeof o === "object") for (const k of SCORE_KEYS) { const n = toScore(o[k]); if (n != null) return n; }
  return null;
};
// skor dari HTML (schema.org ratingValue, tema MangaThemesia "num", JSON-LD)
const scoreFromHtml = (h: string): number | null =>
  toScore(h.match(/itemprop=["']ratingValue["'][^>]*content=["']([\d.,]+)/i)?.[1] || h.match(/content=["']([\d.,]+)["'][^>]*itemprop=["']ratingValue/i)?.[1]
    || h.match(/itemprop=["']ratingValue["'][^>]*>\s*([\d.,]+)/i)?.[1] || h.match(/"ratingValue"\s*:\s*"?([\d.,]+)/i)?.[1]
    || h.match(/rating[\s\S]{0,300}?class=["'][^"']*\bnum\b[^"']*["'][^>]*>\s*([\d.,]+)\s*</i)?.[1] || "");
const VIEW_KEYS = ["view_count", "views_count", "total_views", "total_view", "views", "view", "viewer", "viewers", "read_count", "total_read", "readers", "post_views", "hits"];
const pickViews = (...objs: any[]): number | null => {
  for (const o of objs) if (o && typeof o === "object") for (const k of VIEW_KEYS) { const n = toNum(o[k]); if (n != null && n > 0) return n; }
  return null;
};
const PUB_KEY = /publisher|penerbit|serializ|serialis|magazine|majalah/i;
const pickPublisher = (o: any): string => {
  if (!o || typeof o !== "object") return "";
  for (const [k, v] of Object.entries(o)) if (PUB_KEY.test(k)) {
    const s = Array.isArray(v) ? v.map((x: any) => (typeof x === "string" ? x : x?.name)).filter(Boolean).join(", ") : typeof v === "string" ? v : (v as any)?.name || "";
    if (s) return decodeEnt(stripTags(String(s))).slice(0, 120);
  }
  return "";
};

/* ---------- Shinigami (API JSON) ---------- */
const SHNGM_API = Deno.env.get("SHNGM_API") || "https://api.shinigami.io";
const SHNGM_SITE = Deno.env.get("SHNGM_SITE") || "https://s1.shinigami.mx";
const shngJson = async (path: string) =>
  (await webFetch(SHNGM_API + path, { json: true, referer: SHNGM_SITE + "/", headers: { Origin: SHNGM_SITE, DNT: "1", "Sec-GPC": "1" } })).json();
const shngCover = (o: any) => String(o?.cover_portrait_url || o?.cover_image_url || "");
const SHNG_STATUS: Record<number, string> = { 1: "ongoing", 2: "completed", 3: "hiatus" };
const shngId = (id: string) => { if (!/^[\w-]{6,64}$/.test(id)) throw webErr("ID Shinigami tidak valid", 400); return id; };
async function shngBrowse(page: number, q: string, o: Opt) {
  const p = new URLSearchParams({ limit: String(o.limit), offset: String((page - 1) * o.limit), sort: o.sort === "popular" ? "popularity" : o.sort === "rating" ? "rating" : "latest", sort_order: "desc" });
  if (q) p.set("q", q);
  if (o.type) p.set("format", o.type);
  if (o.genres.length) { p.set("genre_include", o.genres.join(",")); p.set("genre_include_mode", "and"); }
  if (o.status) p.set("status", o.status);
  const j = await shngJson(`/v1/manga/list?${p}`);
  const items = await Promise.all((j?.data || []).filter((m: any) => m?.manga_id).map(async (m: any) => ({
    id: String(m.manga_id), title: String(m.title || ""), cover: await coverUrl(shngCover(m), SHNGM_SITE + "/"), type: o.type || "",
  })));
  const more = j?.meta?.has_next;
  return { items, hasNext: typeof more === "boolean" ? more : items.length >= o.limit };
}
async function shngChapters(id: string): Promise<Chapter[]> {
  // API baru: maks. 2000 per permintaan, sisanya lewat meta.next_cursor
  let all: any[] = [], cur = "";
  for (let i = 0; i < 10; i++) {
    const j = await shngJson(`/v1/chapter/${shngId(id)}/list?limit=2000${cur ? `&cursor=${encodeURIComponent(cur)}` : ""}`);
    all = all.concat(j?.data || []);
    cur = j?.meta?.has_next && j.meta.next_cursor ? String(j.meta.next_cursor) : "";
    if (!cur) break;
  }
  return all.filter((c: any) => c?.chapter_id).map((c: any) => ({
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
      status: SHNG_STATUS[Number(d.status)] || normStatus(d.status_name || d.status_label || d.status), tags: [...(tax.Genre || []), ...(tax.Format || [])].map((x: any) => x?.name).filter(Boolean).slice(0, 8),
      author: (tax.Author || []).map((x: any) => x?.name).filter(Boolean).join(", "), url: `${SHNGM_SITE}/series/${id}`,
      views: pickViews(d, d.stats, d.statistic), score: pickScore(d, d.stats, d.statistic), publisher: pickPublisher(tax) || pickPublisher(d),
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
    const img = komikuCover(imgSrc(b.match(/<img\b[^>]*>/i)?.[0] || "", KOMIKU_SITE).replace(/\?.*$/, ""), 300);
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
  // info komik ada di atas daftar chapter: cari di bagian itu saja (halaman komik ribuan chapter bisa berukuran MB)
  const listAt = h.search(/<table[^>]*id=["']Daftar_Chapter["']/i);
  const top = h.slice(0, Math.min(listAt > 0 ? listAt : h.length, 600000));
  const row = (label: string) => stripTags(top.match(new RegExp(`<td[^>]*>\\s*(?:<[^>]+>)*\\s*${label}[\\s\\S]*?<\\/td>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`, "i"))?.[1] || "");
  const title = stripTags(top.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "").replace(/^komik\s+/i, "") || metaContent(top, "og:title");
  const cover = imgSrc((block(top, /<div[^>]*class=["'][^"']*\bims\b[^"']*["'][^>]*>/i).match(/<img\b[^>]*>/i) || top.match(/<img\b[^>]*itemprop=["']image["'][^>]*>/i) || [""])[0], page.url).replace(/\?.*$/, "");
  const desc = stripTags(block(top, /<(?:section|div)[^>]*id=["']Sinopsis["'][^>]*>/i).match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || top.match(/<p[^>]*class=["']desc["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] || "");
  const tags = [...block(top, /<ul[^>]*class=["'][^"']*\bgenre\b[^"']*["'][^>]*>/i).matchAll(/<li[^>]*class=["'][^"']*\bgenre\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi)].map((x) => stripTags(x[1])).filter(Boolean);
  const st = row("Status").toLowerCase();
  const chapters = komikuRows(block(listAt >= 0 ? h.slice(listAt) : h, /<table[^>]*id=["']Daftar_Chapter["'][^>]*>/i), page.url);
  // halaman lebih dari batas (komik ribuan chapter, mis. Martial Peak): chapter lama ada di bagian yang dipotong.
  // Aplikasi mengambil sisanya lewat action "more_chapters" mulai dari byte setelah baris chapter terakhir yang utuh.
  const more = page.cut && listAt >= 0 ? komikuNext(h, 0) : null;
  return {
    manga: { id: page.url, title, cover: await coverUrl(komikuCover(cover, 500), page.url), desc, tags: tags.slice(0, 8),
      status: normStatus(st), author: row("(?:Pengarang|Komikus|Author)"), url: page.url,
      publisher: row("(?:Penerbit|Publisher|Serialisasi|Serialization)").slice(0, 120),
      views: toNum(row("(?:Pembaca|Dibaca|Dilihat|Views?)")) ?? toNum(stripTags(top).match(/([\d.,]+\s*(?:rb|ribu|jt|juta|k|m)?)\s*(?:x\s*)?(?:dibaca|pembaca|views?)\b/i)?.[1] || ""),
      score: toScore(row("(?:Skor|Score|Rating|Nilai)")) ?? scoreFromHtml(top) },
    chapters,
    more,
  };
}
// baris chapter Komiku (<tr> berisi td.judulseries) dari potongan HTML mana pun
function komikuRows(html: string, base: string): Chapter[] {
  const out: Chapter[] = [];
  for (const tr of tagPairs(html, "tr")) {
    if (!/class=["'][^"']*\bjudulseries\b/i.test(tr.inner)) continue;
    const a = tr.inner.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const url = abs(a[1], base), name = stripTags(a[2]);
    out.push({ id: url, ch: chNumFrom(name, url), title: chTitleFrom(name), url,
      at: komikuDate(stripTags(tr.inner.match(/class=["'][^"']*\btanggalseries\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)?.[1] || "")) });
  }
  return out;
}
// panjang UTF-8 tanpa membuat salinan byte (hemat memori)
function utf8Len(s: string, end = s.length) {
  let n = 0;
  for (let i = 0; i < end; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1; else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < end) { n += 4; i++; } else n += 3;
  }
  return n;
}
// posisi lanjutan: byte setelah baris chapter utuh terakhir; null bila tabel chapter sudah selesai di potongan ini
function komikuNext(text: string, start: number): { offset: number } | null {
  // baris terakhir bisa terpotong di tengah: pakai </tr> utuh terakhir yang berisi chapter
  const endRow = text.lastIndexOf("</tr>");
  if (endRow < 0 || text.lastIndexOf("judulseries", endRow) < 0) return null;
  if (/<\/table>/i.test(text.slice(endRow, endRow + 4000))) return null;
  return { offset: start + utf8Len(text, endRow + 5) };
}
const KOMIKU_CHUNK = 6 * 1024 * 1024;
const KOMIKU_OVERLAP = 8192;   // mundur sedikit supaya baris di batas potongan tidak terlewat (duplikat disaring aplikasi)
async function komikuMoreChapters(id: string, offset: number) {
  const url = safeUrl(komikuUrl(id));
  const from = Math.max(0, offset - KOMIKU_OVERLAP);
  const headers = { "User-Agent": WEB_UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "id-ID,id;q=0.9,en;q=0.8", Referer: KOMIKU_SITE + "/", Range: `bytes=${from}-` };
  let r: Response;
  try { ({ r } = await fetchSafe(url, { headers }, 20000)); }
  catch (e: any) { throw webErr(`${url.hostname} tidak bisa dihubungi (${e.message})`); }
  if (!r.ok || !r.body) { await r.body?.cancel().catch(() => {}); throw webErr(`${url.hostname} membalas HTTP ${r.status}`, 502); }
  // situs yang tidak mendukung Range mengirim halaman utuh (200): lewati byte yang sudah dibaca
  const skip = r.status === 206 ? 0 : from;
  const rd = r.body.getReader(), dec = new TextDecoder(), out: string[] = [];
  let seen = 0, got = 0, cut = false;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    let v = value;
    if (seen < skip) { const drop = Math.min(v.length, skip - seen); seen += drop; v = v.subarray(drop); if (!v.length) continue; }
    if (got + v.length > KOMIKU_CHUNK) { out.push(dec.decode(v.subarray(0, KOMIKU_CHUNK - got))); got = KOMIKU_CHUNK; cut = true; await rd.cancel().catch(() => {}); break; }
    out.push(dec.decode(v, { stream: true })); got += v.length;
  }
  if (!cut) out.push(dec.decode());
  if (seen < skip) return { chapters: [], more: null };
  const text = out.join("");
  return { chapters: komikuRows(text, url.href), more: cut ? komikuNext(text, from) : null };
}
async function komikuPages(id: string) {
  const page = await webFetch(komikuUrl(id), { referer: KOMIKU_SITE + "/" });
  if (!/(^|\.)komiku\.(org|to|id)$/.test(new URL(page.url).hostname)) throw webErr("Link bukan dari Komiku", 400);
  const box = block(page.text, /<(?:div|section)[^>]*id=["']Baca_Komik["'][^>]*>/i);
  return { ref: page.url, images: [...box.matchAll(/<img\b[^>]*>/gi)].map((m) => imgSrc(m[0], page.url)).filter((u) => u && !/komiku-promosi/i.test(u)) };
}

/* ---------- Kiryuu (WordPress NatsuId) ---------- */
const KIRYUU_SITE = (Deno.env.get("KIRYUU_SITE") || "https://v7.kiryuu.to").replace(/\/+$/, "");
const kiryuuJson = async (path: string) => (await webFetch(KIRYUU_SITE + path, { json: true, referer: KIRYUU_SITE + "/", headers: { "X-Requested-With": "XMLHttpRequest" } })).json();
const kiryuuTerms = (m: any, tax: string): string[] => ((m?._embedded?.["wp:term"] || []) as any[][]).find((g) => g?.[0]?.taxonomy === tax)?.map((t: any) => decodeEnt(String(t?.name || ""))) || [];
// Sampul Kiryuu: WordPress menyimpan beberapa ukuran. Diukur 18-11-2026 (Mercenary Enrollment): asli 480 px 56 KB,
// "medium" 231 px 26 KB, "card-thumbnail" 320 px 43 KB. Daftar memakai medium, halaman komik card-thumbnail.
const kiryuuCover = (m: any, size = "medium") => {
  const fm = m?._embedded?.["wp:featuredmedia"]?.[0];
  return String(fm?.media_details?.sizes?.[size]?.source_url || fm?.source_url || m?.yoast_head_json?.og_image?.[0]?.url || "");
};
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
  fd.set("order", o.sort === "az" ? "asc" : "desc"); fd.set("orderby", o.sort === "popular" ? "popular" : o.sort === "rating" ? "rating" : o.sort === "az" || o.sort === "za" ? "title" : "updated"); fd.set("query", q);
  const html = (await webFetch(`${KIRYUU_SITE}/wp-admin/admin-ajax.php?action=advanced_search`, { method: "POST", body: fd, referer: KIRYUU_SITE + "/", headers: { "X-Requested-With": "XMLHttpRequest" } })).text;
  if (/nonce|invalid|forbidden/i.test(html) && !/\/manga\//.test(html) && retry) return await kiryuuSearchPage(srcPage, q, o, false);
  const slugs: string[] = [];
  for (const m of tagPairs(html, "a")) {
    if (!/<img\b/i.test(m.inner)) continue;
    const slug = (attr("<a " + m.attrs + ">", "href") || "").match(/\/manga\/([^/?#]+)/)?.[1];
    if (slug && !slugs.includes(slug)) slugs.push(slug);
  }
  const hasNext = [...tagPairs(html, "button")].some((b) => /<svg/i.test(b.inner));
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
  for (const a of tagPairs(html, "a")) {
    if (!/<time\b/i.test(a.inner)) continue;
    const href = attr("<a " + a.attrs + ">", "href"); if (!href) continue;
    const url = abs(href, KIRYUU_SITE + "/");
    const span = (a.inner.match(/<span\b[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "").slice(0, 4000);
    const name = stripTags(span.replace(/<(\w+)\b[^>]*>[\s\S]*?<\/\1>/g, " ")) || stripTags(span);
    const dt = attr(a.inner.match(/<time\b[^>]*>/i)?.[0] || "", "datetime");
    const at = dt && !isNaN(Date.parse(dt)) ? new Date(dt).toISOString() : parseWebDate(stripTags(a.inner.match(/<time\b[^>]*>([\s\S]*?)<\/time>/i)?.[1] || ""));
    out.push({ id: url, ch: chNumFrom(name, url), title: chTitleFrom(name), at, url });
  }
  return out;
}
const KIRYUU_STATUS: Record<string, string> = { Ongoing: "ongoing", Completed: "completed", "On Hiatus": "hiatus", Cancelled: "dropped", Dropped: "dropped" };
async function kiryuuDetail(id: string): Promise<Detail> {
  const [m, chapters] = await Promise.all([kiryuuJson(`/wp-json/wp/v2/manga/${kiryuuId(id)}?_embed`), kiryuuChapters(id)]);
  if (!m?.id) throw webErr("Seri Kiryuu tidak ditemukan", 404);
  return {
    manga: {
      id, title: decodeEnt(stripTags(m.title?.rendered || "")), cover: await coverUrl(kiryuuCover(m, "card-thumbnail"), KIRYUU_SITE + "/"),
      desc: stripTags(String(m.content?.rendered || "").replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")).trim(),
      tags: [...kiryuuTerms(m, "genre"), ...kiryuuTerms(m, "type")].slice(0, 8), status: kiryuuTerms(m, "status").map((s) => KIRYUU_STATUS[s] || normStatus(s)).find(Boolean) || "",
      author: kiryuuTerms(m, "series-author").join(", "), url: m.link || `${KIRYUU_SITE}/manga/${m.slug}/`,
      views: pickViews(m, m.meta, m.acf), score: pickScore(m, m.meta, m.acf),
      publisher: ["series-publisher", "series-serialization", "serialization", "publisher"].map((t) => kiryuuTerms(m, t).join(", ")).find(Boolean) || pickPublisher(m.meta) || pickPublisher(m.acf),
    },
    chapters,
  };
}
// Hanya domain Kiryuu yang dikenal: domain dari KIRYUU_SITE (bagian "kiryuu.xxx" ke kanan) + secret KIRYUU_HOSTS
// (dipisah koma, mis. "kiryuu.id,kiryuu.co") bila situs pindah domain. Tanpa daftar ini siapa pun yang mendaftarkan
// "kiryuu.apa-saja" bisa membuat server menandatangani gambar dari halaman buatannya.
const KIRYUU_HOSTS = (() => {
  const out: string[] = [];
  try {
    const labels = new URL(KIRYUU_SITE).hostname.toLowerCase().split(".");
    const i = labels.findIndex((l) => l === "kiryuu");
    out.push(labels.slice(i >= 0 ? i : 0).join("."));
  } catch { /* KIRYUU_SITE tidak valid: hanya KIRYUU_HOSTS */ }
  (Deno.env.get("KIRYUU_HOSTS") || "").split(",").map((x) => x.trim().toLowerCase().replace(/^\.+/, "")).filter(Boolean).forEach((x) => out.push(x));
  return out;
})();
const kiryuuHostOk = (h: string) => KIRYUU_HOSTS.some((d) => h === d || h.endsWith("." + d));
async function kiryuuPages(id: string) {
  const u = safeUrl(id);
  if (!kiryuuHostOk(u.hostname)) throw webErr("Link bukan dari Kiryuu", 400);
  const page = await webFetch(u.href, { referer: KIRYUU_SITE + "/" });
  // pengalihan ke domain lain tidak boleh lolos: gambar yang ditandatangani harus dari halaman Kiryuu sungguhan
  if (!kiryuuHostOk(new URL(page.url).hostname)) throw webErr("Link bukan dari Kiryuu", 400);
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
  const p = new URLSearchParams({ page: String(page), per_page: String(o.limit), type: "Comic", orderBy: o.sort === "popular" ? "Popular" : o.sort === "az" ? "Az" : o.sort === "za" ? "Za" : "Update" });
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
      status: WEST_STATUS[String(d.status || "").toLowerCase()] || normStatus(d.status), author: String(d.author || ""), url: `${westBase}/comic/${d.slug}`,
      views: pickViews(d, d.stats), score: pickScore(d, d.stats), publisher: pickPublisher(d),
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
// canLearn: ukuran halaman sumber hanya dipelajari dari penelusuran tanpa kata kunci/filter, supaya satu
// permintaan khusus tidak meracuni cache untuk semua orang.
async function windowed(src: string, page: number, limit: number, fetchPage: (sp: number) => Promise<{ items: any[]; hasNext: boolean }>, canLearn = true) {
  const cache = new Map<number, { items: any[]; hasNext: boolean }>();
  const get = async (sp: number) => { if (!cache.has(sp)) cache.set(sp, await fetchPage(sp)); return cache.get(sp)!; };
  const start = (page - 1) * limit, end = start + limit;
  let per = srcPerPage[src];
  if (!per) {
    const f = await get(1);
    if (!f.hasNext) return { items: f.items.slice(start, end), hasNext: f.items.length > end };
    per = Math.min(100, Math.max(1, f.items.length));
    if (canLearn) srcPerPage[src] = per;
  }
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
  const plain = !q && !o.genres.length && !o.type && !o.status;
  if (src === "komiku") return await windowed("komiku", page, o.limit, (sp) => komikuPage(sp, q, o), plain);
  if (src === "kiryuu") return await windowed("kiryuu", page, o.limit, (sp) => kiryuuSearchPage(sp, q, o), plain);
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
  // INVALID_ARGUMENT dipakai FCM juga untuk muatan yang salah, jadi hanya yang menyebut token tidak valid yang dihapus
  const gone = /UNREGISTERED|registration-token-not-registered|not a valid FCM registration token/i.test(t);
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
// PostgREST membatasi satu balasan (db-max-rows, bawaan 1000 baris) tanpa pemberitahuan: daftar yang lebih panjang
// terpotong diam-diam. fetchAll membaca halaman demi halaman sampai habis; query WAJIB punya order() yang tetap.
async function fetchAll<T = any>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, max = 50000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max;) {
    const { data, error } = await q(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...data); from += data.length;
  }
  return out;
}
// maks. 10 perangkat per akun (dijaga database), jadi 100 akun per kueri tetap di bawah batas 1000 baris
async function tokensOf(userIds: string[]) {
  const out: string[] = [];
  for (let i = 0; i < userIds.length; i += 100) {
    const { data } = await admin.from("devices").select("token").in("user_id", userIds.slice(i, i + 100)).order("token").limit(1000);
    (data || []).forEach((d: any) => out.push(d.token));
  }
  return out;
}

/* ---------- chapter baru → notifikasi ---------- */
// gambar notifikasi diunduh oleh setiap HP penerima: pakai alamat asli sampul, bukan proxy (hemat Egress)
const rawImg = (u: string) => { try { const x = new URL(u); return /\/functions\/v1\/ninokuu-api(-dev)?$/.test(x.pathname) && x.searchParams.get("img") || u; } catch { return u; } };
const deepLink = (src: string, id: string) => `ninokuu://comic/${src}/${encodeURIComponent(id)}`;
// Gambar notifikasi diunduh oleh HP penerima, jadi hanya host sampul sumber yang dikenal (https, dan akar domainnya
// salah satu kata kunci di bawah atau domain di secret IMG_HOSTS) yang dipakai; selain itu notifikasi tanpa gambar.
const IMG_ROOTS = ["komiku", "kiryuu", "shngm", "shinigami", "westmanga"];
const IMG_EXTRA = (Deno.env.get("IMG_HOSTS") || "").split(",").map((x) => x.trim().toLowerCase().replace(/^\.+/, "")).filter(Boolean);
function imgHostOk(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
    const h = u.hostname.toLowerCase().replace(/\.+$/, ""), l = h.split(".");
    if (l.length < 2 || /^[\d.]+$/.test(h) || h.includes(":")) return false;
    // akar domain = label sebelum TLD; untuk TLD dua huruf dengan SLD umum (co.id, com.sg) satu label lebih ke kiri
    const sld = l.length >= 3 && l[l.length - 1].length === 2 && ["co", "com", "or", "ac", "go", "net", "org"].includes(l[l.length - 2]);
    if (IMG_ROOTS.includes(l[l.length - (sld ? 3 : 2)])) return true;
    return IMG_EXTRA.some((d) => h === d || h.endsWith("." + d));
  } catch { return false; }
}
async function notifyChapter(src: string, id: string, ch: string) {
  // Judul & sampul diambil dari koleksi MASING-MASING penerima. Satu pengguna tidak bisa menaruh judul/gambar
  // buatannya ke notifikasi orang lain.
  const fol = await fetchAll<any>((a, b) => admin.from("library").select("user_id,title,cover").eq("source", src).eq("comic_id", id).eq("notify", true)
    .order("user_id").range(a, b));
  const groups = new Map<string, { title: string; cover: string; users: string[] }>();
  const seen = new Set<string>();
  for (const f of fol) {
    const uid = String(f.user_id);
    if (seen.has(uid)) continue;
    seen.add(uid);
    const title = clip(f.title, 200).trim() || "Chapter baru";
    const cover = imgHostOk(rawImg(String(f.cover || ""))) ? clip(f.cover, 1000) : "";
    const k = title + "\n" + cover;
    (groups.get(k) || groups.set(k, { title, cover, users: [] }).get(k)!).users.push(uid);
  }
  if (!seen.size) return { users: 0, sent: 0 };
  const body = `Chapter ${clip(ch, 40)} sudah rilis`;
  let sent = 0;
  for (const g of groups.values()) {
    for (let i = 0; i < g.users.length; i += 500) {
      await admin.from("notifications").insert(g.users.slice(i, i + 500).map((u) => ({ user_id: u, title: g.title, body, source: src, comic_id: id, chapter: clip(ch, 40), cover: g.cover || null })));
    }
    const r = await pushTokens(await tokensOf(g.users), { title: g.title, body, url: deepLink(src, id), tag: `ch:${src}:${id}`.slice(0, 100), image: g.cover ? rawImg(g.cover) : undefined });
    sent += r.sent;
  }
  return { users: seen.size, sent };
}
// Nomor chapter dari sumber luar dibersihkan: hanya angka wajar (0 – 99999), dibulatkan 2 desimal.
const safeNum = (ch: unknown): number | null => { const n = chNum(ch); return n != null && n >= 0 && n < 100000 ? Math.round(n * 100) / 100 : null; };
// Klaim atomik di database (claim_chapter): dua cron / dua pelapor serentak tidak bisa sama-sama mengirim notifikasi.
// Hanya yang mendapat claimed = true yang mengirim. Kunjungan pertama hanya dicatat. Status chapter dimiliki server;
// judul/sampul dari pemanggil hanya dipakai saat baris dibuat dan tidak pernah dipakai untuk notifikasi orang lain.
async function claimAndNotify(src: Source, id: string, meta: { title: string; cover: string }, label: string | null, num: number | null, maxJump?: number) {
  const { data, error } = await admin.rpc("claim_chapter", {
    p_source: src, p_comic: id, p_title: clip(meta.title, 300), p_cover: meta.cover ? clip(meta.cover, 1000) : null,
    p_chapter: label == null ? null : clip(label, 40), p_num: num, p_max_jump: maxJump ?? null,
  });
  if (error) throw new Error("claim_chapter: " + error.message + " — jalankan ulang ninokuu-schema.sql versi terbaru di SQL Editor, lalu coba lagi.");
  const c = (data || {}) as { claimed?: boolean };
  const notified = c.claimed && label != null ? await notifyChapter(src, id, label) : null;
  return { newest: label, notified };
}
// bandingkan daftar chapter dengan catatan terakhir; kirim notifikasi bila ada nomor yang lebih tinggi
async function applyChapters(src: Source, id: string, list: Chapter[], meta: { title: string; cover: string }, opt: { maxJump?: number } = {}) {
  const top = newestChapter(list);
  const n = top ? safeNum(top.ch) : null;
  return await claimAndNotify(src, id, meta, top && n != null ? String(top.ch) : null, n, opt.maxJump);
}
async function checkChapters() {
  const libs = await fetchAll<any>((a, b) => admin.from("library").select("user_id, source, comic_id, title, cover").eq("notify", true)
    .order("user_id").order("source").order("comic_id").range(a, b), 20000);
  const byUser = new Map<string, any[]>();
  const comics = new Set<string>();
  for (const l of libs) {
    if (!(SOURCES as readonly string[]).includes(l.source)) continue;
    comics.add(l.source + "|" + l.comic_id);
    (byUser.get(l.user_id) || byUser.set(l.user_id, []).get(l.user_id)!).push(l);
  }
  if (!comics.size) return { comics: 0, checked: 0, notified: 0 };
  const states = await fetchAll<any>((a, b) => admin.from("comic_state").select("source, comic_id, checked_at").order("source").order("comic_id").range(a, b), 100000);
  const staleOf = new Map<string, number>(states.map((s: any) => [s.source + "|" + s.comic_id, Date.parse(s.checked_at || "") || 0]));
  const stale = (l: any) => staleOf.get(l.source + "|" + l.comic_id) ?? 0;
  // Antrean adil: tiap putaran mengambil komik paling lama tidak dicek dari TIAP pengguna secara bergiliran, jadi satu akun
  // dengan ratusan lonceng tidak bisa menghabiskan jatah (CHECK_PER_RUN) yang seharusnya dibagi rata.
  const lists = [...byUser.values()].map((a) => a.sort((x, y) => stale(x) - stale(y))).sort((a, b) => stale(a[0]) - stale(b[0]));
  const cur = lists.map(() => 0), picked = new Set<string>(), queue: any[] = [];
  for (let more = true; more && queue.length < CHECK_PER_RUN;) {
    more = false;
    for (let j = 0; j < lists.length && queue.length < CHECK_PER_RUN; j++) {
      while (cur[j] < lists[j].length && picked.has(lists[j][cur[j]].source + "|" + lists[j][cur[j]].comic_id)) cur[j]++;
      if (cur[j] >= lists[j].length) continue;
      const c = lists[j][cur[j]++];
      picked.add(c.source + "|" + c.comic_id); queue.push(c); more = true;
    }
  }
  let checked = 0, notified = 0;
  const errors: string[] = [];
  for (const c of queue) {
    try {
      const r = await applyChapters(c.source, c.comic_id, await chaptersOf(c.source, c.comic_id), { title: c.title, cover: c.cover });
      checked++;
      if (r.notified) notified += r.notified.users;
    } catch (e: any) {
      const msg = String(e?.message || e).slice(0, 300);
      // hanya waktu cek & galatnya yang dicatat; nomor chapter terakhir tidak disentuh (tidak bisa mundur lalu memicu notifikasi ganda)
      await admin.from("comic_state").upsert({ source: c.source, comic_id: c.comic_id, checked_at: new Date().toISOString(), last_error: msg }, { onConflict: "source,comic_id" });
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
    const users = await fetchAll<any>((x, y) => admin.from("profiles").select("id").eq("banned", false).order("id").range(x, y), 100000);
    const ids = users.map((u: any) => u.id as string);
    for (let i = 0; i < ids.length; i += 500) {
      // announcement_id: notifikasi ikut terhapus bila pengumuman ditarik developer
      const rows = ids.slice(i, i + 500).map((u: string) => ({ user_id: u, title: String(a.title).slice(0, 200), body: String(a.body || "Pengumuman dari Developer").slice(0, 500), announcement_id: a.id }));
      const { error } = await admin.from("notifications").insert(rows);
      // skema lama (belum ada kolom announcement_id) → simpan tanpa kolom itu
      if (error && /announcement_id/.test(error.message)) await admin.from("notifications").insert(rows.map(({ announcement_id: _x, ...r }: any) => r));
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
  // gambar yatim (tidak dipakai pesan mana pun, > 1 hari): hapus lewat Storage API, maks. 200 per jalan
  let orphans = 0;
  const { data: orph, error: orphErr } = await admin.rpc("chat_orphan_images", { p_limit: 200 });
  if (!orphErr) {
    const names = (Array.isArray(orph) ? orph : []).map((x: any) => (typeof x === "string" ? x : x?.chat_orphan_images)).filter((x: any) => typeof x === "string" && x);
    for (let i = 0; i < names.length; i += 100) {
      const { error: rmErr } = await admin.storage.from("chat-images").remove(names.slice(i, i + 100));
      if (!rmErr) orphans += Math.min(100, names.length - i);
    }
  }
  const week = new Date(Date.now() - 7 * 864e5).toISOString();
  await admin.from("notifications").delete().lt("created_at", week);
  await admin.from("chapter_reports").delete().lt("created_at", week);
  return { chatError: error?.message || null, images, orphans, orphanError: orphErr?.message || null };
}

async function runCron(force: boolean) {
  const at = new Date().toISOString();
  if (force) {
    await admin.from("server_state").upsert({ k: "cron", v: { at, running: true }, updated_at: at });
  } else {
    // klaim atomik: dua pemanggil serentak tidak bisa sama-sama menjalankan cron
    const { data: ok, error } = await admin.rpc("cron_claim", { p_key: "cron", p_gap: `${Math.round(CRON_GAP / 1000)} seconds` });
    if (error) throw new Error("cron_claim belum ada. Jalankan ulang ninokuu-schema.sql versi terbaru di SQL Editor. [" + error.message + "]");
    if (!ok) {
      const { data: st } = await admin.from("server_state").select("v").eq("k", "cron").maybeSingle();
      const last = Date.parse(st?.v?.at || "") || 0;
      return { skipped: true, next_in_s: Math.max(1, Math.ceil((CRON_GAP - (Date.now() - last)) / 1000)) };
    }
  }
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
const testPushAt = new Map<string, number>();
const isSource = (s: unknown): s is Source => (SOURCES as readonly string[]).includes(String(s));
// Laporan chapter dari HP (aplikasi terbuka atau cek latar belakang). Dipakai report_chapters & bg_report.
async function reportChapters(uid: string, body: any): Promise<Response> {
  const src = body.source, id = clip(body.comic_id, 600);
  if (!isSource(src) || !REPORTABLE.includes(src)) return json({ error: "sumber ini dicek langsung oleh server" }, 400);
  const { data: lib } = await admin.from("library").select("title, cover").eq("user_id", uid).eq("source", src).eq("comic_id", id).maybeSingle();
  if (!lib) return json({ error: "Komik ini tidak ada di koleksimu" }, 404);
  const { data: mine } = await admin.from("chapter_reports").select("created_at").eq("source", src).eq("comic_id", id).eq("user_id", uid).maybeSingle();
  if (mine?.created_at && Date.now() - Date.parse(mine.created_at) < 5 * 60e3) return json({ ok: true, skipped: true });
  const list = cleanChapters(body.chapters);
  if (!list.length) return json({ ok: true, found: 0 });
  const top = newestChapter(list), n = top ? safeNum(top.ch) : null;
  if (!top || n == null) return json({ ok: true, found: list.length, newest: null });
  const { error: upErr } = await admin.from("chapter_reports").upsert({ source: src, comic_id: id, user_id: uid, num: n, chapter: clip(top.ch, 40), created_at: new Date().toISOString() }, { onConflict: "source,comic_id,user_id" });
  if (upErr) return json({ error: "chapter_reports: " + upErr.message + " — jalankan ulang ninokuu-schema.sql versi terbaru." }, 500);
  const { count } = await admin.from("library").select("user_id", { count: "exact", head: true }).eq("source", src).eq("comic_id", id).eq("notify", true);
  const need = Math.min(2, Math.max(1, count || 1));
  const since = new Date(Date.now() - 24 * 3600e3).toISOString();
  const { data: reps } = await admin.from("chapter_reports").select("num, chapter").eq("source", src).eq("comic_id", id).gte("created_at", since)
    .order("num", { ascending: false }).limit(need);
  if (!reps || reps.length < need) return json({ ok: true, pending: true, newest: top.ch });
  const agreed = reps[need - 1];   // nomor tertinggi yang sudah dilaporkan setidaknya `need` orang berbeda
  return json({ ok: true, ...(await claimAndNotify(src, id, { title: lib.title, cover: lib.cover || "" }, String(agreed.chapter), Number(agreed.num), 20)) });
}
// Kunci cek latar belakang (per akun): HP menyimpannya untuk melapor chapter saat aplikasi ditutup, tanpa token
// login (token login kedaluwarsa & berganti; kunci ini hanya bisa membaca daftar komik berlonceng & melapor chapter).
async function sha256hex(t: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function bgUser(key: unknown): Promise<string | null> {
  const k = String(key || "");
  if (!/^[0-9a-f]{64}$/.test(k)) return null;
  const { data } = await admin.from("bg_keys").select("user_id").eq("key_hash", await sha256hex(k)).maybeSingle();
  if (data?.user_id) admin.from("bg_keys").update({ used_at: new Date().toISOString() }).eq("user_id", data.user_id).then(() => {}, () => {});
  return data?.user_id || null;
}
async function userOf(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await admin.auth.getUser(token);
  return data?.user || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const seg = url.pathname.split("/").filter(Boolean).find((x) => /^ninokuu-api(-dev)?$/.test(x));
  if (seg && seg !== FN_NAME) { FN_NAME = seg; SELF = `${SUPABASE_URL}/functions/v1/${FN_NAME}`; }
  try {
    if (req.method === "GET") {
      const img = url.searchParams.get("img");
      if (img) return await proxyImage(img, url.searchParams.get("ref") || "", url.searchParams.get("sig") || "", url.searchParams.get("c") === "1", req.signal);
      let fcmProject: string | null = null;
      try { fcmProject = JSON.parse(Deno.env.get("FCM_SERVICE_ACCOUNT") || "null")?.project_id || null; } catch { fcmProject = "json-tidak-valid"; }
      return json({ ok: true, name: FN_NAME, dev: IS_DEV(), version: VERSION, sources: SOURCES, serverKey: !!SERVICE_KEY, fcm: !!Deno.env.get("FCM_SERVICE_ACCOUNT"), fcmProject });
    }
    if (!SERVICE_KEY) return json({ error: "Edge Function tidak menemukan kunci server Supabase (SUPABASE_SERVICE_ROLE_KEY)." }, 500);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    // Dipanggil Supabase Cron tiap 15 menit. Dengan kunci server: selalu jalan; tanpa kunci: paling cepat tiap 10 menit.
    // Ninokuu Dev tidak menjalankan cron (notifikasi & pembersihan cukup dari function global, supaya tidak dobel)
    if ((action === "cron" || action === "run_cron") && IS_DEV()) return json({ ok: true, skipped: "dev" });
    if (action === "cron") {
      const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      return json({ ok: true, ...(await runCron(!!bearer && bearer === SERVICE_KEY)) });
    }

    // Jelajah & baca: terbuka untuk tamu
    if (action === "browse" || action === "detail" || action === "pages" || action === "filters" || action === "more_chapters" || action === "latest") {
      const src = body.source;
      if (!isSource(src)) return json({ error: "sumber tidak dikenal" }, 400);
      try {
        if (action === "browse") {
          const opt: Opt = {
            sort: (SORTS[src] || []).includes(body.sort) ? body.sort : "update",
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
        // chapter terbaru saja (untuk label "Terbaru" di Koleksi): jauh lebih kecil dari detail lengkap
        if (action === "latest") {
          const top = newestChapter(await chaptersOf(src, clip(body.comic_id, 2000)));
          return json({ ok: true, source: src, ch: top?.ch ?? null, at: top?.at ?? null });
        }
        if (action === "more_chapters") {
          const off = Number(body.offset);
          if (src !== "komiku") return json({ ok: true, source: src, chapters: [], more: null });
          if (!Number.isInteger(off) || off < 1 || off > 300 * 1024 * 1024) return json({ error: "offset tidak valid" }, 400);
          return json({ ok: true, source: src, ...(await komikuMoreChapters(clip(body.comic_id, 2000), off)) });
        }
        return json({ ok: true, source: src, ...(await pages(src, clip(body.chapter_id, 2000))) });
      } catch (e: any) {
        return json({ error: e?.message || String(e), blocked: !!e?.blocked }, e?.status || 502);
      }
    }

    // Cek latar belakang dari HP (aplikasi ditutup): daftar komik berlonceng yang perlu dicek HP, lalu laporannya
    if (action === "bg_list" || action === "bg_report") {
      const uid = await bgUser(body.key);
      if (!uid) return json({ error: "kunci latar belakang tidak valid" }, 401);
      if (action === "bg_report") return await reportChapters(uid, body);
      const { data } = await admin.from("library").select("source, comic_id").eq("user_id", uid).eq("notify", true).in("source", REPORTABLE).limit(40);
      return json({ ok: true, items: data || [] });
    }

    const user = await userOf(req);
    if (!user) return json({ error: "Masuk dulu untuk memakai fitur ini." }, 401);

    // buat (atau ganti) kunci cek latar belakang untuk HP ini; kunci lama otomatis tidak berlaku
    if (action === "bg_key") {
      const key = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
      const { error } = await admin.from("bg_keys").upsert({ user_id: user.id, key_hash: await sha256hex(key), created_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) return json({ error: "bg_keys: " + error.message + " — jalankan ulang ninokuu-schema.sql versi terbaru." }, 500);
      return json({ ok: true, key });
    }
    if (action === "bg_key_drop") { await admin.from("bg_keys").delete().eq("user_id", user.id); return json({ ok: true }); }

    // Staf menghapus gambar chat dengan kunci server. Moderator tidak punya izin Storage atas folder orang lain, jadi tanpa
    // ini gambar pesan yang disembunyikan / dihapus / milik akun yang diblokir tetap bisa dibuka lewat alamat publiknya.
    //  { paths: [...] }  → hanya gambar yang pesannya sudah disembunyikan atau sudah tidak ada
    //  { user_id }       → semua gambar akun yang sudah diblokir
    // Hierarki sama dengan mod_restrict: moderator hanya untuk pengguna biasa, developer juga untuk moderator.
    if (action === "purge_chat_images") {
      const { data: me } = await admin.from("profiles").select("role, banned").eq("id", user.id).maybeSingle();
      if (!me || me.banned || !["moderator", "developer"].includes(me.role)) return json({ error: "khusus moderator" }, 403);
      const roleOf = new Map<string, { role: string; banned: boolean } | null>();
      const allowed = async (uid: string) => {
        if (uid === user.id) return true;
        if (!roleOf.has(uid)) { const { data } = await admin.from("profiles").select("role, banned").eq("id", uid).maybeSingle(); roleOf.set(uid, data || null); }
        const t = roleOf.get(uid);
        return !t || t.role === "user" || (t.role === "moderator" && me.role === "developer");   // tanpa profil = akun sudah dihapus
      };
      const toRemove: string[] = []; let skipped = 0;
      if (typeof body.user_id === "string") {
        const uid = body.user_id;
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uid) || uid === user.id || !(await allowed(uid))) return json({ error: "tidak boleh menindak akun ini" }, 403);
        await allowed(uid);
        if (!roleOf.get(uid)?.banned) return json({ error: "akun ini belum diblokir" }, 409);
        for (let off = 0; off < 10000; off += 1000) {
          const { data: files, error: lsErr } = await admin.storage.from("chat-images").list(uid, { limit: 1000, offset: off });
          if (lsErr) return json({ error: "Storage: " + lsErr.message }, 502);
          (files || []).forEach((f: any) => { if (f?.name) toRemove.push(`${uid}/${f.name}`); });
          if ((files || []).length < 1000) break;
        }
      } else {
        const paths = [...new Set<string>((Array.isArray(body.paths) ? body.paths : []).map((x: unknown) => String(x)))].slice(0, 50);
        const valid = paths.filter((x) => /^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,200}$/.test(x));
        skipped += paths.length - valid.length;
        // pesan yang masih tampil tidak boleh kehilangan gambar lewat jalur ini
        const { data: live } = valid.length ? await admin.from("chat_messages").select("image_path").in("image_path", valid).eq("hidden", false) : { data: [] as any[] };
        const liveSet = new Set<string>((live || []).map((r: any) => String(r.image_path)));
        for (const x of valid) {
          if (liveSet.has(x) || !(await allowed(x.split("/")[0]))) skipped++; else toRemove.push(x);
        }
      }
      let removed = 0;
      for (let i = 0; i < toRemove.length; i += 100) {
        const { error: rmErr } = await admin.storage.from("chat-images").remove(toRemove.slice(i, i + 100));
        if (rmErr) return json({ ok: false, removed, skipped, error: "Storage: " + rmErr.message }, 502);
        removed += Math.min(100, toRemove.length - i);
      }
      return json({ ok: true, removed, skipped });
    }

    // APK melaporkan daftar chapter dari sumber yang menolak server (Shinigami/WestManga).
    // Laporan satu orang bisa salah/dipalsukan, jadi chapter baru baru diumumkan ke banyak orang setelah DUA pelapor berbeda
    // (atau satu, bila hanya satu orang yang memantau komik itu: dampaknya hanya ke dirinya) melaporkan nomor setinggi itu.
    if (action === "report_chapters") return await reportChapters(user.id, body);

    // Tes notifikasi ke HP sendiri (Lainnya → Kirim tes / Panel developer)
    if (action === "test_push") {
      // tiap tes memanggil FCM sekali per perangkat: maks. 1 tes per 30 detik per akun
      const nowMs = Date.now(), prevTest = testPushAt.get(user.id) || 0;
      if (nowMs - prevTest < 30e3) return json({ ok: false, error: `Tunggu ${Math.ceil((30e3 - (nowMs - prevTest)) / 1000)} detik sebelum tes lagi.` }, 429);
      if (testPushAt.size > 2000) testPushAt.clear();
      testPushAt.set(user.id, nowMs);
      // baca langsung (bukan tokensOf) supaya error izin database terlihat, tidak dikira "belum terdaftar"
      const { data: devs, error: dbErr } = await admin.from("devices").select("token").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(10);
      if (dbErr) return json({ ok: false, devices: 0, error: `Server tidak bisa membaca tabel devices (${dbErr.message}). Jalankan ulang ninokuu-schema.sql di SQL Editor.` }, 500);
      const tokens = (devs || []).map((d: any) => String(d.token));
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
