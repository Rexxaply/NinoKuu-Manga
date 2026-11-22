// Ninokuu PWA · router dan semua layar (mengikuti prototipe desain di canvas).
import * as api from "./api.js";
import * as S from "./store.js";
import { QUOTES } from "./assets.js";
import { DOCS } from "./docs.js";
import * as N from "./native.js";
import { openFilter, activeCount, genreName, STATUS_NAME } from "./filters.js";
import { vChat, vDev, roomFor, roomPreview, roomCount, miniMsg, bindSpoilers, watchAvatars, framesReady } from "./chat.js";
import * as X from "./exp.js";
import * as DL from "./dl.js";
import * as T from "./tour.js";
import * as O from "./online.js";
import { esc, icon, $, $$, toast, ago, SOURCES, srcName, TYPES, typeName, cover, comicHref, readHref, greeting, errBox, loading, rankBadge, ask, closeAsk } from "./ui.js";

const VERSION = window.NINOKUU_CONFIG?.VERSION || "1.0.0";
const KIND_NAME = { mayor: "Pembaruan besar", minor: "Fitur baru", patch: "Perbaikan" };
const view = $("#view");
const nav = $("#nav");
let route = { name: "home", params: [], key: "" };
let cleanup = null;
const scrollMem = new Map();
const detailCache = new Map();
// Ninokuu Dev: penanda kecil "DEV" di pojok layar supaya tidak tertukar dengan aplikasi global
if (N.DEV) document.body.classList.add("nk-dev");

/* ---------- router ---------- */
function parse() {
  const parts = (location.hash.replace(/^#\/?/, "") || "home").split("/").map(decodeURIComponent);
  const map = { c: "detail", r: "reader", p: "page", ch: "chapters", k: "comments", kc: "chcomments", dl: "download" };
  return { name: map[parts[0]] || parts[0], params: parts.slice(1) };
}
const TABS = ["home", "search", "fav", "more"];
const DEPTH = { home: 0, search: 0, fav: 0, more: 0, detail: 1, page: 1, chat: 1, chapters: 2, download: 2, comments: 2, reader: 3, chcomments: 4 };
let prevName = "home", prevTab = "home";
// riwayat navigasi milik aplikasi: tiap entri riwayat browser diberi nomor urut (history.state.nk),
// supaya tombol kembali tahu halaman sebelumnya dan tidak menumpuk halaman baru
const NAVK = "ninokuu:navstack";
let navStack = (() => { try { return JSON.parse(sessionStorage.getItem(NAVK)) || []; } catch { return []; } })();
let navIdx = -1, replacing = false;
function trackNav() {
  const h = location.hash || "#/home";
  let i = history.state?.nk;
  if (typeof i !== "number") {
    i = replacing ? Math.max(0, navIdx) : navIdx + 1;
    navStack = navStack.slice(0, i);
    history.replaceState({ ...(history.state || {}), nk: i }, "");
  }
  navStack[i] = h; navIdx = i; replacing = false;
  try { sessionStorage.setItem(NAVK, JSON.stringify(navStack.slice(0, i + 1))); } catch {}
}
let renderSeq = 0, movingT = 0;
// hiasan beranimasi yang di luar layar juga dijeda (tidak menggambar ulang tanpa terlihat)
// Bintang & partikel bingkai avatar ada di SVG sprite tersembunyi (#nk-sprite) dan berjalan terus walau tidak ada
// avatar di layar. Sprite hanya boleh beranimasi (class "run") bila ada avatar terlihat dan layar tidak sedang
// berpindah. Penanda dipasang langsung di elemen hiasan, bukan di <body>, supaya tidak menghitung ulang gaya
// seluruh halaman (lihat avatars.css).
const fxVis = new Set();
let fxHold = false;
// hanya grup sprite milik rank yang avatarnya sedang terlihat yang dijalankan (bukan seluruh 9 rank);
// class dipasang di grup itu saja, jadi hitung ulang gayanya kecil
let fxGroups = null, fxOn = new Set();
const fxSprite = () => {
  const sp = document.getElementById("nk-sprite"); if (!sp) return;
  const want = new Set(fxHold ? [] : [...fxVis].map((el) => el.dataset.t));
  if (want.size === fxOn.size && [...want].every((t) => fxOn.has(t))) return;
  fxGroups ??= [...sp.querySelectorAll('g[id^="rk"]')].map((g) => [g, g.id[2]]);
  fxGroups.forEach(([g, t]) => { const on = want.has(t); if (fxOn.has(t) !== on || want.size === 0) g.classList.toggle("run", on); });
  fxOn = want;
};
const fxIo = "IntersectionObserver" in window ? new IntersectionObserver((es) => {
  es.forEach((e) => { e.target.classList.toggle("fx-off", !e.isIntersecting); if (e.isIntersecting && e.target.matches(".av-wrap")) fxVis.add(e.target); else fxVis.delete(e.target); });
  fxSprite();
}) : null;
const FX_SEL = "#view .av-wrap, #view .rk-b, .sheet .av-wrap";
const watchFx = () => { if (fxIo) $$(FX_SEL).forEach((el) => { if (el.dataset.fx) return; el.dataset.fx = "1"; fxIo.observe(el); }); };
// isi yang ditambahkan belakangan (pesan chat, komentar) juga diawasi; dikumpulkan per frame
let fxRaf = 0;
if (fxIo) new MutationObserver(() => { if (!fxRaf && !fxHold) fxRaf = requestAnimationFrame(() => { fxRaf = 0; watchFx(); }); }).observe(document.getElementById("view"), { childList: true, subtree: true });
const holdFx = (on) => { fxHold = on; $$(FX_SEL).forEach((el) => el.classList.toggle("fx-hold", on)); fxSprite(); };
async function render() {
  trackNav();
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  // keluar dari pembaca (juga saat chapter berikutnya belum sempat tampil): bilah status selalu dikembalikan
  if (parse().name !== "reader") N.setFullscreen(false, false);
  closeNotif(); closeSheet();
  $$(".flt-host, .chs-host").forEach((x) => x.remove()); document.body.classList.remove("flt-open");
  scrollMem.set(route.key, window.scrollY);
  route = { ...parse(), key: location.hash || "#/home" };
  const owner = { detail: null, reader: null, chapters: null, chat: "home", page: "more" }[route.name];
  const tab = TABS.includes(route.name) ? route.name : owner;
  document.body.dataset.screen = route.name;
  // navigasi bawah: indikator bergeser ke tab aktif; disembunyikan (meluncur turun) di luar layar utama tab
  const onRoot = TABS.includes(route.name);
  document.body.classList.toggle("nav-off", !onRoot);
  navReset();
  const ti = Math.max(0, TABS.indexOf(tab ?? prevTab));
  nav.style.setProperty("--ti", ti);
  $$("#nav a").forEach((a) => a.setAttribute("aria-current", String(a.dataset.tab === tab)));
  // arah animasi: masuk lebih dalam / tab di kanan = dari kanan; kembali = dari kiri
  const depth = DEPTH[route.name] ?? 0, prevDepth = DEPTH[prevName] ?? 0;
  const fwd = depth !== prevDepth ? depth > prevDepth : TABS.indexOf(route.name) >= TABS.indexOf(prevName);
  // Bar "Lanjut baca": meluncur naik saat masuk info komik dari Beranda/tab, dan meluncur turun saat kembali ke
  // Beranda/tab. Ke/dari pembaca (dan halaman dalam lainnya) tanpa animasi. Salinannya dipasang sebentar di luar
  // #view supaya pindah halamannya tidak perlu menunggu animasi keluar.
  if (depth === 0 && prevDepth > 0) {
    const w = $(".rfab-wrap", view);
    if (w && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const g = w.cloneNode(true); g.classList.add("rfab-out"); g.setAttribute("aria-hidden", "true"); g.inert = true;
      document.body.append(g); g.addEventListener("animationend", () => g.remove(), { once: true }); setTimeout(() => g.remove(), 600);
    }
  }
  const fromReader = prevName === "reader";
  prevName = route.name; if (tab) prevTab = tab;
  // animasi masuk dimulai setelah layar baru terisi, supaya layar lama tidak ikut "meluncur lagi"
  const my = ++renderSeq;
  // pembaca: halaman sebelumnya dibiarkan terlihat sampai pembaca siap (tanpa layar gelap kosong sekejap)
  const keepOld = route.name === "reader" && !!view.childElementCount;
  view.classList.remove("in", "in-f", "in-b");
  // Bar "Lanjut baca" info komik: tetap diam saat masuk pembaca (halaman lama masih tampil selama chapter dimuat;
  // dulu animasinya terulang sehingga bar meluncur naik lagi), dan langsung di tempatnya saat kembali ke info komik.
  // Yang beranimasi di pembaca hanya bar/menu pembaca sendiri.
  // Keluar dari pembaca ke info komik: bar meluncur naik lagi, langsung tanpa jeda (tidak tampak "hilang duluan").
  if (keepOld || (!fwd && !fromReader)) view.dataset.upDone = "1"; else delete view.dataset.upDone;
  if (fromReader && !keepOld) view.dataset.upFast = "1"; else delete view.dataset.upFast;
  if (!keepOld) view.innerHTML = "";
  fxIo?.disconnect(); fxVis.clear(); fxSprite();
  let animated = false;
  // Selama layar baru meluncur masuk, animasi hiasan (bingkai avatar kosmik, kilau rank) dijeda: SVG beranimasi
  // menggambar ulang dirinya tiap frame dan bersaing dengan animasi pindah layar (terasa tersendat di Lainnya).
  const animate = () => {
    if (animated || my !== renderSeq) return; animated = true;
    holdFx(true); clearTimeout(movingT);
    // kelas animasi dilepas setelah selesai: halaman yang digambar ulang (data datang) tidak ikut meluncur lagi
    movingT = setTimeout(() => { holdFx(false); watchFx(); if (my === renderSeq) view.classList.remove("in", "in-f", "in-b"); }, 420);
    for (const c of view.children) c.classList.toggle("vfix", getComputedStyle(c).position === "fixed");
    // pindah chapter di pembaca: chapter berikutnya masuk dari kanan, chapter sebelumnya dari kiri
    // pindah chapter di pembaca: digeser oleh vReader sendiri (halaman lama keluar, chapter baru masuk)
    if (route.name === "reader" && fromReader) return;
    void view.offsetWidth; view.classList.add("in", fwd ? "in-f" : "in-b");
  };
  const job = (VIEWS[route.name] || VIEWS.home)(...route.params);
  if (view.childElementCount && !keepOld) animate();
  await job;
  animate();
  if (my === renderSeq && !fxHold) watchFx();
  // chat & komentar mengatur gulirnya sendiri (langsung ke pesan terbaru)
  if (["chat", "comments", "chcomments"].includes(route.name)) return;
  const y = scrollMem.get(route.key);
  requestAnimationFrame(() => window.scrollTo(0, y || 0));
}
window.addEventListener("hashchange", render);
// bar "Mulai baca" / bar bawah daftar chapter: meluncur naik sekali per kunjungan halaman (lihat app.css .rfab-wrap)
view.addEventListener("animationend", (e) => { if (e.animationName === "fixUp") view.dataset.upDone = "1"; });

// Bar bawah ringkas (gaya iOS): gulir ke bawah ±48 px → bar mengecil jadi 1 tombol (tab aktif) di tengah.
// Ketuk tombol itu → bar terbuka lagi. Kembali ke paling atas halaman juga membukanya.
// Lompatan gulir buatan aplikasi (pulihkan posisi, ganti halaman) diabaikan supaya bar tidak mengecil sendiri.
// lebar bar untuk animasi berbasis transform (CSS tidak bisa memakai % induk di dalam transform)
const navW = () => { const w = nav.offsetWidth; if (w) { nav.style.setProperty("--nw", w + "px"); nav.style.setProperty("--nwn", String(w)); } };
navW(); if ("ResizeObserver" in window) new ResizeObserver(navW).observe(nav); else addEventListener("resize", navW);
let navLastY = null, navAcc = 0, navIdle = 0;
const setNavMin = (on) => {
  if (document.body.classList.contains("nav-min") === on) return;
  document.body.classList.toggle("nav-min", on);
  nav.setAttribute("aria-label", on ? "Buka menu utama" : "Menu utama");
};
const navReset = () => { navLastY = null; navAcc = 0; clearTimeout(navIdle); setNavMin(false); };
// diam ±2,5 dtk setelah menggulir → bar terbuka penuh lagi; gulir ke bawah lagi → mengecil lagi
const navIdleArm = () => { clearTimeout(navIdle); navIdle = setTimeout(() => { navAcc = 0; if (!document.body.classList.contains("nav-off")) setNavMin(false); }, 2500); };
window.addEventListener("scroll", () => {
  const y = window.scrollY;
  if (document.body.classList.contains("nav-min")) navIdleArm();
  if (navLastY == null || Math.abs(y - navLastY) > 400) { navLastY = y; navAcc = 0; return; }
  const d = y - navLastY; navLastY = y;
  if (document.body.classList.contains("nav-off")) return;
  if (y < 30) { navAcc = 0; setNavMin(false); return; }
  if (d > 0) { navAcc += d; if (navAcc > 48) { setNavMin(true); navIdleArm(); } } else navAcc = 0;
}, { passive: true });
nav.addEventListener("click", (e) => {
  if (!document.body.classList.contains("nav-min")) return;
  e.preventDefault(); e.stopPropagation();
  navAcc = 0; setNavMin(false);
}, true);
const go = (h) => { location.hash = h; };
let rdLast = null, rdBack = false;   // chapter terakhir yang dibuka di pembaca (arah animasi pindah chapter)
// ganti halaman tanpa menambah riwayat (dipakai saat pindah chapter)
const goReplace = (h) => { if (h === location.hash) return; replacing = true; location.replace(h); };
const back = (fallback = "#/home") => (navIdx > 0 ? history.back() : goReplace(fallback));
// kembali ke halaman tertentu: mundur bila itu memang halaman sebelumnya, selain itu ganti halaman ini
const backTo = (href, alsoOk = []) => { const prev = navStack[navIdx - 1]; if (navIdx > 0 && (prev === href || alsoOk.includes(prev))) history.back(); else goReplace(href); };

// pilihan segmen yang sedang aktif tidak bisa ditekan lagi (mis. "Scroll" saat sudah Scroll → tidak memuat ulang)
document.addEventListener("click", (e) => {
  const b = e.target.closest?.(".seg > button, .fseg > button");
  if (b && (b.getAttribute("aria-selected") === "true" || b.getAttribute("aria-checked") === "true")) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);
let acts = {};
view.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || !view.contains(el)) return;
  const fn = acts[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
});
const setActs = (a) => { acts = a; };
const soon = (msg) => toast(typeof msg === "string" ? msg : "Fitur ini hadir di bagian berikutnya.");

/* ---------- lembar bawah (laporan masalah) ---------- */
let sheetEl = null;
function closeSheet() { sheetEl?.remove(); sheetEl = null; }
function openSheet(html, onClick) {
  closeSheet();
  sheetEl = document.createElement("div");
  sheetEl.className = "sheet-host";
  sheetEl.innerHTML = `<button class="pop-bg" data-s="close" aria-label="Tutup"></button><div class="sheet glass" role="dialog">${html}</div>`;
  sheetEl.addEventListener("click", (e) => { const b = e.target.closest("[data-s]"); if (!b) return; if (b.dataset.s === "close") return closeSheet(); onClick(b, e); });
  document.body.append(sheetEl);
  return sheetEl;
}
const BUG_KINDS = [["gambar", "Gambar tidak muncul / rusak"], ["chapter", "Chapter hilang / tidak lengkap"], ["urutan", "Urutan halaman salah"], ["info", "Info komik salah"], ["lainnya", "Lainnya"]];
function openReport(r) {
  if (!S.loggedIn()) { toast("Masuk dulu untuk mengirim laporan (Lainnya → Masuk)."); return; }
  let kind = r.chapter_id ? "gambar" : "info";
  const el = openSheet(`<span class="sheet-ttl">Laporkan masalah</span><span class="sheet-prev">${esc(r.title)}${r.chapter ? ` · Chapter ${esc(r.chapter)}` : ""}</span>
    <div class="col g4" role="radiogroup" aria-label="Jenis masalah">${BUG_KINDS.filter(([k]) => r.chapter_id || !["gambar", "urutan"].includes(k)).map(([k, n]) => `<button class="sh-row rk" role="radio" aria-checked="${k === kind}" data-s="kind" data-v="${k}"><span class="rk-dot"></span>${n}</button>`).join("")}</div>
    <textarea id="bugnote" maxlength="300" rows="2" placeholder="Keterangan (opsional), mis. halaman 5 kosong"></textarea>
    <div class="row g8"><button class="sh-cancel grow" data-s="close">Batal</button><button class="btn primary grow" data-s="send">Kirim laporan</button></div>`, async (b) => {
    if (b.dataset.s === "kind") { kind = b.dataset.v; $$(".rk", el).forEach((x) => x.setAttribute("aria-checked", String(x.dataset.v === kind))); }
    if (b.dataset.s === "send") {
      b.disabled = true;
      try {
        await api.rest("bug_reports", { method: "POST", prefer: "return=minimal", body: { source: r.source, comic_id: r.comic_id, chapter_id: r.chapter_id || null, title: String(r.title || "").slice(0, 200), chapter: String(r.chapter ?? "").slice(0, 30), kind, note: $("#bugnote").value.trim().slice(0, 300) } });
        closeSheet(); toast("Laporan terkirim. Terima kasih, developer akan memeriksanya.");
      } catch (e) { b.disabled = false; toast(e.message, 4000); }
    }
  });
}
const commentsHref = (src, id, chId) => chId ? `#/kc/${src}/${encodeURIComponent(id)}/${encodeURIComponent(chId)}` : `#/k/${src}/${encodeURIComponent(id)}`;
// 1234 → "1,2 rb", 3400000 → "3,4 jt" (gaya penulisan Indonesia)
const compactNum = (n) => { n = Number(n) || 0; const f = (x, u) => (x >= 100 ? Math.round(x) : Math.round(x * 10) / 10).toString().replace(".", ",") + " " + u;
  return n >= 1e9 ? f(n / 1e9, "M") : n >= 1e6 ? f(n / 1e6, "jt") : n >= 1e3 ? f(n / 1e3, "rb") : String(n); };
const dlSoon = () => toast("Unduhan chapter tersedia di aplikasi APK Ninokuu.");
const dlOpen = (src, id) => () => (DL.supported() ? go(`#/dl/${src}/${encodeURIComponent(id)}`) : dlSoon());

/* ---------- potongan tampilan bersama ---------- */
const topbar = (title, right = "") => `<div class="topbar"><button class="icon-btn" data-act="back" aria-label="Kembali">${icon("back", 22)}</button><h1>${title}</h1>${right || '<span class="tb-sp"></span>'}</div>`;
const seg = (list, cur, act, cls = "") => `<div class="seg ${cls}" role="tablist">${list.map((x) => `<button role="tab" aria-selected="${x.id === cur}" data-act="${act}" data-v="${esc(x.id)}">${esc(x.name)}</button>`).join("")}</div>`;
const chips = (list, cur, act) => `<div class="chips" role="group">${list.map((x) => `<button aria-pressed="${x.id === cur}" data-act="${act}" data-v="${esc(x.id)}">${esc(x.name)}</button>`).join("")}</div>`;
// baris minimalis untuk daftar Beranda & Pencarian: sampul kecil, judul 1 baris, titik warna sumber · jenis;
// hati kecil bila komik sudah ada di koleksi
const minRow = (src, it) => `<a class="mn-row" href="${comicHref(src, it.id)}">${cover(it.cover, it.title, "sm")}<span class="mn-mid"><b class="mn-t">${esc(it.title)}</b><span class="fa-meta"><i class="fa-dot s-${esc(src)}"></i>${esc(srcName(src))}${it.type ? ` · ${esc(typeName(it.type))}` : ""}</span></span>${S.inLib(src, it.id) ? `<span class="redt mn-fav" title="Ada di koleksi">${icon("heartF", 14)}</span>` : ""}</a>`;
// mahkota Top 1: tersangkut miring di pojok kiri atas sampul
const CROWN = `<svg class="t10-crown" viewBox="0 0 64 52" aria-hidden="true"><defs><linearGradient id="crG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE9A3"/><stop offset=".55" stop-color="#F2B33D"/><stop offset="1" stop-color="#B9771A"/></linearGradient></defs>
<path d="M6 40 2 12l16 12L32 4l14 20 16-12-4 28Z" fill="url(#crG)" stroke="#7A4A0E" stroke-width="2.4" stroke-linejoin="round"/>
<rect x="5" y="39" width="54" height="9" rx="3" fill="url(#crG)" stroke="#7A4A0E" stroke-width="2.4"/>
<circle cx="32" cy="27" r="4.2" fill="#E0242B" stroke="#7A0E12" stroke-width="1.4"/><circle cx="17" cy="31" r="3" fill="#5AA9FF" stroke="#13406E" stroke-width="1.2"/><circle cx="47" cy="31" r="3" fill="#5DD39E" stroke="#12603E" stroke-width="1.2"/>
<circle cx="2" cy="12" r="3" fill="#FFE9A3" stroke="#7A4A0E" stroke-width="1.6"/><circle cx="32" cy="4" r="3.4" fill="#FFE9A3" stroke="#7A4A0E" stroke-width="1.6"/><circle cx="62" cy="12" r="3" fill="#FFE9A3" stroke="#7A4A0E" stroke-width="1.6"/></svg>`;
const lrow = (href, cv, title, sub, right = "") => `<a class="lrow" href="${href}">${cv}<span class="rc-mid"><span class="lr-t">${title}</span><span class="mu sm">${sub}</span></span>${right}</a>`;
const gcard = (href, it, src, badge = "") => `<a class="grid-card" href="${href}"><span class="gc-cv">${cover(it.cover, it.title)}${badge}</span><b class="t2">${esc(it.title)}</b><span class="mu xs">${esc(typeName(it.type) || srcName(src))}</span></a>`;
const viewBtn = (grid, act, cls = "") => `<button class="sq-btn ${cls}" data-act="${act}" aria-label="${grid ? "Tampilan daftar" : "Tampilan grid"}">${icon(grid ? "list" : "grid", 18, 2)}</button>`;
const typeFromTags = (tags = []) => (tags.map((t) => String(t).toLowerCase()).find((t) => ["manga", "manhwa", "manhua"].includes(t)) || "");
const pct = (a, b) => (b ? Math.max(3, Math.min(100, Math.round((a / b) * 100))) : 0);

/* ---------- Beranda ---------- */
const SRC_IDS = SOURCES.map((x) => x.id);
const savedSrc = (k) => { const v = api.lsGet(k); return SRC_IDS.includes(v) ? v : "komiku"; };
let homeSrc = savedSrc("homeSrc");
const browseCache = new Map();
async function browse(src, opt) {
  const k = JSON.stringify([src, opt]);
  const hit = browseCache.get(k);
  if (hit && Date.now() - hit.at < 5 * 60e3) return hit.data;
  const data = await api.call("browse", { source: src, ...opt });
  browseCache.set(k, { at: Date.now(), data });
  return data;
}
// Urutan di Beranda: hanya yang didukung sumbernya (sama dengan Edge Function / ekstensi Mihon)
const SORT_NAME = { update: "Update terbaru", popular: "Populer", az: "Judul A-Z", za: "Judul Z-A", rating: "Rating tertinggi" };
const SRC_SORTS = { komiku: ["update", "popular"], kiryuu: ["update", "popular", "az", "za", "rating"], shinigami: ["update", "popular", "rating"], westmanga: ["update", "popular", "az", "za"] };
const homeSortOf = (src) => { const v = (S.state.settings.homeSort || {})[src]; return (SRC_SORTS[src] || ["update"]).includes(v) ? v : "update"; };
// daftar Beranda yang sudah dimuat (per sumber + urutan): kembali dari halaman komik → daftar & posisi gulir utuh
const homeMem = new Map();
const HOME_STEP = 15;   // 3 kolom × 5 baris per muatan
function sortSheet(title, list, cur, onPick) {
  openSheet(`<span class="sheet-ttl">${esc(title)}</span><div class="col g4" role="radiogroup">${list.map(([k, n]) => `<button class="sh-row" role="radio" aria-checked="${k === cur}" data-s="pick" data-v="${esc(k)}"><span class="grow">${esc(n)}</span>${k === cur ? `<span class="redt">${icon("check", 18, 2.4)}</span>` : ""}</button>`).join("")}</div>`,
    (b) => { if (b.dataset.s === "pick") { closeSheet(); onPick(b.dataset.v); } });
}
async function vHome() {
  const name = S.state.profile?.name || (S.loggedIn() ? "" : "Pembaca");
  let qi = Math.floor(Math.random() * QUOTES.length);
  const last = S.history()[0];
  view.innerHTML = `
<header class="top"><img class="logo" src="icons/logo.png" alt="Ninokuu" width="110" height="34">
  <span class="top-r"><a class="gl-btn" href="#/chat" aria-label="Chat publik">${icon("msg", 20)}<span class="c-dot" id="chatDot" hidden></span></a><button class="gl-btn" data-act="bell" aria-label="Notifikasi" aria-expanded="false">${icon("bell", 21)}<span class="bell-n" id="bellN" hidden></span></button></span></header>
<section class="hello"><h1>${greeting()}${name ? `, <span class="gold">${esc(name)}</span>` : ""}</h1>
  <button class="quote" data-act="quote" title="Ketuk untuk kutipan lain">“${esc(QUOTES[qi])}”</button></section>
${last ? `<section class="sec s16"><h2 class="cap">Lanjut baca</h2>
  <a class="resume" href="${last.chapter_id ? readHref(last.source, last.comic_id, last.chapter_id) : comicHref(last.source, last.comic_id)}">${cover(last.cover, last.title, "rs")}
    <span class="rc-mid g6"><span class="meta"><span class="tag-s">${esc(srcName(last.source))}</span>${last.type ? `<span>${esc(typeName(last.type))}</span>` : ""}</span>
      <span class="rs-t">${esc(last.title)}</span>
      <span class="mu sm">Chapter ${esc(last.chapter)}${last.pages ? ` · halaman ${Number(last.page) || 1} dari ${Number(last.pages) || 0}` : ""}</span>
      <span class="prog"><span style="width:${pct(last.page || 1, last.pages || 0) || 6}%"></span></span></span>
    <span class="play">${icon("play", 19, 2)}</span></a></section>` : ""}
<section class="sec s26 nox"><div class="sec-h px"><h2>Top 10 populer</h2><span class="mu sm">${esc(srcName(homeSrc))}</span></div><div class="hs" id="pop">${loading(3, "sk-top")}</div></section>
<section class="sec s24"><h2>Jelajah kategori</h2><div class="cats">
  ${[["manga", "Jepang"], ["manhwa", "Korea"], ["manhua", "Tiongkok"]].map(([t, c]) => `<a class="cat" href="#/search/${t}"><span class="flag f-${t}"></span><span class="col"><b>${typeName(t)}</b><span class="mu xs">${c}</span></span></a>`).join("")}
  <a class="cat" href="#/search"><span class="cat-ic">${icon("search", 20)}</span><span class="col"><b>Semua</b><span class="mu xs">Cari judul</span></span></a>
</div></section>
<section class="sec s26"><div class="sec-h"><h2 id="updH">${esc(SORT_NAME[homeSortOf(homeSrc)])}</h2><span class="row g8"><a class="link-red" href="#/search">Lihat semua</a><button class="sq-btn" data-act="hsort" aria-label="Urutkan">${icon("sort", 18, 2)}</button>${viewBtn(S.state.settings.updView === "grid", "updView")}</span></div>
  ${seg(SOURCES, homeSrc, "src")}
  <div id="upd">${loading(5, "sk-lrow")}</div>
  <button class="more-auto" data-act="more" id="updMore" hidden><span class="spin-s" aria-hidden="true"></span>Memuat lainnya…</button></section>
<div class="pad-nav"></div>`;
  const memKey = () => `${homeSrc}|${homeSortOf(homeSrc)}`;
  let mem = homeMem.get(memKey());
  if (mem && Date.now() - mem.at > 10 * 60e3) { homeMem.delete(memKey()); mem = null; }
  let page = mem?.page || 1, items = mem?.items || [], hasNext = mem?.hasNext || false, busy = false;
  const drawUpd = () => {
    const grid = S.state.settings.updView === "grid";
    $("#upd").innerHTML = !items.length ? `<div class="empty"><b>Belum ada komik</b></div>`
      : grid ? `<div class="g3 mt14">${items.map((it) => gcard(comicHref(homeSrc, it.id), it, homeSrc)).join("")}</div>`
      : `<div class="mn-rows mt8">${items.map((it) => minRow(homeSrc, it)).join("")}</div>`;
  };
  const loadUpd = async (more = false) => {
    const src = homeSrc, sort = homeSortOf(src);
    if (busy) return; busy = true;
    try {
      const r = await browse(src, { sort, page, limit: HOME_STEP });
      if (src !== homeSrc || !$("#upd")) return;
      const seen = new Set(more ? items.map((x) => x.id) : []);
      items = more ? items.concat(r.items.filter((x) => !seen.has(x.id))) : r.items;
      hasNext = !!r.hasNext;
      homeMem.set(`${src}|${sort}`, { items, page, hasNext, at: Date.now() });
      drawUpd();
      $("#updMore").hidden = !hasNext;
    } catch (e) { if (more) { page--; toast(e.message); } else if (src === homeSrc && $("#upd")) $("#upd").innerHTML = errBox(e); }
    finally { busy = false; }
  };
  // muat otomatis saat tulisan "Memuat lainnya…" terlihat
  const io = new IntersectionObserver((es) => { if (es[0].isIntersecting && hasNext && !busy && $("#updMore") && !$("#updMore").hidden) { page++; loadUpd(true); } }, { rootMargin: "400px" });
  io.observe($("#updMore"));
  cleanup = () => io.disconnect();
  const loadPop = async () => {
    const src = homeSrc;
    try {
      const r = await browse(src, { sort: "popular", page: 1, limit: 10 });
      if (src !== homeSrc || !$("#pop")) return;
      $("#pop").innerHTML = r.items.slice(0, 10).map((it, i) => `<a class="top10 ${i < 3 ? "t10-" + (i + 1) : ""}" aria-label="Peringkat ${i + 1}: ${esc(it.title)}" href="${comicHref(src, it.id)}">
        <span class="t10-cv">${cover(it.cover, it.title, "top")}<span class="t10-b" aria-hidden="true">${i + 1}</span>${i === 0 ? CROWN : ""}</span>
        <span class="t10-t"><span class="t2 b13">${esc(it.title)}</span><span class="mu xs">${esc(typeName(it.type) || srcName(src))}</span></span></a>`).join("") || `<span class="mu sm px">Belum ada data</span>`;
    } catch (e) { if (src === homeSrc && $("#pop")) $("#pop").innerHTML = `<span class="mu sm px">${esc(e.blocked ? "Sumber ini menolak server. Pilih sumber lain di bawah." : e.message)}</span>`; }
  };
  setActs({
    quote: (el) => { qi = (qi + 1) % QUOTES.length; el.classList.add("fade"); setTimeout(() => { el.textContent = `“${QUOTES[qi]}”`; el.classList.remove("fade"); }, 200); },
    bell: () => openNotif(),
    src: (el) => { setSrc(el.dataset.v); const y = window.scrollY; vHome().then(() => window.scrollTo(0, y)); },
    updView: (el) => { S.setSetting("updView", S.state.settings.updView === "grid" ? "list" : "grid"); el.outerHTML = viewBtn(S.state.settings.updView === "grid", "updView"); drawUpd(); },
    more: () => { if (!busy) { page++; loadUpd(true); } },
    hsort: () => sortSheet(`Urutkan · ${srcName(homeSrc)}`, SRC_SORTS[homeSrc].map((k) => [k, SORT_NAME[k]]), homeSortOf(homeSrc), (v) => {
      S.setSetting("homeSort", { ...(S.state.settings.homeSort || {}), [homeSrc]: v });
      const y = window.scrollY; vHome().then(() => window.scrollTo(0, y));
    }),
    retry: () => vHome(),
  });
  refreshDots();
  // kembali dari halaman lain: daftar langsung digambar dari ingatan, lalu render() memulihkan posisi gulir
  if (mem) { drawUpd(); $("#updMore").hidden = !hasNext; await loadPop(); return; }
  await Promise.all([loadPop(), loadUpd()]);
}

/* ---------- notifikasi (lonceng): maks 30, 7 hari terakhir ---------- */
let notifs = [];
const readSet = new Set(api.lsGet("notifRead", []));
const saveRead = () => api.lsSet("notifRead", [...readSet].slice(-200));
async function loadNotifs() {
  if (!S.loggedIn()) { notifs = []; return; }
  notifs = (await api.rest("notifications?select=id,title,body,source,comic_id,chapter,cover,created_at&order=created_at.desc&limit=30").catch(() => null)) || notifs;
}
async function refreshBell() {
  await loadNotifs();
  const n = notifs.filter((x) => !readSet.has(x.id)).length, el = $("#bellN");
  if (el) { el.hidden = !n; el.textContent = n > 9 ? "9+" : String(n); }
}
// titik merah: lonceng (notifikasi belum dibaca) dan chat publik (ada pesan baru dari orang lain)
async function refreshDots() {
  if (document.visibilityState !== "visible") return;
  const cd = $("#chatDot");
  if (!cd && !$("#bellN")) return;
  refreshBell().catch(() => {});
  if (!cd) return;
  try {
    const top = ((await api.rest("chat_feed?select=id,user_id&room=eq.public&order=id.desc&limit=1")) || [])[0];
    cd.hidden = !(top && top.id > Number(api.lsGet("chatSeen", 0)) && top.user_id !== api.userId());
  } catch {}
}
setInterval(refreshDots, 45000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refreshDots(); });
async function openNotif() {
  closeNotif();
  const wrap = document.createElement("div");
  wrap.id = "notif";
  // isi panel saja yang diganti saat data datang/berubah → animasi muncul tidak terulang (tidak berkedip)
  const draw = () => {
    const unread = notifs.some((x) => !readSet.has(x.id));
    const inner = `
    <div class="pop-h"><span class="cap m0">Notifikasi</span>${unread ? `<button class="link-red sm" data-n="readall">Tandai dibaca</button>` : ""}</div>
    <div class="pop-list">${!S.loggedIn() ? `<p class="pop-empty">Masuk untuk menerima notifikasi chapter baru dari komik yang loncengnya kamu nyalakan.<br><a class="gold b" href="#/more">Masuk</a></p>`
      : notifs.length ? notifs.map((x) => `<button class="pop-i ${readSet.has(x.id) ? "" : "unread"}" data-n="open" data-id="${x.id}">
          <span class="pop-cv">${x.cover ? `<img ${N.imgAttrs(x.cover)} alt="" loading="lazy" referrerpolicy="no-referrer" data-rm>` : icon(x.comic_id ? "book" : "mega", 15)}</span>
          <span class="rc-mid g1"><span class="t1 pop-t">${esc(x.title)}</span><span class="t1 mu xs">${esc(x.body || "")} · ${esc(ago(x.created_at))}</span></span>
          ${readSet.has(x.id) ? "" : `<span class="dot" aria-label="Belum dibaca"></span>`}</button>`).join("")
      : `<p class="pop-empty">Belum ada notifikasi. Nyalakan lonceng di info komik.</p>`}</div>
    <div class="pop-f"><span class="mu xs">Maks 30 · 7 hari</span>${notifs.length ? `<button class="mu xs b" data-n="clear">Hapus semua</button>` : ""}</div>`;
    const pop = wrap.querySelector(".pop");
    if (pop) { if (pop.innerHTML !== inner) pop.innerHTML = inner; return; }
    wrap.innerHTML = `<button class="pop-bg" data-n="close" aria-label="Tutup notifikasi"></button><div class="pop glass" role="dialog" aria-label="Notifikasi">${inner}</div>`;
  };
  draw();
  document.body.appendChild(wrap);
  $("[data-act=bell]")?.setAttribute("aria-expanded", "true");
  wrap.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-n]"); if (!b) return;
    const a = b.dataset.n;
    if (a === "close") closeNotif();
    if (a === "readall") { notifs.forEach((x) => readSet.add(x.id)); saveRead(); draw(); refreshBell(); }
    if (a === "open") {
      const x = notifs.find((y) => String(y.id) === b.dataset.id); readSet.add(x.id); saveRead(); closeNotif(); refreshBell();
      go(x.source && x.comic_id ? comicHref(x.source, x.comic_id) : "#/chat");
    }
    if (a === "clear") {
      if (!(await ask("Hapus semua notifikasi? Lonceng di tiap komik tetap menyala.", { ok: "Hapus", danger: true }))) return;
      try { await api.rest("notifications?id=gt.0", { method: "DELETE" }); notifs = []; draw(); refreshBell(); toast("Notifikasi dihapus"); } catch (er) { toast(er.message); }
    }
  });
  if (S.loggedIn()) { await loadNotifs(); if (document.getElementById("notif")) draw(); }
}
function closeNotif() {
  const el = document.getElementById("notif");
  if (el && !el.classList.contains("out")) { el.id = ""; el.classList.add("out"); setTimeout(() => el.remove(), 160); }
  $("[data-act=bell]")?.setAttribute("aria-expanded", "false");
}

/* ---------- Pencarian (hasil muncul sambil mengetik) ---------- */
let sState = { q: "", src: savedSrc("homeSrc"), type: "", status: "", genres: [] };
// Sumber di Beranda dan Pencarian satu pilihan yang sama: diganti di salah satu, ikut di yang lain
function setSrc(v) {
  if (!SRC_IDS.includes(v)) return;
  homeSrc = v; api.lsSet("homeSrc", v); api.lsSet("searchSrc", v);
  if (sState.src !== v) { sState.src = v; sState.genres = []; sMem = null; }
}
// hasil Pencarian yang sudah dimuat: kembali dari halaman komik → daftar & posisi gulir utuh
let sMem = null;
const sKey = () => JSON.stringify([sState.src, sState.q, sState.type, sState.status, sState.genres]);
async function vSearch(type) {
  if (type !== undefined) sState.type = TYPES.some((t) => t.id === type) ? type : "";
  view.innerHTML = `
<div class="page-h"><h1>Pencarian</h1></div>
<div class="px row g8 s-wrap"><label class="search grow"><span class="mu">${icon("search", 20)}</span><span class="sr">Cari judul</span>
  <input id="sq" type="search" enterkeyhint="search" autocomplete="off" placeholder="Cari judul manga, manhwa, manhua…" value="${esc(sState.q)}">
  <button type="button" class="clr" data-act="clear" aria-label="Hapus pencarian" ${sState.q ? "" : "hidden"}>${icon("x", 16, 2.2)}</button>
  <div class="sh-pop" id="shpop" role="listbox" aria-label="Pencarian terakhir"></div></label>
  <span id="fltbtn"></span></div>
<div class="sec s14">${seg(SOURCES, sState.src, "src")}</div>
<div class="px mt10 t-row"><div id="tchips"></div>${viewBtn(S.state.settings.searchView === "grid", "view")}</div>
<div class="px" id="factive"></div>
<div class="sec-h px mt10"><span class="mu sm" id="sinfo"></span></div>
<div id="sres" class="px">${loading(6, "sk-lrow")}</div>
<button class="btn ghost wide" data-act="more" id="sMore" hidden>Muat lagi</button>
<div class="pad-nav"></div>`;
  let page = 1, items = [], seq = 0, timer = null;
  // tombol filter (angka = jumlah filter aktif) dan baris filter aktif yang bisa dihapus satu-satu
  const drawFilters = (keepChips = false) => {
    const n = activeCount(sState);
    $("#fltbtn").innerHTML = `<button class="flt-btn ${n ? "on" : ""}" data-act="filter" aria-label="Filter${n ? ` (${n} aktif)` : ""}">${icon("filter", 20)}${n ? `<span class="flt-n">${n}</span>` : ""}</button>`;
    if (!keepChips || !$("#tchips .chips")) $("#tchips").innerHTML = chips(TYPES, sState.type, "type");
    const pills = [...(sState.status ? [["status", "", STATUS_NAME[sState.status]]] : []), ...sState.genres.map((g) => ["genre", g, genreName(sState.src, g)])];
    $("#factive").innerHTML = pills.length ? `<div class="fact">${pills.map(([k, v, l]) => `<button class="fpill" data-act="unf" data-k="${k}" data-v="${esc(v)}" aria-label="Hapus filter ${esc(l)}">${esc(l)}${icon("x", 13, 2.4)}</button>`).join("")}<button class="link-red sm" data-act="unall">Hapus semua</button></div>` : "";
  };
  drawFilters();
  const draw = () => {
    const grid = S.state.settings.searchView === "grid";
    $("#sres").innerHTML = items.length ? (grid ? `<div class="g3 mt8">${items.map((it) => gcard(comicHref(sState.src, it.id), it, sState.src)).join("")}</div>`
      : `<div class="mn-rows">${items.map((it) => minRow(sState.src, it)).join("")}</div>`)
      : `<div class="empty"><span class="empty-ic">${icon("search", 24)}</span><b>Tidak ditemukan</b><span>${activeCount(sState) ? "Tidak ada komik yang cocok dengan semua filter. Coba kurangi filternya." : "Coba kata lain, atau pilih sumber lain di atas."}</span></div>`;
  };
  const load = async (more = false) => {
    const my = ++seq;
    if (!more) { page = 1; $("#sres").innerHTML = loading(6, "sk-lrow"); $("#sMore").hidden = true; }
    const nf = (sState.status ? 1 : 0) + sState.genres.length;
    $("#sinfo").textContent = (sState.q ? `Hasil “${sState.q}” di ${srcName(sState.src)}` : `Terbaru di ${srcName(sState.src)}${sState.type ? " · " + typeName(sState.type) : ""}`) + (nf ? ` · ${nf} filter` : "");
    try {
      const r = await api.call("browse", { source: sState.src, q: sState.q, type: sState.type, status: sState.status, genres: sState.genres, sort: "update", page, limit: 24 });
      if (my !== seq || !$("#sres")) return;
      items = more ? items.concat(r.items) : r.items;
      sMem = { key: sKey(), items, page, hasNext: !!r.hasNext, at: Date.now() };
      draw();
      $("#sMore").hidden = !r.hasNext;
    } catch (e) { if (my === seq && $("#sres")) $("#sres").innerHTML = errBox(e); }
  };
  const inp = $("#sq");
  // Riwayat pencarian: 10 kata kunci terakhir (disimpan di HP). Muncul di bawah kolom cari saat kolomnya
  // diketuk dan masih kosong. Disimpan saat Enter, saat memilih hasil, atau saat meninggalkan halaman.
  const HK = "searchHist";
  const shList = () => { const h = api.lsGet(HK); return Array.isArray(h) ? h : []; };
  const saveQ = (q) => { q = String(q || "").trim(); if (q.length < 2) return; api.lsSet(HK, [q, ...shList().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 10)); };
  const pop = $("#shpop");
  const drawHist = () => {
    const h = shList();
    pop.innerHTML = h.length ? `<div class="shp-h"><span class="cap">Pencarian terakhir</span><button type="button" class="link-red sm" data-shall>Hapus semua</button></div>
      ${h.map((q) => `<div class="shp-row" role="option"><button type="button" class="shp-q" data-sh="${esc(q)}"><span class="mu">${icon("clock", 16)}</span><span class="t1">${esc(q)}</span></button><button type="button" class="shp-x" data-shx="${esc(q)}" aria-label="Hapus ${esc(q)} dari riwayat">${icon("x", 14, 2.2)}</button></div>`).join("")}` : "";
    return h.length > 0;
  };
  const showHist = (on) => pop.classList.toggle("on", on && document.activeElement === inp && !inp.value && drawHist());
  pop.addEventListener("pointerdown", (e) => e.preventDefault());          // kolom cari tetap fokus saat panel diketuk
  pop.addEventListener("click", (e) => {
    const b = e.target.closest("[data-sh], [data-shx], [data-shall]"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    if (b.dataset.sh != null) { const q = b.dataset.sh; inp.value = q; sState.q = q; saveQ(q); $("[data-act=clear]").hidden = false; pop.classList.remove("on"); inp.blur(); load(); }
    else if (b.dataset.shx != null) { api.lsSet(HK, shList().filter((x) => x !== b.dataset.shx)); showHist(true); }
    else { api.lsSet(HK, []); pop.classList.remove("on"); }
  });
  inp.addEventListener("focus", () => showHist(true));
  inp.addEventListener("blur", () => pop.classList.remove("on"));
  $("#sres").addEventListener("click", (e) => { if (e.target.closest("a") && sState.q) saveQ(sState.q); });
  inp.addEventListener("input", () => {
    const v = inp.value.trim();
    showHist(true);
    $("[data-act=clear]").hidden = !inp.value;
    clearTimeout(timer);
    if (v === sState.q) return;
    timer = setTimeout(() => { sState.q = v; load(); }, 400);
  });
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); clearTimeout(timer); sState.q = inp.value.trim(); saveQ(sState.q); inp.blur(); load(); } });
  cleanup = () => { clearTimeout(timer); if (sState.q && items.length) saveQ(sState.q); };
  const pick = (act, el) => $$(`[data-act=${act}]`).forEach((b) => b.setAttribute(b.parentElement.classList.contains("chips") ? "aria-pressed" : "aria-selected", String(b === el)));
  setActs({
    clear: () => { inp.value = ""; sState.q = ""; $("[data-act=clear]").hidden = true; inp.focus(); showHist(true); load(); },
    src: (el) => { if (sState.genres.length) toast("Filter genre direset karena tiap sumber punya daftar genre sendiri."); setSrc(el.dataset.v); pick("src", el); drawFilters(); load(); },
    // chip jenis diubah di tempat (tanpa menggambar ulang barisnya) supaya pil meluncur tanpa gangguan;
    // hasil dimuat 1 frame kemudian, setelah animasi dimulai
    type: (el) => { sState.type = el.dataset.v; $$("#tchips .chips > button").forEach((b) => b.setAttribute("aria-pressed", String(b === el))); drawFilters(true); requestAnimationFrame(() => load()); },
    filter: () => openFilter(sState.src, sState, (f) => { sState.type = f.type; sState.status = f.status; sState.genres = f.genres; drawFilters(); load(); }),
    unf: (el) => { if (el.dataset.k === "status") sState.status = ""; else sState.genres = sState.genres.filter((g) => g !== el.dataset.v); drawFilters(); load(); },
    unall: () => { sState.status = ""; sState.genres = []; drawFilters(); load(); },
    view: (el) => { S.setSetting("searchView", S.state.settings.searchView === "grid" ? "list" : "grid"); el.outerHTML = viewBtn(S.state.settings.searchView === "grid", "view"); draw(); },
    more: () => { page++; load(true); },
    retry: () => load(),
  });
  if (sMem && sMem.key === sKey() && Date.now() - sMem.at < 10 * 60e3) {
    ({ items, page } = sMem);
    const nf = (sState.status ? 1 : 0) + sState.genres.length;
    $("#sinfo").textContent = (sState.q ? `Hasil “${sState.q}” di ${srcName(sState.src)}` : `Terbaru di ${srcName(sState.src)}${sState.type ? " · " + typeName(sState.type) : ""}`) + (nf ? ` · ${nf} filter` : "");
    draw(); $("#sMore").hidden = !sMem.hasNext;
    return;
  }
  await load();
}

/* ---------- Detail komik ---------- */
const byCh = (a, b) => (parseFloat(a.ch) || 0) - (parseFloat(b.ch) || 0);
const saveDetail = (k, data) => { try { sessionStorage.setItem("ninokuu:d:" + k, JSON.stringify(data)); } catch {} };
async function getDetail(src, id, force = false) {
  const k = src + "|" + id;
  const c = detailCache.get(k);
  if (c && !force && Date.now() - c.at < 10 * 60e3) { fillMore(src, id, c.data); return c.data; }
  const data = await api.call("detail", { source: src, comic_id: id });
  data.chapters = (data.chapters || []).slice().sort(byCh);
  detailCache.set(k, { at: Date.now(), data });
  saveDetail(k, data);
  fillMore(src, id, data);
  return data;
}
// Buka chapter sesudah chapter yang terakhir dibaca (dipakai lencana +N di Koleksi & tombol di Riwayat).
// Memakai detail yang tersimpan dulu; bila chapter berikutnya belum ada di situ, ambil daftar terbaru.
async function openNextChapter(src, id, chId, chNum, el) {
  if (el?.classList.contains("busy")) return;
  el?.classList.add("busy");
  const find = (d) => { const chs = d?.chapters || []; let i = chId ? chs.findIndex((c) => c.id === chId) : -1; if (i < 0 && chNum != null && chNum !== "") i = chs.findIndex((c) => String(c.ch) === String(chNum)); return i >= 0 ? chs[i + 1] || null : undefined; };
  try {
    let nx = find(cachedDetail(src, id));
    if (!nx) nx = find(await getDetail(src, id, true));
    if (nx) location.hash = readHref(src, id, nx.id);
    else if (nx === null) toast("Kamu sudah di chapter terbaru. Chapter baru akan diberi tahu.", 2800);
    else { toast("Chapter terakhir tidak ditemukan, membuka halaman komik", 2500); location.hash = comicHref(src, id); }
  } catch (e) { toast(e.message || "Gagal memuat daftar chapter", 3500); }
  finally { el?.classList.remove("busy"); }
}
// tombol di dalam kartu (lencana +N, Lanjut, Berikutnya): tidak ikut membuka halaman komik
document.addEventListener("click", (e) => {
  const b = e.target.closest?.("[data-next], [data-go]"); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  if (b.dataset.go) location.hash = b.dataset.go;
  else openNextChapter(b.dataset.src, b.dataset.id, b.dataset.ch, b.dataset.n, b);
}, true);
function cachedDetail(src, id) {
  const k = src + "|" + id;
  if (detailCache.has(k)) { const d = detailCache.get(k).data; fillMore(src, id, d); return d; }
  try { const s = sessionStorage.getItem("ninokuu:d:" + k); if (s) { const d = JSON.parse(s); detailCache.set(k, { at: 0, data: d }); fillMore(src, id, d); return d; } } catch {}
  return null;
}
// Komik dengan ribuan chapter (mis. Martial Peak di Komiku): server mengirim chapter terbaru dulu plus tanda
// "more". Sisanya (sampai chapter 1) diambil di belakang layar per potongan, lalu digabung ke detail yang sama.
// Halaman yang sedang terbuka diberi tahu lewat event "nk:chapters" supaya daftar diperbarui di tempat.
const filling = new Set();
async function fillMore(src, id, data) {
  const k = src + "|" + id;
  if (!data?.more || filling.has(k)) return;
  filling.add(k);
  try {
    let guard = 0;
    while (data.more && guard++ < 40) {
      const r = await api.call("more_chapters", { source: src, comic_id: id, offset: data.more.offset });
      const seen = new Set(data.chapters.map((c) => c.id));
      const add = (r.chapters || []).filter((c) => c?.id && !seen.has(c.id));
      data.chapters = data.chapters.concat(add).sort(byCh);
      data.more = r.more || null;
      saveDetail(k, data);
      dispatchEvent(new CustomEvent("nk:chapters", { detail: { key: k, done: !data.more } }));
    }
  } catch { /* coba lagi saat komik dibuka berikutnya */ }
  finally { filling.delete(k); }
}
// halaman komik: latar berhenti di baris tombol "Mulai baca"
function fitDetail() {
  const bg = $("#dtbg"), row = $(".act-row");
  if (bg && row) bg.style.height = Math.round(row.getBoundingClientRect().bottom - view.getBoundingClientRect().top + 28) + "px";
}
addEventListener("resize", () => { if (parse().name === "detail") fitDetail(); });
async function vDetail(src, id) {
  view.innerHTML = `<div class="bar"><button class="icon-btn glass" data-act="back" aria-label="Kembali">${icon("back", 22)}</button></div>${loading(1, "sk-hero")}<div class="px">${loading(8, "sk-lrow")}</div>`;
  setActs({ back: () => back(), retry: () => vDetail(src, id) });
  let d;
  try { d = await getDetail(src, id); } catch (e) { view.innerHTML = `<div class="bar"><button class="icon-btn glass" data-act="back" aria-label="Kembali">${icon("back", 22)}</button></div>${errBox(e)}`; return; }
  if (parse().name !== "detail") return;
  const m = d.manga, type = typeFromTags(m.tags);
  let latest = d.chapters[d.chapters.length - 1];
  const meta = { source: src, comic_id: id, title: m.title, cover: m.cover };
  S.updateLibMeta(src, id, { type, latest: latest?.ch ?? null, latestAt: latest?.at ?? null });
  const h = S.histItem(src, id);
  let first, resumeCh;
  let descOpen = false;
  const draw = () => {
    // dihitung ulang setiap gambar: chapter lama bisa datang belakangan (fillMore)
    latest = d.chapters[d.chapters.length - 1]; first = d.chapters[0];
    resumeCh = h?.chapter_id && d.chapters.find((c) => c.id === h.chapter_id);
    const fav = S.inLib(src, id), bell = !!S.libItem(src, id)?.notify;
    // ringkas: 4 chapter terbaru; bila sedang membaca chapter lama, tampilkan juga chapter itu
    const desc = d.chapters.slice().reverse();
    let preview = desc.slice(0, 4);
    if (resumeCh && !preview.includes(resumeCh)) {
      const i = desc.indexOf(resumeCh);
      preview = [...desc.slice(0, 2), resumeCh, desc[i + 1]].filter(Boolean);
    }
    const chRow = chRowFor(src, id, h, latest);
    const heroCol = X.cachedCoverColor(m.cover);
    const ST = { ongoing: ["Berlangsung", "ok"], completed: ["Tamat", "blue"], hiatus: ["Hiatus", "gold"], dropped: ["Dihentikan", "red"] }[m.status];
    const views = Number(m.views) > 0 ? compactNum(m.views) : "";
    const score = Number(m.score) > 0 ? (Math.round(Number(m.score) * 10) / 10).toFixed(1).replace(".", ",") : "";
    // satu baris info ringkas di bawah judul; yang tidak tersedia dari sumber tidak ditampilkan
    const infoLine = [score && `<span class="inf-score" title="Skor di situs sumber (dari 10)">${icon("star", 14, 2)}<b>${esc(score)}</b></span>`, ST && `<span class="inf-st inf-${ST[1]}">${esc(ST[0])}</span>`, views && `<span title="Dilihat di situs sumber">${icon("eye", 14)}${esc(views)}</span>`,
      m.publisher && `<span>${icon("book", 13)}<i>${esc(m.publisher)}</i></span>`, m.author && `<span>${icon("user", 13)}<i>${esc(m.author)}</i></span>`].filter(Boolean).join("");
    view.innerHTML = `
<div class="dbar" id="dbar"><button class="r-round glass" data-act="back" aria-label="Kembali">${icon("back", 21, 2)}</button><span class="dbar-t">${esc(m.title)}</span>
  <button class="r-round glass" data-act="dl" aria-label="Unduh chapter">${icon("down", 20, 2)}</button><button class="pill-btn glass" data-act="report">${icon("bug", 17)}Laporkan</button></div>
<div class="dt-bg ${heroCol ? "tinted" : ""}" id="dtbg" aria-hidden="true"${heroCol ? ` style="--hc:${heroCol}"` : ""}><div class="dt-img" style="background-image:url('${esc(N.imgParts(m.cover).src)}')"></div><div class="dt-tint"></div></div>
<div class="hero has-bar dt">
  <div class="hero-in">${cover(m.cover, m.title, "det")}
    <div class="hero-t"><span class="meta"><span class="tag-s">${esc(srcName(src))}</span>${type ? `<span>${esc(typeName(type))}</span>` : ""}</span><h1 id="dtTitle" title="${esc(m.title)}">${esc(m.title)}</h1>
      ${infoLine ? `<span class="inf-line">${infoLine}</span>` : ""}
      <span class="mu sm">${d.chapters.length} chapter${latest?.at ? " · update " + esc(ago(latest.at)) : ""}${d.more ? " · memuat chapter lama…" : ""}</span></div></div></div>
<div class="px dt-body">
  <div class="act-row">
    <a class="btn primary grow" href="${resumeCh ? readHref(src, id, resumeCh.id) : first ? readHref(src, id, first.id) : "#"}">${icon("play", 18, 2)}${resumeCh ? "Lanjut Ch. " + esc(resumeCh.ch) : "Mulai baca"}</a>
    <button class="round-btn ${fav ? "on" : ""}" data-act="fav" aria-pressed="${fav}" aria-label="${fav ? "Hapus dari koleksi" : "Tambah ke koleksi"}">${icon(fav ? "heartF" : "heart", 22)}</button>
    <button class="round-btn ${bell ? "on gold" : ""}" data-act="bell" aria-pressed="${bell}" aria-label="${bell ? "Matikan notifikasi" : "Nyalakan notifikasi chapter baru"}">${icon(bell ? "bellF" : "bell", 22)}</button>
    ${likeBtn(lk)}
  </div>
  ${m.tags?.length ? `<div class="tags">${m.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
  <p class="syn-h">Sinopsis <b>${esc(m.title)}</b></p>
  ${m.desc ? `<p class="desc ${descOpen ? "open" : ""}" data-act="desc">${esc(m.desc)}</p>` : `<p class="desc mu">Belum ada sinopsis dari sumber.</p>`}
  <div class="sec-h mt24"><h2>Chapter</h2><a class="link-red" href="${chaptersHref(src, id)}">Lihat semua (${d.chapters.length})${icon("chev", 16, 2)}</a></div>
  <div class="ch-card">${preview.map((c) => chRow(c)).join("") || `<div class="empty"><b>Belum ada chapter</b></div>`}</div>
  <div id="cmsec">${cmHtml()}</div>
</div><div style="height:calc(120px + env(safe-area-inset-bottom))"></div>
<div class="rfab-wrap"><a class="rfab glass" href="${resumeCh ? readHref(src, id, resumeCh.id) : first ? readHref(src, id, first.id) : chaptersHref(src, id)}"><span class="rfab-ic">${icon("play", 18, 2)}</span><b class="redt">${resumeCh ? "Lanjut baca" : "Mulai baca"}</b><span class="grow">${resumeCh ? "Chapter " + esc(resumeCh.ch) : first ? "Chapter " + esc(first.ch) : ""}</span><span class="redt">${icon("chev", 20, 2)}</span></a></div>`;
    bindSpoilers($("#cmprev")); watchAvatars($("#cmprev"));
    // latar mengikuti warna cover (dihitung sekali, lalu disimpan)
    if (!heroCol) X.coverColor(m.cover).then((c) => { const el = $("#dtbg"); if (c && el && parse().name === "detail") { el.style.setProperty("--hc", c); el.classList.add("tinted"); } });
    onBarScroll();
    fitDetail();
  };
  let cmList = null, cmN = 0, lk = null, lkBusy = false;
  // bagian komentar digambar terpisah: saat komentar datang, hanya bagian ini yang diganti
  // (sebelumnya seluruh halaman digambar ulang → gambar sampul & latar sempat berkedip)
  function cmHtml() { return `  <div class="sec-h mt24"><h2>Komentar${cmN ? ` <span class="mu cm-n">${cmN}</span>` : ""}</h2><a class="link-red" href="${commentsHref(src, id)}">${cmN ? "Lihat semua" : "Tulis komentar"}${icon("chev", 16, 2)}</a></div>
  <div class="cm-card" id="cmprev">${cmList === null ? `<div class="mu sm cm-empty">Memuat komentar…</div>` : cmList.length ? cmList.map(miniMsg).join("") + `<a class="cm-more" href="${commentsHref(src, id)}">${icon("msg", 17)}Buka semua komentar</a>`
    : `<a class="cm-empty" href="${commentsHref(src, id)}">${icon("msg", 20)}<span class="rc-mid g4"><b class="sm">Belum ada komentar</b><span class="mu xs">Jadilah yang pertama berkomentar tentang komik ini.</span></span></a>`}</div>`; }
  const paintComments = () => { const el = $("#cmsec"); if (!el) return draw(); el.innerHTML = cmHtml(); bindSpoilers($("#cmprev")); watchAvatars($("#cmprev")); };
  const paintLike = () => { const b = $("[data-act=like]"); if (b) b.outerHTML = likeBtn(lk); };
  S.likeInfo(src, id, "").then((i) => { if (i && parse().name === "detail") { lk = i; paintLike(); } });
  const onBarScroll = () => { const b = $("#dbar"); if (b) b.classList.toggle("solid", window.scrollY > 120); };
  window.addEventListener("scroll", onBarScroll, { passive: true });
  const onMore = (e) => { if (e.detail.key === src + "|" + id && parse().name === "detail") { const y = window.scrollY; draw(); window.scrollTo(0, y); } };
  window.addEventListener("nk:chapters", onMore);
  cleanup = () => { window.removeEventListener("scroll", onBarScroll); window.removeEventListener("nk:chapters", onMore); };
  const room = roomFor(src, id);
  Promise.all([roomPreview(room, 3), roomCount(room).catch(() => 0), new Promise((r) => setTimeout(r, 450)).then(framesReady)]).then(([l, n]) => { cmList = l; cmN = n; if (parse().name === "detail") paintComments(); })
    .catch(() => { cmList = []; if (parse().name === "detail") paintComments(); });
  setActs({
    back: () => back(),
    retry: () => vDetail(src, id),
    desc: (el) => { descOpen = !descOpen; el.classList.toggle("open", descOpen); },
    dl: dlOpen(src, id),
    report: () => openReport({ source: src, comic_id: id, title: m.title }),
    like: async () => {
      if (!S.loggedIn()) { toast("Masuk dulu untuk memberi like."); return; }
      if (lkBusy) return; lkBusy = true;
      const old = lk || { n: 0, liked: false }, on = !old.liked;
      lk = { n: Math.max(0, old.n + (on ? 1 : -1)), liked: on }; paintLike();
      try { await S.setLike(src, id, "", m.title, on); if (on) toast("Kamu menyukai komik ini"); }
      catch (e) { lk = old; paintLike(); toast(e.message); }
      lkBusy = false;
    },
    fav: async () => {
      try { const on = await S.toggleLib(meta); if (on) S.updateLibMeta(src, id, { type, latest: latest?.ch ?? null, latestAt: latest?.at ?? null }); toast(on ? "Ditambahkan ke koleksi" : "Dihapus dari koleksi"); }
      catch (e) { toast(e.message); }
      draw();
    },
    bell: async () => {
      if (!S.loggedIn()) { toast("Masuk dulu untuk menyalakan notifikasi chapter baru."); return; }
      const on = !S.libItem(src, id)?.notify;
      try {
        await S.setNotify(meta, on); S.updateLibMeta(src, id, { type, latest: latest?.ch ?? null, latestAt: latest?.at ?? null });
        toast(on ? "Notifikasi chapter baru menyala" : "Notifikasi dimatikan");
        if (on && N.pushSupported()) N.pushEnable(api.rpc, true).then((st) => { if (st === "denied") toast("Izin notifikasi HP ditolak. Aktifkan di Pengaturan → Aplikasi → Ninokuu → Notifikasi.", 5000); }).catch(() => {});
      }
      catch (e) { toast(e.message); }
      draw();
    },
  });
  draw();
}

const chLike = (lk) => `<button class="btn ghost rlike like-b ${lk?.liked ? "on" : ""}" data-act="like" aria-pressed="${!!lk?.liked}">${icon(lk?.liked ? "thumbF" : "thumb", 18)}${lk?.liked ? "Kamu suka chapter ini" : "Suka chapter ini"}${lk?.n ? `<span class="cm-n">${lk.n}</span>` : ""}</button>`;
// tombol like (komik di detail, chapter di pembaca); angka = jumlah like semua pembaca
const likeBtn = (lk, cls = "round-btn") => `<button class="${cls} like-b ${lk?.liked ? "on" : ""}" data-act="like" aria-pressed="${!!lk?.liked}" aria-label="${lk?.liked ? "Batal suka" : "Suka"}">${icon(lk?.liked ? "thumbF" : "thumb", 21)}${lk?.n ? `<span class="lk-n">${lk.n > 999 ? (lk.n / 1000).toFixed(1).replace(".0", "") + "rb" : lk.n}</span>` : ""}</button>`;
// cari chapter: angka dicocokkan PERSIS (ketik 1 → hanya chapter 1, bukan 10/100/1000);
// selain angka dicocokkan ke judul chapter
function matchCh(c, q) {
  q = String(q || "").trim().toLowerCase().replace(",", ".");
  if (!q) return true;
  const num = (q.match(/\d+(?:\.\d+)?/) || [""])[0];
  if (num) return parseFloat(c.ch) === parseFloat(num);
  return (c.title || "").toLowerCase().includes(q);
}
const chaptersHref = (src, id) => `#/ch/${src}/${encodeURIComponent(id)}`;
// baris chapter: BARU (rilis < 3 hari), TERAKHIR DIBACA, centang bila sudah lewat
function chRowFor(src, id, h, latest) {
  const readN = h ? parseFloat(h.chapter) : NaN;
  return (c, timeline = false) => {
    const cur = h?.chapter_id === c.id, n = parseFloat(c.ch);
    const isNew = !cur && c.at && Date.now() - Date.parse(c.at) < 3 * 864e5;
    const read = !cur && Number.isFinite(readN) && Number.isFinite(n) && n < readN;
    const ic = cur ? icon("bookmark", 17, 2) : isNew ? icon("star", 17) : read ? icon("eye", 17) : icon("circle", 15);
    return `<a class="ch ${timeline ? "tl" : ""} ${cur ? "cur" : ""} ${read ? "read" : ""}" href="${readHref(src, id, c.id)}">${timeline ? `<span class="tl-ic ${cur ? "cur" : isNew ? "new" : read ? "read" : ""}">${ic}</span>` : ""}
      <span class="col grow"><b>Chapter ${esc(c.ch ?? "?")}</b><span class="mu xs">${esc(c.title ? c.title + " · " : "")}${esc(ago(c.at))}</span></span>
      ${isNew ? `<span class="badge-s new">BARU</span>` : ""}${cur ? `<span class="badge-s cur">TERAKHIR DIBACA</span>` : ""}${DL.isSaved(src, id, c.id) ? `<span class="dl-mark" aria-label="Tersimpan di HP">${icon("down", 15, 2.2)}</span>` : ""}${read && !timeline ? `<span class="ok">${icon("check", 18, 2.2)}</span>` : ""}
      <span class="mu">${icon("chev", 16)}</span></a>`;
  };
}
async function vChapters(src, id) {
  const dlBtn = `<button class="icon-btn" data-act="dl" aria-label="Unduh chapter">${icon("down", 21, 2)}</button>`;
  view.innerHTML = topbar("Daftar chapter", dlBtn) + `<div class="px">${loading(8, "sk-lrow")}</div>`;
  setActs({ back: () => backTo(comicHref(src, id)), retry: () => vChapters(src, id), dl: dlOpen(src, id) });
  let d;
  try { d = cachedDetail(src, id) || (await getDetail(src, id)); } catch (e) { view.innerHTML = topbar("Daftar chapter") + errBox(e); return; }
  if (parse().name !== "chapters") return;
  const h = S.histItem(src, id), latest = d.chapters[d.chapters.length - 1];
  const row = chRowFor(src, id, h, latest);
  const STEP = 60;
  let q = "", asc = false, shown = STEP, io = null;
  view.innerHTML = topbar("Daftar chapter", dlBtn) + `<div class="px">
  <div class="ch-top" id="chtop"></div>
  <div class="sec-h"><b class="b15">${esc(d.manga.title)}</b><span class="mu sm" id="chcount"></span></div>
  ${h?.chapter_id ? `<div class="row sb resume-line"><span>Terakhir dibuka · Chapter ${esc(h.chapter)}</span><button class="link-red" data-act="find">Temukan ↓</button></div>` : ""}
  <div class="mu xs info" id="chinfo"></div>
  <div id="chl" class="rows"></div><div id="chsent" style="height:1px"></div></div><div class="pad-nav"></div>
  <div class="fade-b" aria-hidden="true"></div>
  <div class="chbar glass" id="chbar"><span class="mu">${icon("search", 20)}</span><label class="grow row"><span class="sr">Cari chapter</span><input id="chq" type="text" inputmode="text" enterkeyhint="search" autocomplete="off" placeholder="Cari chapter…"></label>
    <button class="chx" data-act="clr" aria-label="Hapus pencarian" hidden>${icon("x", 18, 2)}</button><span class="vdiv" aria-hidden="true"></span>
    <button class="chsort" data-act="sort" id="chsort">${icon("sort", 18)}<span>Terbaru</span></button></div>`;
  const list = () => {
    const base = asc ? d.chapters : d.chapters.slice().reverse();
    return base.filter((c) => matchCh(c, q));
  };
  const draw = () => {
    const l = list();
    $("#chcount").textContent = `${d.chapters.length} chapter tersedia${d.more ? " · memuat chapter lama…" : ""}`;
    $("#chl").innerHTML = l.slice(0, shown).map((c) => row(c, true)).join("") || `<div class="empty"><span class="empty-ic">${icon("search", 22)}</span><b>Maaf, chapter tidak tersedia</b><span>Coba nomor chapter lain.</span></div>`;
    $("#chinfo").textContent = (q ? `${l.length} hasil · ` : "") + (asc ? "Urut dari chapter pertama" : "Urut dari chapter terbaru") + (l.length > shown ? ` · menampilkan ${shown} dari ${l.length}` : "");
    $("#chsort span").textContent = asc ? "Terlama" : "Terbaru";
    $(".chx").hidden = !q;
  };
  // tampilkan bertahap (60 per gulir) agar ratusan chapter tetap ringan
  io = new IntersectionObserver((e) => { if (e[0].isIntersecting && list().length > shown) { shown += STEP; draw(); } }, { rootMargin: "600px" });
  io.observe($("#chsent"));
  const inp = $("#chq");
  inp.addEventListener("input", () => { q = inp.value.trim(); shown = STEP; draw(); });
  // kolom cari: di bawah saat diam; diketuk → pindah ke atas (tidak tertutup keyboard), gulir daftar → kembali ke bawah
  // Ketukan pertama: tahan fokus sampai jari diangkat (klik selesai di kolom), baru kolom pindah ke atas.
  // Klik nyasar ke daftar tepat setelah kolom pindah diabaikan, supaya tidak membuka chapter.
  let guardUntil = 0;
  const setFoc = (on) => {
    const was = document.body.classList.contains("chfoc");
    document.body.classList.toggle("chfoc", on);
    $("#chbar")?.classList.toggle("was-top", was && !on);
    if (on) { guardUntil = Date.now() + 450; window.scrollTo(0, 0); }
  };
  // keyboard ditutup (tombol kembali / sembunyikan keyboard) tidak melepas fokus di Android:
  // deteksi dari tinggi layar yang kembali normal, lalu turunkan kolom
  const vv = window.visualViewport;
  let fullH = vv ? vv.height : window.innerHeight, kbSeen = false;
  const onVV = () => {
    const h = vv ? vv.height : window.innerHeight;
    if (document.activeElement !== inp) { fullH = h; kbSeen = false; return; }
    if (fullH - h > 150) kbSeen = true;
    else if (kbSeen && fullH - h < 80) { kbSeen = false; inp.blur(); }
  };
  (vv || window).addEventListener("resize", onVV);
  const onKb = (e) => { if (!e.detail.open && document.activeElement === inp) inp.blur(); };
  window.addEventListener("nk:kb", onKb);
  const guard = (e) => { if (Date.now() < guardUntil && !e.target.closest("#chbar")) { e.preventDefault(); e.stopPropagation(); } };
  document.addEventListener("click", guard, true);
  inp.addEventListener("pointerdown", (e) => { if (document.activeElement !== inp) e.preventDefault(); });
  inp.addEventListener("click", () => { if (document.activeElement === inp) return; setFoc(true); try { inp.focus({ preventScroll: true }); } catch { inp.focus(); } });
  inp.addEventListener("focus", () => { if (!document.body.classList.contains("chfoc")) setFoc(true); });
  inp.addEventListener("blur", () => setFoc(false));
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); });
  // gulir daftar (bukan sentuhan kecil) → tutup keyboard, kolom kembali ke bawah
  let ty = null;
  const tstart = (e) => { ty = e.touches?.[0]?.clientY ?? null; };
  const drop = (e) => {
    if (document.activeElement !== inp || Date.now() < guardUntil || e.target.closest?.("#chbar")) return;
    if (e.type === "touchmove" && ty !== null && Math.abs((e.touches?.[0]?.clientY ?? ty) - ty) < 12) return;
    inp.blur();
  };
  window.addEventListener("touchstart", tstart, { passive: true });
  window.addEventListener("touchmove", drop, { passive: true });
  window.addEventListener("wheel", drop, { passive: true });
  // chapter lama datang belakangan: gambar ulang daftar tanpa mengganggu pencarian & posisi gulir
  const onMore = (e) => { if (e.detail.key === src + "|" + id && parse().name === "chapters") { const y = window.scrollY; draw(); window.scrollTo(0, y); } };
  window.addEventListener("nk:chapters", onMore);
  cleanup = () => { io.disconnect(); window.removeEventListener("nk:chapters", onMore); window.removeEventListener("nk:kb", onKb); (vv || window).removeEventListener("resize", onVV); window.removeEventListener("touchstart", tstart); window.removeEventListener("touchmove", drop); window.removeEventListener("wheel", drop); document.removeEventListener("click", guard, true); document.body.classList.remove("chfoc"); };
  setActs({
    back: () => backTo(comicHref(src, id)),
    sort: () => { asc = !asc; shown = STEP; draw(); window.scrollTo({ top: 0, behavior: "smooth" }); },
    clr: () => { inp.value = ""; q = ""; shown = STEP; draw(); inp.focus({ preventScroll: true }); },
    dl: dlOpen(src, id),
    find: () => {
      const l = list(), i = l.findIndex((c) => c.id === h.chapter_id);
      if (i < 0) return;
      if (i >= shown) { shown = i + STEP; draw(); }
      $("#chl .ch.cur")?.scrollIntoView({ block: "center", behavior: "smooth" });
    },
  });
  draw();
}

/* ---------- Pembaca (gulir atau slide), tampilan sama seperti prototipe ---------- */
const pagesMem = new Map();
let readerSeq = 0;
async function vReader(src, id, chId) {
  const shell = (inner) => `<div class="reader ui enter" id="rd" data-shell="1">${inner}<div class="r-top"><button class="r-round glass" data-act="back" aria-label="Kembali">${icon("back", 22, 2)}</button><div class="r-pill glass"><b class="t1">Memuat…</b></div><span class="r-sp"></span></div></div>`;
  // Halaman sebelumnya tetap terlihat selama data chapter dimuat; layar "Memuat…" baru dipasang bila butuh > 1,2 dtk
  // (sebelumnya langsung tampil layar gelap kosong sekejap sebelum halaman komik → terlihat seperti kedipan)
  const myR = ++readerSeq;
  // Animasi bar meluncur masuk HANYA saat masuk dari luar pembaca (mis. info komik), dan baru setelah halaman siap.
  // Pindah chapter di dalam pembaca (lanjut/sebelumnya/daftar chapter/muat ulang) langsung tampil tanpa animasi.
  const rd0 = $("#rd"), inReader = !!rd0 && !rd0.dataset.shell;
  let shellShown = false;
  setTimeout(() => {
    if (myR !== readerSeq || parse().name !== "reader" || $("#rd")) return;
    // layar "Memuat…" tampil diam (tanpa bar meluncur) supaya tidak terlihat seperti macet
    view.innerHTML = shell(`<div class="r-pages">${loading(3, "sk-page")}</div>`).replace('class="reader ui enter"', 'class="reader ui"');
    shellShown = true;
  }, 1200);
  const fail = (e) => {
    if (myR !== readerSeq || parse().name !== "reader") return;
    if (!$("#rd")) view.innerHTML = shell(`<div class="r-pages"></div>`);
    $("#rd").classList.remove("enter"); $(".r-pages").innerHTML = errBox(e);
  };
  // file impor dari HP (src "local") tidak punya halaman info komik, kembali ke Favorit → Unduhan
  const isLocal = src === "local";
  const toComic = () => (isLocal ? backTo("#/fav/dl") : backTo(comicHref(src, id), [chaptersHref(src, id)]));
  // tombol kembali: bar atas & bawah meluncur keluar dulu (±0,18 dtk), lalu pindah ke info komik yang meluncur masuk
  // (bilah status HP tidak ikut disembunyikan sesaat saat bar meluncur keluar: lihat "leaving" di syncFs)
  let leaving = false;
  const leave = () => { const r = $("#rd"); if (r && r.classList.contains("ui") && !r.dataset.shell && !matchMedia("(prefers-reduced-motion: reduce)").matches) { leaving = true; r.classList.remove("ui"); setTimeout(toComic, 180); } else toComic(); };
  setActs({ back: leave, retry: () => vReader(src, id, chId) });
  let d = isLocal ? DL.offlineDetail(src, id) : cachedDetail(src, id);
  try { if (!d) d = await getDetail(src, id); }
  catch (e) { d = DL.offlineDetail(src, id); if (!d) { fail(e); return; } }   // offline: info dari unduhan
  if (!d) { fail(new Error("File unduhan tidak ditemukan di HP.")); return; }
  const idx = d.chapters.findIndex((c) => c.id === chId);
  // arah animasi pindah chapter (lihat render): mundur bila urutan chapter baru lebih kecil dari yang tadi dibaca
  rdBack = !!rdLast && rdLast.k === src + "|" + id && idx >= 0 && idx < rdLast.i; rdLast = { k: src + "|" + id, i: idx };
  const ch = d.chapters[idx] || { id: chId, ch: "?" };
  const prev = d.chapters[idx - 1], next = d.chapters[idx + 1];
  // chapter yang sudah diunduh dibaca dari file di HP (tanpa kuota, bisa offline)
  let p;
  try { p = await DL.localPages(src, id, chId); }
  catch (e) { if (e?.localRead) { fail(e); return; } p = null; }
  if (!p) {
    if (isLocal) { fail(new Error("File unduhan tidak ditemukan di HP.")); return; }
    // daftar halaman disimpan sebentar di memori: kembali ke chapter yang sama (mis. dari info komik) langsung tampil
    const pk = src + "|" + chId, pc = pagesMem.get(pk);
    if (pc && Date.now() - pc.t < 30 * 60e3) p = pc.p;
    else {
      try { p = await api.call("pages", { source: src, chapter_id: chId }); } catch (e) { fail(e); return; }
      pagesMem.set(pk, { p, t: Date.now() }); if (pagesMem.size > 12) pagesMem.delete(pagesMem.keys().next().value);
    }
  }
  if (parse().name !== "reader" || myR !== readerSeq) return;
  const st = S.state.settings, total = p.images.length;
  // manga: boleh scroll & slide. manhwa/manhua (strip panjang): hanya scroll. Jenis dari tag sumber;
  // bila tag tidak menyebut jenisnya, dari bentuk gambar (lihat cekStrip di bawah), diingat per komik.
  const kind = typeFromTags(d.manga.tags), stripKey = `${src}|${id}`;
  const stripSeen = api.lsGet("stripComics", {}) || {};
  const longStrip = kind === "manhwa" || kind === "manhua" || (kind !== "manga" && !!stripSeen[stripKey]);
  let slide = st.readMode === "slide" && !longStrip;
  const rtl = st.readDir !== "ltr";
  // Hemat kuota: hanya 2 halaman pertama yang langsung diunduh. Halaman lain memakai data-src dan baru diunduh
  // saat mendekati layar (lihat lazyIo). Sebelumnya semua gambar belum bertinggi (0 px) sehingga "lazy" bawaan
  // browser menganggap semuanya dekat layar dan seluruh chapter langsung diunduh.
  // halaman tujuan (lanjut baca) dimuat & di-decode dulu selagi halaman sebelumnya masih tampil (maks 0,6 dtk),
  // supaya pembaca langsung muncul berisi gambar, bukan layar hitam kosong sekejap
  const pk0 = `${src}|${id}|${chId}`, pm0 = api.lsGet("readPos", {}) || {}, ph0 = S.histItem(src, id);
  let at0 = Number(pm0[pk0]) || (ph0?.chapter_id === chId ? Number(ph0.page) || 1 : 1);
  if (!(at0 > 1 && at0 < p.images.length)) at0 = 1;
  const near = (i) => i >= at0 - 5 && i <= at0;   // indeks 0-based: halaman tujuan & 4 sebelumnya (yang ikut termuat di dekat layar)
  // Situs yang menolak dimuat langsung (mis. Shinigami butuh Referer) diambil lewat jaringan HP di sini juga, jadi gambar
  // halaman tujuan sudah ada saat pembaca digambar (sebelumnya: layar hitam sampai jalur cadangan selesai).
  const preOne = async (im) => {
    if (im.local) { const x = new Image(); x.src = im.u; return x.decode().catch(() => {}); }
    const { src: u, d } = N.imgParts(im.u), direct = d || (/^https:\/\//i.test(u) ? u : "");
    if (direct && N.nativeFirst(direct)) return N.imageViaNative(direct, p.ref || "").catch(() => {});
    const x = new Image(); x.referrerPolicy = "no-referrer"; x.src = u;
    try { await x.decode(); } catch { if (N.isApp && direct) await N.imageViaNative(direct, p.ref || "").catch(() => {}); }
  };
  const preIdx = new Set(p.images.map((_, i) => i).filter((i) => i < 2 || near(i)).slice(0, 8));
  if (preIdx.size) await Promise.race([Promise.all([...preIdx].map((i) => preOne(p.images[i]))), new Promise((r) => setTimeout(r, 1000))]);
  if (parse().name !== "reader" || myR !== readerSeq) return;
  const imgs = p.images.map((im, i) => {
    let a = im.local ? `src="${esc(im.u)}"` : N.imgAttrs(im.u, { ref: p.ref || "", px: im.p ? api.pageUrl(im.p) : "" });
    // sudah diambil lewat jaringan HP saat pra-muat → langsung pakai hasilnya (tanpa percobaan langsung yang gagal dulu)
    const b = !im.local && N.blobFor(N.imgParts(im.u).d || N.imgParts(im.u).src);
    if (b) a = a.replace(/^src="[^"]*"/, `src="${b}" data-fb="1"`);
    // halaman yang sudah dipra-muat langsung digambar (decoding sync) supaya tidak berkedip hitam saat chapter dibuka
    return `<img class="r-img wait" data-i="${i + 1}" ${i > 1 && !near(i) && !b ? a.replace(/^src=/, "data-src=") : a} alt="" aria-label="Halaman ${i + 1}" decoding="${preIdx.has(i) ? "sync" : "async"}" referrerpolicy="no-referrer" draggable="false">`;
  });

  const animIn = !inReader && !shellShown && !matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Pindah chapter: halaman chapter lama digeser keluar penuh sementara chapter baru masuk dari sisi lain (seperti
  // membalik halaman). Dulu halaman lama langsung hilang lalu halaman baru meloncat 44px → terlihat seperti glitch.
  let ghost = null;
  const swap = inReader && !matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (swap) {
    const ob = $("#rbox");
    if (ob) {
      const st = ob.scrollTop, sl = ob.scrollLeft;
      ob.removeAttribute("id"); ob.querySelectorAll("[id]").forEach((x) => x.removeAttribute("id"));
      ghost = document.createElement("div"); ghost.className = `r-ghost ${rdBack ? "gb" : "gf"}`;
      ghost.setAttribute("aria-hidden", "true"); ghost.inert = true; ghost.append(ob);
      ghost._pos = [st, sl];
    }
  }
  view.innerHTML = `<div class="reader ui ${animIn ? "enter" : ""} ${slide ? "slide" : ""} ${ghost ? (rdBack ? "swap-b" : "swap-f") : ""}" id="rd">
  ${slide ? `<div class="r-slides" id="rbox" dir="${rtl ? "rtl" : "ltr"}">${imgs.map((im) => `<div class="r-slide">${im}</div>`).join("")}<div class="r-slide r-endslide"><span class="mu sm">Akhir chapter ${esc(ch.ch)}</span>${next ? `<button class="r-next-hint" id="rnext" data-act="cancelNext" hidden><span class="r-nbar"></span><span class="r-ntx"></span></button>` : ""}${isLocal ? "" : `${chLike(null)}<a class="btn ghost" href="${commentsHref(src, id, chId)}">${icon("msg", 18)}Komentar chapter ini</a>`}</div></div>`
    : `<div class="r-scroll" id="rbox"><div class="r-pages" id="rpages">${imgs.join("")}<div class="r-endtxt"><span class="mu sm">Akhir chapter ${esc(ch.ch)}</span>${next ? `<button class="r-next-hint" id="rnext" data-act="cancelNext" hidden><span class="r-nbar"></span><span class="r-ntx"></span></button>` : ""}${isLocal ? "" : `${chLike(null)}<a class="btn ghost" href="${commentsHref(src, id, chId)}">${icon("msg", 18)}Komentar chapter ini<span class="cm-n" id="rcmn"></span></a>`}</div></div></div>`}
  <div class="r-top">
    <button class="r-round glass" data-act="back" aria-label="Kembali">${icon("back", 22, 2)}</button>
    <button class="r-pill glass" data-act="chlist" aria-label="Daftar chapter"><b class="t1">${esc(d.manga.title)}</b><span class="mu xs row g4">Chapter ${esc(ch.ch)}${icon("chev", 12, 2.4)}</span></button>
    ${isLocal ? "" : `<a class="r-round glass" href="${commentsHref(src, id, chId)}" aria-label="Komentar chapter">${icon("msg", 20)}</a>`}
    <button class="r-round glass r-reload" data-act="reload" aria-label="Muat ulang chapter">${icon("refresh", 20)}<span class="r-fdot" id="rfdot" hidden></span></button>
    <button class="r-round glass" data-act="menu" aria-label="Pengaturan mode baca" aria-expanded="false">${icon("dots", 22)}</button>
  </div>
  <div class="r-menu-bg" data-act="closeMenu" hidden></div>
  <div class="r-menu glass" role="dialog" aria-label="Mode baca" hidden>
    <span class="cap">Mode baca</span>
    <div class="seg s2 rm-seg" role="radiogroup">${[["scroll", "Scroll", "scroll"], ["slide", "Slide", "slides"]].map(([k, n, ic]) => {
      const on = (slide ? "slide" : "scroll") === k, off = k === "slide" && longStrip;
      return `<button role="radio" aria-selected="${on}" aria-checked="${on}" data-act="rmode" data-v="${k}" ${off ? "disabled" : ""}>${icon(ic, 16)}${n}</button>`; }).join("")}</div>
    ${longStrip ? `<span class="mu xs rm-note">Slide tak tersedia untuk manhwa/manhua.</span>` : ""}
    ${slide ? `<div class="rq-row"><span>Arah geser</span><div class="seg s2">${[["rtl", "Ka → Ki"], ["ltr", "Ki → Ka"]].map(([k, n]) => `<button role="tab" aria-selected="${(rtl ? "rtl" : "ltr") === k}" data-act="rdir" data-v="${k}" aria-label="${k === "rtl" ? "Kanan ke kiri" : "Kiri ke kanan"}">${n}</button>`).join("")}</div></div>` : ""}
    <div class="rq-acts"><button class="rq-act" data-act="chlist"><span class="gold">${icon("list", 18)}</span>Chapter <span class="mu">${esc(ch.ch)}</span></button><button class="rq-act" data-act="rreport"><span class="redt">${icon("bug", 18)}</span>Laporkan</button></div>
    <span class="cap mt4">Bacaan</span><div class="r-togs rq">${readPrefsCompact()}</div>
  </div>
  <div class="r-bottom">
    <div class="r-seek glass"><span class="r-pn"><span id="rpg">1</span> / ${total}</span>
      <div class="r-track" id="rtrack" role="slider" aria-label="Posisi halaman" aria-valuemin="1" aria-valuemax="${total}" aria-valuenow="1" tabindex="0"><span class="r-rail"></span><span class="r-fill" id="rfill"></span><span class="r-knob" id="rknob"></span></div></div>
    <div class="r-btns">
      <button class="r-sq glass" data-act="prev" aria-label="Chapter sebelumnya" ${prev ? "" : "disabled"}>${icon("back", 22, 2.2)}</button>
      ${next ? `<button class="r-main" data-act="main">${icon("play", 16, 2.2)}Lanjut ke Chapter ${esc(next.ch)}</button>`
        : `<button class="r-main last" disabled aria-label="Ini chapter terakhir">${icon("flag", 18, 2)}Chapter Terakhir</button>`}
      <button class="r-sq glass" data-act="next" aria-label="${next ? "Chapter berikutnya" : "Kembali ke info komik"}">${next ? icon("chev", 22, 2.2) : icon("home", 21, 2)}</button>
    </div></div></div>`;
  const rd = $("#rd"), box = $("#rbox"), pages = $("#rpages");
  if (ghost) {
    rd.prepend(ghost); const [st, sl] = ghost._pos; ghost.firstChild.scrollTop = st; ghost.firstChild.scrollLeft = sl;
    const g = ghost, end = () => { g.remove(); rd.classList.remove("swap-f", "swap-b"); };
    g.addEventListener("animationend", end, { once: true }); setTimeout(end, 700);
  }
  // masuk pembaca dari info komik: halaman tampil dulu, bar atas & bawah baru meluncur masuk setelah gambar
  // halaman tujuan selesai dimuat & digambar (maks 2,5 dtk), supaya animasi tidak berjalan bersamaan dengan pemuatan
  if (animIn) {
    const tgt = $$(".r-img", box)[at0 - 1] || $(".r-img", box);
    // gambar yang ditolak situs dicoba ulang lewat jalur lain (ui.js), jadi tunggu "load" yang berhasil, bukan "error"
    const ready = tgt && !(tgt.complete && tgt.naturalWidth) ? new Promise((r) => tgt.addEventListener("load", r, { once: true })) : Promise.resolve();
    Promise.race([ready, new Promise((r) => setTimeout(r, 2500))]).then(() =>
      requestAnimationFrame(() => requestAnimationFrame(() => { if (myR === readerSeq) rd.classList.remove("enter"); })));
  }
  // halaman dimuat langsung dari situs aslinya (tidak memakai kuota Supabase); bila ditolak,
  // penangan error di ui.js mencoba jaringan HP (APK) lalu proxy sebagai cadangan terakhir
  const meta = { source: src, comic_id: id, title: d.manga.title, cover: d.manga.cover, chapter: ch.ch, chapter_id: ch.id, pages: total, type: typeFromTags(d.manga.tags) };
  // posisi terakhir per chapter (12/48 → buka lagi di halaman 12). Selesai sampai halaman terakhir → mulai dari awal.
  const posKey = `${src}|${id}|${ch.id}`, posMap = api.lsGet("readPos", {}) || {}, prevH = S.histItem(src, id);
  let resumeAt = Number(posMap[posKey]) || (prevH?.chapter_id === ch.id ? Number(prevH.page) || 1 : 1);
  if (!(resumeAt > 1 && resumeAt < total)) resumeAt = 1;
  const savePos = (i) => {
    const m = api.lsGet("readPos", {}) || {}; delete m[posKey];
    if (i > 1 && i < total) m[posKey] = i;
    const ks = Object.keys(m); while (ks.length > 400) delete m[ks.shift()];
    api.lsSet("readPos", m);
  };
  if (!isLocal) S.saveHistory({ ...meta, page: resumeAt });
  // EXP baca: hanya setelah chapter dibaca sampai habis (akhir chapter terlihat)
  let awarded = false;
  const finish = () => { if (awarded) return; awarded = true; DL.markRead(src, id, ch.id); if (!isLocal) S.awardRead(src, id, ch.ch); };
  const endEl = $(".r-endtxt, .r-endslide", box);   // (box, bukan rd: rd sesaat juga berisi salinan chapter lama yang sedang digeser keluar)
  let endIo = null;
  if (endEl && "IntersectionObserver" in window) {
    endIo = new IntersectionObserver((es) => {
      const vis = es.some((x) => x.isIntersecting);
      atEnd = vis;
      if (vis) { finish(); if (!rd.classList.contains("zoomed")) showUi(); autoNextStart(); } else autoNextStop();
    }, { root: box, threshold: 0.2 });
    endIo.observe(endEl);
  }
  // like chapter (jumlah dari server, diperbarui optimis)
  let lk = null, lkBusy = false;
  const paintLike = () => $$(".rlike", rd).forEach((b) => { b.outerHTML = chLike(lk); });
  if (!isLocal) S.likeInfo(src, id, ch.ch).then((i) => { if (i && parse().name === "reader") { lk = i; paintLike(); } });
  let curPage = 1;
  const setPage = (i) => {
    if (i < 1 || i > total) return;
    if (i === total && slide) finish();
    const pc = total > 1 ? ((i - 1) / (total - 1)) * 100 : 100;
    $("#rfill").style.width = pc + "%"; $("#rknob").style.left = pc + "%"; $("#rtrack").setAttribute("aria-valuenow", i);
    if (i !== curPage) { curPage = i; $("#rpg").textContent = i; savePos(i); if (!isLocal) S.saveHistory({ ...meta, page: i }); }
  };
  const goPage = (i, smooth = false) => {
    const el = $(`.r-img[data-i="${i}"]`, box); if (!el) return;
    quietUntil = Date.now() + (smooth ? 900 : 400);
    if (slide) { clearZoom(); const w = box.clientWidth; box.scrollTo({ left: (rtl ? -1 : 1) * (i - 1) * w, behavior: smooth ? "smooth" : "auto" }); }
    else box.scrollTo({ top: el.offsetTop, behavior: smooth ? "smooth" : "auto" });
    setPage(i);
  };
  // posisi halaman saat menggulir
  let zoom = 1, zEl = null, zBase = 0, rafPos = 0;
  // menu bacaan otomatis: hilang saat menggulir/menggeser, muncul sendiri di akhir chapter
  let atEnd = false, anchor = 0, quietUntil = 0, seeking = false;
  const menuOpen = () => !$(".r-menu").hidden;
  const showUi = () => { rd.classList.add("ui"); anchor = slide ? Math.abs(box.scrollLeft) : box.scrollTop; };
  // Jarak dihitung dari posisi saat menu terakhir muncul (bukan per frame), jadi gulir pelan 40 px pun cukup.
  const autoHide = () => {
    const pos = slide ? Math.abs(box.scrollLeft) : box.scrollTop;
    if (!S.state.settings.autoHide || atEnd || seeking || menuOpen() || Date.now() < quietUntil || pinch || !rd.classList.contains("ui")) { anchor = pos; return; }
    if (Math.abs(pos - anchor) > (slide ? 30 : 40)) { rd.classList.remove("ui"); anchor = pos; }
  };
  // indikator gulir tipis di tepi kanan (gaya iOS): muncul saat halaman bergerak, menghilang ±0,9 dtk setelah berhenti
  if (!slide) {
    const sb = document.createElement("div"); sb.className = "r-sb"; sb.setAttribute("aria-hidden", "true"); sb.innerHTML = "<i></i>";
    rd.append(sb);
    const th = sb.firstChild; let sbT = 0, sbRaf = 0;
    const sbDraw = () => {
      sbRaf = 0;
      const H = box.clientHeight, S2 = box.scrollHeight, track = sb.clientHeight; if (S2 <= H + 4 || !track) return;
      const len = Math.max(36, Math.round(track * H / S2)), y = Math.round((track - len) * Math.min(1, box.scrollTop / (S2 - H)));
      th.style.height = len + "px"; th.style.transform = `translate3d(0, ${y}px, 0)`;
    };
    box.addEventListener("scroll", () => {
      if (!sbRaf) sbRaf = requestAnimationFrame(sbDraw);
      sb.classList.add("on"); clearTimeout(sbT); sbT = setTimeout(() => sb.classList.remove("on"), 900);
    }, { passive: true });
  }
  box.addEventListener("scroll", () => {
    if (rafPos) return;
    rafPos = requestAnimationFrame(() => {
      rafPos = 0;
      autoHide();
      if (slide) { setPage(Math.round(Math.abs(box.scrollLeft) / (box.clientWidth || 1)) + 1); return; }
      const y = box.scrollTop + box.clientHeight * 0.4;
      let n = 1; for (const im of $$(".r-img", pages)) { if (im.offsetTop <= y) n = Number(im.dataset.i); else break; }
      setPage(n);
    });
  }, { passive: true });
  // ketuk sekali: tampil/sembunyikan tombol; ketuk dua kali: perbesar 2,5× / kembali normal (mode gulir)
  let lastTap = null, tapT = null;
  // Zoom memperbesar LEBAR gambar (bukan CSS zoom) → geser kiri-kanan & gulir tetap mulus untuk
  // manga, manhwa, maupun manhua (strip panjang). Mode gulir: seluruh halaman; mode slide: halaman yang tampil.
  // halaman panjang (manhwa/manhua) vs halaman pendek (manga): batas & tingkat zoom berbeda
  const ZMAX = longStrip ? 3 : 4, ZTAP = longStrip ? 2 : 2.5;
  const zTarget = () => (slide ? $$(".r-slide", box)[curPage - 1]?.querySelector(".r-img") : pages);
  function clearZoom() {
    if (zEl) {
      const sc = slide ? zEl.parentElement : box;
      zEl.style.width = zEl.style.maxWidth = zEl.style.maxHeight = zEl.style.height = "";
      if (slide) { sc.classList.remove("zoomed-slide"); sc.scrollLeft = 0; box.classList.remove("zlock"); }
    }
    zoom = 1; zEl = null; rd.classList.remove("zoomed");
  }
  const applyZoom = (z, fx, fy) => {
    z = Math.max(1, Math.min(ZMAX, z));
    const el = zTarget(); if (!el) return;
    if (zEl && zEl !== el) clearZoom();
    if (!zEl) { if (z <= 1.01) return; zEl = el; zBase = el.getBoundingClientRect().width; zoom = 1; }
    const sc = slide ? el.parentElement : box;
    const r = sc.getBoundingClientRect(), x = fx - r.left, y = fy - r.top, k = z / zoom, sl = sc.scrollLeft, st = sc.scrollTop;
    zoom = z;
    el.style.width = zBase * zoom + "px"; el.style.maxWidth = "none";
    if (slide) { el.style.maxHeight = "none"; el.style.height = "auto"; sc.classList.add("zoomed-slide"); box.classList.add("zlock"); }
    sc.scrollLeft = (sl + x) * k - x; sc.scrollTop = (st + y) * k - y;
    if (zoom <= 1.01) clearZoom(); else rd.classList.add("zoomed");
  };
  // mode slide: halaman strip panjang (manhwa/manhua) dibuat selebar layar dan bisa digulir ke bawah
  if (slide) $$(".r-slide .r-img", box).forEach((im) => {
    const mark = () => { if (im.naturalHeight > im.naturalWidth * 1.8) im.parentElement.classList.add("tall"); };
    if (im.complete && im.naturalWidth) mark(); else im.addEventListener("load", mark, { once: true });
  });
  // Ketukan pertama langsung menampilkan/menyembunyikan menu (tanpa menunggu 320 ms). Bila ternyata ketukan
  // kedua datang cepat (ketuk 2×), menu dikembalikan ke keadaan semula lalu halaman diperbesar.
  const setUi = (on) => (on ? showUi() : rd.classList.remove("ui"));
  box.addEventListener("click", (e) => {
    if (e.target.closest("a,button")) return;
    const now = Date.now();
    if (lastTap && now - lastTap.t < 320 && Math.hypot(lastTap.x - e.clientX, lastTap.y - e.clientY) < 50) {
      clearTimeout(tapT); setUi(lastTap.was); lastTap = null; applyZoom(zoom > 1.05 ? 1 : ZTAP, e.clientX, e.clientY);
    } else {
      const was = rd.classList.contains("ui");
      setUi(!was);
      lastTap = { t: now, x: e.clientX, y: e.clientY, was };
      clearTimeout(tapT); tapT = setTimeout(() => { lastTap = null; }, 320);
    }
  });
  // Cubit untuk memperbesar. Selama dua jari menempel, gambar diperbesar dengan transform (GPU, mulus) dan
  // ikut bergeser mengikuti titik tengah kedua jari (cubit di kiri lalu geser ke kanan → gambar ikut).
  // Saat jari dilepas, hasilnya dikunci menjadi zoom lebar biasa supaya bisa digeser/digulir dengan satu jari.
  // Penahan gulir (touchmove non-pasif) hanya dipasang selama dua jari menempel, jadi gulir satu jari tidak "macet".
  let pinch = null;
  const pinchPaint = () => {
    if (!pinch) return;
    pinch.raf = 0;
    // Kunci di dalam halaman: hasil perbesaran + geseran selalu menutupi layar baca, tidak pernah lewat dari tepi
    // gambar (tidak ada celah hitam di samping/atas/bawah). Bila gambar lebih kecil dari layar, dijaga di dalamnya.
    const { r, B, ox, oy } = pinch, s2 = pinch.s, cl = (v, a, b) => Math.min(Math.max(v, Math.min(a, b)), Math.max(a, b));
    const base = (start, o) => start + o * (1 - s2);          // posisi tepi kiri/atas setelah diperbesar, sebelum digeser
    const lim = (start, size, o, bStart, bSize) => { const w = size * s2, p0 = base(start, o);
      return w >= bSize ? [bStart + bSize - w - p0, bStart - p0] : [bStart - p0, bStart + bSize - w - p0]; };
    pinch.dx = cl(pinch.dx, ...lim(r.left, r.width, ox, B.left, B.width));
    pinch.dy = cl(pinch.dy, ...lim(r.top, r.height, oy, B.top, B.height));
    pinch.el.style.transform = `translate3d(${pinch.dx}px, ${pinch.dy}px, 0) scale(${pinch.s})`;
  };
  const pinchMove = (e) => {
    if (!pinch || e.touches.length !== 2) return;
    const [a, b] = e.touches, dd = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const mx = (a.clientX + b.clientX) / 2, my = (a.clientY + b.clientY) / 2;
    if (!pinch.on && Math.abs(dd - pinch.d) < 10) return;          // dua jari tapi belum mencubit → biarkan bergulir
    e.preventDefault();
    if (!pinch.on) {
      pinch.on = true;
      const el = zTarget(); if (!el) { pinch = null; return; }
      const r = el.getBoundingClientRect(), sc = slide ? el.parentElement : box;
      pinch.el = el; pinch.r = r; pinch.B = sc.getBoundingClientRect(); pinch.ox = pinch.x - r.left; pinch.oy = pinch.y - r.top;
      el.style.transformOrigin = `${pinch.ox}px ${pinch.oy}px`; el.style.willChange = "transform";
    }
    const z = Math.max(1, Math.min(ZMAX, pinch.z * (dd / pinch.d)));
    pinch.s = z / pinch.z;
    // geser ikut jari, diredam sedikit supaya tetap mudah dikendalikan
    pinch.dx = (mx - pinch.x) * 0.9; pinch.dy = (my - pinch.y) * 0.9;
    if (!pinch.raf) pinch.raf = requestAnimationFrame(pinchPaint);
  };
  const pinchEnd = (e) => {
    if (e.touches.length >= 2 || !pinch) return;
    const p = pinch; pinch = null; box.removeEventListener("touchmove", pinchMove);
    if (!p.on) return;
    cancelAnimationFrame(p.raf);
    p.el.style.transform = p.el.style.transformOrigin = p.el.style.willChange = "";
    applyZoom(p.z * p.s, p.x, p.y);
    const sc = slide ? zTarget()?.parentElement : box;
    if (sc && zoom > 1.01) { sc.scrollLeft -= p.dx; sc.scrollTop -= p.dy; }
  };
  box.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 2 || pinch) return;
    const [a, b] = e.touches;
    pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, z: zoom, x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2, on: false, s: 1, dx: 0, dy: 0, raf: 0, el: null };
    box.addEventListener("touchmove", pinchMove, { passive: false });
  }, { passive: true });
  box.addEventListener("touchend", pinchEnd, { passive: true });
  box.addEventListener("touchcancel", pinchEnd, { passive: true });
  // Gulir otomatis (mode Scroll): 1× / 2× / 3×. Selama jari menekan layar → berhenti; jari dilepas → lanjut lagi
  // dari posisi itu (juga setelah menggeser sendiri). Dimatikan lewat pilihan OFF.
  // Berhenti sendiri di akhir chapter; lanjut otomatis ke chapter berikutnya tetap memakai pengaturannya sendiri.
  const AS_PX = { 1: 50, 2: 100, 3: 160 };   // px per detik
  let asRun = false, asHold = false, asRaf = 0, asLast = 0, asY = 0, asHoldT = 0;
  const asSpeed = () => (slide ? 0 : AS_PX[choiceVal("autoScroll")] || 0);
  const asTick = (t) => {
    asRaf = 0;
    if (!asRun || !rd.isConnected || parse().name !== "reader") { asRun = false; return; }
    const v = asSpeed(); if (!v) { asPause(); return; }
    const dt = Math.min(100, t - (asLast || t)); asLast = t;
    if (!asHold && !pinch && zoom <= 1.01 && !menuOpen() && !seeking) {
      if (Math.abs(box.scrollTop - asY) > 2) asY = box.scrollTop;            // digeser sendiri → lanjut dari posisi itu
      const max = box.scrollHeight - box.clientHeight;
      asY = Math.min(max, asY + (v * dt) / 1000); box.scrollTop = asY;
      if (asY >= max - 1) { asPause(); return; }                           // sampai akhir chapter → berhenti
    }
    asRaf = requestAnimationFrame(asTick);
  };
  const asStart = () => { if (!asSpeed() || asRun) return; asRun = true; asLast = 0; asY = box.scrollTop; if (!asRaf) asRaf = requestAnimationFrame(asTick); };
  function asPause() { asRun = false; cancelAnimationFrame(asRaf); asRaf = 0; }
  box.addEventListener("touchstart", () => { asHold = true; clearTimeout(asHoldT); }, { passive: true });
  // jari dilepas: lanjut lagi (gulir manual yang masih meluncur dibiarkan selesai dulu ±0,35 dtk)
  const asUnhold = (e) => { if (e.touches?.length) return; clearTimeout(asHoldT); asHoldT = setTimeout(() => { asHold = false; asY = box.scrollTop; if (asSpeed() && !asRun && !atEnd) asStart(); }, 350); };
  box.addEventListener("touchend", asUnhold, { passive: true }); box.addEventListener("touchcancel", asUnhold, { passive: true });
  // mulai sendiri saat chapter terbuka (pengaturan aktif), setelah pembaca sempat melihat posisinya
  if (asSpeed()) setTimeout(() => { if (rd.isConnected && !atEnd) asStart(); }, 1200);
  // geser slider halaman
  const track = $("#rtrack");
  const seekAt = (clientX) => { const r = track.getBoundingClientRect(); const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width)); goPage(Math.round(f * (total - 1)) + 1); };
  track.addEventListener("pointerdown", (e) => { e.stopPropagation(); seeking = true; track.setPointerCapture(e.pointerId); seekAt(e.clientX); track.onpointermove = (ev) => seekAt(ev.clientX); });
  const seekEnd = () => { track.onpointermove = null; seeking = false; quietUntil = Date.now() + 400; };
  track.addEventListener("pointerup", seekEnd); track.addEventListener("pointercancel", seekEnd);
  track.addEventListener("keydown", (e) => { if (e.key === "ArrowRight") goPage(curPage + 1); if (e.key === "ArrowLeft") goPage(curPage - 1); });
  const menu = (open) => { $(".r-menu").hidden = !open; $(".r-menu-bg").hidden = !open; $("[data-act=menu]").setAttribute("aria-expanded", String(open)); };
  setActs({
    back: leave,
    retry: () => vReader(src, id, chId),
    like: async () => {
      if (!S.loggedIn()) { toast("Masuk dulu untuk memberi like."); return; }
      if (lkBusy) return; lkBusy = true;
      const old = lk || { n: 0, liked: false }, on = !old.liked;
      lk = { n: Math.max(0, old.n + (on ? 1 : -1)), liked: on }; paintLike();
      try { await S.setLike(src, id, ch.ch, d.manga.title, on); } catch (e) { lk = old; paintLike(); toast(e.message); }
      lkBusy = false;
    },
    menu: () => menu($(".r-menu").hidden), closeMenu: () => menu(false),
    rmode: (el) => { S.setSetting("readMode", el.dataset.v); vReader(src, id, chId); },
    chlist: () => { menu(false); openChList(); },
    rreport: () => { menu(false); openReport({ source: src, comic_id: id, title: d.manga.title, chapter_id: chId, chapter: ch.ch }); },
    rdir: (el) => { S.setSetting("readDir", el.dataset.v); vReader(src, id, chId); },
    rtog: (el) => {
      const k = el.dataset.k, on = !S.state.settings[k];
      S.setSetting(k, on);
      flipToggle(el, on);
      if (k === "autoHide") anchor = slide ? Math.abs(box.scrollLeft) : box.scrollTop;
    },
    rch: (el) => {
      const k = el.dataset.k, v = el.dataset.v;
      S.setSetting(k, v);
      flipChoice(el);
      if (k === "screenMode") syncFs();
      if (k === "nextDelay") { autoNextStop(); if (v !== "off" && atEnd) autoNextStart(); }
      if (k === "autoScroll") {
        if (v === "off") asPause();
        else if (slide) toast("Gulir otomatis hanya untuk mode Scroll");
        else { menu(false); asStart(); }
      }
    },
    cancelNext: () => { autoNextStop(true); toast("Lanjut otomatis dibatalkan untuk chapter ini"); },
    reimg: (el) => { const im = $(`.r-img[data-i="${el.dataset.i}"]`, box); if (im) reloadImg(im); },
    reload: () => { menu(false); if (failed.size) { const n = failed.size; [...failed].forEach(reloadImg); toast(`Memuat ulang ${n} gambar yang gagal…`); } else { toast("Memuat ulang chapter…", 1500); vReader(src, id, chId); } },
    prev: () => prev && goReplace(readHref(src, id, prev.id)),
    main: () => (next ? goReplace(readHref(src, id, next.id)) : toComic()),
    next: () => (next ? goReplace(readHref(src, id, next.id)) : toComic()),
  });
  // #10 gambar gagal (server/internet): tombol muat ulang per halaman, menu "Muat ulang chapter",
  // dan otomatis dicoba lagi saat internet tersambung kembali
  const failed = new Set();
  $$(".r-img", box).forEach((im) => { im.dataset.o = im.getAttribute("src") || im.dataset.src || ""; });
  // muat halaman yang mendekati layar: 3 layar ke depan, 1 layar ke belakang (mode slide: 1 halaman ke kiri/kanan),
  // supaya saat digulir gambar berikutnya sudah siap tanpa jeda, tapi tetap tidak mengunduh seluruh chapter
  const loadImg = (im) => {
    const u = im.dataset.src; if (!u) return;
    delete im.dataset.src; im.dataset.t0 = String(Date.now());
    if (N.nativeFirst(im.dataset.d)) { im.dataset.fb = "1"; N.imageViaNative(im.dataset.d, im.dataset.ref || "").then((b) => { im.src = b; }, () => { im.src = u; }); }
    else im.src = u;
  };
  let slowLogged = 0;
  // selain jarak 3 layar, 2 halaman sesudah halaman yang mulai dimuat ikut diunduh (halaman manhwa bisa sangat panjang)
  const loadNear = (im) => { const i = Number(im.dataset.i); [i, i + 1, i + 2].forEach((k) => { const x = $(`.r-img[data-i="${k}"]`, box); if (x?.dataset.src) { loadImg(x); lazyIo.unobserve(x); } }); };
  const lazyIo = new IntersectionObserver((es) => es.forEach((x) => { if (x.isIntersecting) loadNear(x.target); }),
    { root: box, rootMargin: slide ? "0px 100%" : "100% 0px 300% 0px" });
  $$(".r-img[data-src]", box).forEach((im) => lazyIo.observe(im));
  // Tinggi sementara halaman yang belum dimuat = rasio gambar terakhir yang sudah tampil (halaman satu chapter
  // biasanya sama ukurannya), bukan 1 layar penuh. Jadi saat gambar datang, isi layar hampir tidak bergeser.
  rd.addEventListener("load", (e) => {
    const im = e.target; if (!im.classList?.contains("r-img")) return;
    im.classList.remove("wait");
    // Log error (Dev): catat halaman yang lama sekali dimuat, untuk mencari sumber jeda
    const ms = im.dataset.t0 ? Date.now() - Number(im.dataset.t0) : 0;
    if (ms > 2500 && slowLogged++ < 5) N.logDev("img", `halaman ${im.dataset.i} dimuat ${(ms / 1000).toFixed(1)} dtk`, `${src} · ${(im.currentSrc || "").slice(0, 120)}`);
    if (!slide && im.naturalWidth > 0) rd.style.setProperty("--ar", String(im.naturalWidth / im.naturalHeight));
  }, true);
  // tombol muat ulang di bar atas: titik merah = ada gambar yang gagal
  const paintFail = () => { const el = $("#rfdot"); if (el) el.hidden = !failed.size; const b = $("[data-act=reload]", rd); if (b) b.setAttribute("aria-label", failed.size ? `Muat ulang ${failed.size} gambar yang gagal` : "Muat ulang chapter"); };
  const markFail = (im) => {
    im.classList.add("fail"); im.classList.remove("wait"); failed.add(im);
    if (!im.nextElementSibling?.classList.contains("r-fail")) im.insertAdjacentHTML("afterend", `<button class="r-fail" data-act="reimg" data-i="${im.dataset.i}">${icon("refresh", 18, 2)}<span>Halaman ${im.dataset.i} gagal dimuat<br><b>Ketuk untuk muat ulang</b></span></button>`);
    paintFail();
  };
  function reloadImg(im) {
    failed.delete(im); im.classList.remove("fail");
    if (im.nextElementSibling?.classList.contains("r-fail")) im.nextElementSibling.remove();
    delete im.dataset.fb; delete im.dataset.src; im.src = im.dataset.o; paintFail();
  }
  rd.addEventListener("error", async (e) => {
    const im = e.target;
    if (!(im instanceof HTMLImageElement) || !im.classList.contains("r-img")) return;
    if ((im.dataset.d || im.dataset.px) && await N.imgFallback(im)) return;
    markFail(im);
  }, true);
  const onOnline = () => { if (failed.size) { [...failed].forEach(reloadImg); toast("Internet tersambung, memuat ulang gambar…"); } };
  addEventListener("online", onOnline);
  // Mode fullscreen: bilah status HP mengikuti menu bacaan. Menu tampil → bilah tampil; menu hilang
  // (diketuk atau digulir) → bilah disembunyikan. Mode standar: bilah selalu tampil.
  const syncFs = () => { if (leaving) return; const fs = choiceVal("screenMode") === "fullscreen"; N.setFullscreen(fs && !rd.classList.contains("ui"), fs); };
  const fsObs = new MutationObserver(syncFs);
  fsObs.observe(rd, { attributes: true, attributeFilter: ["class"] });
  syncFs();   // langsung saat pembaca dibuka (juga pindah chapter: overlay tetap, halaman tidak melompat)
  // Di akhir chapter (pengaturan "Di akhir chapter"): "menu" = menu bacaan muncul (bawaan);
  // "auto" = hitung mundur 2 detik lalu chapter berikutnya terbuka. Batal bila petunjuk diketuk atau
  // pembaca menggulir kembali ke atas. Tidak berjalan saat chapter baru dibuka (belum digulir).
  const hint = $("#rnext");
  let nextT = null, nextOff = false;
  function autoNextStop(cancel = false) {
    clearTimeout(nextT); nextT = null; if (cancel) nextOff = true;
    if (hint) { hint.hidden = true; hint.classList.remove("run"); }
  }
  function autoNextStart() {
    const sec = Number(choiceVal("nextDelay")) || 0;
    if (!next || !hint || nextT || nextOff || !sec || zoom > 1.02) return;
    if (!slide && box.scrollTop < 40 && curPage <= 1) return;
    hint.querySelector(".r-ntx").textContent = `Lanjut ke Chapter ${next.ch}… ketuk untuk batal`;
    hint.style.setProperty("--nd", sec + "s");   // panjang bilah hitung mundur = jeda yang dipilih
    hint.hidden = false; hint.classList.remove("run"); void hint.offsetWidth; hint.classList.add("run");
    nextT = setTimeout(() => { nextT = null; if (parse().name === "reader" && atEnd) goReplace(readHref(src, id, next.id)); else autoNextStop(); }, sec * 1000);
  }
  // #2 kembali ke halaman terakhir dibaca. Mode gulir: halaman sebelumnya dimuat dulu supaya posisinya tepat;
  // berhenti menyesuaikan begitu pembaca menyentuh layar.
  if (resumeAt > 1) {
    let stop = false;
    const quit = () => { stop = true; };
    box.addEventListener("touchstart", quit, { once: true, passive: true });
    box.addEventListener("wheel", quit, { once: true, passive: true });
    setTimeout(quit, 10000);
    // halaman sebelum posisi itu TIDAK diunduh (hemat kuota); halaman kosong punya tinggi sementara, dan
    // posisi disesuaikan lagi setiap kali gambar di sekitar tujuan selesai dimuat
    const jump = () => { if (!stop && parse().name === "reader") goPage(resumeAt); };
    // langsung (sebelum layar digambar) supaya pembaca tidak sempat tampil di halaman 1 lalu melompat;
    // selama 2 frame pertama halaman disembunyikan sampai posisinya pasti
    rd.classList.add("resuming"); jump();
    requestAnimationFrame(() => { jump(); requestAnimationFrame(() => rd.classList.remove("resuming")); });
    if (!slide) $$(".r-img", box).slice(0, resumeAt).forEach((im) => im.addEventListener("load", jump, { once: true }));   // semua halaman di atas tujuan: tingginya berubah saat termuat
    toast(`Lanjut dari halaman ${resumeAt}`, 1800);
  }
  cleanup = () => { lazyIo.disconnect(); fsObs.disconnect(); clearTimeout(tapT); clearTimeout(nextT); cancelAnimationFrame(rafPos); endIo?.disconnect(); removeEventListener("online", onOnline); (parse().name === "reader" ? 0 : N.setFullscreen(false, false)); S.flushHistory(); };   // ke halaman lain: bilah status dikembalikan SEBELUM halaman baru digambar (tidak melompat setelahnya); pindah chapter: status layar tidak disentuh sama sekali sampai chapter baru tampil (dulu dilepas setelah 0,3 dtk → seluruh layar bergeser naik-turun saat chapter lambat dimuat)
  // jenis belum diketahui dari tag: periksa bentuk beberapa gambar pertama. Kebanyakan sangat tinggi
  // (tinggi > 1,8× lebar) → strip panjang manhwa/manhua: diingat, dan mode slide dialihkan ke scroll.
  if (!kind && !longStrip) {
    const firsts = $$(".r-img", box).slice(0, 4);
    const cekStrip = () => {
      const done = firsts.filter((im) => im.complete && im.naturalWidth);
      if (done.length < Math.min(2, firsts.length)) return;
      const tall = done.filter((im) => im.naturalHeight > im.naturalWidth * 1.8).length;
      if (tall < Math.max(1, Math.ceil(done.length / 2))) return;
      firsts.forEach((im) => im.removeEventListener("load", cekStrip));
      const m = api.lsGet("stripComics", {}) || {}; m[stripKey] = 1;
      const keys = Object.keys(m); if (keys.length > 500) delete m[keys[0]];
      api.lsSet("stripComics", m);
      if (slide && parse().name === "reader") { toast("Halaman panjang (manhwa/manhua): mode scroll dipakai."); vReader(src, id, chId); }
    };
    firsts.forEach((im) => im.addEventListener("load", cekStrip));
    cekStrip();
  }
  // daftar chapter di pembaca: 50 per muat, bisa dicari; kolom cari di atas panel (tidak tertutup keyboard)
  function openChList() {
    $$(".chs-host").forEach((x) => x.remove());
    const desc = [...d.chapters].reverse(), ci = desc.length - 1 - idx;
    let start = Math.max(0, ci - 10), end = Math.min(desc.length, start + 50), q = "";
    const host = document.createElement("div");
    host.className = "chs-host";
    host.innerHTML = `<button class="chs-bg" data-x="close" aria-label="Tutup daftar chapter"></button>
      <div class="chs" role="dialog" aria-label="Daftar chapter">
        <div class="chs-h"><span class="col grow g4"><b>Daftar chapter</b><span class="mu xs t1">${esc(d.manga.title)} · ${desc.length} chapter</span></span>
          <button class="x-btn" data-x="close" aria-label="Tutup">${icon("x", 16, 2.2)}</button></div>
        <label class="chs-q"><span class="mu">${icon("search", 18)}</span><span class="sr">Cari chapter</span>
          <input id="chsq" type="text" inputmode="text" enterkeyhint="search" autocomplete="off" placeholder="Cari nomor atau judul chapter…">
          <button class="chx" data-x="clr" aria-label="Hapus pencarian" hidden>${icon("x", 16, 2)}</button></label>
        <div class="chs-list" id="chsl"></div></div>`;
    document.body.append(host);
    const L = $("#chsl", host), inp = $("#chsq", host);
    const row = (c) => { const cur = c.id === chId; return `<a class="chs-i ${cur ? "cur" : ""}" href="${readHref(src, id, c.id)}" data-x="go" data-id="${esc(c.id)}">
      <span class="col grow g2"><b>Chapter ${esc(c.ch)}</b>${c.title ? `<span class="mu xs t1">${esc(c.title)}</span>` : ""}</span>
      ${cur ? `<span class="chs-tag">Sedang dibaca</span>` : c.at ? `<span class="mu xs">${esc(ago(c.at))}</span>` : ""}</a>`; };
    const draw = () => {
      if (q) {
        const r = desc.filter((c) => matchCh(c, q));
        L.innerHTML = r.slice(0, 50).map(row).join("") || `<div class="chs-empty">Chapter “${esc(q)}” tidak ditemukan</div>`;
        if (r.length > 50) L.insertAdjacentHTML("beforeend", `<div class="chs-empty">Menampilkan 50 dari ${r.length} hasil · perjelas pencarian</div>`);
        return;
      }
      L.innerHTML = (start > 0 ? `<button class="chs-more" data-x="prev">${icon("chev", 15, 2.2)}Muat ${Math.min(50, start)} chapter lebih baru</button>` : "")
        + desc.slice(start, end).map(row).join("")
        + (end < desc.length ? `<button class="chs-more" data-x="next">Muat ${Math.min(50, desc.length - end)} chapter berikutnya${icon("chev", 15, 2.2)}</button>` : "");
    };
    draw();
    requestAnimationFrame(() => { const c = $(".chs-i.cur", host); if (c) L.scrollTop = c.offsetTop - L.clientHeight / 2 + c.offsetHeight / 2; });
    inp.addEventListener("input", () => { q = inp.value.trim(); $("[data-x=clr]", host).hidden = !q; L.scrollTop = 0; draw(); });
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); });
    host.addEventListener("click", (e) => {
      const b = e.target.closest("[data-x]"); if (!b) return;
      const a = b.dataset.x;
      if (a === "close") host.remove();
      else if (a === "clr") { inp.value = ""; q = ""; b.hidden = true; draw(); }
      else if (a === "prev") { const h = L.scrollHeight, y = L.scrollTop; start = Math.max(0, start - 50); draw(); L.scrollTop = y + (L.scrollHeight - h); }
      else if (a === "next") { end = Math.min(desc.length, end + 50); draw(); }
      else if (a === "go") { e.preventDefault(); host.remove(); if (b.dataset.id !== chId) goReplace(readHref(src, id, b.dataset.id)); }
    });
  }
  if (!isLocal) roomCount(roomFor(src, id, chId)).then((n) => { const el = $("#rcmn"); if (el && n) el.textContent = n; }).catch(() => {});
  const h = S.histItem(src, id);
  if (h?.chapter_id === chId && h.page > 1) setTimeout(() => goPage(h.page), 350);
}

/* ---------- foto profil: maks 10 MB, dipotong persegi 512 px (WebP), foto lama langsung dihapus ---------- */
const AV_MAX = 10 * 1024 * 1024;
async function squareWebp(file, size = 512) {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height), out = Math.min(size, side);
  const c = document.createElement("canvas"); c.width = c.height = out;
  c.getContext("2d").drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, out, out);
  const blob = await new Promise((r) => c.toBlob(r, "image/webp", 0.86));
  if (!blob || blob.type !== "image/webp") return { blob: await new Promise((r) => c.toBlob(r, "image/jpeg", 0.88)), ext: "jpg" };
  return { blob, ext: "webp" };
}
async function setAvatar(file) {
  const uid = api.userId(), old = S.state.profile?.avatar_path || null;
  let path = null;
  if (file) {
    const { blob, ext } = await squareWebp(file);
    path = `${uid}/${Date.now()}.${ext}`;
    await api.upload("avatars", path, new File([blob], "foto." + ext, { type: blob.type }));
  }
  try { await api.rest(`profiles?id=eq.${uid}`, { method: "PATCH", body: { avatar_path: path }, prefer: "return=minimal" }); }
  catch (e) { if (path) api.removeFile("avatars", path).catch(() => {}); throw e; }
  // foto lama tidak dipakai lagi → hapus agar penyimpanan tetap hemat
  if (old && old !== path) api.removeFile("avatars", old).catch(() => {});
  await S.loadProfile();
}
function openPhoto() {
  const p = S.state.profile, lv = S.levelOf(p);
  const el = openSheet(`<span class="sheet-ttl">Foto profil</span>
    <div class="pf-prev">${avatarHtml(p, lv, 116, { noMedal: true })}</div>
    <span class="mu xs center pf-hint">JPG, PNG, WEBP, atau GIF · maks 10 MB · dipotong persegi di tengah</span>
    <label class="btn primary pf-pick">${icon("img", 18)}<span class="pf-t">${p?.avatar_path ? "Ganti foto" : "Pilih foto"}</span><input type="file" id="pfile" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>
    ${p?.avatar_path ? `<button class="sh-row red" data-s="rm">${icon("trash", 18)}Hapus foto profil</button>` : ""}
    <button class="sh-cancel" data-s="close">Batal</button>`, async (b) => {
    if (b.dataset.s !== "rm") return;
    if (!(await ask("Hapus foto profil? Avatar kembali memakai huruf awal nama.", { ok: "Hapus", danger: true }))) return;
    b.disabled = true;
    try { await setAvatar(null); closeSheet(); toast("Foto profil dihapus"); if (route.name === "more") vMore(); }
    catch (e) { b.disabled = false; toast(e.message, 4500); }
  });
  watchFx();
  $("#pfile", el).addEventListener("change", async (e) => {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) return toast("Format harus JPG, PNG, WEBP, atau GIF");
    if (f.size > AV_MAX) return toast(`Foto terlalu besar (${(f.size / 1048576).toFixed(1).replace(".", ",")} MB). Maksimal 10 MB.`, 4000);
    const pick = $(".pf-pick", el), t = $(".pf-t", el), was = t.textContent;
    pick.classList.add("busy"); t.textContent = "Mengunggah…";
    try { await setAvatar(f); closeSheet(); toast("Foto profil diperbarui"); if (route.name === "more") vMore(); }
    catch (er) { toast(er.message, 4500); pick.classList.remove("busy"); t.textContent = was; }
  });
}

/* ---------- status notifikasi HP di Lainnya ---------- */
let lastPushErr = "";
function showPush(st) {
  const el = $("#pushst"); if (!el) return;
  const err = N.pushError();
  el.textContent = { on: "Aktif · HP terdaftar · ketuk untuk kirim tes", off: "Mati · ketuk untuk mengaktifkan", denied: "Diblokir di pengaturan HP",
    unsupported: "Tidak tersedia", busy: "Mendaftarkan HP…", unreg: "Izin aktif, tapi HP belum terdaftar · ketuk untuk daftar ulang",
    login: "Izin aktif · masuk dulu agar notifikasi terkirim",
    server: "HP terdaftar, tapi server gagal mengirim" + (lastPushErr ? ": " + lastPushErr : "") + " · ketuk untuk coba lagi", error: "Gagal mendaftar" + (err ? ": " + err : "") + " · ketuk untuk coba lagi" }[st] || st;
}
async function refreshPushStatus() {
  const st = await N.pushStatus();
  if (st !== "on") return showPush(st);
  if (!S.loggedIn()) return showPush("login");
  showPush("busy");
  try { await N.pushEnable(api.rpc, false); showPush("on"); } catch { showPush("error"); }
}

/* ---------- Komentar komik / chapter (logika sama dengan chat publik) ---------- */
async function vComments(src, id, chId) {
  let d = cachedDetail(src, id);
  if (!d) { try { d = await getDetail(src, id); } catch {} }
  const ch = chId && d?.chapters.find((c) => c.id === chId);
  const title = d?.manga.title || "Komik";
  cleanup = await vChat(view, ctx(), {
    room: roomFor(src, id, chId), title: chId ? `Komentar Chapter ${ch?.ch ?? ""}`.trim() : "Komentar",
    sub: chId ? `${title} · Chapter ${ch?.ch ?? ""}` : title, cover: cover(d?.manga.cover, title, "rm"),
    backHref: chId ? readHref(src, id, chId) : comicHref(src, id),
  });
}

/* ---------- Favorit ---------- */
// Label "Terbaru" & urutan "Update terbaru" di Koleksi butuh chapter terbaru tiap komik. Sebelumnya baru diketahui
// setelah komik dibuka (HP / pemasangan baru: kosong semua). Sekarang dicek di belakang layar saat Koleksi dibuka:
// maks. 12 komik per kunjungan, 2 sekaligus, tiap komik paling sering 3 jam sekali. Shinigami/WestManga di APK
// diambil lewat jaringan HP (detail), sumber lain lewat action "latest" yang hanya mengirim chapter terbaru.
let latestRun = false;
async function refreshLatest(items) {
  if (latestRun) return;
  const chk = api.lsGet("latestChk", {}) || {}, now = Date.now();
  const due = items.filter((m) => now - (chk[m.source + "|" + m.comic_id] || 0) > 3 * 3600e3)
    .sort((a, b) => (a.latest == null ? 0 : 1) - (b.latest == null ? 0 : 1)).slice(0, 12);
  if (!due.length) return;
  latestRun = true;
  const one = async (m) => {
    const k = m.source + "|" + m.comic_id;
    try {
      let ch = null, at = null;
      if (N.DIRECT[m.source]) { const d = await api.call("detail", { source: m.source, comic_id: m.comic_id }); const t = (d.chapters || []).reduce((b, c) => (!b || (parseFloat(c.ch) || -1) > (parseFloat(b.ch) || -1) ? c : b), null); ch = t?.ch ?? null; at = t?.at ?? null; }
      else ({ ch, at } = await api.call("latest", { source: m.source, comic_id: m.comic_id }));
      if (ch != null) S.updateLibMeta(m.source, m.comic_id, { latest: ch, latestAt: at });
    } catch { /* sumber sedang tidak bisa dijangkau: coba lagi lain kali */ }
    const c2 = api.lsGet("latestChk", {}) || {}; c2[k] = Date.now();
    const ks = Object.keys(c2); while (ks.length > 600) delete c2[ks.shift()];
    api.lsSet("latestChk", c2);
  };
  try { for (let i = 0; i < due.length; i += 2) await Promise.all(due.slice(i, i + 2).map(one)); }
  finally { latestRun = false; }
}
const FAV_SORTS = [["update", "Update terbaru"], ["added", "Terakhir ditambah"], ["az", "Judul A-Z"], ["za", "Judul Z-A"]];
let fav = { tab: "lib", q: "", filter: "all" };
// perilaku tab Unduhan dilepas setiap kali Favorit digambar ulang (tidak menumpuk)
let favDlOff = null, favShell = "";
const FAV_CARDS = "<!--kartu-->";
function vFav(tab, soft = false) {
  if (favDlOff) { favDlOff(); favDlOff = null; }
  if (tab && ["lib", "hist", "dl"].includes(tab)) fav.tab = tab;
  const grid = S.state.settings.favView === "grid";
  const readOf = (m) => S.histItem(m.source, m.comic_id);
  // ada chapter yang belum dibaca (untuk lencana +N / lanjut di tampilan daftar)
  const isNew = (m) => { const r = readOf(m); return m.latest != null && r && parseFloat(m.latest) > parseFloat(r.chapter); };
  // label "NEW UPDATE" & filter "New update": chapter terbaru rilis < 24 jam lalu (tetap tampil walau sudah dibaca, supaya rapi)
  // tanggal tanpa jam (sebagian sumber) = tengah malam waktu HP pada hari itu, jadi rilis "hari ini" tetap terhitung baru
  const tsOf = (v) => { const d = /^(\d{4})-(\d\d)-(\d\d)$/.exec(v || ""); const t = d ? new Date(+d[1], d[2] - 1, +d[3]).getTime() : Date.parse(v || ""); return Number.isFinite(t) ? t : 0; };
  const isFresh = (m) => { const t = tsOf(m.latestAt); return t > 0 && Date.now() - t < 864e5; };
  // urutan koleksi: update terbaru (tanggal chapter terakhir yang diketahui saat komik dibuka), terakhir ditambah, judul
  const fs = FAV_SORTS.some(([k]) => k === S.state.settings.favSort) ? S.state.settings.favSort : "update";
  const byAdded = (a, b) => (b.added_at || "").localeCompare(a.added_at || "");
  const byTitle = (a, b) => String(a.title || "").localeCompare(String(b.title || ""), "id", { sensitivity: "base", numeric: true });
  const libAll = [...S.state.lib.values()].sort(fs === "added" ? byAdded : fs === "az" ? byTitle : fs === "za" ? (a, b) => byTitle(b, a)
    : (a, b) => (tsOf(b.latestAt) || tsOf(b.added_at)) - (tsOf(a.latestAt) || tsOf(a.added_at)) || byTitle(a, b));   // dibanding sebagai waktu (format tanggal tiap sumber berbeda)
  const lib = libAll.filter((m) => (!fav.q || m.title.toLowerCase().includes(fav.q.toLowerCase()))
    && (fav.filter === "all" || (fav.filter === "new" ? isFresh(m) : m.type === fav.filter)));
  const hist = S.history();
  // baris riwayat: judul, sumber · waktu, "Ch. 23 · hal 12/48" + bar halaman; tombol Lanjut (ke halaman terakhir)
  // atau Berikutnya (bila chapter itu sudah selesai dibaca)
  const histRow = (x) => {
    const done = x.pages && x.page >= x.pages;
    const btn = !x.chapter_id ? "" : done
      ? `<button class="hl-go nx" type="button" data-next data-src="${esc(x.source)}" data-id="${esc(x.comic_id)}" data-ch="${esc(x.chapter_id)}" data-n="${esc(x.chapter ?? "")}">Berikutnya${icon("chev", 13, 2.6)}</button>`
      : `<button class="hl-go" type="button" data-go="${esc(readHref(x.source, x.comic_id, x.chapter_id))}">${icon("play", 12, 2.6)}Lanjut</button>`;
    return `<a class="fa-row" href="${comicHref(x.source, x.comic_id)}">${cover(x.cover, x.title, "sm")}<span class="fa-mid">
      <b class="fa-t">${esc(x.title)}</b>
      <span class="fa-meta"><i class="fa-dot s-${esc(x.source)}"></i>${esc(srcName(x.source))}<span class="fa-sep">·</span>${esc(ago(x.read_at))}</span>
      <span class="fa-meta"><b class="fa-rd">Ch. ${esc(x.chapter)}</b>${x.pages ? `<span class="fa-sep">·</span>${done ? "selesai" : `hal ${Number(x.page) || 1} / ${Number(x.pages) || 0}`}` : ""}</span>
      <span class="fa-bar"><i style="width:${pct(x.page || 1, x.pages || 0) || 4}%"></i></span>
    </span>${btn}</a>`;
  };
  const srcType = (m) => esc(srcName(m.source)) + (m.type ? " · " + esc(typeName(m.type)) : "");
  // baris koleksi (tampilan daftar), ramping: judul 1 baris, sumber · chapter (chapter yang dibaca ditebalkan), bar progres tipis;
  // di kanan lencana jumlah chapter baru (+80) atau centang bila sudah terbaru
  const favRow = (m) => {
    const r = readOf(m), L = parseFloat(m.latest), R = r ? parseFloat(r.chapter) : NaN, fresh = isNew(m);
    const pctRead = Number.isFinite(L) && L > 0 && Number.isFinite(R) ? Math.max(4, Math.min(100, Math.round((R / L) * 100))) : 0;
    const gap = fresh && Number.isFinite(L) && Number.isFinite(R) ? Math.floor(L) - Math.floor(R) : 0;
    const chTxt = r ? `<b class="fa-rd">Ch. ${esc(r.chapter)}</b>${m.latest != null ? ` / ${esc(m.latest)}` : ""}` : m.latest != null ? `${esc(m.latest)} chapter` : "Belum dibaca";
    const badge = fresh ? `<button class="fa-new" type="button" data-next data-src="${esc(m.source)}" data-id="${esc(m.comic_id)}" data-ch="${esc(r?.chapter_id || "")}" data-n="${esc(r?.chapter ?? "")}" aria-label="Baca chapter berikutnya (${gap > 0 ? gap + " chapter baru" : "chapter baru"})">${gap > 0 ? "+" + gap : "Baru"}${icon("play", 11, 2.6)}</button>` : r && m.latest != null && R >= L ? `<span class="fa-ok" title="Sudah terbaru">${icon("check", 14, 2.4)}</span>` : "";
    return `<a class="fa-row" href="${comicHref(m.source, m.comic_id)}">${cover(m.cover, m.title, "sm")}<span class="fa-mid">
      <b class="fa-t">${esc(m.title)}</b>
      <span class="fa-meta"><i class="fa-dot s-${esc(m.source)}"></i><span class="fa-src">${srcType(m)}</span>${m.notify ? `<span class="gold fa-bell" title="Notifikasi aktif">${icon("bellF", 11)}</span>` : ""}<span class="fa-sep">·</span><span class="fa-ch">${chTxt}</span></span>
      <span class="fa-bar"><i style="width:${pctRead}%"></i></span>
    </span>${badge}</a>`;
  };
  let body = "", cards = null;
  if (fav.tab === "lib") {
    body = `<div class="row g8"><label class="search box grow"><span class="mu">${icon("search", 19)}</span><span class="sr">Cari di koleksi</span><input id="fq" placeholder="Cari di koleksimu" value="${esc(fav.q)}"></label><button class="sq-btn lg" data-act="fsort" aria-label="Urutkan: ${esc(FAV_SORTS.find(([k]) => k === fs)[1])}">${icon("sort", 18, 2)}</button>${viewBtn(grid, "fview", "lg")}</div>
  ${chips([{ id: "all", name: "Semua" }, { id: "new", name: "New update" }, { id: "manga", name: "Manga" }, { id: "manhwa", name: "Manhwa" }, { id: "manhua", name: "Manhua" }], fav.filter, "ff")}
  <div class="mu xs info">${libAll.length ? `${lib.length} dari ${libAll.length} judul · ${esc(FAV_SORTS.find(([k]) => k === fs)[1])} · ${S.loggedIn() ? "tersinkron" : "tersimpan di HP ini"}` : ""}</div>
  ${!lib.length ? (libAll.length ? `<div class="empty"><b>Tidak ada yang cocok</b><span>Ubah kata kunci atau filter.</span></div>`
      : `<div class="empty"><span class="empty-ic">${icon("heart", 24)}</span><b>Koleksi masih kosong</b><span>Ketuk ikon hati di halaman komik untuk menyimpannya di sini.</span><a class="btn ghost" href="#/search">Cari komik</a></div>`)
    : grid ? `<div class="g3 favg">${FAV_CARDS}</div>`
    : `<div class="frows">${FAV_CARDS}</div>`}`;
    cards = grid ? lib.map((m) => { const r = readOf(m); return `<a class="grid-card" href="${comicHref(m.source, m.comic_id)}"><span class="gc-cv">${cover(m.cover, m.title, "fav3")}
        <span class="stack">${m.latest != null ? `<span class="st-red">Terbaru ${esc(m.latest)}</span>` : ""}<span class="st-dark">${r ? "Dibaca " + esc(r.chapter) : "Belum dibaca"}</span></span>
        ${isFresh(m) ? `<span class="new-up">NEW UPDATE</span>` : ""}${m.notify ? `<span class="bell-b">${icon("bellF", 12)}</span>` : ""}</span>
        <b class="fg-t">${esc(m.title)}</b><span class="mu xs">${srcType(m)}</span></a>`; }) : lib.map(favRow);
  } else if (fav.tab === "hist") {
    cards = hist.map(histRow);
    body = hist.length ? `<div class="sec-h"><span class="mu xs">Terbaru di atas</span><button class="link-red" data-act="clearHist">Bersihkan</button></div>
  <div class="frows">${FAV_CARDS}</div>`
      : `<div class="empty"><span class="empty-ic">${icon("clock", 24)}</span><b>Belum ada riwayat</b><span>Chapter yang kamu baca akan muncul di sini.</span></div>`;
  } else {
    body = DL.favTab();
  }
  const shell = `
<div class="page-h"><h1>Favorit</h1>${seg([{ id: "lib", name: "Koleksi" }, { id: "hist", name: "Riwayat" }, { id: "dl", name: "Unduhan" }], fav.tab, "tab")}</div>
${!S.loggedIn() && fav.tab !== "dl" ? `<div class="note mx">${icon("cloud", 18)}<span>Tersimpan di HP ini saja. <a href="#/more">Masuk</a> agar tersinkron di semua perangkat.</span></div>` : ""}
<div class="px s14">${body}</div><div class="pad-nav"></div>`;
  // Gambar ulang karena data berubah di belakang layar (chapter terbaru tiap komik, sinkron riwayat):
  // bila kerangka halaman sama, hanya kartu yang berubah yang diganti. Kartu lain (beserta sampulnya yang sudah
  // termuat) dibiarkan, jadi tidak ada sampul berkedip & animasi masuk halaman tidak terulang dari awal.
  const list = soft && cards && favShell === shell ? view.querySelector(":scope > .px > .favg, :scope > .px > .frows") : null;
  if (list?._cards) {
    if (list._cards.join("\n") === cards.join("\n")) return;
    const pool = new Map();
    [...list.children].forEach((el, i) => { const h = list._cards[i]; if (h == null) return; if (!pool.has(h)) pool.set(h, []); pool.get(h).push(el); });
    const tp = document.createElement("template");
    const nodes = cards.map((h) => pool.get(h)?.shift() || (tp.innerHTML = h, tp.content.firstElementChild));
    nodes.forEach((n, i) => { if (list.children[i] !== n) list.insertBefore(n, list.children[i] || null); });
    while (list.children.length > nodes.length) list.lastElementChild.remove();
    list._cards = cards;
    return;
  }
  favShell = shell;
  view.innerHTML = cards ? shell.replace(FAV_CARDS, () => cards.join("")) : shell;
  const lst = cards && view.querySelector(":scope > .px > .favg, :scope > .px > .frows"); if (lst) lst._cards = cards;
  const fq = $("#fq");
  if (fq) fq.addEventListener("input", () => { fav.q = fq.value; const pos = fq.selectionStart; vFav(); const n = $("#fq"); n.focus(); n.setSelectionRange(pos, pos); });
  setActs({
    tab: (el) => { fav.tab = el.dataset.v; vFav(); },
    ff: (el) => { fav.filter = el.dataset.v; vFav(); },
    fview: () => S.setSetting("favView", grid ? "list" : "grid"),
    fsort: () => sortSheet("Urutkan koleksi", FAV_SORTS, fs, (v) => S.setSetting("favSort", v)),
    clearHist: async () => { if (!(await ask("Hapus semua riwayat baca?", { ok: "Hapus", danger: true }))) return; try { await S.clearHistory(); toast("Riwayat dibersihkan"); } catch (e) { toast(e.message); } },
  });
  if (fav.tab === "lib" && libAll.length) refreshLatest(libAll);
  if (fav.tab === "dl") {
    favDlOff = DL.mountFav(view, { openSheet, closeSheet, redraw: () => { if (parse().name === "fav" && fav.tab === "dl") { const y = scrollY; vFav(); scrollTo(0, y); } } });
    cleanup = () => { favDlOff?.(); favDlOff = null; };
  }
}

/* ---------- Lainnya ---------- */
let authMode = "in";
const mrow = (ic, label, sub, act, opt = {}) => {
  const inner = `<span class="mrow-ic">${icon(ic, 19)}</span><span class="rc-mid"><b>${label}</b>${sub ? `<span class="mu sm">${sub}</span>` : ""}</span>`;
  return act ? `<button class="mrow ${opt.danger ? "danger" : ""}" data-act="${act}">${inner}${opt.danger ? "" : `<span class="mu">${icon("chev", 18)}</span>`}</button>` : `<div class="mrow">${inner}</div>`;
};
// pilihan bacaan: dipakai di Pengaturan dan di menu ⋯ pembaca
const READ_OPTS = [
  ["autoHide", "Sembunyikan menu otomatis", "Menu bacaan hilang setelah digulir sedikit (±40 px)"],
];
// pilihan dua mode (bawaan = yang pertama)
const READ_CHOICES = [
  ["autoScroll", "Gulir otomatis (mode Scroll)", [["off", "OFF", "Halaman hanya bergerak saat kamu menggulir."], ["1", "1×", "Gulir otomatis pelan. Tekan layar untuk berhenti, lepas untuk lanjut."], ["2", "2×", "Gulir otomatis sedang. Tekan layar untuk berhenti, lepas untuk lanjut."], ["3", "3×", "Gulir otomatis cepat. Tekan layar untuk berhenti, lepas untuk lanjut."]], "off"],
  ["screenMode", "Tampilan layar", [["standard", "Mode standar", "Bilah status HP tetap tampil saat membaca."], ["fullscreen", "Mode fullscreen", "Bilah status HP ikut menu bacaan: menu tampil → bilah tampil, menu hilang → bilah disembunyikan."]]],
  ["nextDelay", "Lanjut otomatis ke chapter berikutnya", [["off", "OFF", "Menu muncul di akhir chapter; pilih sendiri lanjut atau tidak."], ["1", "1 dtk", "Sampai di akhir chapter, chapter berikutnya terbuka setelah 1 detik (ketuk untuk batal)."], ["2", "2 dtk", "Sampai di akhir chapter, chapter berikutnya terbuka setelah 2 detik (ketuk untuk batal)."], ["3", "3 dtk", "Sampai di akhir chapter, chapter berikutnya terbuka setelah 3 detik (ketuk untuk batal)."], ["5", "5 dtk", "Sampai di akhir chapter, chapter berikutnya terbuka setelah 5 detik (ketuk untuk batal)."]], "3"],
];
const choiceVal = (k) => { const c = READ_CHOICES.find((x) => x[0] === k); const v = S.state.settings[k]; return c[2].some((o) => o[0] === v) ? v : (c[3] ?? c[2][0][0]); };
// ubah tampilan sakelar/pilihan di tempat (tanpa menggambar ulang) supaya animasinya terlihat
const flipToggle = (el, on) => { el.setAttribute("aria-checked", String(on)); el.querySelector(".switch")?.classList.toggle("on", on); };
const flipChoice = (el) => {
  const box = el.closest(".ch-opt"), k = el.dataset.k, v = el.dataset.v;
  box.querySelectorAll("[data-act=rch]").forEach((b) => b.setAttribute("aria-selected", String(b === el)));
  const o = READ_CHOICES.find((x) => x[0] === k)[2].find((x) => x[0] === v); const d = box.querySelector(".lh"); if (o && d) d.textContent = o[2];
};
// versi ringkas untuk menu ⋯ pembaca: 1 baris per pilihan, tanpa keterangan panjang
const SHORT = { autoScroll: "Gulir otomatis", autoHide: "Sembunyikan menu otomatis", screenMode: "Layar", nextDelay: "Lanjut otomatis", standard: "Standar", fullscreen: "Fullscreen" };
const readPrefsCompact = () => READ_OPTS.map(([k, t]) => { const on = !!S.state.settings[k]; return `<button class="mrow rq-tog" data-act="rtog" data-k="${k}" role="switch" aria-checked="${on}"><b>${SHORT[k] || t}</b><span class="switch ${on ? "on" : ""}"><span></span></span></button>`; }).join("")
  + READ_CHOICES.map(([k, t, opts]) => { const cur = choiceVal(k); return `<div class="ch-opt rq-row" data-ck="${k}"><b>${SHORT[k] || t}</b><div class="seg s2" role="tablist">${opts.map(([v, n]) => `<button role="tab" aria-selected="${v === cur}" data-act="rch" data-k="${k}" data-v="${v}" aria-label="${n}">${SHORT[v] || n}</button>`).join("")}</div></div>`; }).join("");
const choiceRow = (k) => {
  const [, t, opts] = READ_CHOICES.find((x) => x[0] === k), cur = choiceVal(k);
  return `<div class="ch-opt" data-ck="${k}"><b>${t}</b><div class="seg s2" role="tablist">${opts.map(([v, n]) => `<button role="tab" aria-selected="${v === cur}" data-act="rch" data-k="${k}" data-v="${v}">${n}</button>`).join("")}</div><span class="mu xs lh">${opts.find((o) => o[0] === cur)[2]}</span></div>`;
};
const readPrefs = (act) => READ_OPTS.map(([k, t, dsc]) => toggleRow(k, t, dsc, act)).join("") + READ_CHOICES.map(([k]) => choiceRow(k)).join("");
const toggleRow = (k, t, dsc, act = "rtog") => { const on = !!S.state.settings[k]; return `<button class="mrow" data-act="${act}" data-k="${k}" role="switch" aria-checked="${on}"><span class="rc-mid"><b>${t}</b><span class="mu sm">${dsc}</span></span><span class="switch ${on ? "on" : ""}"><span></span></span></button>`; };
// bar unduhan di baris "Unduhan" (Lainnya): terbuka saat ada unduhan berjalan, garis berkilau saat aktif, abu-abu saat dijeda
const dlBar = (a) => `<span class="dl-mbar${a ? " on" : ""}${a?.paused ? " pz" : ""}" id="dlmbar" aria-hidden="true"><i style="width:${a ? Math.max(3, a.pct).toFixed(1) : 0}%"></i></span>`;
const group = (t, inner) => `<section class="sec s20"><h2 class="cap">${t}</h2><div class="group">${inner}</div></section>`;
// bingkai avatar kosmik dari prototipe (dimuat sekali saat dibutuhkan); cadangan: cincin warna sederhana
let AVM = null;
async function loadAvatars() {
  if (!AVM) {
    AVM = await import("./avatars.js").catch(() => null);
    if (AVM && !document.getElementById("nk-sprite")) { const d = document.createElement("div"); d.id = "nk-sprite"; d.innerHTML = AVM.SPRITE; document.body.prepend(d); }
  }
  return AVM;
}
const SIZE_CLS = { 116: "xl", 46: "sm", 40: "sm" };
const avatarHtml = (p, lv, size = 56, opt = {}) => {
  const ini = esc((opt.ini || p?.name || "?").trim()[0]?.toUpperCase() || "?");
  const tier = opt.tier ?? lv.tier;
  // foto profil ditumpuk di atas inisial (bila gagal dimuat, inisial tetap terlihat)
  const photo = p?.avatar_path ? `<img class="av-img" src="${esc(api.publicUrl("avatars", p.avatar_path))}" alt="" decoding="async" data-rm>` : "";
  let tpl = AVM?.AV[size][tier];
  if (tpl && photo) tpl = tpl.replace("position:relative;font-family", "position:static;font-family");
  if (tpl) return `<span class="av-wrap s${size}" data-t="${tier}">${tpl.replaceAll("%I%", ini + photo).replaceAll("%L%", opt.noMedal ? "" : String(opt.lv ?? lv.lv))}</span>`;
  return `<span class="avatar ${SIZE_CLS[size] || ""} t${tier}"><span>${ini}${photo}</span></span>`;
};
const rankPill = (lv, big = false) => rankBadge(lv, big ? "big" : "");
const badges = (p) => `${p?.verified ? `<span class="verif" title="Terverifikasi">${icon("check", 10, 3.2)}</span>` : ""}${p?.role === "developer" ? `<span class="pill-dev">DEV</span>` : p?.role === "moderator" ? `<span class="pill-mod">MOD</span>` : ""}`;
async function vMore() {
  await loadAvatars();
  const p = S.state.profile, lv = S.levelOf(p), user = api.currentUser(), st = S.state.settings;
  view.innerHTML = `
<div class="page-h"><h1>Lainnya</h1></div>
${!api.configured ? `<div class="note warn mx">${icon("info", 18)}<span>Aplikasi belum tersambung ke server (config.js kosong).</span></div>` : ""}
${user ? `<button class="me mx" data-act="level">${avatarHtml(p, lv)}
    <span class="rc-mid g5"><span class="me-name"><b class="t1">${esc(p?.name || "Memuat…")}</b>${badges(p)}</span>
      <span class="row g8 mu sm">${rankPill(lv)}Lv ${lv.lv}${lv.max ? " · level maksimal" : ` · ${(lv.need - lv.cur).toLocaleString("id-ID")} EXP lagi ke Lv ${lv.lv + 1}`}</span>
      <span class="prog"><span style="width:${lv.max ? 100 : pct(lv.cur, lv.need)}%"></span></span></span><span class="mu">${icon("chev", 18)}</span></button>`
  : `<div class="guest mx">${avatarHtml(null, S.levelOf(null), 56, { ini: "T", noMedal: true })}<span class="rc-mid g4"><b class="b16">Tamu</b><span class="mu sm">Belum masuk · level, rank, dan koleksi belum tersimpan di akun</span></span></div>
  <div class="auth mx"><b class="b17">${authMode === "up" ? "Daftar akun Ninokuu" : authMode === "reset" ? "Lupa password" : "Masuk ke Ninokuu"}</b>
    <span class="mu sm">${authMode === "reset" ? "Kami kirim link ke emailmu untuk membuat password baru." : "Masuk agar koleksi, riwayat baca, dan pengaturan tersinkron di semua perangkatmu."}</span>
    <form id="auth" class="auth-f">
      ${authMode === "up" ? `<label>Nama<input name="name" required maxlength="24" autocomplete="nickname" placeholder="Nama panggilan"></label>` : ""}
      <label>Email<input name="email" type="email" required autocomplete="email" placeholder="nama@email.com"></label>
      ${authMode !== "reset" ? `<label>Password<input name="pw" type="password" required minlength="8" autocomplete="${authMode === "up" ? "new-password" : "current-password"}" placeholder="Minimal 8 karakter"></label>` : ""}
      <span class="err" id="aerr" role="alert"></span>
      <button class="btn primary" type="submit" ${api.configured ? "" : "disabled"}>${authMode === "up" ? "Daftar" : authMode === "reset" ? "Kirim link" : "Masuk"}</button>
    </form>
    ${authMode === "in" ? `<button class="btn ghost" data-act="auth" data-v="up">Belum punya akun? Daftar</button><button class="link" data-act="auth" data-v="reset">Lupa password?</button>` : `<button class="btn ghost" data-act="auth" data-v="in">Sudah punya akun? Masuk</button>`}</div>`}
${user ? group("Akun", mrow("user", "Akun", "Foto profil · nama tampilan · email · password", "akun")) : ""}
${["developer", "moderator"].includes(p?.role) ? group("Developer", mrow("dev", "Panel developer", p.role === "developer" ? "Moderasi, pengumuman, statistik" : "Moderasi chat", "dev")) : ""}
${group("Bacaanmu", mrow("star", "Level &amp; Rank", user ? `${lv.rank} · Lv ${lv.lv}${X.cachedStatus() ? ` · 🔥 ${X.cachedStatus().streak} hari` : ""}` : "Masuk untuk mulai naik level", "level") + (user ? mrow("share", "Rekap bacaan", "7 & 30 hari · bagikan sebagai gambar", "recap") : "") + mrow("down", "Unduhan", DL.supported() ? `<span id="dlsub">${DL.savedCount()} file tersimpan${DL.progressLine() ? " · " + esc(DL.progressLine()) : ""}</span>${dlBar(DL.active())}` : "Baca offline di aplikasi APK", "dlrow") + mrow("clock", "Riwayat baca", `${S.history().length} judul`, "goHist") + mrow("sliders", "Pengaturan", "Mode baca · gulir otomatis · tampilan layar · efek avatar", "settings"))}
${N.DEV ? group("Ninokuu Dev", mrow("bug", "Log error", `${N.devLog().length} catatan · salin & kirim ke developer`, "devlog") + mrow("info", "Build uji", `v${esc(VERSION)} · build ${esc(N.BUILD)} · function ${esc(api.FN.split("/").pop())}`, "")) : ""}
${N.isApp ? group("Aplikasi", `<span id="updrow"></span>` + (N.pushSupported() || !N.DEV ? mrow("bell", "Notifikasi HP", `<span id="pushst">Memeriksa…</span>`, "pushset") : mrow("bell", "Notifikasi HP", "Belum aktif di Ninokuu Dev (paket .dev belum didaftarkan di Firebase)", "")) + mrow("info", "Versi aplikasi", `v${esc(VERSION)}${N.DEV ? " Dev" : ""} · ketuk untuk cek pembaruan`, "checkupd"))
  : group("Aplikasi Android", mrow("down", "Pasang aplikasi Android (APK)", "Baca Shinigami &amp; WestManga, notifikasi chapter baru di HP", "getapk"))}
${group("Data &amp; penyimpanan", mrow("cloud", "Backup data offline", "Simpan koleksi, riwayat, dan pengaturan ke file", "backup") + mrow("restore", "Pulihkan data", "Dari file backup", "restore") + mrow("trash", "Bersihkan cache", `<span id="cachesub">Menghitung cache di HP…</span>`, "cache"))}
<section class="sec s20"><button class="tk-card" data-act="trakteer" aria-label="Dukung Ninokuu di Trakteer">
  <span class="tk-ic">${icon("gift", 26, 2)}</span>
  <span class="tk-t"><b>Traktir Ninokuu</b><span>Gratis &amp; tanpa iklan berkat dukunganmu. Kirim hadiah kecil lewat Trakteer.</span></span>
  <span class="tk-go">${icon("chev", 18, 2.4)}</span></button></section>
${group("Dukungan", mrow("chat", "Lapor bug &amp; saran", "Lewat server Discord Ninokuu", "discord") + mrow("star", "Yang baru di versi ini", `Fitur baru &amp; panduan bergambar v${esc(VERSION)}`, "whatsnew") + mrow("info", "Tentang aplikasi", "Versi " + esc(VERSION), "about") + mrow("shield", "Kebijakan privasi", "", "privacy") + mrow("doc", "Ketentuan pengguna", "", "terms") + (user ? mrow("out", "Keluar", "", "logout", { danger: true }) : ""))}
<p class="mu xs center mt18">Ninokuu versi ${esc(VERSION)}</p><div class="pad-nav"></div>`;
  if (N.isApp) {
    refreshPushStatus();
    N.latestBuild().then((r) => { const el = $("#updrow"); if (el && r?.newer) el.outerHTML = mrow("refresh", `<span class="gold">Versi baru tersedia</span>`, `v${esc(r.version || "")} · ${KIND_NAME[r.kind] || "Pembaruan"} · ketuk untuk melihat`, "update"); });
  }
  const form = $("#auth");
  if (form) form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(form), btn = form.querySelector("button[type=submit]"), err = $("#aerr");
    err.textContent = ""; btn.disabled = true;
    try {
      if (authMode === "reset") { await api.recover(f.get("email")); toast("Link reset dikirim. Cek email (dan folder spam).", 4000); authMode = "in"; vMore(); return; }
      if (authMode === "up") {
        const r = await api.signUp(f.get("email"), f.get("pw"), f.get("name"));
        if (r.confirm) { toast("Cek email untuk konfirmasi akun, lalu masuk.", 4500); authMode = "in"; vMore(); return; }
      } else await api.signIn(f.get("email"), f.get("pw"));
      await S.syncAfterLogin().catch(() => {});
      toast("Berhasil masuk"); vMore(); window.dispatchEvent(new Event("nk:login"));
      if (N.pushSupported()) N.pushEnable(api.rpc, true).then(() => { if (route.name === "more") vMore(); }).catch(() => {});
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  });
  N.cacheSize().then((b) => { const el = $("#cachesub"); if (el && route.name === "more") el.textContent = b ? `±${N.fmtBytes(b)} di HP · gambar sampul & halaman` : "Cache kosong"; }).catch(() => {});
  if (user && !X.cachedStatus()) X.loadStatus().then((ds) => { const el = $("button.mrow[data-act=level] .mu.sm"); if (ds && el && route.name === "more" && !el.textContent.includes("🔥")) el.textContent += ` · 🔥 ${ds.streak} hari`; });
  setActs({
    auth: (el) => { authMode = el.dataset.v; vMore(); },
    level: () => go("#/p/level"), recap: () => go("#/p/recap"), dlrow: () => go("#/fav/dl"), dev: () => go("#/p/dev"), photo: () => openPhoto(), goName: () => go("#/p/name"), goEmail: () => go("#/p/email"), goPass: () => go("#/p/pass"),
    goHist: () => go("#/fav/hist"), goDl: () => go("#/fav/dl"),
    whatsnew: () => { if (!T.showNow({ version: VERSION, build: N.BUILD, dev: N.DEV, go })) toast("Belum ada catatan untuk versi ini"); },
    about: () => go("#/p/about"), privacy: () => go("#/p/privacy"), terms: () => go("#/p/terms"),
    backup: () => go("#/p/backup"), restore: () => go("#/p/restore"),
    getapk: () => window.open(N.SITE_URL, "_blank"),
    update: () => checkUpdate(true),
    checkupd: () => checkUpdate(true),
    devlog: () => openDevLog(),
    settings: () => go("#/p/settings"), akun: () => go("#/p/akun"),
    pushset: async () => {
      if (!user) { toast("Masuk dulu supaya notifikasi bisa dikirim ke HP ini."); return; }
      try {
        showPush("busy");
        const st = await N.pushEnable(api.rpc, true, true);
        if (st === "denied") { showPush(st); return toast("Izin notifikasi ditolak. Buka Pengaturan HP → Aplikasi → Ninokuu → Notifikasi, lalu aktifkan.", 5000); }
        if (st !== "on") { showPush(st); return toast("Notifikasi belum diizinkan."); }
        const test = () => api.call("test_push").catch((e) => ({ ok: false, error: e.message }));
        let r = await test();
        // server belum mengenal HP ini → daftar ulang sekali lalu coba lagi
        if (!r.ok && /belum terdaftar|tidak lagi terdaftar/i.test(r.error || "")) { await N.pushEnable(api.rpc, false, true); r = await test(); }
        const err = r.error || r.errors?.[0] || "";
        // HP sudah terdaftar tapi server gagal mengirim → masalah di pengaturan Firebase server, bukan di HP
        showPush(r.ok ? "on" : /belum terdaftar|tidak lagi terdaftar/i.test(err) ? "unreg" : "server");
        if (!r.ok) lastPushErr = err;
        toast(r.ok ? "Tes notifikasi dikirim. Cek bilah notifikasi HP." : "Tes gagal: " + (err || "server tidak bisa mengirim notifikasi"), 7000);
      } catch (e) { showPush("error"); toast("Pendaftaran notifikasi gagal: " + e.message, 5000); }
    },
    discord: () => soon("Server Discord Ninokuu sedang disiapkan."), trakteer: () => openTrakteer(),
    logout: async () => { if (!(await ask("Keluar dari akun? Koleksi dan riwayatmu tetap aman di server.", { ok: "Keluar", danger: true }))) return; await S.flushHistory(); await N.pushRelease(api.rest).catch(() => {}); await api.signOut(); S.clearUserData(); toast("Kamu sudah keluar"); vMore(); },
    cache: async () => {
      const c = await N.cacheParts().catch(() => ({ images: 0, data: 0, total: 0 }));
      if (!c.total) { toast("Cache sudah bersih"); return; }
      const html = `<div class="cc-big"><b>±${esc(N.fmtBytes(c.total))}</b><span>perkiraan cache di HP</span></div>
        <div class="cc-rows"><span>${icon("img", 15)}Gambar sampul &amp; halaman<b>${esc(N.fmtBytes(c.images))}</b></span>${c.data ? `<span>${icon("doc", 15)}Data info komik<b>${esc(N.fmtBytes(c.data))}</b></span>` : ""}</div>
        <span class="cc-note">${icon("shield", 14)}Koleksi, riwayat &amp; unduhan tetap aman</span>`;
      if (!(await ask("", { title: "Bersihkan cache?", html, ok: "Bersihkan", danger: true }))) return;
      const sub = $("#cachesub"); if (sub) sub.textContent = "Membersihkan…";
      const r = await N.cacheClear().catch(() => ({ freed: 0, after: 0 }));
      detailCache.clear(); browseCache.clear();
      if (sub) sub.textContent = r.after ? `±${N.fmtBytes(r.after)} di HP · gambar sampul & halaman` : "Cache kosong";
      toast(r.freed > 0 ? `${N.fmtBytes(r.freed)} cache dihapus` : "Cache sudah bersih", 3000);
    },
  });
}

/* ---------- khusus APK: notifikasi, tombol kembali, cek chapter sumber yang diblokir server ---------- */
// Keyboard: bila WebView tidak menyusut saat keyboard muncul, angkat elemen bawah (kolom chat, dll.)
// setinggi bagian keyboard yang belum "dimakan" oleh penyusutan layar.
// Dihitung ulang setiap kali layar berubah ukuran: di sebagian HP, keyboard dilaporkan "sudah muncul" sebelum
// WebView menyusut. Dulu tingginya dihitung sekali saja → kolom chat terangkat 2× (melompat ke atas layar).
// Keyboard: kolom bawah (chat, lembar, dll.) diangkat setinggi bagian keyboard yang MENUTUPI layar.
// - Bila layar aplikasi sudah menyusut karena keyboard (Android adjustResize), tidak perlu diangkat lagi (--kb 0).
//   Dulu tinggi keyboard tetap ditambahkan → kolom terangkat 2× dan seluruh isi chat terdorong keluar layar.
// - Bila layar tidak menyusut (keyboard melayang di atas aplikasi), angkat setinggi keyboard. Tinggi dari Android
//   kadang dalam piksel fisik (mis. 900 di HP 2,75×): dinormalkan ke piksel tampilan.
// - Tinggi layar penuh (kbBase) hanya diambil saat keyboard pasti tertutup (dan = tinggi terbesar yang terlihat),
//   karena di sebagian HP layar menyusut SEBELUM laporan "keyboard muncul" datang.
// - Dihitung ulang setiap layar berubah ukuran; nilai terakhir dicatat di Log error (Ninokuu Dev) untuk diagnosa.
let kbBase = window.innerHeight, kbOpen = false, kbH = 0, kbStick = false;
// seperti aplikasi chat: bila sedang di pesan terbawah saat keyboard muncul, tetap menempel di bawah setelah layar menyusut
const kbAtEnd = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
const kbKeepEnd = () => { if (kbStick) window.scrollTo(0, document.documentElement.scrollHeight); };
const kbCss = (h) => { const dpr = window.devicePixelRatio || 1; return h > kbBase * 0.62 && dpr > 1.2 ? h / dpr : h; };
const applyKb = () => {
  const shrink = Math.max(0, kbBase - window.innerHeight), vv = window.visualViewport;
  // Bila visualViewport tahu ada keyboard, ia juga tahu berapa jauh layar digeser (offsetTop) oleh Android/Chromium.
  // Bagian bawah yang terlihat = offsetTop + height; komposer cukup diangkat sejauh yang masih tertutup.
  // (Dulu tinggi keyboard ikut dipakai walau layar sudah digeser → komposer naik dua kali dan nyangkut di atas.)
  const vvKnows = vv && window.innerHeight - vv.height > 40;
  const vvCover = vv ? Math.max(0, window.innerHeight - (vv.height + vv.offsetTop)) : 0;
  const h = kbCss(kbH);
  const lift = vvKnows ? vvCover : shrink > 80 ? 0 : h - shrink;
  const v = lift > 40 ? Math.round(Math.min(lift, window.innerHeight * 0.7)) : 0;
  document.documentElement.style.setProperty("--kb", v + "px");
  kbKeepEnd();
  if (N.DEV) N.logDev("kb", `keyboard ${Math.round(kbH)} → ${Math.round(h)} px, layar ${kbBase}→${window.innerHeight} (susut ${shrink}), vv ${vv ? Math.round(vv.height) + "+" + Math.round(vv.offsetTop) : "-"}, tutup ${Math.round(vvCover)}, angkat ${v}px`);
};
window.addEventListener("resize", () => { if (kbOpen) { if (kbH) applyKb(); } else if (window.innerHeight > kbBase) kbBase = window.innerHeight; });
window.visualViewport?.addEventListener("resize", () => { if (kbOpen) applyKb(); });
window.visualViewport?.addEventListener("scroll", () => { if (kbOpen) applyKb(); });
// Chat: saat layar menyusut/membesar karena keyboard, kolom (dan pesan bila menempel di bawah) meluncur halus
// dari posisi lama ke posisi baru, mengikuti gerak keyboard, alih-alih melompat.
let flipH = window.innerHeight, chatEnd = true;
addEventListener("scroll", () => { if (!kbOpen) chatEnd = kbAtEnd(); }, { passive: true });
addEventListener("resize", () => {
  const d = window.innerHeight - flipH; flipH = window.innerHeight;
  if (Math.abs(d) < 80 || !document.querySelector("#chatroot")) return;
  const shrink = d < 0, stick = shrink && (chatEnd || kbStick);
  if (stick) window.scrollTo(0, document.documentElement.scrollHeight);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const els = [document.querySelector("#chatroot .composer"), stick && document.querySelector("#chat")].filter(Boolean);
  for (const el of els) el.animate([{ transform: `translate3d(0, ${-d}px, 0)` }, { transform: "translate3d(0, 0, 0)" }], { duration: 280, easing: "cubic-bezier(.2, .8, .2, 1)" });
});
addEventListener("orientationchange", () => setTimeout(() => { if (!kbOpen) kbBase = window.innerHeight; }, 400));
function setKeyboard(h, phase) {
  const root = document.documentElement;
  if (h > 0) {
    if (!kbOpen) kbStick = !!document.querySelector("#chatroot") && kbAtEnd();
    kbOpen = true;
    if (phase !== "did") return;
    kbH = h; applyKb();
    document.body.classList.add("kb-open");
    const ae = document.activeElement;
    if (ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName) && !ae.closest(".composer, .chbar")) setTimeout(() => ae.scrollIntoView({ block: "center", behavior: "smooth" }), 60);
  } else {
    kbOpen = false; kbH = 0; kbStick = false;
    if (phase === "did") setTimeout(() => { if (!kbOpen) kbBase = window.innerHeight; }, 250);   // tinggi penuh yang pasti benar
    root.style.setProperty("--kb", "0px");
    document.body.classList.remove("kb-open");
  }
  window.dispatchEvent(new CustomEvent("nk:kb", { detail: { open: h > 0, phase } }));
}

// Dukungan lewat Trakteer: lembar penjelasan dulu (ke mana dukungan dipakai), lalu dibuka di browser
const TRAKTEER_URL = "https://trakteer.id/reza-rexxa/gift";
function openTrakteer() {
  openSheet(`<div class="tk-sheet">
    <span class="tk-hero">${icon("gift", 34, 1.8)}</span>
    <span class="sheet-ttl center">Dukung Ninokuu</span>
    <span class="mu sm lh center">Ninokuu tetap gratis &amp; tanpa iklan. Hadiahmu membantu:</span>
    <div class="tk-list">
      <span>${icon("cloud", 17, 2)}<b>Biaya server</b><i>supaya baca, chat, &amp; notifikasi tetap lancar</i></span>
      <span>${icon("star", 17, 2)}<b>Fitur baru</b><i>update rutin &amp; perbaikan bug lebih cepat</i></span>
      <span>${icon("heart", 17, 2)}<b>Semangat developer</b><i>setiap dukungan sangat berarti, terima kasih!</i></span>
    </div>
    <span class="mu xs center">Dibuka di Trakteer (trakteer.id) · pembayaran diurus langsung oleh Trakteer</span>
    <div class="row g8"><button class="sh-cancel grow" data-s="no">Nanti</button><button class="btn primary grow tk-btn" data-s="go">${icon("gift", 17, 2)}Kirim hadiah</button></div>
  </div>`, (b) => {
    if (b.dataset.s === "go") window.open(TRAKTEER_URL, "_blank");
    closeSheet();
  });
}

// Pembaruan APK: peringatan saat aplikasi dibuka bila ada build baru, dan cek manual dari Lainnya.
function showUpdate(r) {
  openSheet(`<span class="sheet-ttl">Pembaruan tersedia <span class="kind-pill ${r.kind}">${KIND_NAME[r.kind] || "Pembaruan"}</span></span>
    <span class="sheet-prev">${r.version ? `Versi ${esc(r.version)} · kamu memakai ${esc(VERSION)}` : `Build ${r.build} · kamu memakai build ${N.BUILD || "-"}`}</span>
    ${r.notes?.length ? `<div class="upd-notes"><b class="xs gold">Yang baru</b>${r.notes.map((x) => `<span>${esc(x.replace(/^[-•*]\s*/, ""))}</span>`).join("")}</div>` : ""}
    <span class="mu xs upd-hint">Unduh lalu pasang menimpa aplikasi ini. Login, favorit, dan riwayat tetap aman.</span>
    <div class="row g8"><button class="sh-cancel grow" data-s="later">Nanti</button><button class="btn primary grow" data-s="get">${icon("down", 17, 2)}Perbarui sekarang</button></div>`, (b) => {
    if (b.dataset.s === "later") { try { sessionStorage.setItem("ninokuu:updLater", String(r.version || r.build)); } catch {} closeSheet(); }
    if (b.dataset.s === "get") { window.open(r.url, "_blank"); closeSheet(); }
  });
}
// Ninokuu Dev: daftar error yang tercatat, bisa disalin lalu ditempel ke chat developer
function openDevLog() {
  const l = N.devLog().slice().reverse();
  const text = () => [`Ninokuu Dev v${VERSION} build ${N.BUILD} · ${navigator.userAgent}`, ...N.devLog().map((x) => `[${x.t}] ${x.k} ${x.r}\n${x.m}${x.x ? "\n" + x.x : ""}`)].join("\n\n");
  openSheet(`<span class="sheet-ttl">Log error · ${l.length}</span>
    <div class="col g8" style="max-height:52vh;overflow:auto">${l.length ? l.map((x) => `<div class="mu xs" style="white-space:pre-wrap;word-break:break-word"><b class="redt">${esc(x.k)}</b> · ${esc(new Date(x.t).toLocaleString("id-ID"))} · ${esc(x.r)}<br>${esc(x.m)}${x.x ? `<br><span style="opacity:.7">${esc(x.x.slice(0, 400))}</span>` : ""}</div>`).join("") : `<span class="mu sm">Belum ada error tercatat.</span>`}</div>
    <div class="row g8"><button class="sh-cancel grow" data-s="clear">Hapus log</button><button class="btn primary grow" data-s="copy">Salin semua</button></div>`, async (b) => {
    if (b.dataset.s === "copy") { try { await navigator.clipboard.writeText(text()); toast("Log disalin. Tempel di chat developer."); } catch { toast("Tidak bisa menyalin otomatis."); } }
    if (b.dataset.s === "clear") { N.clearDevLog(); closeSheet(); toast("Log dihapus"); if (route.name === "more") vMore(); }
  });
}
// Pembaruan dicek saat aplikasi dibuka, saat kembali dari latar belakang, dan tiap 15 menit selama dipakai,
// jadi pengguna tidak perlu menutup-buka aplikasi. Sedang membaca → spanduk kecil di atas (tidak menutupi halaman);
// di halaman lain → lembar pembaruan. Tiap versi hanya diumumkan sekali per sesi (dan tidak lagi bila dipilih "Nanti").
let updLast = 0, updShown = "";
async function checkUpdate(manual, fresh = false) {
  if (manual) toast("Memeriksa pembaruan…", 1500);
  updLast = Date.now();
  const r = await N.latestBuild(manual || fresh);
  if (!r) { if (manual) toast("Tidak bisa memeriksa pembaruan. Periksa koneksi internet."); return; }
  if (r.newer) {
    const key = String(r.version || r.build);
    let later = ""; try { later = sessionStorage.getItem("ninokuu:updLater") || ""; } catch {}
    if (manual) { updBanner(null); showUpdate(r); return; }
    if (later === key || updShown === key) return;
    updShown = key;
    if (route.name === "reader") updBanner(r); else showUpdate(r);
  } else if (manual) toast(`Kamu sudah memakai versi terbaru (v${VERSION}).`);
}
function updBanner(r) {
  document.querySelector(".upd-ban")?.remove();
  if (!r) return;
  const el = document.createElement("div");
  el.className = "upd-ban glass"; el.setAttribute("role", "status");
  el.innerHTML = `<span class="upd-ban-t"><b>Pembaruan tersedia</b><span class="mu xs">${r.version ? "Versi " + esc(r.version) : "Build " + esc(r.build)}</span></span>
    <button class="upd-ban-go" data-u="go">Lihat</button><button class="upd-ban-x" data-u="x" aria-label="Tutup">${icon("x", 16, 2.2)}</button>`;
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-u]"); if (!b) return;
    el.classList.add("out"); setTimeout(() => el.remove(), 260);
    if (b.dataset.u === "go") showUpdate(r);
    else { try { sessionStorage.setItem("ninokuu:updLater", String(r.version || r.build)); } catch {} }
  });
  document.body.append(el);
  setTimeout(() => { if (el.isConnected) { el.classList.add("out"); setTimeout(() => el.remove(), 260); } }, 12000);
}
const updTick = () => { if (document.visibilityState === "visible" && Date.now() - updLast > 14 * 60e3) checkUpdate(false); };

let exitArmed = false, exitT = null;
function startApp() {
  document.body.classList.add("is-app");
  N.onKeyboard(setKeyboard);
  N.onPushReceived(() => refreshDots());
  setTimeout(() => checkUpdate(false, true), 2500);              // aplikasi dibuka: selalu cek baru (tanpa simpanan)
  setInterval(updTick, 60e3);                                   // tiap menit dicek apakah sudah 15 menit sejak cek terakhir
  N.onResume(() => { if (Date.now() - updLast > 5 * 60e3) setTimeout(() => checkUpdate(false, true), 1200); });
  N.onPushOpen((h) => go(h));
  N.onUrlOpen((h, why) => {
    go(h);
    if (why === "verified") setTimeout(() => toast(S.loggedIn() ? "Email terverifikasi." : "Email terverifikasi. Silakan masuk dengan email & kata sandimu.", 4000), 400);
    if (why === "reset") { if (!S.loggedIn()) authMode = "in"; setTimeout(() => toast(S.loggedIn() ? "Password baru sudah aktif." : "Password baru sudah aktif. Silakan masuk.", 4000), 400); }
  });
  // tombol kembali Android: tutup lapisan yang terbuka dulu, lalu mundur; di Beranda → keluar
  N.onBack((exit) => {
    const ae = document.activeElement;
    if (ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName) && document.body.classList.contains("chfoc")) { ae.blur(); return; }
    if (closeAsk()) return;   // dialog konfirmasi terbuka → tombol kembali = Batal
    const flt = $(".flt-host [data-f=close]"); if (flt) { flt.click(); return; }
    if (sheetEl) { closeSheet(); return; }
    if (document.getElementById("notif")) { closeNotif(); return; }
    const chatSheet = $("#host [data-c=close]"); if (chatSheet) { chatSheet.click(); return; }
    const rmenu = $(".r-menu:not([hidden])"); if (rmenu) { $("[data-act=closeMenu]")?.click(); return; }
    const chs = $(".chs-host [data-x=close]"); if (chs) { chs.click(); return; }
    const ip = $(".img-prev"); if (ip) { ip.click(); return; }
    if (X.closeDaily()) return;
    if (route.name === "reader" && acts.back) { acts.back(); return; }   // pembaca: bar meluncur keluar dulu
    // sama seperti prototipe: halaman dalam → mundur; tab lain → Beranda; Beranda → tekan sekali lagi untuk keluar
    if (!["home", "search", "fav", "more"].includes(route.name)) { if (navIdx > 0) history.back(); else goReplace("#/home"); return; }
    if (route.name !== "home") { goReplace("#/home"); return; }
    if (exitArmed) { exit(); return; }
    exitArmed = true; toast("Tekan kembali sekali lagi untuk keluar", 2000);
    clearTimeout(exitT); exitT = setTimeout(() => { exitArmed = false; }, 2000);
  });
  const pushQuiet = () => { if (S.loggedIn()) N.pushEnable(api.rpc, false).catch(() => {}); };
  const check = () => { if (S.loggedIn()) N.checkBlockedSources([...S.state.lib.values()], api.call).catch(() => {}); };
  setTimeout(pushQuiet, 3000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { pushQuiet(); if (route.name === "more") refreshPushStatus(); } });
  setTimeout(check, 8000);
  setInterval(check, 30 * 60e3);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
}

/* ---------- halaman turunan Lainnya ---------- */
const RANK_INFO = S.RANK_LIST;
async function vPage(name) {
  if (name === "dev") return vDev(view, ctx());
  const p = S.state.profile, lv = S.levelOf(p), user = api.currentUser();
  if (["name", "email", "pass"].includes(name) && !user) { go("#/more"); return; }
  let html = "";
  const acts2 = { back: () => back("#/more") };
  if (name === "level") { cleanup = await X.vLevel(view, lctx()); return; }
  if (name === "recap") { await X.vRecap(view, lctx()); return; }
  if (name === "name") {
    html = topbar("Nama tampilan") + `<form class="px col g14 mt6" id="pf"><p class="mu sm lh m0">Nama ini dipakai untuk sapaan di Beranda dan tampil di chat publik.</p>
  <label class="fld">Nama<input name="v" maxlength="24" required autocomplete="nickname" value="${esc(p?.name || "")}"></label><span class="err" id="perr"></span>
  <button class="btn primary">Simpan</button></form>`;
    acts2.submit = async (f) => { await S.setName(f.get("v").trim()); toast("Nama disimpan"); back("#/more"); };
  } else if (name === "email") {
    html = topbar("Email") + `<form class="px col g14 mt6" id="pf"><div class="card col g4"><span class="mu xs">Email saat ini</span><b>${esc(user.email || "")}</b></div>
  <label class="fld">Email baru<input name="v" type="email" required autocomplete="email" placeholder="nama@email.com"></label><span class="err" id="perr"></span>
  <p class="mu xs lh m0">Kami kirim link konfirmasi ke email baru. Email baru aktif setelah link diketuk.</p><button class="btn primary">Kirim link konfirmasi</button></form>`;
    acts2.submit = async (f) => { await api.updateUser({ email: f.get("v").trim() }); toast("Cek email baru untuk konfirmasi.", 4000); back("#/more"); };
  } else if (name === "pass") {
    html = topbar("Ganti password") + `<form class="px col g14 mt6" id="pf">
  <label class="fld">Password baru<input name="v" type="password" minlength="8" required autocomplete="new-password" placeholder="Minimal 8 karakter"></label>
  <label class="fld">Ulangi password baru<input name="v2" type="password" minlength="8" required autocomplete="new-password"></label><span class="err" id="perr"></span>
  <button class="btn primary">Simpan password</button></form>`;
    acts2.submit = async (f) => { if (f.get("v") !== f.get("v2")) throw new Error("Kedua password tidak sama."); await api.updateUser({ password: f.get("v") }); toast("Password baru disimpan"); back("#/more"); };
  } else if (name === "backup") {
    html = topbar("Backup data offline") + `<div class="px col g14 mt6"><p class="mu sm lh m0">Simpan salinan data Ninokuu ke file di HP. Berguna sebelum ganti HP atau memasang ulang aplikasi.</p>
  <div class="card col g6"><b>Isi backup</b><span class="mu sm">${S.state.lib.size} judul koleksi · ${S.state.hist.size} riwayat baca · pengaturan</span></div>
  <button class="btn primary" data-act="dl">${icon("down", 18, 2)}Simpan file backup</button></div>`;
    acts2.dl = async (el) => {
      const data = { app: "ninokuu", v: 1, at: new Date().toISOString(), lib: [...S.state.lib.values()], hist: [...S.state.hist.values()], settings: S.state.settings };
      const d = new Date(), pad = (n) => String(n).padStart(2, "0");
      const name = `ninokuu-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`, text = JSON.stringify(data);
      if (!DL.supported()) {   // web: unduh lewat browser
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([text], { type: "application/json" })); a.download = name;
        a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        toast("File backup diunduh"); return;
      }
      // APK: WebView tidak bisa mengunduh lewat tautan, jadi file ditulis langsung ke penyimpanan HP
      el.disabled = true;
      try {
        const r = await DL.saveText(name, text);
        el.parentNode.querySelector(".bk-res")?.remove();
        // file hanya bisa disimpan di dalam aplikasi → langsung buka menu bagikan supaya bisa disimpan ke File/Drive/WhatsApp
        el.insertAdjacentHTML("afterend", `<div class="card col g6 bk-res"><b class="gold row g6">${icon("check", 16, 2.4)} ${r.where ? "File backup tersimpan" : "File backup siap"}</b>
          <span class="mu sm" style="word-break:break-all">${r.where ? esc(r.where) : "HP ini tidak mengizinkan menyimpan ke folder umum. Pilih tempat menyimpan lewat tombol di bawah (mis. File, Drive, atau WhatsApp)."}</span>
          ${r.uri ? `<button class="btn ${r.where ? "" : "primary"}" data-act="bkshare">${icon("send", 17, 2)}${r.where ? "Bagikan / simpan ke tempat lain" : "Simpan ke…"}</button>` : ""}</div>`);
        acts2.bkshare = () => DL.shareFile(r.uri, "Backup Ninokuu").catch((e) => toast(e.message || "Gagal membagikan"));
        if (!r.where && r.uri) acts2.bkshare(); else toast("File backup tersimpan");
      } catch (e) { toast(e?.message || "Gagal menyimpan file backup"); }
      el.disabled = false;
    };
  } else if (name === "restore") {
    html = topbar("Pulihkan data") + `<div class="px col g14 mt6"><p class="mu sm lh m0">Pilih file backup (.json) dari HP. Data di file digabung dengan data yang sudah ada; judul yang sama tidak terduplikat.</p>
  <label class="btn primary">${icon("restore", 18, 2)}Pilih file backup<input type="file" accept="application/json,.json" id="rf" hidden></label><span class="err" id="perr"></span></div>`;
  } else if (name === "akun") {
    // Akun: foto profil, nama tampilan, email, password (sama seperti halaman Pengaturan)
    const user = api.currentUser();
    if (!user) { go("#/more"); return; }
    const pr = S.state.profile;
    view.innerHTML = topbar("Akun") + `<div class="px col g14 mt6">
  <section class="sec"><h2 class="cap">Profil</h2><div class="group">${mrow("img", "Foto profil", pr?.avatar_path ? "Ketuk untuk mengganti · maks 10 MB" : "Belum ada · ketuk untuk menambah (maks 10 MB)", "photo") + mrow("user", "Nama tampilan", esc(pr?.name || ""), "goName")}</div></section>
  <section class="sec"><h2 class="cap">Masuk &amp; keamanan</h2><div class="group">${mrow("msg", "Email", esc(user.email || ""), "goEmail") + mrow("key", "Ganti password", "", "goPass")}</div></section></div><div class="pad-nav"></div>`;
    setActs({ back: () => back("#/more"), photo: () => openPhoto(), goName: () => go("#/p/name"), goEmail: () => go("#/p/email"), goPass: () => go("#/p/pass") });
    return;
  } else if (name === "settings") {
    // Pengaturan: tampilan & perilaku saat membaca (pilihan bacaan juga ada di menu ⋯ pembaca)
    const draw = () => {
      const st = S.state.settings;
      view.innerHTML = topbar("Pengaturan") + `<div class="px col g14 mt6">
  <section class="sec"><h2 class="cap">Mode baca</h2><div class="card col g12">
  ${seg([{ id: "scroll", name: "Scroll (webtoon)" }, { id: "slide", name: "Slide (halaman)" }], st.readMode, "rmode", "s2")}
  ${st.readMode === "slide" ? `<span class="mu sm">Arah geser</span>${seg([{ id: "rtl", name: "Kanan ke kiri" }, { id: "ltr", name: "Kiri ke kanan" }], st.readDir === "ltr" ? "ltr" : "rtl", "dir", "s2")}` : ""}
  <span class="mu xs lh">${st.readMode === "slide" ? "Geser per halaman. Kanan ke kiri cocok untuk manga Jepang. Manhwa/manhua tetap dibaca dengan Scroll." : "Gulir ke bawah, halaman tersambung. Cocok untuk manhwa dan manhua."}</span></div></section>
  <section class="sec"><h2 class="cap">Tampilan</h2><div class="card col g12"><span class="b145">Mode efek avatar</span>
    ${seg([{ id: "Ringan", name: "Ringan" }, { id: "Normal", name: "Normal" }], S.state.settings.gfx || "Normal", "gfx", "s2")}
    <span class="mu xs lh">${(S.state.settings.gfx || "Normal") === "Ringan" ? "Partikel dikurangi; komet, aurora, dan awan nebula dimatikan. Hemat baterai, cocok untuk HP spek rendah." : "Bingkai avatar kosmik penuh dengan partikel dan animasi."}</span></div></section>
  <section class="sec"><h2 class="cap">Bacaan</h2><div class="group" id="setRead">${readPrefs("rtog")}</div></section></div><div class="pad-nav"></div>`;
    };
    draw();
    setActs({ back: () => back("#/more"), gfx: (el) => { S.setSetting("gfx", el.dataset.v); applyGfx(); draw(); },
      rmode: (el) => { S.setSetting("readMode", el.dataset.v); draw(); }, dir: (el) => { S.setSetting("readDir", el.dataset.v); draw(); }, rtog: (el) => { const on = !S.state.settings[el.dataset.k]; S.setSetting(el.dataset.k, on); flipToggle(el, on); }, rch: (el) => { S.setSetting(el.dataset.k, el.dataset.v); flipChoice(el); } });
    return;
  } else if (name === "about") {
    html = topbar("Tentang aplikasi") + `<div class="px col g14 mt10"><div class="card col center g10 big-card"><img src="icons/logo.png" alt="Ninokuu" class="about-logo">
    <span class="mu sm lh">Baca manga, manhwa, dan manhua dari banyak sumber dalam satu aplikasi.</span><span class="row g8 jc"><span class="pill">Versi ${esc(VERSION)}</span><span class="pill">Web</span></span></div>
  <div class="group">${mrow("layers", "Sumber yang didukung", "Komiku, Kiryuu, Shinigami, WestManga")}${mrow("cloud", "Sinkronisasi", "Supabase · koleksi, riwayat, pengaturan")}</div>
  <div class="card lh sm soft"><b class="b14 block mb6">Penting diketahui</b>Ninokuu tidak menyimpan atau mengunggah komik. Aplikasi hanya menampilkan konten dari situs sumber pihak ketiga. Hak cipta tiap karya milik penulis dan penerbitnya. Dukung karya favoritmu lewat rilis resminya bila tersedia.</div>
  <p class="mu xs center lh">Dibuat dengan ♥ oleh Rexxaply<br>© 2026 Ninokuu</p></div>`;
  } else if (DOCS[name]) {
    const dd = DOCS[name];
    html = topbar(dd.title) + `<div class="px col g14 mt10"><span class="mu xs">Terakhir diperbarui ${esc(dd.updated)}</span><p class="lh m0">${dd.intro}</p>
  ${dd.secs.map(([hd, b], i) => `<section class="card"><h2 class="doc-h"><span class="gold">${String(i + 1).padStart(2, "0")}</span>${hd}</h2><div class="doc-b">${b}</div></section>`).join("")}
  <p class="mu xs lh">Ada pertanyaan? Hubungi kami lewat server Discord Ninokuu.</p></div>`;
  } else { go("#/more"); return; }
  view.innerHTML = html + `<div class="pad-nav"></div>`;
  const pf = $("#pf");
  if (pf) pf.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = pf.querySelector("button"); btn.disabled = true; $("#perr").textContent = "";
    try { await acts2.submit(new FormData(pf)); } catch (ex) { $("#perr").textContent = ex.message; btn.disabled = false; }
  });
  const rf = $("#rf");
  if (rf) rf.addEventListener("change", async () => {
    const file = rf.files?.[0]; if (!file) return;
    try {
      const j = JSON.parse(await file.text());
      if (j?.app !== "ninokuu") throw new Error("Ini bukan file backup Ninokuu.");
      // isi backup tidak dipercaya: hanya sumber yang dikenal, field dari daftar putih, string dipotong, angka dipaksa bulat
      const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
      const int = (v) => { const x = Math.trunc(Number(v)); return Number.isFinite(x) && x > 0 ? Math.min(x, 10000) : 0; };
      const okKey = (x) => !!x && SRC_IDS.includes(x.source) && typeof x.comic_id === "string" && x.comic_id.length > 0 && x.comic_id.length <= 300;
      let added = 0;
      for (const m of Array.isArray(j.lib) ? j.lib : []) {
        if (!okKey(m) || typeof m.title !== "string" || !m.title) continue;
        const row = { source: m.source, comic_id: m.comic_id, title: str(m.title, 300), cover: str(m.cover, 1000) };
        if (!S.inLib(row.source, row.comic_id)) { await S.toggleLib(row).catch(() => {}); added++; }
      }
      for (const h of Array.isArray(j.hist) ? j.hist : []) {
        if (!okKey(h) || S.histItem(h.source, h.comic_id)) continue;
        S.saveHistory({ source: h.source, comic_id: h.comic_id, title: str(h.title, 300), cover: str(h.cover, 1000), type: str(h.type, 20),
          chapter: str(h.chapter, 40), chapter_id: str(h.chapter_id, 300), page: int(h.page), pages: int(h.pages) });
      }
      if (j.settings && typeof j.settings === "object") ["readMode", "readDir", "updView", "searchView", "favView", "gfx", "favSort"].forEach((k) => { if (typeof j.settings[k] === "string") S.setSetting(k, j.settings[k]); });
        ["autoHide"].forEach((k) => { if (typeof j.settings[k] === "boolean") S.setSetting(k, j.settings[k]); });
        ["screenMode", "nextDelay"].forEach((k) => { if (typeof j.settings[k] === "string") S.setSetting(k, j.settings[k]); });
      toast(`Data dipulihkan · ${added} judul baru di koleksi`, 3500); go("#/fav");
    } catch (ex) { $("#perr").textContent = ex.message || "File tidak bisa dibaca."; }
  });
  setActs(acts2);
}

const ctx = () => ({ topbar, setActs, go, back, loading });
const lctx = () => ({ ...ctx(), avatarHtml, rankPill, badges, loadAvatars, RANK_INFO });
const dctx = () => ({ ...ctx(), getDetail, histOf: (s, i) => S.histItem(s, i), openSheet, closeSheet, errBox });
const VIEWS = { download: async (s, i) => { cleanup = await DL.vDownload(view, dctx(), s, i); }, chat: async () => { cleanup = await vChat(view, ctx()); }, comments: (s, i) => vComments(s, i), chcomments: (s, i, c) => vComments(s, i, c), chapters: vChapters, home: vHome, search: vSearch, fav: vFav, more: vMore, detail: vDetail, reader: vReader, page: vPage };

/* ---------- mulai ---------- */
// bingkai rank untuk komentar/chat disiapkan saat aplikasi sedang santai (bukan saat membuka halaman komik)
setTimeout(() => (window.requestIdleCallback || ((f) => setTimeout(f, 1)))(() => framesReady(), { timeout: 10000 }), 5000);
const applyGfx = () => document.body.classList.toggle("nk-lite", S.state.settings.gfx === "Ringan");
applyGfx();
// Posisi miring dicek dari ukuran layar fisik (tidak berubah saat keyboard muncul).
function checkOrientation() {
  const sw = screen.width || 0, sh = screen.height || 0;
  const type = screen.orientation?.type || (Math.abs(window.orientation || 0) === 90 ? "landscape" : sw > sh ? "landscape" : "portrait");
  const phone = Math.min(sw, sh) > 0 && Math.min(sw, sh) < 600;
  // Jendela mengambang / layar terbagi: aplikasi hanya memakai sebagian layar → tetap tampil (tata letak menyesuaikan),
  // pesan "putar HP" hanya untuk layar penuh yang miring.
  const full = window.innerWidth * window.innerHeight >= sw * sh * 0.8;
  document.body.classList.toggle("landscape-phone", phone && full && type.startsWith("landscape"));
  document.body.classList.toggle("short", window.innerHeight < 520);
}
checkOrientation();
screen.orientation?.addEventListener?.("change", checkOrientation);
window.addEventListener("orientationchange", () => setTimeout(checkOrientation, 50));
let oriT = 0; window.addEventListener("resize", () => { clearTimeout(oriT); oriT = setTimeout(() => { if (!kbOpen) checkOrientation(); }, 120); });

// Data lokal dibersihkan saat keluar, dan juga saat akun berganti TANPA keluar (mis. sesi diganti oleh tautan #access_token):
// tanpa ini, syncAfterLogin() akan mengunggah koleksi/riwayat akun lama ke akun yang baru.
// Tamu → masuk (uid null → akun) tetap menggabungkan data tamu seperti biasa.
let authUid = api.userId();
api.onAuth((s) => {
  const uid = s?.user?.id || null;
  if (!s || (authUid && uid && uid !== authUid)) S.clearUserData();
  authUid = uid;
});
if (S.loggedIn()) { S.loadProfile().catch(() => {}); S.pull().catch(() => {}); }
// perubahan data beruntun (mis. 12 komik dicek chapter terbarunya) digabung jadi 1 gambar ulang per frame
let favSubRaf = 0;
S.subscribe(() => { if (route.name !== "fav" || favSubRaf) return; favSubRaf = requestAnimationFrame(() => { favSubRaf = 0; if (route.name === "fav" && !document.activeElement?.matches?.("#fq")) vFav(undefined, true); }); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") S.flushHistory(); });
// Android WebView kadang tidak menggambar ulang area gulir (halaman komik) setelah aplikasi dibuka lagi dari
// latar belakang: layar gelap kosong sampai digeser. Geser 1 px lalu kembalikan untuk memaksa gambar ulang.
function repaintScrollers() {
  const nudge = (el) => { if (!el) return; const y = el.scrollTop, x = el.scrollLeft;
    if (el.scrollHeight > el.clientHeight) { el.scrollTop = y + (y > 0 ? -1 : 1); el.scrollTop = y; }
    else if (el.scrollWidth > el.clientWidth) { el.scrollLeft = x + (x > 0 ? -1 : 1); el.scrollLeft = x; } };
  document.querySelectorAll(".r-scroll, .r-slides").forEach(nudge);
  nudge(document.scrollingElement);
  view.style.transform = "translateZ(0)";
  requestAnimationFrame(() => { view.style.transform = ""; });
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  // permukaan WebView kadang baru siap sedikit setelah aplikasi tampil, jadi diulang sekali lagi
  requestAnimationFrame(repaintScrollers); setTimeout(repaintScrollers, 350);
});
N.onResume(() => { requestAnimationFrame(repaintScrollers); setTimeout(repaintScrollers, 350); });
// APK: berkas sudah ada di dalam aplikasi, service worker tidak diperlukan
if (!N.isApp && "serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
(async () => {
  try {
    const type = await api.sessionFromUrl();
    if (type) {
      await S.syncAfterLogin().catch(() => {});
      if (type === "recovery") { history.replaceState(null, "", location.pathname + "#/p/pass"); render(); toast("Buat password baru untuk akunmu.", 4000); return; }
      toast(type === "signup" ? "Email terkonfirmasi. Selamat datang!" : "Berhasil masuk", 3500);
    }
  } catch (e) { toast(e.message, 4500); }
  render();
  if (N.isApp) startApp();
  // pembaca aktif realtime (Presence); kunci = akun, tersambung ulang saat masuk/keluar akun
  O.start({ url: api.SB_URL, apikey: api.SB_KEY, userKey: () => api.userId() });
  { let last = api.userId(); api.onAuth(() => { const u = api.userId(); if (u !== last) { last = u; O.restart(); } }); }
  // pop-up "Yang baru" sekali setelah pembaruan (Dev: sekali setiap isi changelog berubah)
  T.maybeShow({ version: VERSION, build: N.BUILD, dev: N.DEV, go });
  X.startDaily();
  DL.start();
  // progres unduhan di baris "Unduhan" halaman Lainnya
  window.addEventListener("nk:dl", () => {
    const el = document.getElementById("dlsub"); if (!el) return;
    const pl = DL.progressLine(); el.textContent = `${DL.savedCount()} file tersimpan${pl ? " · " + pl : ""}`;
    const a = DL.active(), bar = document.getElementById("dlmbar"); if (!bar) return;
    bar.classList.toggle("on", !!a); bar.classList.toggle("pz", !!a?.paused);
    if (a) bar.firstElementChild.style.width = Math.max(3, a.pct).toFixed(1) + "%";
  });
  // bingkai avatar (berkas besar) dimuat di latar belakang agar menu Lainnya langsung tampil
  setTimeout(() => (window.requestIdleCallback || setTimeout)(() => loadAvatars()), 1200);
})();
