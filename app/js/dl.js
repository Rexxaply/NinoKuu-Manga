// Unduhan chapter untuk dibaca offline (khusus APK). Mengikuti desain canvas "Unduh chapter":
// pilih cepat / rentang / pilih sendiri, format CBZ · ZIP · Folder gambar, antrean dengan jeda & batal,
// daftar file di Favorit → Unduhan, hapus otomatis, dan baca file CBZ/ZIP dari HP.
// File disimpan di Documents/Ninokuu/<judul>/ (bisa dibuka aplikasi komik lain). Bila Android menolak,
// disimpan di folder data aplikasi.
import * as api from "./api.js";
import * as S from "./store.js";
import * as N from "./native.js";
import { esc, icon, $, $$, toast, cover } from "./ui.js";

/* ---------- penyimpanan & status ---------- */
const FMTS = ["CBZ", "ZIP", "Folder gambar"];
const FMT_HINT = {
  CBZ: "Satu file per chapter, bisa dibuka aplikasi komik lain (Mihon, Tachiyomi, dll).",
  ZIP: "Satu file ZIP per chapter berisi gambar halaman.",
  "Folder gambar": "Gambar disimpan langsung di folder per chapter.",
};
const AUTO_WHEN = ["Jangan", "Langsung", "1 hari", "7 hari"];
const MB_EST = 9;                                  // perkiraan ukuran per chapter (MB) bila belum ada data
const keyOf = (src, id, chId) => `${src}|${id}|${chId}`;
const idx = () => api.lsGet("dlIndex", {}) || {};
const saveIdx = (o) => api.lsSet("dlIndex", o);
// semua jalur tulis/hapus wajib berada di dalam Ninokuu/ (tanpa segmen kosong, "." atau "..")
const inNinokuu = (p) => typeof p === "string" && p.startsWith("Ninokuu/") && !p.split("/").some((s) => s === "" || s === "." || s === "..");
const shortHash = (s) => { let h = 5381; for (const c of String(s)) h = (((h << 5) + h) ^ c.charCodeAt(0)) >>> 0; return h.toString(36); };
// jalur sudah dipakai catatan lain (judul serupa, atau komik yang sama dari sumber lain)?
const taken = (dir, path, key) => Object.entries(idx()).some(([k, r]) => k !== key && r.dir === dir && r.path === path);
const queue = () => api.lsGet("dlQueue", []) || [];
const saveQueue = (q) => api.lsSet("dlQueue", q);
export const fmt = () => (FMTS.includes(api.lsGet("dlFmt")) ? api.lsGet("dlFmt") : "CBZ");
const autoWhen = () => (AUTO_WHEN.includes(api.lsGet("dlAutoWhen")) ? api.lsGet("dlAutoWhen") : "Jangan");
const autoOld = () => !!api.lsGet("dlAutoOld", false);
// detail.t: add (masuk antrean) · prog (halaman) · ch (1 chapter selesai) · done (1 komik selesai) · err · pause · resume · cancel
const emit = (d = {}) => window.dispatchEvent(new CustomEvent("nk:dl", { detail: d }));
const mbS = (b) => { if (b > 0 && b < 104858) return Math.max(1, Math.round(b / 1024)) + " KB"; const m = b / 1048576; return m >= 1000 ? (m / 1024).toFixed(1).replace(".", ",") + " GB" : (m < 10 ? m.toFixed(1).replace(".", ",") : Math.round(m)) + " MB"; };
const chLabel = (a, b) => (a === b ? `Ch. ${a}` : `Ch. ${a}–${b}`);
// nama aman untuk file/folder. Hasil yang hanya berisi titik ("." / "..") diganti, supaya judul dari sumber
// tidak bisa menjadi segmen "naik folder" di jalur Ninokuu/<judul>/…
const safe = (s) => { const r = String(s || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80); return /^[.\s]*$/.test(r) ? "Tanpa judul" : r; };
const pad = (n) => String(n).padStart(3, "0");
const numOf = (c) => parseFloat(c);

let FS = null;
function fs() {
  if (FS) return FS;
  const C = window.Capacitor;
  if (!N.isApp || !C) return null;
  FS = C.Plugins?.Filesystem || (C.isPluginAvailable?.("Filesystem") ? C.registerPlugin?.("Filesystem") : null) || null;
  return FS;
}
export const supported = () => !!fs();

// folder tujuan: Documents (bisa dibuka aplikasi lain) → bila ditolak, folder data aplikasi
let dirP = null;
function storeDir() {
  if (!dirP) dirP = (async () => {
    const f = fs();
    try { await f.requestPermissions?.(); } catch {}
    try { await f.writeFile({ path: "Ninokuu/.nomedia", data: "", directory: "DOCUMENTS", recursive: true }); return "DOCUMENTS"; }
    catch { await f.writeFile({ path: "Ninokuu/.nomedia", data: "", directory: "DATA", recursive: true }).catch(() => {}); return "DATA"; }
  })();
  return dirP;
}
export const where = async () => ((await storeDir()) === "DOCUMENTS" ? "Internal / Documents / Ninokuu" : "Penyimpanan aplikasi / Ninokuu");

// file teks (mis. backup .json): coba folder Documents/Ninokuu/Backup (terlihat di Pengelola File) → bila ditolak,
// penyimpanan aplikasi. Salinan juga ditaruh di cache, karena hanya file cache yang boleh dibagikan ke aplikasi lain.
// (Folder Documents/Ninokuu bisa sudah dibuat Ninokuu versi lain → file .nomedia-nya bukan milik aplikasi ini,
//  jadi untuk backup ditulis langsung tanpa mengandalkan cek folder unduhan.)
export async function saveText(name, text) {
  const f = fs(); if (!f) throw new Error("Penyimpanan HP tidak tersedia.");
  try { await f.requestPermissions?.(); } catch {}
  let where = "";
  try { await f.writeFile({ path: "Ninokuu/Backup/" + name, data: text, directory: "DOCUMENTS", encoding: "utf8", recursive: true }); where = "Internal / Documents / Ninokuu / Backup / " + name; }
  catch {
    try { await f.writeFile({ path: "Download/" + name, data: text, directory: "EXTERNAL_STORAGE", encoding: "utf8", recursive: true }); where = "Internal / Download / " + name; }
    catch { await f.writeFile({ path: "Ninokuu/Backup/" + name, data: text, directory: "DATA", encoding: "utf8", recursive: true }); where = ""; }
  }
  let uri = ""; try { uri = (await f.writeFile({ path: name, data: text, directory: "CACHE", encoding: "utf8" })).uri || ""; } catch {}
  return { where, uri };
}
export async function shareFile(uri, title) {
  const C = window.Capacitor, SH = C?.Plugins?.Share || (C?.isPluginAvailable?.("Share") ? C.registerPlugin?.("Share") : null);
  if (!SH || !uri) throw new Error("Tidak bisa membuka menu bagikan.");
  try { await SH.share({ title, files: [uri], dialogTitle: title }); }
  catch (e) { if (!/cancel/i.test(e?.message || "")) throw e; }
}

const b64 = (u8) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.onerror = no; r.readAsDataURL(new Blob([u8])); });
async function writeBytes(dir, path, u8) {
  if (!inNinokuu(path)) throw new Error("Jalur file tidak valid");
  const CH = 3 << 20;                              // potongan 3 MB (kelipatan 3 → base64 bisa disambung)
  await fs().writeFile({ path, data: await b64(u8.subarray(0, CH)), directory: dir, recursive: true });
  for (let o = CH; o < u8.length; o += CH) await fs().appendFile({ path, data: await b64(u8.subarray(o, o + CH)), directory: dir });
}
// Baca file sebagai data mentah lewat server lokal Capacitor (https://localhost/_capacitor_file_/…).
// readFile mengirim isi file sebagai teks base64 lewat jembatan plugin: file 50 MB jadi ±70 MB teks dan
// gagal di HP (CBZ/ZIP besar tidak bisa dibuka). Cara lama tetap dipakai sebagai cadangan.
async function readBytes(dir, path) {
  const C = window.Capacitor;
  if (C?.convertFileSrc) {
    try {
      const { uri } = await fs().getUri({ path, directory: dir });
      const r = await fetch(C.convertFileSrc(uri));
      if (r.ok) { const u8 = new Uint8Array(await r.arrayBuffer()); if (u8.length) return u8; }
    } catch {}
  }
  const r = await fs().readFile({ path, directory: dir });
  const d = r.data;
  if (d instanceof Blob) return new Uint8Array(await d.arrayBuffer());
  const bin = atob(d), u8 = new Uint8Array(bin.length);          // CSP melarang fetch("data:…")
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

/* ---------- ZIP (CBZ) : tulis tanpa kompresi, baca STORE & DEFLATE ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const concat = (parts) => { const n = parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
export function zipStore(files) {
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  const d = new Date(), t = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dd = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const nm = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, t, true); lh.setUint16(12, dd, true); lh.setUint32(14, crc, true); lh.setUint32(18, sz, true); lh.setUint32(22, sz, true); lh.setUint16(26, nm.length, true);
    parts.push(new Uint8Array(lh.buffer), nm, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, t, true); ch.setUint16(14, dd, true); ch.setUint32(16, crc, true); ch.setUint32(20, sz, true); ch.setUint32(24, sz, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), nm);
    off += 30 + nm.length + sz;
  }
  const cd = concat(central), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cd.length, true); end.setUint32(16, off, true);
  return concat([...parts, cd, new Uint8Array(end.buffer)]);
}
export async function unzip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let e = u8.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error("File ini bukan ZIP/CBZ yang valid.");
  const n = dv.getUint16(e + 10, true), dec = new TextDecoder(), out = [];
  let p = dv.getUint32(e + 16, true);
  for (let i = 0; i < n && dv.getUint32(p, true) === 0x02014b50; i++) {
    const meth = dv.getUint16(p + 10, true), csz = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    out.push({ name, meth, raw: u8.subarray(start, start + csz) });
  }
  return out;
}
const inflate = async (raw) => new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
const IMG_RE = /\.(jpe?g|png|webp|gif|avif)$/i;
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
const mimeOf = (name) => ({ png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif" })[name.split(".").pop().toLowerCase()] || "image/jpeg";
const extOf = (type) => ({ "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "image/avif": ".avif" })[String(type).split(";")[0].trim()] || ".jpg";
async function zipImages(u8) {
  const ents = (await unzip(u8)).filter((x) => IMG_RE.test(x.name) && !/(^|\/)__MACOSX\//.test(x.name)).sort((a, b) => natural(a.name, b.name));
  const out = [];
  for (const x of ents) {
    const data = x.meth === 0 ? x.raw : x.meth === 8 ? await inflate(x.raw) : null;
    if (data) out.push({ name: x.name, data });
  }
  return out;
}

/* ---------- ambil gambar halaman ---------- */
// Hemat kuota Supabase: unduh langsung dari situs aslinya. APK lewat jaringan HP (bisa kirim Referer),
// browser web tidak bisa (CORS & CSP), jadi di web tetap lewat proxy ninokuu-api. Di APK proxy hanya cadangan.
async function pageBytes(im, ref) {
  if (N.isApp) {
    try {
      const r = await N.nget(im.u, { type: "arraybuffer", headers: ref ? { Referer: ref } : {} });
      return { u8: new Uint8Array(r.bytes), type: r.type || "image/jpeg" };
    } catch (e) { if (!im.p) throw e; }
  }
  const r = await fetch(im.p ? api.pageUrl(im.p) : im.u);
  if (!r.ok) throw new Error(`Gambar gagal diunduh (HTTP ${r.status})`);
  return { u8: new Uint8Array(await r.arrayBuffer()), type: r.headers.get("content-type") || "image/jpeg" };
}
// Bagikan satu halaman chapter (tekan lama gambar di pembaca). APK: simpan di cache lalu lembar bagikan Android;
// web: Web Share API (file) atau unduh.
export async function sharePage(im, ref, name, text) {
  const { u8, type } = im.local ? await (async () => { const r = await fetch(im.u); return { u8: new Uint8Array(await r.arrayBuffer()), type: r.headers.get("content-type") || "image/jpeg" }; })()
    : await retry(() => pageBytes(im, ref), 2);
  const ext = /png/i.test(type) ? "png" : /webp/i.test(type) ? "webp" : /gif/i.test(type) ? "gif" : "jpg";
  const file = `${name}.${ext}`;
  const C = N.isApp ? window.Capacitor : null;
  if (C?.isPluginAvailable?.("Filesystem") && C.isPluginAvailable("Share")) {
    const f = fs() || C.Plugins?.Filesystem || C.registerPlugin?.("Filesystem"), SH = C.Plugins?.Share || C.registerPlugin?.("Share");
    const { uri } = await f.writeFile({ path: "share/" + file, data: await b64(u8), directory: "CACHE", recursive: true });
    try { await SH.share({ title: text, text, files: [uri], dialogTitle: "Bagikan halaman" }); }
    catch (e) { if (!/cancel/i.test(e?.message || "")) throw e; }
    return;
  }
  const blob = new Blob([u8], { type }), fl = new File([blob], file, { type });
  if (navigator.canShare?.({ files: [fl] })) { try { await navigator.share({ files: [fl], text }); } catch (e) { if (e?.name !== "AbortError") throw e; } return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast("Gambar disimpan ke Unduhan");
}
const retry = async (fn, n = 3) => { let e; for (let i = 0; i < n; i++) { try { return await fn(); } catch (x) { e = x; await new Promise((r) => setTimeout(r, 600 * (i + 1))); } } throw e; };

/* ---------- antrean ---------- */
const prog = {};                                    // jid → { page, pages } chapter yang sedang diunduh
let running = false, stopFlag = null;
const STOP = Symbol("stop");
export function jobPct(j) {
  const p = prog[j.jid], part = p && p.pages ? p.page / p.pages : 0;
  return Math.min(100, ((j.done + part) / Math.max(1, j.items.length)) * 100);
}
export const isQueued = (src, id, chId) => queue().some((j) => j.src === src && j.id === id && j.items.slice(j.done).some((x) => x.chId === chId));
export const isSaved = (src, id, chId) => !!idx()[keyOf(src, id, chId)];
export const savedOf = (src, id) => Object.values(idx()).filter((r) => r.src === src && r.id === id);

export function enqueue(d, src, id, chs) {
  const q = queue(), f = fmt();
  const items = chs.filter((c) => !isSaved(src, id, c.id) && !isQueued(src, id, c.id)).map((c) => ({ chId: c.id, ch: String(c.ch ?? "?") }));
  if (!items.length) { toast("Chapter yang dipilih sudah diunduh atau sudah di antrean."); return 0; }
  items.sort((a, b) => (numOf(a.ch) || 0) - (numOf(b.ch) || 0));
  q.push({ jid: Date.now() + Math.random().toString(36).slice(2, 6), src, id, title: d.manga.title, cover: d.manga.cover || "", fmt: f, items, done: 0, paused: false, err: "" });
  saveQueue(q);
  // simpan info komik seperlunya supaya chapter bisa dibuka saat offline
  api.lsSet(`dlDetail:${src}|${id}`, { manga: { id, title: d.manga.title, cover: d.manga.cover || "", tags: d.manga.tags || [] }, chapters: d.chapters.slice(0, 5000).map((c) => ({ id: c.id, ch: c.ch })) });
  emit({ t: "add" }); run();
  return items.length;
}
export function toggleJob(jid) {
  const q = queue(), j = q.find((x) => x.jid === jid); if (!j) return;
  j.paused = !j.paused; j.err = ""; saveQueue(q);
  if (j.paused && stopFlag?.jid === jid) stopFlag.stop = true;
  emit({ t: j.paused ? "pause" : "resume" }); if (!j.paused) run();
}
export function cancelJobs(jids) {
  const set = new Set(jids), q = queue();
  if (stopFlag && set.has(stopFlag.jid)) stopFlag.stop = true;
  saveQueue(q.filter((j) => !set.has(j.jid))); jids.forEach((k) => delete prog[k]); emit({ t: "cancel" });
}
export function run() {
  if (running || !supported()) return;
  running = true;
  (async () => {
    try {
      for (;;) {
        const j = queue().find((x) => !x.paused);
        if (!j) break;
        const it = j.items[j.done];
        if (!it) { finishJob(j.jid); continue; }
        stopFlag = { jid: j.jid, stop: false };
        try {
          await dlChapter(j, it, stopFlag);
          const q = queue(), cur = q.find((x) => x.jid === j.jid);
          if (cur) { cur.done++; cur.err = ""; saveQueue(q); }
          prog[j.jid] = null; emit({ t: "ch" });
        } catch (e) {
          if (e === STOP) { prog[j.jid] = null; emit({ t: "pause" }); continue; }
          const q = queue(), cur = q.find((x) => x.jid === j.jid);
          if (cur) { cur.paused = true; cur.err = e.message || "Gagal mengunduh"; saveQueue(q); }
          emit({ t: "err", title: j.title, cover: j.cover, err: e.message || "Gagal mengunduh" });
        }
      }
    } finally { running = false; stopFlag = null; }
  })();
}
function finishJob(jid) {
  const q = queue(), j = q.find((x) => x.jid === jid);
  saveQueue(q.filter((x) => x.jid !== jid)); delete prog[jid];
  emit(j ? { t: "done", title: j.title, cover: j.cover, n: j.items.length } : {});
}
async function dlChapter(j, it, flag) {
  const p = await retry(() => api.call("pages", { source: j.src, chapter_id: it.chId }));
  const imgs = p.images || []; if (!imgs.length) throw new Error("Chapter tidak berisi gambar");
  prog[j.jid] = { page: 0, pages: imgs.length }; emit({ t: "prog" });
  const files = [];
  for (let i = 0; i < imgs.length; i += 3) {
    if (flag.stop) throw STOP;
    const got = await Promise.all(imgs.slice(i, i + 3).map((im) => retry(() => pageBytes(im, p.ref))));
    got.forEach((g, k) => files.push({ name: pad(i + k + 1) + extOf(g.type), data: g.u8 }));
    prog[j.jid] = { page: Math.min(imgs.length, i + 3), pages: imgs.length }; emit({ t: "prog" });
  }
  if (flag.stop) throw STOP;
  const dir = await storeDir(), base = `Ninokuu/${safe(j.title)}`, name = `Chapter ${safe(it.ch)}`;
  const key = keyOf(j.src, j.id, it.chId), tag = ` [${safe(j.src)}-${shortHash(j.id)}]`;   // akhiran hanya dipakai bila jalur bentrok
  let path, bytes = files.reduce((a, f) => a + f.data.length, 0);
  if (j.fmt === "Folder gambar") {
    path = `${base}/${name}`; if (taken(dir, path, key)) path += tag;
    for (const f of files) await writeBytes(dir, `${path}/${f.name}`, f.data);
  } else {
    const info = `<?xml version="1.0" encoding="utf-8"?>\n<ComicInfo><Series>${esc(j.title)}</Series><Number>${esc(it.ch)}</Number><PageCount>${files.length}</PageCount><Web>${esc(j.src)}</Web></ComicInfo>`;
    const zip = zipStore(j.fmt === "CBZ" ? [...files, { name: "ComicInfo.xml", data: new TextEncoder().encode(info) }] : files);
    const ext = j.fmt === "CBZ" ? "cbz" : "zip";
    path = `${base}/${name}.${ext}`; if (taken(dir, path, key)) path = `${base}/${name}${tag}.${ext}`; bytes = zip.length;
    await writeBytes(dir, path, zip);
  }
  const o = idx();
  o[keyOf(j.src, j.id, it.chId)] = { src: j.src, id: j.id, title: j.title, cover: j.cover, chId: it.chId, ch: it.ch, fmt: j.fmt, dir, path, bytes, pages: files.length, at: Date.now(), openedAt: 0, readAt: 0 };
  saveIdx(o);
}

/* ---------- baca dari HP ---------- */
let liveUrls = [];
const revokeLive = () => { liveUrls.forEach((u) => URL.revokeObjectURL(u)); liveUrls = []; };
// halaman chapter yang sudah diunduh → daftar gambar lokal (atau null bila belum diunduh / file hilang)
export async function localPages(src, id, chId) {
  const r = idx()[keyOf(src, id, chId)];
  if (!r || !supported()) return null;
  revokeLive();
  try {
    let urls;
    if (r.fmt === "Folder gambar") {
      const ls = await fs().readdir({ path: r.path, directory: r.dir });
      const names = (ls.files || []).map((f) => (typeof f === "string" ? f : f.name)).filter((n) => IMG_RE.test(n)).sort(natural);
      const C = window.Capacitor;
      urls = await Promise.all(names.map(async (n) => {
        const { uri } = await fs().getUri({ path: `${r.path}/${n}`, directory: r.dir });
        return C?.convertFileSrc ? C.convertFileSrc(uri) : uri;
      }));
    } else {
      const imgs = await zipImages(await readBytes(r.dir, r.path));
      urls = imgs.map((x) => { const u = URL.createObjectURL(new Blob([x.data], { type: mimeOf(x.name) })); liveUrls.push(u); return u; });
    }
    if (!urls.length) return null;
    const o = idx(); if (o[keyOf(src, id, chId)]) { o[keyOf(src, id, chId)].openedAt = Date.now(); saveIdx(o); }
    return { ok: true, local: true, images: urls.map((u) => ({ u, local: true })) };
  } catch (e) {
    // file dihapus dari luar aplikasi → lupakan catatannya. File masih ada tapi gagal dibaca →
    // catatan tetap disimpan dan alasan sebenarnya ditampilkan (bukan "tidak ditemukan")
    const gone = await fs().stat({ path: r.path, directory: r.dir }).then(() => false, () => true);
    if (gone) { const o = idx(); delete o[keyOf(src, id, chId)]; saveIdx(o); emit(); return null; }
    const why = String(e?.message || e || "").slice(0, 160);
    throw Object.assign(new Error(`File ada di HP tetapi gagal dibuka${why ? ` (${why})` : ""}. Coba buka ulang, atau hapus lalu unduh/impor lagi.`), { localRead: true });
  }
}
// info komik untuk membuka chapter unduhan saat offline / file impor
export function offlineDetail(src, id) {
  if (src === "local") {
    const rs = savedOf("local", id).sort((a, b) => (numOf(a.ch) || 0) - (numOf(b.ch) || 0));
    if (!rs.length) return null;
    return { ok: true, manga: { id, title: rs[0].title, cover: "", tags: [], desc: "", status: "" }, chapters: rs.map((r) => ({ id: r.chId, ch: r.ch, title: "", at: null })) };
  }
  const d = api.lsGet(`dlDetail:${src}|${id}`, null);
  return d ? { ok: true, manga: { desc: "", status: "", ...d.manga }, chapters: d.chapters.map((c) => ({ ...c, title: "", at: null })) } : null;
}
// chapter selesai dibaca → aturan hapus otomatis
export function markRead(src, id, chId) {
  const o = idx(), r = o[keyOf(src, id, chId)]; if (!r) return;
  r.readAt = Date.now(); saveIdx(o);
  if (autoWhen() === "Langsung") setTimeout(() => removeRecs([keyOf(src, id, chId)]).then(() => toast("Unduhan yang selesai dibaca dihapus otomatis")), 1500);
}
export async function sweep() {
  if (!supported()) return;
  const w = autoWhen(), days = w === "1 hari" ? 1 : w === "7 hari" ? 7 : w === "Langsung" ? 0 : null, now = Date.now();
  const gone = Object.entries(idx()).filter(([, r]) => (days != null && r.readAt && now - r.readAt >= days * 864e5)
    || (autoOld() && now - Math.max(r.openedAt || 0, r.at || 0) > 30 * 864e5)).map(([k]) => k);
  if (gone.length) await removeRecs(gone);
}
async function removeRecs(keys) {
  const o = idx();
  for (const k of keys) {
    const r = o[k]; if (!r) continue;
    // file yang masih dipakai catatan lain tidak dihapus; jalur di luar Ninokuu/ (catatan lama/rusak) tidak disentuh
    const shared = Object.entries(o).some(([k2, r2]) => k2 !== k && !keys.includes(k2) && r2.dir === r.dir && r2.path === r.path);
    if (!shared && inNinokuu(r.path)) {
      try {
        if (r.fmt === "Folder gambar") await fs().rmdir({ path: r.path, directory: r.dir, recursive: true });
        else await fs().deleteFile({ path: r.path, directory: r.dir });
      } catch {}
    }
    delete o[k];
  }
  saveIdx(o); emit();
}

/* ---------- impor CBZ/ZIP dari HP ---------- */
async function importFiles(list) {
  let n = 0;
  for (const file of list) {
    try {
      const u8 = new Uint8Array(await file.arrayBuffer());
      const ents = await unzip(u8);
      const imgs = ents.filter((x) => IMG_RE.test(x.name)).length;
      if (!imgs) throw new Error("tidak ada gambar di dalamnya");
      const infoE = ents.find((x) => /comicinfo\.xml$/i.test(x.name));
      let series = "", number = "";
      if (infoE) {
        const xml = new TextDecoder().decode(infoE.meth === 0 ? infoE.raw : await inflate(infoE.raw));
        series = (xml.match(/<Series>([^<]*)<\/Series>/i) || [])[1] || ""; number = (xml.match(/<Number>([^<]*)<\/Number>/i) || [])[1] || "";
      }
      const base = file.name.replace(/\.(cbz|zip)$/i, "");
      const m = base.match(/^(.*?)[\s._-]*(?:ch(?:apter)?\.?\s*)?(\d+(?:[.,]\d+)?)\s*$/i);
      const title = safe(series || (m && m[1].trim()) || base), ch = String(number || (m && m[2]) || "1").replace(",", ".");
      const id = title.toLowerCase(), chId = "f" + Date.now().toString(36) + n;
      const dir = await storeDir(), path = `Ninokuu/Impor/${title}/${safe(base)}.cbz`;
      await writeBytes(dir, path, u8);
      const o = idx();
      o[keyOf("local", id, chId)] = { src: "local", id, title, cover: "", chId, ch, fmt: "CBZ", dir, path, bytes: u8.length, pages: imgs, at: Date.now(), openedAt: 0, readAt: 0, imported: true };
      saveIdx(o); n++;
    } catch (e) { toast(`${file.name}: ${e.message}`, 3500); }
  }
  if (n) toast(`${n} file ditambahkan ke Unduhan`);
  emit();
}

/* ---------- tampilan: halaman "Unduh chapter" ---------- */
export async function vDownload(view, c, src, id) {
  const { topbar, setActs, back, getDetail, histOf, openSheet, closeSheet } = c;
  setActs({ back: () => back(`#/c/${src}/${encodeURIComponent(id)}`) });
  view.innerHTML = topbar("Unduh chapter") + `<div class="px col g12 mt6">${c.loading(4, "sk-lrow")}</div>`;
  if (!supported()) {
    view.innerHTML = topbar("Unduh chapter") + `<div class="px col g12 mt6"><div class="empty"><span class="empty-ic">${icon("down", 24)}</span><b>Unduhan ada di aplikasi APK</b><span>Versi web tidak bisa menyimpan file ke folder HP. Pasang aplikasi Android Ninokuu untuk membaca offline.</span><a class="btn primary" href="${esc(N.SITE_URL)}" target="_blank" rel="noopener">${icon("down", 18, 2)}Unduh APK Ninokuu</a></div></div>`;
    return;
  }
  let d; try { d = await getDetail(src, id); } catch (e) { d = offlineDetail(src, id); if (!d) { view.innerHTML = topbar("Unduh chapter") + `<div class="px">${c.errBox(e)}</div>`; return; } }
  const chs = d.chapters, total = chs.length;
  const h = histOf(src, id), readN = h ? numOf(h.chapter) : NaN;
  let sel = new Set(), q = "Pilih sendiri", find = "", from = "", to = "", limit = 60;
  const blocked = (x) => isSaved(src, id, x.id) || isQueued(src, id, x.id);
  const pick = (pred) => new Set(chs.filter((x) => !blocked(x) && pred(x)).map((x) => x.id));
  const newest = [...chs].sort((a, b) => (numOf(b.ch) || 0) - (numOf(a.ch) || 0));
  const QUICK = { "Pilih sendiri": () => new Set(), Semua: () => pick(() => true), "Belum dibaca": () => pick((x) => !Number.isFinite(readN) || numOf(x.ch) > readN),
    "10 terbaru": () => new Set(newest.filter((x) => !blocked(x)).slice(0, 10).map((x) => x.id)), Rentang: () => range() };
  const range = () => { const a = parseFloat(from), b = parseFloat(to); if (!a || !b) return new Set(); const lo = Math.min(a, b), hi = Math.max(a, b); return pick((x) => numOf(x.ch) >= lo && numOf(x.ch) <= hi); };
  const avgMb = () => { const rs = Object.values(idx()).filter((r) => r.src === src && r.pages); return rs.length ? rs.reduce((s, r) => s + r.bytes, 0) / rs.length / 1048576 : MB_EST; };
  const doneN = () => chs.filter((x) => isSaved(src, id, x.id)).length;
  const match = (x) => { const fq = find.trim().toLowerCase().replace(",", "."); if (!fq) return true; const num = (fq.match(/\d+(?:\.\d+)?/) || [""])[0]; return num ? numOf(x.ch) === parseFloat(num) : `chapter ${x.ch}`.includes(fq); };
  const rowsHtml = () => {
    const list = newest.filter(match), shown = find ? list : list.slice(0, limit);
    if (!list.length) return `<div class="empty sm"><b>Maaf, chapter tidak tersedia</b><span>Coba nomor chapter lain.</span></div>`;
    return shown.map((x, i) => { const sv = isSaved(src, id, x.id), qd = !sv && isQueued(src, id, x.id), off = sv || qd;
      const sub = x === newest[0] ? "Terbaru" : Number.isFinite(readN) && numOf(x.ch) <= readN ? "Sudah dibaca" : "Belum dibaca";
      return `<label class="dl-row ${off ? "off" : ""}"><input type="checkbox" data-dl="tog" data-id="${esc(x.id)}" ${sel.has(x.id) || off ? "checked" : ""} ${off ? "disabled" : ""}>
        <span class="col grow"><b>Chapter ${esc(x.ch ?? "?")}</b><span class="mu xs">${sub}</span></span>${sv ? `<span class="dl-ok">${icon("check", 15, 2.4)}Tersimpan</span>` : qd ? `<span class="dl-q">Di antrean</span>` : ""}</label>`; }).join("")
      + (!find && list.length > limit ? `<button class="btn ghost" data-dl="more">Tampilkan lebih banyak</button>` : "");
  };
  const sheetHtml = () => { const n = sel.size, mb = n * avgMb();
    return `<span class="col"><b>${n} chapter dipilih</b><span class="mu xs">Perkiraan ${mb >= 1000 ? (mb / 1024).toFixed(1).replace(".", ",") + " GB" : Math.round(mb) + " MB"}</span></span>
      <button class="dl-go ${n ? "on" : ""}" data-dl="start" ${n ? "" : "disabled"}>${icon("down", 18, 2.2)}Unduh</button>`; };
  const loc = await where();
  const draw = () => {
    view.innerHTML = topbar("Unduh chapter") + `<div class="px col g12 mt6 dl-page">
      <div class="dl-head">${cover(d.manga.cover, d.manga.title, "sm")}<span class="col grow"><b class="t2">${esc(d.manga.title)}</b><span class="mu xs" id="dlDoneN">${total} chapter · ${doneN()} sudah diunduh</span></span></div>
      <div class="chips dl-quick" role="group" aria-label="Pilih cepat">${Object.keys(QUICK).map((n) => `<button aria-pressed="${q === n}" data-dl="quick" data-v="${n}">${n}</button>`).join("")}</div>
      ${q === "Pilih sendiri" ? `<label class="dl-find">${icon("search", 19)}<input type="text" enterkeyhint="search" autocomplete="off" id="dlFind" placeholder="Cari chapter, mis. 120" value="${esc(find)}">${find ? `<button data-dl="findx" aria-label="Hapus pencarian">${icon("x", 16, 2)}</button>` : ""}</label>` : ""}
      ${q === "Rentang" ? `<div class="dl-range"><label>Dari chapter<input type="text" inputmode="decimal" id="dlFrom" value="${esc(from)}"></label><span>–</span><label>Sampai chapter<input type="text" inputmode="decimal" id="dlTo" value="${esc(to)}"></label></div>` : ""}
      <div class="dl-fmt"><span class="cap">Format</span><div class="seg s3" role="radiogroup" aria-label="Format file">${FMTS.map((f) => `<button role="radio" aria-checked="${fmt() === f}" data-dl="fmt" data-v="${f}">${f}</button>`).join("")}</div><span class="mu xs lh">${FMT_HINT[fmt()]}</span></div>
      <div class="dl-loc"><span class="ic-box">${icon("folder", 20)}</span><span class="col grow"><span class="mu xs">Simpan ke</span><b class="b14">${esc(loc.replace("Internal / ", ""))} / ${esc(safe(d.manga.title))}</b></span></div>
      <div class="row sb"><span class="cap m0">Pilih chapter</span><button class="link-red" data-dl="clear">Hapus pilihan</button></div>
      <div class="dl-rows" id="dlRows">${rowsHtml()}</div>
    </div><div style="height:calc(110px + env(safe-area-inset-bottom))"></div>
    <div class="dl-sheet" id="dlSheet">${sheetHtml()}</div>`;
  };
  const refreshRows = () => { const r = $("#dlRows"); if (r) r.innerHTML = rowsHtml(); const s = $("#dlSheet"); if (s) s.innerHTML = sheetHtml(); };
  draw();
  view.onclick = (e) => {
    const b = e.target.closest("[data-dl]"); if (!b || b.tagName === "INPUT") return;
    const a = b.dataset.dl;
    if (a === "quick") { q = b.dataset.v; find = ""; sel = QUICK[q](); draw(); }
    else if (a === "fmt") { api.lsSet("dlFmt", b.dataset.v); draw(); }
    else if (a === "clear") { sel = new Set(); q = "Pilih sendiri"; draw(); }
    else if (a === "more") { limit += 60; refreshRows(); }
    else if (a === "findx") { find = ""; draw(); $("#dlFind")?.focus(); }
    else if (a === "start") {
      const list = chs.filter((x) => sel.has(x.id)); if (!list.length) return;
      const n = enqueue(d, src, id, list); if (!n) return;
      sel = new Set(); q = "Pilih sendiri";
      toast(`${n} chapter masuk antrean unduhan`); draw();
    }
  };
  view.onchange = (e) => {
    const t = e.target;
    if (t.dataset?.dl === "tog") { const k = t.dataset.id; if (t.checked) sel.add(k); else sel.delete(k); if (q !== "Pilih sendiri") { q = "Pilih sendiri"; find = ""; draw(); } else { const s = $("#dlSheet"); if (s) s.innerHTML = sheetHtml(); } }
  };
  view.oninput = (e) => {
    const t = e.target;
    if (t.id === "dlFind") { find = t.value; const r = $("#dlRows"); if (r) r.innerHTML = rowsHtml(); }
    if (t.id === "dlFrom" || t.id === "dlTo") { t.value = t.value.replace(/[^\d.,]/g, ""); if (t.id === "dlFrom") from = t.value.replace(",", "."); else to = t.value.replace(",", "."); sel = range(); refreshRows(); }
  };
  const onDl = () => { const n = $("#dlDoneN"); if (!n) return; n.textContent = `${total} chapter · ${doneN()} sudah diunduh`; refreshRows(); };
  window.addEventListener("nk:dl", onDl);
  return () => { window.removeEventListener("nk:dl", onDl); view.onclick = view.onchange = view.oninput = null; };
}

/* ---------- tampilan: Favorit → Unduhan ---------- */
function groups() {
  const g = new Map();
  for (const [k, r] of Object.entries(idx())) {
    const gk = r.src + "|" + r.id;
    if (!g.has(gk)) g.set(gk, { src: r.src, id: r.id, title: r.title, cover: r.cover, keys: [], chs: [], fmts: new Set(), bytes: 0, readAll: true, old: true, imported: !!r.imported });
    const x = g.get(gk); x.keys.push(k); x.chs.push(r.ch); x.fmts.add(r.imported ? "Impor" : r.fmt); x.bytes += r.bytes || 0;
    if (!r.readAt) x.readAll = false;
    if (Date.now() - Math.max(r.openedAt || 0, r.at || 0) <= 30 * 864e5) x.old = false;
  }
  return [...g.values()].map((x) => { const n = x.chs.map(numOf).filter(Number.isFinite).sort((a, b) => a - b); x.range = n.length ? chLabel(n[0], n[n.length - 1]) : `${x.chs.length} chapter`; return x; });
}
export const savedCount = () => Object.keys(idx()).length;
// unduhan yang sedang berjalan (atau yang pertama di antrean bila semua dijeda)
export function active() {
  const q = queue(), j = q.find((x) => !x.paused) || q[0]; if (!j) return null;
  const n = j.items.length, p = prog[j.jid];
  return { jid: j.jid, title: j.title, cover: j.cover, pct: jobPct(j), n, at: Math.min(n, j.done + 1), ch: j.items[Math.min(n - 1, j.done)]?.ch, page: p?.page || 0, pages: p?.pages || 0, paused: !!j.paused, err: j.err || "", more: q.length - 1 };
}

/* ---------- kartu unduhan melayang (kiri bawah, pasangan pil +EXP di kanan) ----------
   Muncul saat unduhan dimulai, tiap 1 chapter selesai, saat gagal, dan saat selesai; persentase & bar berjalan
   terus selama kartu terlihat. Hilang sendiri ±3,5 dtk setelah kejadian terakhir. Ketuk → Favorit › Unduhan. */
let popEl = null, popT = 0;
const popShow = (ms) => { clearTimeout(popT); popT = setTimeout(popHide, ms); };
function popHide() {
  const el = popEl; popEl = null; if (!el) return;
  el.classList.remove("on"); setTimeout(() => el.remove(), 420);
}
function popFill(el, st) {
  // st: { title, cover, pct, line, state: run|done|err|pause }
  el.dataset.st = st.state;
  const cv = el.querySelector(".dp-cv");
  if (cv.dataset.u !== (st.cover || "") || cv.dataset.t !== st.title) { cv.dataset.u = st.cover || ""; cv.dataset.t = st.title; cv.innerHTML = cover(st.cover, st.title, "xs"); }
  el.querySelector(".dp-t").textContent = st.title;
  el.querySelector(".dp-l").textContent = st.line;
  el.querySelector(".dp-p").textContent = st.state === "done" ? "" : st.state === "err" ? "" : Math.round(st.pct) + "%";
  el.querySelector(".dp-bar i").style.width = Math.max(2, Math.min(100, st.pct)).toFixed(1) + "%";
  el.setAttribute("aria-label", `${st.title}: ${st.line}`);
}
const runLine = (a) => a.paused ? "Dijeda" : `Ch. ${a.ch} · ${a.at}/${a.n} chapter${a.pages ? ` · hal ${a.page}/${a.pages}` : ""}${a.more > 0 ? ` · +${a.more} antrean` : ""}`;
function onDlPop(e) {
  const t = e.detail?.t; if (!t || !supported()) return;
  if (t === "cancel") { const a = active(); if (!a) popHide(); else if (popEl) popFill(popEl, { title: a.title, cover: a.cover, pct: a.pct, line: runLine(a), state: a.paused ? "pause" : "run" }); return; }
  if (t === "prog" && !popEl) return;                    // halaman berjalan: hanya memperbarui kartu yang sedang tampil
  if (document.body.dataset.screen === "fav" && document.querySelector(".dl-qcard")) { popHide(); return; }   // daftar antrean sedang terlihat
  let st;
  if (t === "done") st = { title: e.detail.title, cover: e.detail.cover, pct: 100, line: `Selesai · ${e.detail.n} chapter tersimpan`, state: "done" };
  else if (t === "err") st = { title: e.detail.title, cover: e.detail.cover, pct: active()?.pct || 0, line: "Dijeda: " + e.detail.err, state: "err" };
  else { const a = active(); if (!a) { popHide(); return; } st = { title: a.title, cover: a.cover, pct: a.pct, line: runLine(a), state: a.paused ? "pause" : "run" }; }
  if (!popEl) {
    popEl = document.createElement("button");
    popEl.type = "button"; popEl.className = "dl-pop"; popEl.setAttribute("role", "status");
    popEl.innerHTML = `<span class="dp-cv"></span><span class="dp-mid"><span class="dp-top"><b class="dp-t"></b><span class="dp-p"></span></span><span class="dp-l"></span><span class="dp-bar"><i></i></span></span><span class="dp-ic" aria-hidden="true">${icon("down", 15, 2.4)}${icon("check", 15, 2.6)}</span>`;
    popEl.addEventListener("click", () => { popHide(); location.hash = "#/fav/dl"; });
    popFill(popEl, { ...st, pct: Math.max(0, st.pct - 6) });
    document.body.append(popEl);
    requestAnimationFrame(() => requestAnimationFrame(() => { if (!popEl) return; popEl.classList.add("on"); popFill(popEl, st); }));
  } else popFill(popEl, st);
  if (t !== "prog") popShow(t === "done" ? 2800 : t === "err" ? 4200 : 3600);
}
window.addEventListener("nk:dl", onDlPop);
export function progressLine() {
  const q = queue(), j = q[0]; if (!j) return "";
  return `Mengunduh ${j.title} · ${Math.round(jobPct(j))}%${q.length > 1 ? ` · +${q.length - 1} antrean` : ""}`;
}
const queueHtml = () => {
  const q = queue(); if (!q.length) return "";
  return `<div class="card dl-qcard"><div class="row sb b13"><span>Sedang mengunduh</span><span class="row g10"><span class="mu">${q.length} antrean</span>${q.length > 1 ? `<button class="dl-xs red" data-dl="cancelAll">Batalkan semua</button>` : ""}</span></div>
    ${q.map((j) => { const pct = jobPct(j), n = j.items.length, a = j.items[0]?.ch, b = j.items[n - 1]?.ch;
      const info = `${chLabel(a, b)} · ${j.fmt} · ${j.err ? "gagal: " + j.err : j.paused ? "dijeda" : `chapter ${Math.min(n, j.done + 1)} dari ${n} · ${Math.round(pct)}%`}`;
      return `<div class="dl-job" data-jid="${esc(j.jid)}">${cover(j.cover, j.title, "xs")}<span class="col grow g6"><span class="t1 b14">${esc(j.title)}</span><span class="mu xs dl-info">${esc(info)}</span>
        <span class="dl-bar"><span style="width:${pct.toFixed(1)}%;background:${j.paused ? "var(--mu)" : "var(--red)"}"></span></span></span>
        <button class="dl-rb" data-dl="toggle" data-v="${esc(j.jid)}" aria-label="${j.paused ? "Lanjutkan unduhan" : "Jeda unduhan"}">${icon(j.paused ? "play" : "pause", 16, 2)}</button>
        <button class="dl-rb red" data-dl="cancel" data-v="${esc(j.jid)}" aria-label="Batalkan unduhan">${icon("x", 16, 2.2)}</button></div>`; }).join("")}</div>`;
};
export function favTab(c) {
  if (!supported()) return `<div class="card row g12"><span class="ic-box">${icon("folder", 20)}</span><span class="rc-mid"><span class="mu xs">Lokasi penyimpanan</span><b class="b14">Tersedia di aplikasi APK</b></span></div>
    <div class="empty"><span class="empty-ic">${icon("down", 24)}</span><b>Belum ada unduhan</b><span>Unduh chapter untuk dibaca offline ada di aplikasi APK Ninokuu. Versi web tidak bisa menyimpan file ke folder HP.</span></div>`;
  const gs = groups(), tot = gs.reduce((a, x) => a + x.bytes, 0), w = autoWhen(), ao = autoOld();
  const tagOf = (x) => (w !== "Jangan" && x.readAll ? (w === "Langsung" ? "Dihapus otomatis · sudah dibaca" : `Dihapus otomatis dalam ${w} · sudah dibaca`) : ao && x.old ? "Dihapus otomatis · tidak dibuka 30+ hari" : "");
  const hint = w === "Jangan" ? "Mati · file tetap disimpan sampai kamu hapus sendiri" : w === "Langsung" ? "File dihapus begitu chapter selesai dibaca" : `File dihapus ${w} setelah selesai dibaca`;
  return `<div class="col g12 dl-fav">
  <div class="card row g12"><span class="ic-box gold">${icon("folder", 20)}</span><span class="rc-mid"><span class="mu xs">Lokasi penyimpanan</span><b class="b14" id="dlWhere">Internal / Documents / Ninokuu</b></span></div>
  <label class="dl-import">${icon("folder", 18)}Baca dari file CBZ / ZIP di HP<input type="file" id="dlImport" accept=".cbz,.zip,application/zip,application/x-cbz,application/vnd.comicbook+zip" multiple hidden></label>
  <div id="dlQueue">${queueHtml()}</div>
  <div class="card p0">
    <div class="row g12 dl-set"><span class="ic-box gold sm">${icon("trash", 18)}</span><span class="col grow dl-g2"><b class="b14">Hapus otomatis setelah dibaca</b><span class="mu xs">${hint}</span></span></div>
    <div class="dl-set2"><div class="seg s4" role="radiogroup" aria-label="Hapus otomatis">${AUTO_WHEN.map((n) => `<button role="radio" aria-checked="${w === n}" data-dl="when" data-v="${n}">${n}</button>`).join("")}</div></div>
    <div class="row g12 dl-set bt"><span class="ic-box gold sm">${icon("clock", 18)}</span><span class="col grow dl-g2"><b class="b14">Hapus unduhan lama</b><span class="mu xs">Yang tidak dibuka lebih dari 30 hari</span></span>
      <button class="switch ${ao ? "on" : ""}" role="switch" aria-checked="${ao}" data-dl="old" aria-label="Hapus unduhan lama"><span></span></button></div>
  </div>
  <div class="row sb"><span class="cap m0">Tersimpan di HP · ${mbS(tot)}</span>${gs.length ? `<button class="dl-xs red" data-dl="delAll">Hapus semua</button>` : ""}</div>
  ${gs.length ? `<div class="dl-files">${gs.map((x) => { const tag = tagOf(x);
    return `<div class="dl-file"><a class="row g12 grow" href="${x.src === "local" ? `#/r/local/${encodeURIComponent(x.id)}/${encodeURIComponent(savedOf(x.src, x.id).sort((a, b) => (numOf(a.ch) || 0) - (numOf(b.ch) || 0))[0].chId)}` : `#/c/${x.src}/${encodeURIComponent(x.id)}`}">${cover(x.cover, x.title, "sm")}
      <span class="col grow g4"><b class="b145 t2">${esc(x.title)}</b><span class="mu xs">${esc(x.range)} · ${esc([...x.fmts].join(", "))} · ${mbS(x.bytes)}</span>${tag ? `<span class="gold xs">${tag}</span>` : ""}</span></a>
      <button class="dl-rb red" data-dl="del" data-v="${esc(x.src + "|" + x.id)}" aria-label="Hapus dari HP">${icon("trash", 16, 2)}</button></div>`; }).join("")}</div>`
    : `<div class="dl-none">Belum ada file unduhan di HP</div>`}
</div>`;
}
// pasang perilaku tab Unduhan (dipanggil setelah Favorit digambar)
export function mountFav(root, c) {
  if (!supported() || !root) return () => {};
  const { openSheet, closeSheet, redraw } = c;
  where().then((t) => { const el = $("#dlWhere"); if (el) el.textContent = t; });
  sweep().catch(() => {});
  const gs = () => groups();
  const ask = (title, body, ok, act) => {
    openSheet(`<span class="sheet-ttl">${esc(title)}</span><p class="mu sm lh m0 dl-sp">${esc(body)}</p><div class="row g8"><button class="sh-cancel grow" data-s="close">Batal</button><button class="btn primary grow" data-s="ok">${esc(ok)}</button></div>`,
      async (b) => { if (b.dataset.s === "ok") { b.disabled = true; await act(); closeSheet(); } });
  };
  const sum = (l) => l.reduce((a, x) => a + x.bytes, 0);
  const onClick = (e) => {
    const b = e.target.closest("[data-dl]"); if (!b) return;
    const a = b.dataset.dl, v = b.dataset.v;
    if (a === "toggle") toggleJob(v);
    else if (a === "cancel" || a === "cancelAll") {
      const q = queue(), all = a === "cancelAll", j = q.find((x) => x.jid === v);
      if (!all && !j) return;
      const body = all ? `${q.length} antrean akan dihentikan. Chapter yang sudah selesai tetap tersimpan, sisanya tidak diunduh.`
        : `${j.title} (${chLabel(j.items[0]?.ch, j.items[j.items.length - 1]?.ch)}) akan dihentikan. ${j.done ? j.done + " chapter yang sudah selesai tetap tersimpan." : "Belum ada chapter yang selesai, jadi tidak ada yang tersimpan."}`;
      ask(all ? "Batalkan semua unduhan?" : "Batalkan unduhan?", body, "Batalkan", () => { cancelJobs(all ? q.map((x) => x.jid) : [v]); toast(all ? "Semua unduhan dibatalkan" : "Unduhan dibatalkan"); });
    }
    else if (a === "when") {
      api.lsSet("dlAutoWhen", v); redraw();
      const hit = gs().filter((x) => x.readAll);
      if (v === "Langsung" && hit.length) ask("Hapus sekarang?", `${hit.length} unduhan (${mbS(sum(hit))}) sudah selesai dibaca dan akan langsung dihapus dari HP.`, "Hapus",
        async () => { await removeRecs(hit.flatMap((x) => x.keys)); toast(`${mbS(sum(hit))} dihapus dari HP`); redraw(); });
    }
    else if (a === "old") {
      if (autoOld()) { api.lsSet("dlAutoOld", false); redraw(); return; }
      const hit = gs().filter((x) => x.old);
      if (!hit.length) { api.lsSet("dlAutoOld", true); redraw(); return; }
      ask("Hapus unduhan lama?", `${hit.length} unduhan (${mbS(sum(hit))}) yang tidak dibuka lebih dari 30 hari akan langsung dihapus dari HP. File yang terhapus tidak bisa dikembalikan.`, "Aktifkan & hapus",
        async () => { api.lsSet("dlAutoOld", true); await removeRecs(hit.flatMap((x) => x.keys)); toast(`${mbS(sum(hit))} dihapus dari HP`); redraw(); });
    }
    else if (a === "del") {
      const x = gs().find((g) => g.src + "|" + g.id === v); if (!x) return;
      ask("Hapus dari HP?", `${x.title} (${x.range}, ${mbS(x.bytes)}) akan dihapus permanen dari penyimpanan HP. Kamu masih bisa membacanya online atau mengunduh ulang.`, "Hapus",
        async () => { await removeRecs(x.keys); toast("Unduhan dihapus dari HP"); redraw(); });
    }
    else if (a === "delAll") {
      const l = gs(); if (!l.length) return;
      ask("Hapus semua unduhan?", `${l.length} unduhan (${mbS(sum(l))}) akan dihapus permanen dari HP. Koleksi dan riwayat baca tetap aman.`, "Hapus semua",
        async () => { await removeRecs(l.flatMap((x) => x.keys)); toast("Semua unduhan dihapus dari HP"); redraw(); });
    }
  };
  const onChange = (e) => { if (e.target.id === "dlImport" && e.target.files?.length) { const f = [...e.target.files]; e.target.value = ""; importFiles(f).then(redraw); } };
  root.addEventListener("click", onClick); root.addEventListener("change", onChange);
  // progres antrean diperbarui tanpa menggambar ulang seluruh halaman
  let lastN = queue().length, lastSaved = savedCount();
  const onDl = () => {
    const q = queue(), nowSaved = savedCount();
    if (q.length !== lastN || nowSaved !== lastSaved) { lastN = q.length; lastSaved = nowSaved; redraw(); return; }
    const box = $("#dlQueue"); if (box) box.innerHTML = queueHtml();
  };
  window.addEventListener("nk:dl", onDl);
  return () => { root.removeEventListener("click", onClick); root.removeEventListener("change", onChange); window.removeEventListener("nk:dl", onDl); };
}

// lanjutkan antrean yang belum selesai saat aplikasi dibuka, dan jalankan hapus otomatis
export function start() {
  if (!supported()) return;
  setTimeout(() => { sweep().catch(() => {}); run(); }, 2500);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") run(); });
}
