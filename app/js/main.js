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
import { esc, icon, $, $$, toast, ago, SOURCES, srcName, TYPES, typeName, cover, comicHref, readHref, greeting, errBox, loading, rankBadge } from "./ui.js";

const VERSION = window.NINOKUU_CONFIG?.VERSION || "1.0.0";
const KIND_NAME = { mayor: "Pembaruan besar", minor: "Fitur baru", patch: "Perbaikan" };
const view = $("#view");
const nav = $("#nav");
let route = { name: "home", params: [], key: "" };
let cleanup = null;
const scrollMem = new Map();
const detailCache = new Map();

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
let renderSeq = 0;
async function render() {
  trackNav();
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
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
  const ti = Math.max(0, TABS.indexOf(tab ?? prevTab));
  nav.style.setProperty("--ti", ti);
  $$("#nav a").forEach((a) => a.setAttribute("aria-current", String(a.dataset.tab === tab)));
  // arah animasi: masuk lebih dalam / tab di kanan = dari kanan; kembali = dari kiri
  const depth = DEPTH[route.name] ?? 0, prevDepth = DEPTH[prevName] ?? 0;
  const fwd = depth !== prevDepth ? depth > prevDepth : TABS.indexOf(route.name) >= TABS.indexOf(prevName);
  prevName = route.name; if (tab) prevTab = tab;
  // animasi masuk dimulai setelah layar baru terisi, supaya layar lama tidak ikut "meluncur lagi"
  const my = ++renderSeq;
  view.classList.remove("in", "in-f", "in-b");
  view.innerHTML = "";
  let animated = false;
  const animate = () => { if (animated || my !== renderSeq) return; animated = true; void view.offsetWidth; view.classList.add("in", fwd ? "in-f" : "in-b"); };
  const job = (VIEWS[route.name] || VIEWS.home)(...route.params);
  if (view.childElementCount) animate();
  await job;
  animate();
  // chat & komentar mengatur gulirnya sendiri (langsung ke pesan terbaru)
  if (["chat", "comments", "chcomments"].includes(route.name)) return;
  const y = scrollMem.get(route.key);
  requestAnimationFrame(() => window.scrollTo(0, y || 0));
}
window.addEventListener("hashchange", render);
const go = (h) => { location.hash = h; };
// ganti halaman tanpa menambah riwayat (dipakai saat pindah chapter)
const goReplace = (h) => { if (h === location.hash) return; replacing = true; location.replace(h); };
const back = (fallback = "#/home") => (navIdx > 0 ? history.back() : goReplace(fallback));
// kembali ke halaman tertentu: mundur bila itu memang halaman sebelumnya, selain itu ganti halaman ini
const backTo = (href, alsoOk = []) => { const prev = navStack[navIdx - 1]; if (navIdx > 0 && (prev === href || alsoOk.includes(prev))) history.back(); else goReplace(href); };

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
const lrow = (href, cv, title, sub, right = "") => `<a class="lrow" href="${href}">${cv}<span class="rc-mid"><span class="lr-t">${title}</span><span class="mu sm">${sub}</span></span>${right}</a>`;
const gcard = (href, it, src, badge = "") => `<a class="grid-card" href="${href}"><span class="gc-cv">${cover(it.cover, it.title)}${badge}</span><b class="t2">${esc(it.title)}</b><span class="mu xs">${esc(typeName(it.type) || srcName(src))}</span></a>`;
const viewBtn = (grid, act, cls = "") => `<button class="sq-btn ${cls}" data-act="${act}" aria-label="${grid ? "Tampilan daftar" : "Tampilan grid"}">${icon(grid ? "list" : "grid", 18, 2)}</button>`;
const typeFromTags = (tags = []) => (tags.map((t) => String(t).toLowerCase()).find((t) => ["manga", "manhwa", "manhua"].includes(t)) || "");
const pct = (a, b) => (b ? Math.max(3, Math.min(100, Math.round((a / b) * 100))) : 0);

/* ---------- Beranda ---------- */
let homeSrc = "komiku";
const browseCache = new Map();
async function browse(src, opt) {
  const k = JSON.stringify([src, opt]);
  const hit = browseCache.get(k);
  if (hit && Date.now() - hit.at < 5 * 60e3) return hit.data;
  const data = await api.call("browse", { source: src, ...opt });
  browseCache.set(k, { at: Date.now(), data });
  return data;
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
      <span class="mu sm">Chapter ${esc(last.chapter)}${last.pages ? ` · halaman ${last.page || 1} dari ${last.pages}` : ""}</span>
      <span class="prog"><span style="width:${pct(last.page || 1, last.pages || 0) || 6}%"></span></span></span>
    <span class="play">${icon("play", 19, 2)}</span></a></section>` : ""}
<section class="sec s26 nox"><div class="sec-h px"><h2>Top 10 populer</h2><span class="mu sm">${esc(srcName(homeSrc))}</span></div><div class="hs" id="pop">${loading(3, "sk-top")}</div></section>
<section class="sec s24"><h2>Jelajah kategori</h2><div class="cats">
  ${[["manga", "Jepang"], ["manhwa", "Korea"], ["manhua", "Tiongkok"]].map(([t, c]) => `<a class="cat" href="#/search/${t}"><span class="flag f-${t}"></span><span class="col"><b>${typeName(t)}</b><span class="mu xs">${c}</span></span></a>`).join("")}
  <a class="cat" href="#/search"><span class="cat-ic">${icon("search", 20)}</span><span class="col"><b>Semua</b><span class="mu xs">Cari judul</span></span></a>
</div></section>
<section class="sec s26"><div class="sec-h"><h2>Update terbaru</h2><span class="row g12"><a class="link-red" href="#/search">Lihat semua</a>${viewBtn(S.state.settings.updView === "grid", "updView")}</span></div>
  ${seg(SOURCES, homeSrc, "src")}
  <div id="upd">${loading(5, "sk-lrow")}</div>
  <button class="btn ghost wide" data-act="more" id="updMore" hidden>Muat lagi</button></section>
<div class="pad-nav"></div>`;
  let page = 1, items = [];
  const drawUpd = () => {
    const grid = S.state.settings.updView === "grid";
    $("#upd").innerHTML = !items.length ? `<div class="empty"><b>Belum ada komik</b></div>`
      : grid ? `<div class="g3 mt14">${items.map((it) => gcard(comicHref(homeSrc, it.id), it, homeSrc)).join("")}</div>`
      : `<div class="rows mt8">${items.map((it) => lrow(comicHref(homeSrc, it.id), cover(it.cover, it.title, "sm"), esc(it.title), esc(typeName(it.type) || "Komik") + " · " + esc(srcName(homeSrc)), `<span class="mu">${icon("chev", 18)}</span>`)).join("")}</div>`;
  };
  const loadUpd = async (more = false) => {
    const src = homeSrc;
    try {
      const r = await browse(src, { sort: "update", page, limit: 20 });
      if (src !== homeSrc || !$("#upd")) return;
      items = more ? items.concat(r.items) : r.items;
      drawUpd();
      $("#updMore").hidden = !r.hasNext;
    } catch (e) { if (src === homeSrc && $("#upd")) $("#upd").innerHTML = errBox(e); }
  };
  const loadPop = async () => {
    const src = homeSrc;
    try {
      const r = await browse(src, { sort: "popular", page: 1, limit: 10 });
      if (src !== homeSrc || !$("#pop")) return;
      $("#pop").innerHTML = r.items.slice(0, 10).map((it, i) => `<a class="top10 ${i === 9 ? "w10" : ""}" href="${comicHref(src, it.id)}">
        <span class="t10-cv">${cover(it.cover, it.title, "top")}<span class="t10-n ${i < 3 ? "hot" : ""}" aria-hidden="true">${i + 1}</span></span>
        <span class="t10-t"><span class="t2 b13">${esc(it.title)}</span><span class="mu xs">${esc(typeName(it.type) || srcName(src))}</span></span></a>`).join("") || `<span class="mu sm px">Belum ada data</span>`;
    } catch (e) { if (src === homeSrc && $("#pop")) $("#pop").innerHTML = `<span class="mu sm px">${esc(e.blocked ? "Sumber ini menolak server. Pilih sumber lain di bawah." : e.message)}</span>`; }
  };
  setActs({
    quote: (el) => { qi = (qi + 1) % QUOTES.length; el.classList.add("fade"); setTimeout(() => { el.textContent = `“${QUOTES[qi]}”`; el.classList.remove("fade"); }, 200); },
    bell: () => openNotif(),
    src: (el) => { homeSrc = el.dataset.v; const y = window.scrollY; vHome().then(() => window.scrollTo(0, y)); },
    updView: (el) => { S.setSetting("updView", S.state.settings.updView === "grid" ? "list" : "grid"); el.outerHTML = viewBtn(S.state.settings.updView === "grid", "updView"); drawUpd(); },
    more: () => { page++; loadUpd(true); },
    retry: () => vHome(),
  });
  loadPop(); loadUpd(); refreshDots();
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
          <span class="pop-cv">${x.cover ? `<img src="${esc(x.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-rm>` : icon(x.comic_id ? "book" : "mega", 15)}</span>
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
      if (!confirm("Hapus semua notifikasi? Lonceng di tiap komik tetap menyala.")) return;
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
let sState = { q: "", src: "komiku", type: "", status: "", genres: [] };
async function vSearch(type) {
  if (type !== undefined) sState.type = TYPES.some((t) => t.id === type) ? type : "";
  view.innerHTML = `
<div class="page-h"><h1>Pencarian</h1></div>
<div class="px row g8"><label class="search grow"><span class="mu">${icon("search", 20)}</span><span class="sr">Cari judul</span>
  <input id="sq" type="search" enterkeyhint="search" autocomplete="off" placeholder="Cari judul manga, manhwa, manhua…" value="${esc(sState.q)}">
  <button type="button" class="clr" data-act="clear" aria-label="Hapus pencarian" ${sState.q ? "" : "hidden"}>${icon("x", 16, 2.2)}</button></label>
  <span id="fltbtn"></span></div>
<div class="sec s14">${seg(SOURCES, sState.src, "src")}</div>
<div class="px mt10" id="tchips"></div>
<div class="px" id="factive"></div>
<div class="sec-h px mt10"><span class="mu sm" id="sinfo"></span>${viewBtn(S.state.settings.searchView === "grid", "view")}</div>
<div id="sres" class="px">${loading(6, "sk-lrow")}</div>
<button class="btn ghost wide" data-act="more" id="sMore" hidden>Muat lagi</button>
<div class="pad-nav"></div>`;
  let page = 1, items = [], seq = 0, timer = null;
  // tombol filter (angka = jumlah filter aktif) dan baris filter aktif yang bisa dihapus satu-satu
  const drawFilters = () => {
    const n = activeCount(sState);
    $("#fltbtn").innerHTML = `<button class="flt-btn ${n ? "on" : ""}" data-act="filter" aria-label="Filter${n ? ` (${n} aktif)` : ""}">${icon("filter", 20)}${n ? `<span class="flt-n">${n}</span>` : ""}</button>`;
    $("#tchips").innerHTML = chips(TYPES, sState.type, "type");
    const pills = [...(sState.status ? [["status", "", STATUS_NAME[sState.status]]] : []), ...sState.genres.map((g) => ["genre", g, genreName(sState.src, g)])];
    $("#factive").innerHTML = pills.length ? `<div class="fact">${pills.map(([k, v, l]) => `<button class="fpill" data-act="unf" data-k="${k}" data-v="${esc(v)}" aria-label="Hapus filter ${esc(l)}">${esc(l)}${icon("x", 13, 2.4)}</button>`).join("")}<button class="link-red sm" data-act="unall">Hapus semua</button></div>` : "";
  };
  drawFilters();
  const draw = () => {
    const grid = S.state.settings.searchView === "grid";
    $("#sres").innerHTML = items.length ? (grid ? `<div class="g3 mt8">${items.map((it) => gcard(comicHref(sState.src, it.id), it, sState.src)).join("")}</div>`
      : `<div class="rows">${items.map((it) => lrow(comicHref(sState.src, it.id), cover(it.cover, it.title, "sm"), esc(it.title), esc(typeName(it.type) || "Komik") + " · " + esc(srcName(sState.src)), `<span class="mu">${icon("chev", 18)}</span>`)).join("")}</div>`)
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
      draw();
      $("#sMore").hidden = !r.hasNext;
    } catch (e) { if (my === seq && $("#sres")) $("#sres").innerHTML = errBox(e); }
  };
  const inp = $("#sq");
  inp.addEventListener("input", () => {
    const v = inp.value.trim();
    $("[data-act=clear]").hidden = !inp.value;
    clearTimeout(timer);
    if (v === sState.q) return;
    timer = setTimeout(() => { sState.q = v; load(); }, 400);
  });
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); clearTimeout(timer); sState.q = inp.value.trim(); inp.blur(); load(); } });
  cleanup = () => clearTimeout(timer);
  const pick = (act, el) => $$(`[data-act=${act}]`).forEach((b) => b.setAttribute(b.parentElement.classList.contains("chips") ? "aria-pressed" : "aria-selected", String(b === el)));
  setActs({
    clear: () => { inp.value = ""; sState.q = ""; $("[data-act=clear]").hidden = true; inp.focus(); load(); },
    src: (el) => { if (sState.genres.length) toast("Filter genre direset karena tiap sumber punya daftar genre sendiri."); sState.src = el.dataset.v; sState.genres = []; pick("src", el); drawFilters(); load(); },
    type: (el) => { sState.type = el.dataset.v; drawFilters(); load(); },
    filter: () => openFilter(sState.src, sState, (f) => { sState.type = f.type; sState.status = f.status; sState.genres = f.genres; drawFilters(); load(); }),
    unf: (el) => { if (el.dataset.k === "status") sState.status = ""; else sState.genres = sState.genres.filter((g) => g !== el.dataset.v); drawFilters(); load(); },
    unall: () => { sState.status = ""; sState.genres = []; drawFilters(); load(); },
    view: (el) => { S.setSetting("searchView", S.state.settings.searchView === "grid" ? "list" : "grid"); el.outerHTML = viewBtn(S.state.settings.searchView === "grid", "view"); draw(); },
    more: () => { page++; load(true); },
    retry: () => load(),
  });
  load();
}

/* ---------- Detail komik ---------- */
async function getDetail(src, id, force = false) {
  const k = src + "|" + id;
  const c = detailCache.get(k);
  if (c && !force && Date.now() - c.at < 10 * 60e3) return c.data;
  const data = await api.call("detail", { source: src, comic_id: id });
  data.chapters = (data.chapters || []).slice().sort((a, b) => (parseFloat(a.ch) || 0) - (parseFloat(b.ch) || 0));
  detailCache.set(k, { at: Date.now(), data });
  try { sessionStorage.setItem("ninokuu:d:" + k, JSON.stringify(data)); } catch {}
  return data;
}
function cachedDetail(src, id) {
  const k = src + "|" + id;
  if (detailCache.has(k)) return detailCache.get(k).data;
  try { const s = sessionStorage.getItem("ninokuu:d:" + k); if (s) { const d = JSON.parse(s); detailCache.set(k, { at: 0, data: d }); return d; } } catch {}
  return null;
}
async function vDetail(src, id) {
  view.innerHTML = `<div class="bar"><button class="icon-btn glass" data-act="back" aria-label="Kembali">${icon("back", 22)}</button></div>${loading(1, "sk-hero")}<div class="px">${loading(8, "sk-lrow")}</div>`;
  setActs({ back: () => back(), retry: () => vDetail(src, id) });
  let d;
  try { d = await getDetail(src, id); } catch (e) { view.innerHTML = `<div class="bar"><button class="icon-btn glass" data-act="back" aria-label="Kembali">${icon("back", 22)}</button></div>${errBox(e)}`; return; }
  if (parse().name !== "detail") return;
  const m = d.manga, type = typeFromTags(m.tags), latest = d.chapters[d.chapters.length - 1];
  const meta = { source: src, comic_id: id, title: m.title, cover: m.cover };
  S.updateLibMeta(src, id, { type, latest: latest?.ch ?? null });
  const h = S.histItem(src, id);
  const first = d.chapters[0], resumeCh = h?.chapter_id && d.chapters.find((c) => c.id === h.chapter_id);
  let descOpen = false;
  const draw = () => {
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
    // satu baris info ringkas di bawah judul; yang tidak tersedia dari sumber tidak ditampilkan
    const infoLine = [ST && `<span class="inf-st inf-${ST[1]}">${esc(ST[0])}</span>`, views && `<span title="Dilihat di situs sumber">${icon("eye", 14)}${esc(views)}</span>`,
      m.publisher && `<span>${icon("book", 13)}<i>${esc(m.publisher)}</i></span>`, m.author && `<span>${icon("user", 13)}<i>${esc(m.author)}</i></span>`].filter(Boolean).join("");
    view.innerHTML = `
<div class="dbar" id="dbar"><button class="r-round glass" data-act="back" aria-label="Kembali">${icon("back", 21, 2)}</button><span class="dbar-t">${esc(m.title)}</span>
  <button class="r-round glass" data-act="dl" aria-label="Unduh chapter">${icon("down", 20, 2)}</button><button class="pill-btn glass" data-act="report">${icon("bug", 17)}Laporkan</button></div>
<div class="hero has-bar ${heroCol ? "tinted" : ""}" id="hero"${heroCol ? ` style="--hc:${heroCol}"` : ""}><div class="hero-bg" style="background-image:url('${esc(m.cover)}')"></div>
  <div class="hero-in">${cover(m.cover, m.title, "det")}
    <div class="hero-t"><span class="meta"><span class="tag-s">${esc(srcName(src))}</span>${type ? `<span>${esc(typeName(type))}</span>` : ""}</span><h1>${esc(m.title)}</h1>
      ${infoLine ? `<span class="inf-line">${infoLine}</span>` : ""}
      <span class="mu sm">${d.chapters.length} chapter${latest?.at ? " · update " + esc(ago(latest.at)) : ""}</span></div></div></div>
<div class="px">
  <div class="act-row">
    <a class="btn primary grow" href="${resumeCh ? readHref(src, id, resumeCh.id) : first ? readHref(src, id, first.id) : "#"}">${icon("play", 18, 2)}${resumeCh ? "Lanjut Ch. " + esc(resumeCh.ch) : "Mulai baca"}</a>
    <button class="round-btn ${fav ? "on" : ""}" data-act="fav" aria-pressed="${fav}" aria-label="${fav ? "Hapus dari koleksi" : "Tambah ke koleksi"}">${icon(fav ? "heartF" : "heart", 22)}</button>
    <button class="round-btn ${bell ? "on gold" : ""}" data-act="bell" aria-pressed="${bell}" aria-label="${bell ? "Matikan notifikasi" : "Nyalakan notifikasi chapter baru"}">${icon(bell ? "bellF" : "bell", 22)}</button>
    ${likeBtn(lk)}
  </div>
  ${m.tags?.length ? `<div class="tags">${m.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
  ${m.desc ? `<p class="desc ${descOpen ? "open" : ""}" data-act="desc">${esc(m.desc)}</p>` : ""}
  <div class="sec-h mt24"><h2>Chapter</h2><a class="link-red" href="${chaptersHref(src, id)}">Lihat semua (${d.chapters.length})${icon("chev", 16, 2)}</a></div>
  <div class="ch-card">${preview.map((c) => chRow(c)).join("") || `<div class="empty"><b>Belum ada chapter</b></div>`}</div>
  <div class="sec-h mt24"><h2>Komentar${cmN ? ` <span class="mu cm-n">${cmN}</span>` : ""}</h2><a class="link-red" href="${commentsHref(src, id)}">${cmN ? "Lihat semua" : "Tulis komentar"}${icon("chev", 16, 2)}</a></div>
  <div class="cm-card" id="cmprev">${cmList === null ? `<div class="mu sm cm-empty">Memuat komentar…</div>` : cmList.length ? cmList.map(miniMsg).join("") + `<a class="cm-more" href="${commentsHref(src, id)}">${icon("msg", 17)}Buka semua komentar</a>`
    : `<a class="cm-empty" href="${commentsHref(src, id)}">${icon("msg", 20)}<span class="rc-mid g4"><b class="sm">Belum ada komentar</b><span class="mu xs">Jadilah yang pertama berkomentar tentang komik ini.</span></span></a>`}</div>
</div><div style="height:calc(120px + env(safe-area-inset-bottom))"></div>
<div class="rfab-wrap"><a class="rfab glass" href="${resumeCh ? readHref(src, id, resumeCh.id) : first ? readHref(src, id, first.id) : chaptersHref(src, id)}"><span class="rfab-ic">${icon("play", 18, 2)}</span><b class="redt">${resumeCh ? "Lanjut baca" : "Mulai baca"}</b><span class="grow">${resumeCh ? "Chapter " + esc(resumeCh.ch) : first ? "Chapter " + esc(first.ch) : ""}</span><span class="redt">${icon("chev", 20, 2)}</span></a></div>`;
    bindSpoilers($("#cmprev")); watchAvatars($("#cmprev"));
    // latar mengikuti warna cover (dihitung sekali, lalu disimpan)
    if (!heroCol) X.coverColor(m.cover).then((c) => { const el = $("#hero"); if (c && el && parse().name === "detail") { el.style.setProperty("--hc", c); el.classList.add("tinted"); } });
    onBarScroll();
  };
  let cmList = null, cmN = 0, lk = null, lkBusy = false;
  const paintLike = () => { const b = $("[data-act=like]"); if (b) b.outerHTML = likeBtn(lk); };
  S.likeInfo(src, id, "").then((i) => { if (i && parse().name === "detail") { lk = i; paintLike(); } });
  const onBarScroll = () => { const b = $("#dbar"); if (b) b.classList.toggle("solid", window.scrollY > 120); };
  window.addEventListener("scroll", onBarScroll, { passive: true });
  cleanup = () => window.removeEventListener("scroll", onBarScroll);
  const room = roomFor(src, id);
  Promise.all([roomPreview(room, 3), roomCount(room).catch(() => 0), framesReady()]).then(([l, n]) => { cmList = l; cmN = n; if (parse().name === "detail") { const y = window.scrollY; draw(); window.scrollTo(0, y); } })
    .catch(() => { cmList = []; if (parse().name === "detail") { const y = window.scrollY; draw(); window.scrollTo(0, y); } });
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
      try { const on = await S.toggleLib(meta); if (on) S.updateLibMeta(src, id, { type, latest: latest?.ch ?? null }); toast(on ? "Ditambahkan ke koleksi" : "Dihapus dari koleksi"); }
      catch (e) { toast(e.message); }
      draw();
    },
    bell: async () => {
      if (!S.loggedIn()) { toast("Masuk dulu untuk menyalakan notifikasi chapter baru."); return; }
      const on = !S.libItem(src, id)?.notify;
      try {
        await S.setNotify(meta, on); S.updateLibMeta(src, id, { type, latest: latest?.ch ?? null });
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
  <div class="sec-h"><b class="b15">${esc(d.manga.title)}</b><span class="mu sm">${d.chapters.length} chapter tersedia</span></div>
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
  cleanup = () => { io.disconnect(); window.removeEventListener("nk:kb", onKb); (vv || window).removeEventListener("resize", onVV); window.removeEventListener("touchstart", tstart); window.removeEventListener("touchmove", drop); window.removeEventListener("wheel", drop); document.removeEventListener("click", guard, true); document.body.classList.remove("chfoc"); };
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
async function vReader(src, id, chId) {
  const shell = (inner) => `<div class="reader ui" id="rd">${inner}<div class="r-top"><button class="r-round glass" data-act="back" aria-label="Kembali">${icon("back", 22, 2)}</button><div class="r-pill glass"><b class="t1">Memuat…</b></div><span class="r-sp"></span></div></div>`;
  view.innerHTML = shell(`<div class="r-pages">${loading(3, "sk-page")}</div>`);
  // file impor dari HP (src "local") tidak punya halaman info komik, kembali ke Favorit → Unduhan
  const isLocal = src === "local";
  const toComic = () => (isLocal ? backTo("#/fav/dl") : backTo(comicHref(src, id), [chaptersHref(src, id)]));
  setActs({ back: toComic, retry: () => vReader(src, id, chId) });
  let d = isLocal ? DL.offlineDetail(src, id) : cachedDetail(src, id);
  try { if (!d) d = await getDetail(src, id); }
  catch (e) { d = DL.offlineDetail(src, id); if (!d) { $(".r-pages").innerHTML = errBox(e); return; } }   // offline: info dari unduhan
  if (!d) { $(".r-pages").innerHTML = errBox(new Error("File unduhan tidak ditemukan di HP.")); return; }
  const idx = d.chapters.findIndex((c) => c.id === chId);
  const ch = d.chapters[idx] || { id: chId, ch: "?" };
  const prev = d.chapters[idx - 1], next = d.chapters[idx + 1];
  // chapter yang sudah diunduh dibaca dari file di HP (tanpa kuota, bisa offline)
  let p = await DL.localPages(src, id, chId).catch(() => null);
  if (!p) {
    if (isLocal) { $(".r-pages").innerHTML = errBox(new Error("File unduhan tidak ditemukan di HP.")); return; }
    try { p = await api.call("pages", { source: src, chapter_id: chId }); } catch (e) { $(".r-pages").innerHTML = errBox(e); return; }
  }
  if (parse().name !== "reader") return;
  const st = S.state.settings, total = p.images.length;
  let slide = st.readMode === "slide";
  const rtl = st.readDir !== "ltr";
  const imgs = p.images.map((im, i) => `<img class="r-img" data-i="${i + 1}" src="${esc(im.local || im.direct ? im.u : api.pageUrl(im.p))}"${im.direct ? ` data-direct="${esc(im.u)}"` : ""} alt="Halaman ${i + 1}" ${i > 2 ? 'loading="lazy"' : ""} decoding="async" referrerpolicy="no-referrer" draggable="false">`);
  const mainLabel = next ? `Lanjut ke Chapter ${esc(next.ch)}` : "Kembali ke info komik";
  view.innerHTML = `<div class="reader ui ${slide ? "slide" : ""}" id="rd">
  ${slide ? `<div class="r-slides" id="rbox" dir="${rtl ? "rtl" : "ltr"}">${imgs.map((im) => `<div class="r-slide">${im}</div>`).join("")}<div class="r-slide r-endslide"><span class="mu sm">Akhir chapter ${esc(ch.ch)}</span>${isLocal ? "" : `${chLike(null)}<a class="btn ghost" href="${commentsHref(src, id, chId)}">${icon("msg", 18)}Komentar chapter ini</a>`}</div></div>`
    : `<div class="r-scroll" id="rbox"><div class="r-pages" id="rpages">${imgs.join("")}<div class="r-endtxt"><span class="mu sm">Akhir chapter ${esc(ch.ch)}</span>${isLocal ? "" : `${chLike(null)}<a class="btn ghost" href="${commentsHref(src, id, chId)}">${icon("msg", 18)}Komentar chapter ini<span class="cm-n" id="rcmn"></span></a>`}</div></div></div>`}
  <div class="r-zoom glass" id="rzoom" hidden>${icon("zoom", 15)}<span id="rzt"></span> · geser untuk melihat, ketuk 2× untuk normal</div>
  <div class="r-top">
    <button class="r-round glass" data-act="back" aria-label="Kembali">${icon("back", 22, 2)}</button>
    <button class="r-pill glass" data-act="chlist" aria-label="Daftar chapter"><b class="t1">${esc(d.manga.title)}</b><span class="mu xs row g4">Chapter ${esc(ch.ch)}${icon("chev", 12, 2.4)}</span></button>
    ${isLocal ? "" : `<a class="r-round glass" href="${commentsHref(src, id, chId)}" aria-label="Komentar chapter">${icon("msg", 20)}</a>`}
    <button class="r-round glass" data-act="menu" aria-label="Pengaturan mode baca" aria-expanded="false">${icon("dots", 22)}</button>
  </div>
  <div class="r-menu-bg" data-act="closeMenu" hidden></div>
  <div class="r-menu glass" role="dialog" aria-label="Mode baca" hidden>
    <span class="cap">Mode baca</span>
    ${[["scroll", "Scroll (webtoon)", "Gulir ke bawah, halaman tersambung", "scroll"], ["slide", "Slide (halaman)", "Geser per halaman", "slides"]].map(([k, n, dsc, ic]) =>
      `<button class="r-mode ${st.readMode === k ? "on" : ""}" role="radio" aria-checked="${st.readMode === k}" data-act="rmode" data-v="${k}"><span class="${st.readMode === k ? "redt" : "mu"}">${icon(ic, 20)}</span><span class="col grow"><b>${n}</b><span class="mu xs">${dsc}</span></span>${st.readMode === k ? `<span class="redt">${icon("check", 18, 2.4)}</span>` : ""}</button>`).join("")}
    <button class="r-mode" data-act="chlist"><span class="gold">${icon("list", 20)}</span><span class="col grow"><b>Daftar chapter</b><span class="mu xs">${d.chapters.length} chapter · cari & pindah chapter</span></span></button>
    <button class="r-mode" data-act="rreport"><span class="redt">${icon("bug", 20)}</span><span class="col grow"><b>Laporkan masalah chapter</b><span class="mu xs">Gambar rusak, halaman hilang, dll.</span></span></button>
    ${slide ? `<span class="cap mt4">Arah geser</span><div class="seg s3">${[["rtl", "Kanan ke kiri"], ["ltr", "Kiri ke kanan"]].map(([k, n]) => `<button role="tab" aria-selected="${(rtl ? "rtl" : "ltr") === k}" data-act="rdir" data-v="${k}">${n}</button>`).join("")}</div>` : ""}
  </div>
  <div class="r-bottom">
    <div class="r-seek glass"><span class="r-pn"><span id="rpg">1</span> / ${total}</span>
      <div class="r-track" id="rtrack" role="slider" aria-label="Posisi halaman" aria-valuemin="1" aria-valuemax="${total}" aria-valuenow="1" tabindex="0"><span class="r-rail"></span><span class="r-fill" id="rfill"></span><span class="r-knob" id="rknob"></span></div></div>
    <div class="r-btns">
      <button class="r-sq glass" data-act="prev" aria-label="Chapter sebelumnya" ${prev ? "" : "disabled"}>${icon("back", 22, 2.2)}</button>
      <button class="r-main" data-act="main">${next ? icon("play", 16, 2.2) : icon("home", 18, 2)}${mainLabel}</button>
      <button class="r-sq glass" data-act="next" aria-label="${next ? "Chapter berikutnya" : "Kembali ke info komik"}">${next ? icon("chev", 22, 2.2) : icon("home", 21, 2)}</button>
    </div></div></div>`;
  const rd = $("#rd"), box = $("#rbox"), pages = $("#rpages");
  // APK: gambar langsung dari situs; bila ditolak WebView, ambil ulang lewat jaringan HP
  $$(".r-img[data-direct]", rd).forEach((im) => im.addEventListener("error", async () => {
    if (im.dataset.tried) return; im.dataset.tried = "1";
    try { im.src = await N.imageViaNative(im.dataset.direct, p.ref); } catch {}
  }));
  const meta = { source: src, comic_id: id, title: d.manga.title, cover: d.manga.cover, chapter: ch.ch, chapter_id: ch.id, pages: total, type: typeFromTags(d.manga.tags) };
  if (!isLocal) S.saveHistory({ ...meta, page: 1 });
  // EXP baca: hanya setelah chapter dibaca sampai habis (akhir chapter terlihat)
  let awarded = false;
  const finish = () => { if (awarded) return; awarded = true; DL.markRead(src, id, ch.id); if (!isLocal) S.awardRead(src, id, ch.ch); };
  const endEl = $(".r-endtxt, .r-endslide", rd);
  if (endEl && "IntersectionObserver" in window) {
    const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { finish(); io.disconnect(); } }, { root: box, threshold: 0.2 });
    io.observe(endEl);
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
    if (i !== curPage) { curPage = i; $("#rpg").textContent = i; if (!isLocal) S.saveHistory({ ...meta, page: i }); }
  };
  const goPage = (i, smooth = false) => {
    const el = $(`.r-img[data-i="${i}"]`); if (!el) return;
    if (slide) { clearZoom(); const w = box.clientWidth; box.scrollTo({ left: (rtl ? -1 : 1) * (i - 1) * w, behavior: smooth ? "smooth" : "auto" }); }
    else box.scrollTo({ top: el.offsetTop, behavior: smooth ? "smooth" : "auto" });
    setPage(i);
  };
  // posisi halaman saat menggulir
  let zoom = 1, zEl = null, zBase = 0;
  box.addEventListener("scroll", () => {
    if (slide) { setPage(Math.round(Math.abs(box.scrollLeft) / (box.clientWidth || 1)) + 1); return; }
    const y = box.scrollTop + box.clientHeight * 0.4;
    let n = 1; for (const im of $$(".r-img", pages)) { if (im.offsetTop <= y) n = Number(im.dataset.i); else break; }
    setPage(n);
  }, { passive: true });
  // ketuk sekali: tampil/sembunyikan tombol; ketuk dua kali: perbesar 2,5× / kembali normal (mode gulir)
  let lastTap = null, tapT = null;
  const showZoom = () => { const z = $("#rzoom"); z.hidden = zoom <= 1.02; $("#rzt").textContent = Math.round(zoom * 100) + "%"; };
  // Zoom memperbesar LEBAR gambar (bukan CSS zoom) → geser kiri-kanan & gulir tetap mulus untuk
  // manga, manhwa, maupun manhua (strip panjang). Mode gulir: seluruh halaman; mode slide: halaman yang tampil.
  const zTarget = () => (slide ? $$(".r-slide", box)[curPage - 1]?.querySelector(".r-img") : pages);
  function clearZoom() {
    if (zEl) {
      const sc = slide ? zEl.parentElement : box;
      zEl.style.width = zEl.style.maxWidth = zEl.style.maxHeight = zEl.style.height = "";
      if (slide) { sc.classList.remove("zoomed-slide"); sc.scrollLeft = 0; box.classList.remove("zlock"); }
    }
    zoom = 1; zEl = null; rd.classList.remove("zoomed"); showZoom();
  }
  const applyZoom = (z, fx, fy) => {
    z = Math.max(1, Math.min(4, z));
    const el = zTarget(); if (!el) return;
    if (zEl && zEl !== el) clearZoom();
    if (!zEl) { if (z <= 1.01) return; zEl = el; zBase = el.getBoundingClientRect().width; zoom = 1; }
    const sc = slide ? el.parentElement : box;
    const r = sc.getBoundingClientRect(), x = fx - r.left, y = fy - r.top, k = z / zoom, sl = sc.scrollLeft, st = sc.scrollTop;
    zoom = z;
    el.style.width = zBase * zoom + "px"; el.style.maxWidth = "none";
    if (slide) { el.style.maxHeight = "none"; el.style.height = "auto"; sc.classList.add("zoomed-slide"); box.classList.add("zlock"); }
    sc.scrollLeft = (sl + x) * k - x; sc.scrollTop = (st + y) * k - y;
    if (zoom <= 1.01) clearZoom(); else { rd.classList.add("zoomed"); showZoom(); }
  };
  // mode slide: halaman strip panjang (manhwa/manhua) dibuat selebar layar dan bisa digulir ke bawah
  if (slide) $$(".r-slide .r-img", box).forEach((im) => {
    const mark = () => { if (im.naturalHeight > im.naturalWidth * 1.8) im.parentElement.classList.add("tall"); };
    if (im.complete && im.naturalWidth) mark(); else im.addEventListener("load", mark, { once: true });
  });
  box.addEventListener("click", (e) => {
    if (e.target.closest("a,button")) return;
    const now = Date.now();
    if (lastTap && now - lastTap.t < 320 && Math.hypot(lastTap.x - e.clientX, lastTap.y - e.clientY) < 50) {
      clearTimeout(tapT); lastTap = null; applyZoom(zoom > 1.05 ? 1 : 2.5, e.clientX, e.clientY);
    } else {
      lastTap = { t: now, x: e.clientX, y: e.clientY };
      clearTimeout(tapT); tapT = setTimeout(() => { lastTap = null; rd.classList.toggle("ui"); }, 320);
    }
  });
  // cubit untuk memperbesar (mode gulir)
  let pinch = null;
  box.addEventListener("touchstart", (e) => { if (e.touches.length === 2) { const [a, b] = e.touches; pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, z: zoom, x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }; } }, { passive: true });
  box.addEventListener("touchmove", (e) => { if (pinch && e.touches.length === 2) { e.preventDefault(); const [a, b] = e.touches; applyZoom(pinch.z * (Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinch.d), pinch.x, pinch.y); } }, { passive: false });
  box.addEventListener("touchend", () => { pinch = null; });
  // geser slider halaman
  const track = $("#rtrack");
  const seekAt = (clientX) => { const r = track.getBoundingClientRect(); const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width)); goPage(Math.round(f * (total - 1)) + 1); };
  track.addEventListener("pointerdown", (e) => { e.stopPropagation(); track.setPointerCapture(e.pointerId); seekAt(e.clientX); track.onpointermove = (ev) => seekAt(ev.clientX); });
  track.addEventListener("pointerup", () => { track.onpointermove = null; });
  track.addEventListener("keydown", (e) => { if (e.key === "ArrowRight") goPage(curPage + 1); if (e.key === "ArrowLeft") goPage(curPage - 1); });
  const menu = (open) => { $(".r-menu").hidden = !open; $(".r-menu-bg").hidden = !open; $("[data-act=menu]").setAttribute("aria-expanded", String(open)); };
  setActs({
    back: toComic,
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
    prev: () => prev && goReplace(readHref(src, id, prev.id)),
    main: () => (next ? goReplace(readHref(src, id, next.id)) : toComic()),
    next: () => (next ? goReplace(readHref(src, id, next.id)) : toComic()),
  });
  cleanup = () => { clearTimeout(tapT); S.flushHistory(); };
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
    if (!confirm("Hapus foto profil? Avatar kembali memakai huruf awal nama.")) return;
    b.disabled = true;
    try { await setAvatar(null); closeSheet(); toast("Foto profil dihapus"); if (route.name === "more") vMore(); }
    catch (e) { b.disabled = false; toast(e.message, 4500); }
  });
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
let fav = { tab: "lib", q: "", filter: "all" };
// perilaku tab Unduhan dilepas setiap kali Favorit digambar ulang (tidak menumpuk)
let favDlOff = null;
function vFav(tab) {
  if (favDlOff) { favDlOff(); favDlOff = null; }
  if (tab && ["lib", "hist", "dl"].includes(tab)) fav.tab = tab;
  const grid = S.state.settings.favView === "grid";
  const readOf = (m) => S.histItem(m.source, m.comic_id);
  const isNew = (m) => { const r = readOf(m); return m.latest != null && r && parseFloat(m.latest) > parseFloat(r.chapter); };
  const libAll = [...S.state.lib.values()].sort((a, b) => (b.added_at || "").localeCompare(a.added_at || ""));
  const lib = libAll.filter((m) => (!fav.q || m.title.toLowerCase().includes(fav.q.toLowerCase()))
    && (fav.filter === "all" || (fav.filter === "new" ? isNew(m) : m.type === fav.filter)));
  const hist = S.history();
  const srcType = (m) => esc(srcName(m.source)) + (m.type ? " · " + esc(typeName(m.type)) : "");
  let body = "";
  if (fav.tab === "lib") {
    body = `<div class="row g8"><label class="search box grow"><span class="mu">${icon("search", 19)}</span><span class="sr">Cari di koleksi</span><input id="fq" placeholder="Cari di koleksimu" value="${esc(fav.q)}"></label>${viewBtn(grid, "fview", "lg")}</div>
  ${chips([{ id: "all", name: "Semua" }, { id: "new", name: "New update" }, { id: "manga", name: "Manga" }, { id: "manhwa", name: "Manhwa" }, { id: "manhua", name: "Manhua" }], fav.filter, "ff")}
  <div class="mu xs info">${libAll.length ? `${lib.length} dari ${libAll.length} judul · ${S.loggedIn() ? "tersinkron" : "tersimpan di HP ini"}` : ""}</div>
  ${!lib.length ? (libAll.length ? `<div class="empty"><b>Tidak ada yang cocok</b><span>Ubah kata kunci atau filter.</span></div>`
      : `<div class="empty"><span class="empty-ic">${icon("heart", 24)}</span><b>Koleksi masih kosong</b><span>Ketuk ikon hati di halaman komik untuk menyimpannya di sini.</span><a class="btn ghost" href="#/search">Cari komik</a></div>`)
    : grid ? `<div class="g2">${lib.map((m) => { const r = readOf(m); return `<a class="grid-card" href="${comicHref(m.source, m.comic_id)}"><span class="gc-cv">${cover(m.cover, m.title, "tall")}
        <span class="stack">${m.latest != null ? `<span class="st-red">Terbaru ${esc(m.latest)}</span>` : ""}<span class="st-dark">${r ? "Dibaca " + esc(r.chapter) : "Belum dibaca"}</span></span>
        ${isNew(m) ? `<span class="new-up">NEW UPDATE</span>` : ""}${m.notify ? `<span class="bell-b">${icon("bellF", 12)}</span>` : ""}</span>
        <b class="t2 b14">${esc(m.title)}</b><span class="mu xs">${srcType(m)}</span></a>`; }).join("")}</div>`
    : `<div class="rows">${lib.map((m) => { const r = readOf(m); return lrow(comicHref(m.source, m.comic_id), cover(m.cover, m.title, "fav"),
        `<span class="row g8 minw0"><span class="t1 b15">${esc(m.title)}</span>${isNew(m) ? `<span class="new-up s">NEW UPDATE</span>` : ""}${m.notify ? `<span class="gold flex">${icon("bellF", 13)}</span>` : ""}</span>`,
        `<span class="row g6 wrap">${m.latest != null ? `<span class="pill">Terbaru Ch. ${esc(m.latest)}</span>` : ""}<span class="pill dim">${r ? "Dibaca Ch. " + esc(r.chapter) : "Belum dibaca"}</span></span><span class="mu xs block mt4">${srcType(m)}</span>`); }).join("")}</div>`}`;
  } else if (fav.tab === "hist") {
    body = hist.length ? `<div class="sec-h"><span class="mu xs">Terbaru di atas</span><button class="link-red" data-act="clearHist">Bersihkan</button></div>
  <div class="rows">${hist.map((x) => lrow(x.chapter_id ? readHref(x.source, x.comic_id, x.chapter_id) : comicHref(x.source, x.comic_id), cover(x.cover, x.title, "sm"),
      `<span class="t1 b14">${esc(x.title)}</span>`, `Ch. ${esc(x.chapter)} · ${esc(ago(x.read_at))}<span class="prog s"><span style="width:${pct(x.page || 1, x.pages || 0) || 6}%"></span></span>`, `<span class="mu">${icon("play", 18, 2)}</span>`)).join("")}</div>`
      : `<div class="empty"><span class="empty-ic">${icon("clock", 24)}</span><b>Belum ada riwayat</b><span>Chapter yang kamu baca akan muncul di sini.</span></div>`;
  } else {
    body = DL.favTab();
  }
  view.innerHTML = `
<div class="page-h"><h1>Favorit</h1>${seg([{ id: "lib", name: "Koleksi" }, { id: "hist", name: "Riwayat" }, { id: "dl", name: "Unduhan" }], fav.tab, "tab")}</div>
${!S.loggedIn() && fav.tab !== "dl" ? `<div class="note mx">${icon("cloud", 18)}<span>Tersimpan di HP ini saja. <a href="#/more">Masuk</a> agar tersinkron di semua perangkat.</span></div>` : ""}
<div class="px s14">${body}</div><div class="pad-nav"></div>`;
  const fq = $("#fq");
  if (fq) fq.addEventListener("input", () => { fav.q = fq.value; const pos = fq.selectionStart; vFav(); const n = $("#fq"); n.focus(); n.setSelectionRange(pos, pos); });
  setActs({
    tab: (el) => { fav.tab = el.dataset.v; vFav(); },
    ff: (el) => { fav.filter = el.dataset.v; vFav(); },
    fview: () => S.setSetting("favView", grid ? "list" : "grid"),
    clearHist: async () => { if (!confirm("Hapus semua riwayat baca?")) return; try { await S.clearHistory(); toast("Riwayat dibersihkan"); } catch (e) { toast(e.message); } },
  });
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
  if (tpl) return `<span class="av-wrap s${size}">${tpl.replaceAll("%I%", ini + photo).replaceAll("%L%", opt.noMedal ? "" : String(opt.lv ?? lv.lv))}</span>`;
  return `<span class="avatar ${SIZE_CLS[size] || ""} t${tier}"><span>${ini}${photo}</span></span>`;
};
const rankPill = (lv, big = false) => rankBadge(lv, big ? "big" : "");
const badges = (p) => `${p?.verified ? `<span class="verif" title="Terverifikasi">${icon("check", 10, 3.2)}</span>` : ""}${p?.role === "developer" ? `<span class="pill-dev">DEV</span>` : p?.role === "moderator" ? `<span class="pill-mod">MOD</span>` : ""}`;
async function vMore() {
  await loadAvatars();
  const p = S.state.profile, lv = S.levelOf(p), user = api.currentUser(), st = S.state.settings;
  const gfx = st.gfx || "Normal";
  view.innerHTML = `
<div class="page-h"><h1>Lainnya</h1></div>
${!api.configured ? `<div class="note warn mx">${icon("info", 18)}<span>Aplikasi belum tersambung ke server (config.js kosong).</span></div>` : ""}
${user ? `<button class="me mx" data-act="level">${avatarHtml(p, lv)}
    <span class="rc-mid g5"><span class="me-name"><b class="t1">${esc(p?.name || "Memuat…")}</b>${badges(p)}</span>
      <span class="row g8 mu sm">${rankPill(lv)}Lv ${lv.lv}${lv.max ? " · level maksimal" : ` · ${(lv.need - lv.cur).toLocaleString("id-ID")} EXP lagi ke Lv ${lv.lv + 1}`}</span>
      <span class="prog"><span style="width:${lv.max ? 100 : pct(lv.cur, lv.need)}%"></span></span></span><span class="mu">${icon("chev", 18)}</span></button>
  ${group("Akun", mrow("img", "Foto profil", p?.avatar_path ? "Ketuk untuk mengganti · maks 10 MB" : "Belum ada · ketuk untuk menambah (maks 10 MB)", "photo") + mrow("user", "Nama tampilan", esc(p?.name || ""), "goName") + mrow("msg", "Email", esc(user.email || ""), "goEmail") + mrow("key", "Ganti password", "", "goPass") + mrow("out", "Keluar", "", "logout", { danger: true }))}`
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
${["developer", "moderator"].includes(p?.role) ? group("Developer", mrow("dev", "Panel developer", p.role === "developer" ? "Moderasi, pengumuman, statistik" : "Moderasi chat", "dev")) : ""}
${group("Bacaanmu", mrow("star", "Level &amp; Rank", user ? `${lv.rank} · Lv ${lv.lv}${X.cachedStatus() ? ` · 🔥 ${X.cachedStatus().streak} hari` : ""}` : "Masuk untuk mulai naik level", "level") + (user ? mrow("share", "Rekap bacaan", "7 & 30 hari · bagikan sebagai gambar", "recap") : "") + mrow("down", "Unduhan", DL.supported() ? `<span id="dlsub">${DL.savedCount()} file tersimpan${DL.progressLine() ? " · " + esc(DL.progressLine()) : ""}</span>` : "Baca offline di aplikasi APK", "dlrow") + mrow("clock", "Riwayat baca", `${S.history().length} judul`, "goHist") + mrow("down", "Unduhan", N.isApp ? "Segera hadir di pembaruan berikutnya" : "Tersedia di aplikasi APK", "goDl"))}
<section class="sec s20"><h2 class="cap">Tampilan</h2><div class="card col g12"><span class="b145">Mode efek avatar</span>
  ${seg([{ id: "Ringan", name: "Ringan" }, { id: "Normal", name: "Normal" }], gfx, "gfx", "s2")}
  <span class="mu xs lh">${gfx === "Ringan" ? "Partikel dikurangi; komet, aurora, dan awan nebula dimatikan. Hemat baterai, cocok untuk HP spek rendah." : "Bingkai avatar kosmik penuh dengan partikel dan animasi."}</span></div></section>
<section class="sec s20"><h2 class="cap">Pengalaman baca</h2><div class="card col g12"><span class="b145">Mode baca</span>
  ${seg([{ id: "scroll", name: "Scroll (webtoon)" }, { id: "slide", name: "Slide (halaman)" }], st.readMode, "rmode", "s2")}
  ${st.readMode === "slide" ? `<span class="mu sm">Arah geser</span>${seg([{ id: "rtl", name: "Kanan ke kiri" }, { id: "ltr", name: "Kiri ke kanan" }], st.readDir === "ltr" ? "ltr" : "rtl", "dir", "s2")}` : ""}
  <span class="mu xs lh">${st.readMode === "slide" ? "Geser per halaman. Kanan ke kiri cocok untuk manga Jepang." : "Gulir ke bawah, halaman tersambung. Cocok untuk manhwa dan manhua."}</span></div></section>
${N.isApp ? group("Aplikasi", `<span id="updrow"></span>` + mrow("bell", "Notifikasi HP", `<span id="pushst">Memeriksa…</span>`, "pushset") + mrow("info", "Versi aplikasi", `v${esc(VERSION)} · ketuk untuk cek pembaruan`, "checkupd"))
  : group("Aplikasi Android", mrow("down", "Pasang aplikasi Android (APK)", "Baca Shinigami &amp; WestManga, notifikasi chapter baru di HP", "getapk"))}
${group("Data &amp; penyimpanan", mrow("cloud", "Backup data offline", "Simpan koleksi, riwayat, dan pengaturan ke file", "backup") + mrow("restore", "Pulihkan data", "Dari file backup", "restore") + mrow("trash", "Bersihkan cache", "Gambar sampul &amp; halaman yang tersimpan", "cache"))}
${group("Dukungan", mrow("chat", "Lapor bug &amp; saran", "Lewat server Discord Ninokuu", "discord") + mrow("info", "Tentang aplikasi", "Versi " + esc(VERSION), "about") + mrow("shield", "Kebijakan privasi", "", "privacy") + mrow("doc", "Ketentuan pengguna", "", "terms") + mrow("heart", "Dukung di Trakteer", "Traktir pengembang", "trakteer"))}
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
  if (user && !X.cachedStatus()) X.loadStatus().then((ds) => { const el = $("button.mrow[data-act=level] .mu.sm"); if (ds && el && route.name === "more" && !el.textContent.includes("🔥")) el.textContent += ` · 🔥 ${ds.streak} hari`; });
  setActs({
    auth: (el) => { authMode = el.dataset.v; vMore(); },
    level: () => go("#/p/level"), recap: () => go("#/p/recap"), dlrow: () => go("#/fav/dl"), dev: () => go("#/p/dev"), photo: () => openPhoto(), goName: () => go("#/p/name"), goEmail: () => go("#/p/email"), goPass: () => go("#/p/pass"),
    goHist: () => go("#/fav/hist"), goDl: () => go("#/fav/dl"),
    about: () => go("#/p/about"), privacy: () => go("#/p/privacy"), terms: () => go("#/p/terms"),
    backup: () => go("#/p/backup"), restore: () => go("#/p/restore"),
    getapk: () => window.open(N.APK_URL, "_blank"),
    update: () => checkUpdate(true),
    checkupd: () => checkUpdate(true),
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
    discord: () => soon("Server Discord Ninokuu sedang disiapkan."), trakteer: () => soon("Halaman Trakteer sedang disiapkan. Terima kasih!"),
    gfx: (el) => { S.setSetting("gfx", el.dataset.v); applyGfx(); vMore(); },
    rmode: (el) => { S.setSetting("readMode", el.dataset.v); vMore(); },
    dir: (el) => { S.setSetting("readDir", el.dataset.v); vMore(); },
    logout: async () => { if (!confirm("Keluar dari akun? Koleksi dan riwayatmu tetap aman di server.")) return; await S.flushHistory(); await api.signOut(); S.clearUserData(); toast("Kamu sudah keluar"); vMore(); },
    cache: async () => {
      if ("caches" in window) { const keys = await caches.keys(); await Promise.all(keys.filter((k) => k.startsWith("ninokuu-img")).map((k) => caches.delete(k))); }
      try { Object.keys(sessionStorage).filter((k) => k.startsWith("ninokuu:d:")).forEach((k) => sessionStorage.removeItem(k)); } catch {}
      detailCache.clear(); browseCache.clear();
      toast("Cache dibersihkan");
    },
  });
}

/* ---------- khusus APK: notifikasi, tombol kembali, cek chapter sumber yang diblokir server ---------- */
// Keyboard: bila WebView tidak menyusut saat keyboard muncul, angkat elemen bawah (kolom chat, dll.)
// setinggi bagian keyboard yang belum "dimakan" oleh penyusutan layar.
let kbBase = window.innerHeight, kbOpen = false;
window.addEventListener("resize", () => { if (!kbOpen) kbBase = window.innerHeight; });
function setKeyboard(h, phase) {
  const root = document.documentElement;
  if (h > 0) {
    kbOpen = true;
    if (phase !== "did") return;
    const extra = h - Math.max(0, kbBase - window.innerHeight);
    root.style.setProperty("--kb", (extra > 40 ? extra : 0) + "px");
    document.body.classList.add("kb-open");
    const ae = document.activeElement;
    if (ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName) && !ae.closest(".composer, .chbar")) setTimeout(() => ae.scrollIntoView({ block: "center", behavior: "smooth" }), 60);
  } else {
    kbOpen = false;
    root.style.setProperty("--kb", "0px");
    document.body.classList.remove("kb-open");
  }
  window.dispatchEvent(new CustomEvent("nk:kb", { detail: { open: h > 0, phase } }));
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
async function checkUpdate(manual) {
  if (manual) toast("Memeriksa pembaruan…", 1500);
  const r = await N.latestBuild();
  if (!r) { if (manual) toast("Tidak bisa memeriksa pembaruan. Periksa koneksi internet."); return; }
  if (r.newer) {
    let later = ""; try { later = sessionStorage.getItem("ninokuu:updLater") || ""; } catch {}
    if (manual || later !== String(r.version || r.build)) showUpdate(r);
  } else if (manual) toast(`Kamu sudah memakai versi terbaru (v${VERSION}).`);
}

let exitArmed = false, exitT = null;
function startApp() {
  document.body.classList.add("is-app");
  N.onKeyboard(setKeyboard);
  N.onPushReceived(() => refreshDots());
  setTimeout(() => checkUpdate(false), 2500);
  N.onPushOpen((h) => go(h));
  // tombol kembali Android: tutup lapisan yang terbuka dulu, lalu mundur; di Beranda → keluar
  N.onBack((exit) => {
    const ae = document.activeElement;
    if (ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName) && document.body.classList.contains("chfoc")) { ae.blur(); return; }
    const flt = $(".flt-host [data-f=close]"); if (flt) { flt.click(); return; }
    if (sheetEl) { closeSheet(); return; }
    if (document.getElementById("notif")) { closeNotif(); return; }
    const chatSheet = $("#host [data-c=close]"); if (chatSheet) { chatSheet.click(); return; }
    const rmenu = $(".r-menu:not([hidden])"); if (rmenu) { $("[data-act=closeMenu]")?.click(); return; }
    const chs = $(".chs-host [data-x=close]"); if (chs) { chs.click(); return; }
    const ip = $(".img-prev"); if (ip) { ip.click(); return; }
    if (X.closeDaily()) return;
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
    acts2.dl = () => {
      const data = { app: "ninokuu", v: 1, at: new Date().toISOString(), lib: [...S.state.lib.values()], hist: [...S.state.hist.values()], settings: S.state.settings };
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
      a.download = `ninokuu-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast("File backup disimpan ke folder Download");
    };
  } else if (name === "restore") {
    html = topbar("Pulihkan data") + `<div class="px col g14 mt6"><p class="mu sm lh m0">Pilih file backup (.json) dari HP. Data di file digabung dengan data yang sudah ada; judul yang sama tidak terduplikat.</p>
  <label class="btn primary">${icon("restore", 18, 2)}Pilih file backup<input type="file" accept="application/json,.json" id="rf" hidden></label><span class="err" id="perr"></span></div>`;
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
      let added = 0;
      for (const m of j.lib || []) if (m?.source && m?.comic_id && m?.title && !S.inLib(m.source, m.comic_id)) { await S.toggleLib(m).catch(() => {}); added++; }
      for (const h of j.hist || []) if (h?.source && h?.comic_id && !S.histItem(h.source, h.comic_id)) S.saveHistory(h);
      if (j.settings && typeof j.settings === "object") ["readMode", "readDir", "updView", "searchView", "favView", "gfx"].forEach((k) => { if (typeof j.settings[k] === "string") S.setSetting(k, j.settings[k]); });
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
const applyGfx = () => document.body.classList.toggle("nk-lite", S.state.settings.gfx === "Ringan");
applyGfx();
// Posisi miring dicek dari ukuran layar fisik (tidak berubah saat keyboard muncul).
function checkOrientation() {
  const sw = screen.width || 0, sh = screen.height || 0;
  const type = screen.orientation?.type || (Math.abs(window.orientation || 0) === 90 ? "landscape" : sw > sh ? "landscape" : "portrait");
  const phone = Math.min(sw, sh) > 0 && Math.min(sw, sh) < 600;
  document.body.classList.toggle("landscape-phone", phone && type.startsWith("landscape"));
}
checkOrientation();
screen.orientation?.addEventListener?.("change", checkOrientation);
window.addEventListener("orientationchange", () => setTimeout(checkOrientation, 50));

api.onAuth((s) => { if (!s) S.clearUserData(); });
if (S.loggedIn()) { S.loadProfile().catch(() => {}); S.pull().catch(() => {}); }
S.subscribe(() => { if (route.name === "fav" && !document.activeElement?.matches?.("#fq")) vFav(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") S.flushHistory(); });
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
  X.startDaily();
  DL.start();
  // progres unduhan di baris "Unduhan" halaman Lainnya
  window.addEventListener("nk:dl", () => { const el = document.getElementById("dlsub"); if (el) { const pl = DL.progressLine(); el.textContent = `${DL.savedCount()} file tersimpan${pl ? " · " + pl : ""}`; } });
  // bingkai avatar (berkas besar) dimuat di latar belakang agar menu Lainnya langsung tampil
  setTimeout(() => (window.requestIdleCallback || setTimeout)(() => loadAvatars()), 1200);
})();
