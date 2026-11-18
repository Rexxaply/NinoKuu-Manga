// Bantuan tampilan kecil: escape HTML, ikon, toast, waktu relatif, sampul.
import { ICONS } from "./assets.js";
import { isApp, SITE_URL, imgAttrs, imgFallback } from "./native.js";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const icon = (name, size = 22, sw = 1.8) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let toastTimer = null;
export function toast(msg, ms = 2600) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

export function ago(iso) {
  const t = Date.parse(iso || "");
  if (!t) return "";
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "baru saja";
  if (s < 3600) return Math.floor(s / 60) + " mnt lalu";
  if (s < 86400) return Math.floor(s / 3600) + " jam lalu";
  if (s < 86400 * 30) return Math.floor(s / 86400) + " hari lalu";
  return new Date(t).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

export const SOURCES = [
  { id: "komiku", name: "Komiku" },
  { id: "kiryuu", name: "Kiryuu" },
  { id: "shinigami", name: "Shinigami" },
  { id: "westmanga", name: "WestManga" },
];
export const srcName = (id) => SOURCES.find((s) => s.id === id)?.name || id;
export const TYPES = [{ id: "", name: "Semua" }, { id: "manga", name: "Manga" }, { id: "manhwa", name: "Manhwa" }, { id: "manhua", name: "Manhua" }];
export const typeName = (t) => TYPES.find((x) => x.id === t)?.name || "";

// sampul; bila tidak ada atau gagal dimuat → logo Ninokuu (+ tombol muat ulang untuk yang gagal)
export const cover = (url, title, cls = "") =>
  `<span class="cover ${cls}${url ? "" : " cv-none"}" data-ini="${esc((title || "?").trim()[0] || "?")}">${url ? `<img ${imgAttrs(url)} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-rm>` : ""}</span>`;

// Sampul gagal: gambar disembunyikan, logo Ninokuu tampil, dan tombol muat ulang kecil di pojok.
// Ketuk tombolnya (tidak ikut membuka komik) → dicoba lagi dari awal (langsung, jaringan HP, lalu proxy).
// Saat internet tersambung lagi, semua sampul yang gagal dicoba ulang otomatis.
function coverFail(img) {
  const cv = img.closest(".cover"); if (!cv) return false;
  cv.classList.remove("cv-load"); cv.classList.add("cv-fail");
  if (!cv.querySelector(".cv-re")) cv.insertAdjacentHTML("beforeend", `<button class="cv-re" type="button" aria-label="Muat ulang sampul">${icon("refresh", 14, 2.2)}</button>`);
  return true;
}
export function retryCover(cv) {
  const img = cv.querySelector("img"); if (!img) return;
  const o = img.dataset.o || img.getAttribute("src"); if (!o) return;
  cv.classList.add("cv-load"); img.dataset.fb = "0";
  img.removeAttribute("src");
  requestAnimationFrame(() => { img.src = o; });
}
document.addEventListener("click", (e) => {
  const b = e.target.closest?.(".cv-re"); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  retryCover(b.closest(".cover"));
}, true);
document.addEventListener("load", (e) => {
  const cv = e.target instanceof HTMLImageElement && e.target.closest(".cover.cv-fail, .cover.cv-load"); if (!cv) return;
  cv.classList.remove("cv-fail", "cv-load"); cv.querySelector(".cv-re")?.remove();
}, true);
addEventListener("online", () => document.querySelectorAll(".cover.cv-fail").forEach(retryCover));

export const comicHref = (src, id) => `#/c/${src}/${encodeURIComponent(id)}`;
export const readHref = (src, id, ch) => `#/r/${src}/${encodeURIComponent(id)}/${encodeURIComponent(ch)}`;

export function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 11 ? "Selamat Pagi" : h < 15 ? "Selamat Siang" : h < 18 ? "Selamat Sore" : "Selamat Malam";
}

// pesan error yang ramah, termasuk sumber yang memblokir server
export function errBox(e, retryAct = "retry") {
  const m = e?.message || String(e);
  // web: sumber menolak server → arahkan ke APK; APK: pesan dari jaringan HP ditampilkan apa adanya
  const blocked = !isApp && (e?.blocked || /Cloudflare/i.test(m));
  const msg = blocked ? "Sumber ini menolak server Ninokuu. Pilih sumber lain, atau pasang aplikasi Android: di APK sumber ini dibuka langsung dari HP." : m;
  return `<div class="empty"><span class="empty-ic">${icon(blocked ? "shield" : "info", 24)}</span><b>${blocked ? "Sumber tidak bisa dijangkau dari web" : "Gagal memuat"}</b><span>${esc(msg)}</span>
    ${blocked ? `<a class="btn primary" href="${SITE_URL}" target="_blank" rel="noopener">${icon("down", 16, 2)}Unduh APK Ninokuu</a>` : ""}<button class="btn ghost" data-act="${retryAct}">${icon("refresh", 16)}Coba lagi</button></div>`;
}
export const loading = (n = 6, cls = "sk-row") => `<div class="sk-wrap">${Array.from({ length: n }, () => `<div class="${cls} sk"></div>`).join("")}</div>`;

// label rank: border & warna mengikuti bingkai avatar; Archmage/Hero of Legend berkilau, Dragon Emperor kilau emas berjalan.
// Mode Ringan (body.nk-lite) mematikan animasinya.
export const rankBadge = (lv, cls = "") => `<span class="rk-b t${lv.tier} ${cls}"><span class="rk-tx">${esc(lv.rank)}</span></span>`;
export const rankText = (name, tier) => `<b class="rk-t t${tier}"><span class="rk-tx">${esc(name)}</span></b>`;

// CSP (script-src 'self') memblokir atribut onerror inline, jadi gambar bertanda data-rm yang gagal dimuat
// (sampul, avatar, gambar chat) dihapus di sini supaya inisial/latar cadangan terlihat.
// Gambar dari situs asli yang gagal dimuat dicoba ulang dulu (jaringan HP di APK, lalu proxy Supabase sebagai cadangan).
document.addEventListener("error", async (e) => {
  const t = e.target;
  if (!(t instanceof HTMLImageElement) || t.classList.contains("r-img")) return;   // halaman bacaan: diurus pembaca (main.js)
  if (!t.dataset.o && t.getAttribute("src")) t.dataset.o = t.getAttribute("src");   // alamat asli, untuk muat ulang
  if ((t.dataset.d || t.dataset.px) && await imgFallback(t)) return;
  if (t.hasAttribute("data-rm") && !coverFail(t)) t.remove();
}, true);

/* ---------- Lembar bawah: geser turun untuk menutup (Apple "fluid interfaces") ----------
   Berlaku otomatis untuk .sheet (lembar umum & chat), .flt-card (filter) dan .chs (daftar chapter pembaca).
   - mengikuti jari 1:1 setelah ±10 px ke bawah (isi yang sedang digulir tidak ikut ditarik)
   - ditarik ke atas: tertahan lembut (rubber band)
   - dilepas: tutup bila sudah turun 30% tinggi lembar atau dilempar cepat (kecepatan jari diteruskan),
     selain itu kembali ke tempat dari posisi saat ini
   Penutupan memakai tombol tutup milik lembar itu sendiri, jadi logika tutup yang lama tetap dipakai. */
const SHEETS = ".sheet, .flt-card, .chs";
const CLOSERS = "[data-s=close], [data-f=close], [data-x=close], [data-c=close]";
const rubber = (x, d = 300) => (x * d * 0.55) / (d + 0.55 * Math.abs(x));
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
function scrolledInside(t, card) {
  for (let el = t; el && el !== card.parentElement; el = el.parentElement) {
    if (el.scrollTop > 0) { const oy = getComputedStyle(el).overflowY; if (oy === "auto" || oy === "scroll") return true; }
    if (el === card) break;
  }
  return false;
}
function closeFor(card) {
  const host = card.closest(".sheet-host, .flt-host, .chs-host, #host") || card.parentElement;
  return host?.querySelector(CLOSERS);
}
function attachDrag(card) {
  if (card.dataset.drag) return;
  card.dataset.drag = "1";
  let s = null;
  const bg = () => card.parentElement?.querySelector(".pop-bg, .flt-bg, .chs-bg");
  card.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1 || e.target.closest("input, textarea, select, .r-track")) { s = null; return; }
    const t = e.touches[0];
    s = { x: t.clientX, y: t.clientY, on: false, dy: 0, h: card.getBoundingClientRect().height, hist: [[t.clientY, e.timeStamp]], inside: scrolledInside(e.target, card) };
  }, { passive: true });
  card.addEventListener("touchmove", (e) => {
    if (!s || e.touches.length !== 1) return;
    const t = e.touches[0], dy = t.clientY - s.y, dx = t.clientX - s.x;
    if (!s.on) {
      if (s.inside || Math.abs(dx) > Math.abs(dy)) { if (Math.abs(dx) > 10 || Math.abs(dy) > 10) s = null; return; }
      if (dy < 10) { if (dy < -10) s = null; return; }
      s.on = true; s.y0 = t.clientY; card.classList.add("dragging");
    }
    e.preventDefault();
    const d = t.clientY - s.y0;
    s.dy = d > 0 ? d : rubber(d);
    s.hist.push([t.clientY, e.timeStamp]); if (s.hist.length > 5) s.hist.shift();
    card.style.transform = `translate3d(0, ${s.dy}px, 0)`;
    const b = bg(); if (b) b.style.opacity = String(Math.max(0.2, 1 - s.dy / (s.h * 1.2)));
  }, { passive: false });
  const end = () => {
    if (!s) return;
    const st = s; s = null;
    if (!st.on) return;
    card.classList.remove("dragging");
    const [a, z] = [st.hist[0], st.hist[st.hist.length - 1]];
    const v = z[1] > a[1] ? (z[0] - a[0]) / (z[1] - a[1]) : 0;          // px/ms, + = ke bawah
    const b = bg();
    if (st.dy > st.h * 0.3 || v > 0.5) {
      // lanjutkan dengan kecepatan jari: makin cepat dilempar, makin singkat animasinya
      const left = st.h + 40 - st.dy, ms = reduced() ? 0 : Math.max(120, Math.min(260, left / Math.max(v, 1.2)));
      card.style.transition = `transform ${ms}ms cubic-bezier(.2, .8, .2, 1)`;
      card.style.transform = `translate3d(0, ${st.h + 40}px, 0)`;
      if (b) { b.style.transition = `opacity ${ms}ms`; b.style.opacity = "0"; }
      setTimeout(() => closeFor(card)?.click(), ms);
    } else {
      card.style.transition = "transform 320ms cubic-bezier(.23, 1, .32, 1)";
      card.style.transform = "";
      if (b) { b.style.transition = "opacity 320ms"; b.style.opacity = ""; }
      setTimeout(() => { card.style.transition = ""; if (b) b.style.transition = ""; }, 340);
    }
  };
  card.addEventListener("touchend", end, { passive: true });
  card.addEventListener("touchcancel", end, { passive: true });
}
new MutationObserver((ms) => {
  for (const m of ms) for (const n of m.addedNodes) {
    if (!(n instanceof HTMLElement)) continue;
    if (n.matches(SHEETS)) attachDrag(n);
    n.querySelectorAll?.(SHEETS).forEach(attachDrag);
  }
}).observe(document.body, { childList: true, subtree: true });

/* ---------- Pilihan bersegmen (Komiku/Kiryuu…, Koleksi/Riwayat/Unduhan, Semua/Manga…) gaya iOS ----------
   Satu "jempol" (latar pilihan aktif) meluncur ke pilihan baru dengan pegas, bukan latar yang berpindah
   tiba-tiba. Ringan: hanya transform (dikerjakan GPU) + lebar 1 elemen kosong; tanpa pustaka.
   Berlaku otomatis untuk .seg, .fseg, .chips, juga yang digambar ulang (posisi lama diingat ±0,8 dtk). */
const SEG_SEL = ".seg, .fseg, .chips";
const SEG_ON = '[aria-selected="true"], [aria-checked="true"], [aria-pressed="true"]';
const segLast = new Map();
const segReduce = matchMedia("(prefers-reduced-motion: reduce)");
const segKey = (el) => { const b = el.querySelector(":scope > button[data-act], :scope > button[data-f]"); return b ? `${b.dataset.act || b.dataset.f}|${el.querySelectorAll(":scope > button").length}` : ""; };
const segRo = "ResizeObserver" in window ? new ResizeObserver((es) => es.forEach((e) => placeSeg(e.target, false))) : null;
function placeSeg(el, anim) {
  const on = el.querySelector(`:scope > button:is(${SEG_ON})`);
  let th = el.querySelector(":scope > .seg-th");
  // belum terlihat (mis. di dalam menu yang tertutup): diawasi ResizeObserver, dipasang saat muncul
  if (!on || !on.offsetWidth) { if (th) th.style.opacity = "0"; segRo?.observe(el); return; }
  if (!th) {
    th = document.createElement("span"); th.className = "seg-th no-tr"; th.setAttribute("aria-hidden", "true");
    el.prepend(th); el.classList.add("has-th"); segRo?.observe(el);
  }
  const box = { x: on.offsetLeft, y: on.offsetTop, w: on.offsetWidth, h: on.offsetHeight }, k = segKey(el);
  // ukuran berubah (layar diputar dll.): pindahkan tanpa animasi; panggilan tanpa perubahan diabaikan
  // (ResizeObserver memanggil sekali saat mulai diamati: jangan sampai memotong animasi yang sedang jalan)
  if (!anim && el._th && el._th.x === box.x && el._th.w === box.w && el._th.y === box.y && el._th.h === box.h) return;
  const prev = el._th || (anim && k && segLast.get(k)?.t > Date.now() - 800 ? segLast.get(k) : null);
  if (k) segLast.set(k, { ...box, t: Date.now() });
  const set = (b) => { th.style.width = b.w + "px"; th.style.height = b.h + "px"; th.style.transform = `translate3d(${b.x}px, ${b.y}px, 0)`; };
  th.style.borderRadius = getComputedStyle(on).borderRadius;
  if (anim && prev && !segReduce.matches && (prev.x !== box.x || prev.w !== box.w)) {
    if (!el._th) { th.classList.add("no-tr"); set(prev); void th.offsetWidth; }
    th.classList.remove("no-tr");
  } else th.classList.add("no-tr");
  set(box); th.style.opacity = "1";
  el._th = box;
}
// dipasang langsung di callback MutationObserver (sebelum layar digambar), jadi tidak ada 1 frame tanpa jempol
// (sekali per daftar per callback, walau beberapa tombolnya berubah sekaligus)
const queueSeg = (el, anim) => { if (el?.isConnected) placeSeg(el, anim); };
new MutationObserver((ms) => {
  const todo = new Set();
  for (const m of ms) {
    if (m.type === "attributes") { const el = m.target.parentElement?.closest(SEG_SEL); if (el) todo.add(el); continue; }
    m.addedNodes.forEach((n) => { if (n.nodeType !== 1) return; if (n.matches(SEG_SEL)) todo.add(n); n.querySelectorAll?.(SEG_SEL).forEach((x) => todo.add(x)); });
  }
  todo.forEach((el) => queueSeg(el, true));
}).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-selected", "aria-checked", "aria-pressed"] });
document.querySelectorAll(SEG_SEL).forEach((s) => queueSeg(s, false));
// ketukan pada pilihan: catat posisi jempol sekarang, supaya bila daftar digambar ulang, jempol meluncur dari sini
document.addEventListener("click", (e) => {
  const el = e.target.closest?.(SEG_SEL); if (!el || !el._th) return;
  const k = segKey(el); if (k) segLast.set(k, { ...el._th, t: Date.now() });
}, true);
