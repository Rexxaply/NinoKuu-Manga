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

// sampul dengan cadangan huruf awal bila gambar gagal dimuat
export const cover = (url, title, cls = "") =>
  `<span class="cover ${cls}" data-ini="${esc((title || "?").trim()[0] || "?")}">${url ? `<img ${imgAttrs(url)} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-rm>` : ""}</span>`;

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
  if ((t.dataset.d || t.dataset.px) && await imgFallback(t)) return;
  if (t.hasAttribute("data-rm")) t.remove();
}, true);
