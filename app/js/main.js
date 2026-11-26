// Ninokuu PWA · router dan semua layar (mengikuti prototipe desain di canvas).
import * as api from "./api.js";
import * as S from "./store.js";
import { QUOTES } from "./assets.js";
import { DOCS } from "./docs.js";
import * as N from "./native.js";
import { openFilter, activeCount, genreName, STATUS_NAME, loadFilters } from "./filters.js";
import { vChat, vDev, roomFor, roomPreview, roomCount, miniMsg, bindSpoilers, watchAvatars, framesReady } from "./chat.js";
import * as X from "./exp.js";
import * as DL from "./dl.js";
import * as T from "./tour.js";
import * as O from "./online.js";
import { vFav, bindFav } from "./fav.js";
import { vSearch, bindSearch, setSrc, normQ, matchQ } from "./search.js";
import { vHome, bindHome, savedSrc, SRC_IDS, NO_SCORE, sortSheet, browseCache, setHomeSrc } from "./home.js";
import { vDetail, vChapters, cachedDetail, getDetail, chaptersHref, chLike, matchCh, bindDetail } from "./detail.js";
import { vReader, bindReader, closeCrop } from "./reader.js";
import { vImport } from "./import.js";
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
// untuk modul halaman (reader.js, dst.): lembar yang sedang terbuka & pembersih halaman
const sheet = () => sheetEl;
const setCleanup = (f) => { cleanup = f; };
// kotak isian sederhana (nama rak, dll.): hasil = teks, atau null bila dibatalkan
async function promptText(title, { value = "", placeholder = "", ok = "Simpan", max = 30 } = {}) {
  let v = null;
  const p = ask("", { title, ok, html: `<input class="ask-in" id="askIn" maxlength="${max}" autocomplete="off" placeholder="${esc(placeholder)}" value="${esc(value)}">` });
  requestAnimationFrame(() => { const i = $("#askIn"); if (i) { i.focus(); i.select(); } });
  if (await p) v = ($("#askIn")?.value || "").trim();
  return v || null;
}
// lembar pilih rak untuk satu komik di koleksi
function shelfSheet(src, id, after) {
  const cur = S.libItem(src, id)?.shelf || "", list = S.shelves();
  openSheet(`<span class="sheet-ttl">Simpan di rak</span><div class="col g4" role="radiogroup">
    ${[["", "Tanpa rak"], ...list.map((n) => [n, n])].map(([k, n]) => `<button class="sh-row" role="radio" aria-checked="${k === cur}" data-s="pick" data-v="${esc(k)}"><span class="mu">${icon(k ? "folder" : "x", 17)}</span><span class="grow">${esc(n)}</span>${k === cur ? `<span class="redt">${icon("check", 18, 2.4)}</span>` : ""}</button>`).join("")}
    <button class="sh-row" data-s="new"><span class="redt">${icon("plus", 18, 2.2)}</span><span class="grow redt">Rak baru…</span></button></div>`,
  async (b) => {
    let v = b.dataset.v ?? "";
    if (b.dataset.s === "new") { closeSheet(); v = await promptText("Rak baru", { placeholder: "mis. Sedang dibaca, Nanti, Tamat" }); if (!v) return; }
    else closeSheet();
    try { await S.setShelf(src, id, v); toast(v ? `Disimpan di rak ${S.cleanShelf(v)}` : "Dikeluarkan dari rak"); after?.(); } catch (e) { toast(e.message); }
  });
}
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
// skor di pojok kanan atas sampul (hanya bila sumbernya punya skor untuk komik itu)
const scoreTag = (it, src) => { const n = Number(it?.score); return !NO_SCORE.has(src) && n > 0 && n <= 10 ? `<span class="cv-score" aria-label="Skor ${esc(n.toFixed(1).replace(".", ","))}">${icon("star", 10, 2)}${esc(n.toFixed(1).replace(".", ","))}</span>` : ""; };
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
const gcard = (href, it, src, badge = "") => `<a class="grid-card" href="${href}"><span class="gc-cv">${cover(it.cover, it.title)}${badge}${scoreTag(it, src)}</span><b class="t2">${esc(it.title)}</b><span class="mu xs">${esc(typeName(it.type) || srcName(src))}</span></a>`;
const viewBtn = (grid, act, cls = "") => `<button class="sq-btn ${cls}" data-act="${act}" aria-label="${grid ? "Tampilan daftar" : "Tampilan grid"}">${icon(grid ? "list" : "grid", 18, 2)}</button>`;
const typeFromTags = (tags = []) => (tags.map((t) => String(t).toLowerCase()).find((t) => ["manga", "manhwa", "manhua"].includes(t)) || "");
const pct = (a, b) => (b ? Math.max(3, Math.min(100, Math.round((a / b) * 100))) : 0);

/* ---------- notifikasi (lonceng): maks 30, 7 hari terakhir ---------- */
let notifs = [];
const readSet = new Set(api.lsGet("notifRead", []));
const saveRead = () => api.lsSet("notifRead", [...readSet].slice(-200));
async function loadNotifs() {
  if (!S.loggedIn()) { notifs = []; return; }
  const got = await api.rest("notifications?select=id,title,body,source,comic_id,chapter,cover,created_at,link&order=created_at.desc&limit=30").catch(() => null);
  if (got) { notifs = got; applyNotifLatest(got); }
}
// notifikasi chapter baru langsung memperbarui "chapter terbaru" komik di Koleksi, jadi label NEW UPDATE muncul tanpa
// harus membuka komiknya dulu (berlaku untuk semua sumber)
const chNumOf = (v) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
function applyNotifLatest(list) {
  for (const x of [...list].reverse()) {              // lama → baru, supaya yang terbaru menang
    if (!x?.source || !x.comic_id || x.chapter == null) continue;
    const row = S.libItem(x.source, x.comic_id), n = chNumOf(x.chapter);
    if (!row || n == null) continue;
    const cur = chNumOf(row.latest);
    if (cur != null && (cur > n || (cur === n && row.latestAt))) continue;
    S.updateLibMeta(x.source, x.comic_id, { latest: String(x.chapter), latestAt: x.created_at || null });
  }
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
          <span class="pop-cv">${x.cover ? `<img ${N.imgAttrs(x.cover)} alt="" loading="lazy" referrerpolicy="no-referrer" data-rm>` : icon(x.link ? "reply" : x.comic_id ? "book" : "mega", 15)}</span>
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
      go(x.link && /^#\/(chat|k|kc)(\/|$)/.test(x.link) ? x.link : x.source && x.comic_id ? comicHref(x.source, x.comic_id) : "#/chat");
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
${group("Data &amp; penyimpanan", mrow("cloud", "Backup data offline", "Simpan koleksi, riwayat, dan pengaturan ke file", "backup") + mrow("restore", "Pulihkan data", "Dari file backup", "restore") + mrow("swap", "Impor dari aplikasi lain", "Koleksi & riwayat dari backup BacaKomik", "import") + mrow("trash", "Bersihkan cache", `<span id="cachesub">Menghitung cache di HP…</span>`, "cache"))}
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
    backup: () => go("#/p/backup"), restore: () => go("#/p/restore"), import: () => go("#/p/import"),
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
    logout: async () => { if (!(await ask("Keluar dari akun? Koleksi dan riwayatmu tetap aman di server.", { ok: "Keluar", danger: true }))) return; await S.flushHistory(); await N.pushRelease(api.rest).catch(() => {}); await N.bgStop(api.call); await api.signOut(); S.clearUserData(); toast("Kamu sudah keluar"); vMore(); },
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
  N.onPushReceived(() => { refreshDots(); loadNotifs().catch(() => {}); });
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
    if (closeCrop()) return;
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
  const check = () => {
    if (!S.loggedIn()) return;
    N.checkBlockedSources([...S.state.lib.values()], api.call).catch(() => {});
    // cek latar belakang Komiku dkk. untuk semua pengguna: hanya dari HP akun developer, dan hanya bila bot Termux
    // tidak sedang aktif (lihat N.bgAuto)
    if (S.state.profile?.role === "developer") N.bgAuto(api.currentUser()?.id, api.call, api.FN, api.SB_KEY).catch(() => {});
  };
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
  if (name === "import") { cleanup = await vImport(view, ctx()); return; }
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
      const data = { app: "ninokuu", v: 1, at: new Date().toISOString(), lib: [...S.state.lib.values()], hist: [...S.state.hist.values()], settings: S.state.settings, readChs: S.readChsAll() };
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
      if (j.readChs && typeof j.readChs === "object" && !Array.isArray(j.readChs)) for (const [k, ids] of Object.entries(j.readChs).slice(0, 500)) {
        const [source, ...rest] = k.split("|"), comic_id = rest.join("|");
        if (okKey({ source, comic_id }) && Array.isArray(ids)) S.mergeReadChs(source, comic_id, ids.slice(-3000));
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
S.subscribe(() => { if (route.name !== "fav" || favSubRaf) return; favSubRaf = requestAnimationFrame(() => { favSubRaf = 0; if (route.name === "fav" && !document.activeElement?.matches?.("#fq, #fbq")) vFav(undefined, true); }); });
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
// Halaman yang dipecah ke modul sendiri (home/search/detail/fav/reader.js) memakai router, lembar bawah, dan
// potongan tampilan bersama dari sini. Diserahkan sekali, sebelum halaman pertama digambar.
bindReader({ parse, cachedDetail, view, back, backTo, chaptersHref, setActs, getDetail, typeFromTags, chLike, commentsHref, readPrefsCompact, soon, openSheet, closeSheet, sheet, setCleanup, choiceVal, openReport, flipToggle, flipChoice, goReplace, matchCh });
bindDetail({ detailCache, normQ, matchQ, openSheet, closeSheet, go, goReplace, typeFromTags, view, parse, setActs, back, backTo, compactNum, NO_SCORE, scoreTag, commentsHref, dlOpen, openReport, shelfSheet, topbar, setCleanup });
bindHome({ openSheet, closeSheet, view, pct, viewBtn, seg, gcard, minRow, CROWN, scoreTag, setActs, openNotif, setSrc, refreshDots, setCleanup });
bindSearch({ view, seg, viewBtn, chips, gcard, minRow, setActs, setCleanup });
bindFav({ loadNotifs, pct, viewBtn, seg, view, setActs, promptText, openSheet, closeSheet, parse, setCleanup });
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
  // jumlah pembaca aktif di samping ikon chat publik Beranda ("● 3"); hilang bila belum tersambung
  O.onCount((n) => {
    const b = document.getElementById("chatBtn"); if (!b) return;
    b.classList.toggle("on", n > 0); $("#onlN b", b).textContent = n || "";
    b.setAttribute("aria-label", n ? `Chat publik · ${n} pembaca aktif` : "Chat publik");
  });
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
