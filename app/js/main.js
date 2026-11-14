// Ninokuu PWA · router dan semua layar.
import * as api from "./api.js";
import * as S from "./store.js";
import { QUOTES } from "./assets.js";
import { esc, icon, $, $$, toast, ago, SOURCES, srcName, TYPES, typeName, cover, comicHref, readHref, greeting, errBox, loading } from "./ui.js";

const view = $("#view");
const nav = $("#nav");
let route = { name: "home", params: [] };
let cleanup = null;                    // dipanggil saat pindah layar
const scrollMem = new Map();           // posisi gulir tiap layar, dipulihkan saat kembali
const detailCache = new Map();         // detail komik + daftar chapter yang terakhir dibuka

/* ---------- router ---------- */
function parse() {
  const parts = (location.hash.replace(/^#\/?/, "") || "home").split("/").map(decodeURIComponent);
  const map = { c: "detail", r: "reader" };
  return { name: map[parts[0]] || parts[0], params: parts.slice(1) };
}
const TABS = ["home", "search", "fav", "more"];
async function render() {
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  const prevKey = route.key;
  scrollMem.set(prevKey, window.scrollY);
  route = { ...parse(), key: location.hash || "#/home" };
  const tab = TABS.includes(route.name) ? route.name : route.name === "detail" || route.name === "reader" ? null : "home";
  document.body.dataset.screen = route.name;
  nav.hidden = route.name === "reader";
  $$("#nav a").forEach((a) => a.setAttribute("aria-current", String(a.dataset.tab === tab)));
  const fn = VIEWS[route.name] || VIEWS.home;
  view.classList.remove("in"); void view.offsetWidth; view.classList.add("in");
  await fn(...route.params);
  const y = scrollMem.get(route.key);
  requestAnimationFrame(() => window.scrollTo(0, y || 0));
}
window.addEventListener("hashchange", render);
const go = (h) => { location.hash = h; };

// klik dengan atribut data-act ditangani oleh layar yang aktif
let acts = {};
view.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || !view.contains(el)) return;
  const fn = acts[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
});
const setActs = (a) => { acts = a; };

/* ---------- bagian bersama ---------- */
const header = () => `
<header class="top">
  <img class="logo" src="icons/logo.png" alt="Ninokuu" width="107" height="33">
  <span class="top-r">
    <button class="icon-btn" data-act="soon" aria-label="Chat publik">${icon("msg", 20)}</button>
    <button class="icon-btn" data-act="soon" aria-label="Notifikasi">${icon("bell", 21)}</button>
  </span>
</header>`;
const cardRow = (it, src, sub = "") => `
<a class="row-card" href="${comicHref(src, it.id)}">${cover(it.cover, it.title, "sm")}
  <span class="rc-mid"><b class="t2">${esc(it.title)}</b><span class="mu">${esc(sub || typeName(it.type) || srcName(src))}</span></span>
  <span class="mu">${icon("chev", 18)}</span></a>`;
const cardGrid = (it, src, badge = "") => `
<a class="grid-card" href="${comicHref(src, it.id)}"><span class="gc-cv">${cover(it.cover, it.title)}${badge ? `<span class="badge">${esc(badge)}</span>` : ""}</span>
  <b class="t2">${esc(it.title)}</b><span class="mu sm">${esc(typeName(it.type) || srcName(src))}</span></a>`;
const pills = (list, cur, act) => `<div class="pills" role="tablist">${list.map((x) => `<button role="tab" aria-selected="${x.id === cur}" data-act="${act}" data-v="${esc(x.id)}">${esc(x.name)}</button>`).join("")}</div>`;
const soon = () => toast("Fitur ini hadir di bagian berikutnya.");

/* ---------- Beranda ---------- */
let homeSrc = "komiku";
const homeCache = new Map();
async function browse(src, opt) {
  const k = JSON.stringify([src, opt]);
  const hit = homeCache.get(k);
  if (hit && Date.now() - hit.at < 5 * 60e3) return hit.data;
  const data = await api.call("browse", { source: src, ...opt });
  homeCache.set(k, { at: Date.now(), data });
  return data;
}
async function vHome() {
  const name = S.state.profile?.name || (S.loggedIn() ? "" : "Pembaca");
  let qi = Math.floor(Math.random() * QUOTES.length);
  const last = S.history()[0];
  view.innerHTML = `${header()}
<section class="hello"><h1>${greeting()}${name ? `, <span class="gold">${esc(name)}</span>` : ""}</h1>
  <button class="quote" data-act="quote">“${esc(QUOTES[qi])}”</button></section>
${last ? `<section class="sec"><h2>Lanjut baca</h2>
  <a class="resume" href="${last.chapter_id ? readHref(last.source, last.comic_id, last.chapter_id) : comicHref(last.source, last.comic_id)}">${cover(last.cover, last.title, "md")}
    <span class="rc-mid"><span class="chip">${esc(srcName(last.source))}</span><b class="t2">${esc(last.title)}</b><span class="mu">Chapter ${esc(last.chapter)}${last.page > 1 ? " · halaman " + last.page : ""}</span></span>
    <span class="play">${icon("play", 19, 2)}</span></a></section>` : ""}
<section class="sec"><div class="sec-h"><h2>Populer</h2><span class="mu sm">${esc(srcName(homeSrc))}</span></div><div class="hs" id="pop">${loading(4, "sk-cv")}</div></section>
<section class="sec"><h2>Jelajah kategori</h2><div class="cats">
  ${["manga", "manhwa", "manhua"].map((t) => `<a class="cat" href="#/search/${t}"><span class="flag f-${t}"></span><b>${typeName(t)}</b><span class="mu sm">${{ manga: "Jepang", manhwa: "Korea", manhua: "Tiongkok" }[t]}</span></a>`).join("")}
</div></section>
<section class="sec"><div class="sec-h"><h2>Update terbaru</h2>
  <button class="icon-btn sm" data-act="updView" aria-label="Ganti tampilan">${icon(S.state.settings.updView === "grid" ? "list" : "grid", 18, 2)}</button></div>
  ${pills(SOURCES, homeSrc, "src")}
  <div id="upd">${loading(6)}</div>
  <button class="btn ghost wide" data-act="more" id="updMore" hidden>Muat lagi</button></section>
<div class="pad-nav"></div>`;
  let page = 1, items = [];
  const drawUpd = () => {
    const grid = S.state.settings.updView === "grid";
    $("#upd").innerHTML = items.length ? (grid ? `<div class="g3">${items.map((it) => cardGrid(it, homeSrc)).join("")}</div>` : `<div class="list">${items.map((it) => cardRow(it, homeSrc)).join("")}</div>`)
      : `<div class="empty"><b>Belum ada komik</b></div>`;
  };
  const loadUpd = async (more = false) => {
    const src = homeSrc;
    try {
      const r = await browse(src, { sort: "update", page, limit: 20 });
      if (src !== homeSrc) return;
      items = more ? items.concat(r.items) : r.items;
      drawUpd();
      $("#updMore").hidden = !r.hasNext;
    } catch (e) { if (src === homeSrc) $("#upd").innerHTML = errBox(e); }
  };
  const loadPop = async () => {
    const src = homeSrc;
    try {
      const r = await browse(src, { sort: "popular", page: 1, limit: 10 });
      if (src !== homeSrc) return;
      $("#pop").innerHTML = r.items.slice(0, 10).map((it, i) => `<a class="pop" href="${comicHref(src, it.id)}"><span class="pop-cv">${cover(it.cover, it.title)}<span class="rank">${i + 1}</span></span><b class="t2 sm">${esc(it.title)}</b></a>`).join("") || `<span class="mu">Kosong</span>`;
    } catch (e) { if (src === homeSrc) $("#pop").innerHTML = `<span class="mu sm">${esc(e.message)}</span>`; }
  };
  setActs({
    quote: (el) => { qi = (qi + 1) % QUOTES.length; el.textContent = `“${QUOTES[qi]}”`; },
    soon,
    src: (el) => { homeSrc = el.dataset.v; vHome(); },
    updView: () => { S.setSetting("updView", S.state.settings.updView === "grid" ? "list" : "grid"); drawUpd(); $("[data-act=updView]").innerHTML = icon(S.state.settings.updView === "grid" ? "list" : "grid", 18, 2); },
    more: () => { page++; loadUpd(true); },
    retry: () => vHome(),
  });
  loadPop(); loadUpd();
}

/* ---------- Pencarian ---------- */
let sState = { q: "", src: "komiku", type: "" };
async function vSearch(type) {
  if (type !== undefined) sState.type = TYPES.some((t) => t.id === type) ? type : "";
  view.innerHTML = `
<div class="page-h"><h1>Pencarian</h1></div>
<form class="search" id="sform" role="search"><span class="mu">${icon("search", 20)}</span>
  <input id="sq" type="search" enterkeyhint="search" autocomplete="off" placeholder="Judul komik…" value="${esc(sState.q)}" aria-label="Cari judul"></form>
<div class="sec tight">${pills(SOURCES, sState.src, "src")}${pills(TYPES, sState.type, "type")}</div>
<div class="sec-h pad"><span class="mu sm" id="sinfo"></span><button class="icon-btn sm" data-act="view" aria-label="Ganti tampilan">${icon(S.state.settings.searchView === "grid" ? "list" : "grid", 18, 2)}</button></div>
<div id="sres" class="pad">${loading(6)}</div>
<button class="btn ghost wide" data-act="more" id="sMore" hidden>Muat lagi</button>
<div class="pad-nav"></div>`;
  let page = 1, items = [], seq = 0;
  const draw = () => {
    const grid = S.state.settings.searchView === "grid";
    $("#sres").innerHTML = items.length ? (grid ? `<div class="g3">${items.map((it) => cardGrid(it, sState.src)).join("")}</div>` : `<div class="list">${items.map((it) => cardRow(it, sState.src)).join("")}</div>`)
      : `<div class="empty"><span class="empty-ic">${icon("search", 24)}</span><b>Tidak ditemukan</b><span>Coba kata lain atau sumber lain.</span></div>`;
  };
  const load = async (more = false) => {
    const my = ++seq;
    if (!more) { page = 1; $("#sres").innerHTML = loading(6); }
    $("#sinfo").textContent = sState.q ? `Hasil untuk “${sState.q}” di ${srcName(sState.src)}` : `Terbaru di ${srcName(sState.src)}`;
    try {
      const r = await api.call("browse", { source: sState.src, q: sState.q, type: sState.type, sort: "update", page, limit: 24 });
      if (my !== seq) return;
      items = more ? items.concat(r.items) : r.items;
      draw();
      $("#sMore").hidden = !r.hasNext;
    } catch (e) { if (my === seq) $("#sres").innerHTML = errBox(e); }
  };
  $("#sform").addEventListener("submit", (e) => { e.preventDefault(); sState.q = $("#sq").value.trim(); $("#sq").blur(); load(); });
  setActs({
    src: (el) => { sState.src = el.dataset.v; $$("[data-act=src]").forEach((b) => b.setAttribute("aria-selected", String(b === el))); load(); },
    type: (el) => { sState.type = el.dataset.v; $$("[data-act=type]").forEach((b) => b.setAttribute("aria-selected", String(b === el))); load(); },
    view: (el) => { S.setSetting("searchView", S.state.settings.searchView === "grid" ? "list" : "grid"); el.innerHTML = icon(S.state.settings.searchView === "grid" ? "list" : "grid", 18, 2); draw(); },
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
  // urut naik untuk navigasi chapter sebelumnya/berikutnya
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
  view.innerHTML = `<div class="bar"><button class="icon-btn" data-act="back" aria-label="Kembali">${icon("back", 22)}</button></div>${loading(1, "sk-hero")}${loading(8)}`;
  setActs({ back: () => history.length > 1 ? history.back() : go("#/home"), retry: () => vDetail(src, id) });
  let d;
  try { d = await getDetail(src, id); } catch (e) { view.innerHTML = `<div class="bar"><button class="icon-btn" data-act="back" aria-label="Kembali">${icon("back", 22)}</button></div>${errBox(e)}`; return; }
  if (parse().name !== "detail") return;
  const m = d.manga, meta = { source: src, comic_id: id, title: m.title, cover: m.cover };
  const h = S.histItem(src, id);
  const first = d.chapters[0], resumeCh = h?.chapter_id && d.chapters.find((c) => c.id === h.chapter_id);
  let desc = false, q = "", desc2 = true;
  const draw = () => {
    const fav = S.inLib(src, id), bell = !!S.libItem(src, id)?.notify;
    const list = d.chapters.slice().reverse().filter((c) => !q || String(c.ch ?? "").includes(q) || (c.title || "").toLowerCase().includes(q.toLowerCase()));
    view.innerHTML = `
<div class="hero"><div class="hero-bg" style="background-image:url('${esc(m.cover)}')"></div>
  <div class="bar"><button class="icon-btn glass" data-act="back" aria-label="Kembali">${icon("back", 22)}</button></div>
  <div class="hero-in">${cover(m.cover, m.title, "lg")}
    <div class="hero-t"><span class="chip">${esc(srcName(src))}</span><h1>${esc(m.title)}</h1>
      <span class="mu sm">${[m.status === "ongoing" ? "Berlangsung" : m.status === "completed" ? "Tamat" : m.status === "hiatus" ? "Hiatus" : "", m.author].filter(Boolean).map(esc).join(" · ")}</span></div></div></div>
<div class="pad">
  <div class="act-row">
    <a class="btn primary grow" href="${resumeCh ? readHref(src, id, resumeCh.id) : first ? readHref(src, id, first.id) : "#"}">${icon("play", 18, 2)}${resumeCh ? "Lanjut Ch. " + esc(resumeCh.ch) : "Mulai baca"}</a>
    <button class="icon-btn box ${fav ? "on" : ""}" data-act="fav" aria-pressed="${fav}" aria-label="${fav ? "Hapus dari koleksi" : "Tambah ke koleksi"}">${icon(fav ? "heartF" : "heart", 22)}</button>
    <button class="icon-btn box ${bell ? "on" : ""}" data-act="bell" aria-pressed="${bell}" aria-label="${bell ? "Matikan notifikasi" : "Nyalakan notifikasi chapter baru"}">${icon(bell ? "bellF" : "bell", 22)}</button>
  </div>
  ${m.tags?.length ? `<div class="tags">${m.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
  ${m.desc ? `<p class="desc ${desc ? "open" : ""}" data-act="desc">${esc(m.desc)}</p>` : ""}
  <div class="sec-h"><h2>${d.chapters.length} chapter</h2></div>
  <label class="search sm"><span class="mu">${icon("search", 18)}</span><input id="chq" inputmode="decimal" placeholder="Cari nomor chapter…" value="${esc(q)}" aria-label="Cari chapter"></label>
  <div class="chlist">${list.map((c) => {
    const read = h?.chapter_id === c.id;
    return `<a class="ch ${read ? "cur" : ""}" href="${readHref(src, id, c.id)}"><span><b>Chapter ${esc(c.ch ?? "?")}</b>${c.title ? `<span class="mu sm"> · ${esc(c.title)}</span>` : ""}</span><span class="mu sm">${read ? "Terakhir dibaca" : esc(ago(c.at))}</span></a>`;
  }).join("") || `<div class="empty"><b>Chapter tidak ditemukan</b></div>`}</div>
</div><div class="pad-nav"></div>`;
    const inp = $("#chq");
    inp.addEventListener("input", () => { q = inp.value.trim(); const pos = inp.selectionStart; draw(); const n = $("#chq"); n.focus(); n.setSelectionRange(pos, pos); });
  };
  setActs({
    back: () => history.length > 1 ? history.back() : go("#/home"),
    retry: () => vDetail(src, id),
    desc: () => { desc = !desc; $(".desc")?.classList.toggle("open", desc); },
    fav: async () => {
      try { const on = await S.toggleLib(meta); toast(on ? "Ditambahkan ke koleksi" : "Dihapus dari koleksi"); }
      catch (e) { toast(e.message); }
      draw();
    },
    bell: async () => {
      if (!S.loggedIn()) { toast("Masuk dulu untuk menyalakan notifikasi chapter baru."); return; }
      const on = !S.libItem(src, id)?.notify;
      try { await S.setNotify(meta, on); toast(on ? "Notifikasi chapter baru menyala" : "Notifikasi dimatikan"); }
      catch (e) { toast(e.message); }
      draw();
    },
  });
  draw();
}

/* ---------- Pembaca ---------- */
async function vReader(src, id, chId) {
  view.innerHTML = `<div class="reader"><div class="r-top"><button class="icon-btn" data-act="back" aria-label="Kembali">${icon("back", 22)}</button><span class="r-title mu">Memuat…</span></div><div class="r-pages">${loading(3, "sk-page")}</div></div>`;
  setActs({ back: () => go(comicHref(src, id)), retry: () => vReader(src, id, chId) });
  let d = cachedDetail(src, id);
  try { if (!d) d = await getDetail(src, id); } catch (e) { $(".r-pages").innerHTML = errBox(e); return; }
  const idx = d.chapters.findIndex((c) => c.id === chId);
  const ch = d.chapters[idx] || { id: chId, ch: "?" };
  const prev = d.chapters[idx - 1], next = d.chapters[idx + 1];
  let p;
  try { p = await api.call("pages", { source: src, chapter_id: chId }); } catch (e) { $(".r-pages").innerHTML = errBox(e); return; }
  if (parse().name !== "reader") return;
  const total = p.images.length;
  view.innerHTML = `<div class="reader ui" id="rd">
  <div class="r-top glass"><button class="icon-btn" data-act="back" aria-label="Kembali">${icon("back", 22)}</button>
    <span class="r-title"><b class="t1">${esc(d.manga.title)}</b><span class="mu sm">Chapter ${esc(ch.ch)} · <span id="rpg">1</span>/${total}</span></span></div>
  <div class="r-pages" id="rpages">${p.images.map((im, i) => `<img class="r-img" data-i="${i + 1}" src="${esc(api.pageUrl(im.p))}" alt="Halaman ${i + 1}" ${i > 2 ? 'loading="lazy"' : ""} decoding="async" referrerpolicy="no-referrer">`).join("")}</div>
  <div class="r-end">${next ? `<a class="btn primary" href="${readHref(src, id, next.id)}">Chapter berikutnya · ${esc(next.ch)}</a>` : `<span class="mu">Ini chapter terbaru.</span>`}</div>
  <div class="r-bot glass">
    <a class="icon-btn ${prev ? "" : "dis"}" ${prev ? `href="${readHref(src, id, prev.id)}"` : 'aria-disabled="true"'} aria-label="Chapter sebelumnya">${icon("back", 22)}</a>
    <a class="btn ghost sm" href="${comicHref(src, id)}">${icon("list", 16, 2)}Daftar chapter</a>
    <a class="icon-btn ${next ? "" : "dis"}" ${next ? `href="${readHref(src, id, next.id)}"` : 'aria-disabled="true"'} aria-label="Chapter berikutnya">${icon("chev", 22)}</a>
  </div></div>`;
  const rd = $("#rd");
  rd.addEventListener("click", (e) => { if (!e.target.closest("a,button")) rd.classList.toggle("ui"); });
  const meta = { source: src, comic_id: id, title: d.manga.title, cover: d.manga.cover, chapter: ch.ch, chapter_id: ch.id };
  S.saveHistory({ ...meta, page: 1 });
  S.awardRead(src, id, ch.ch);
  // halaman yang sedang terlihat → riwayat & penanda halaman
  let curPage = 1;
  const io = new IntersectionObserver((ents) => {
    for (const en of ents) if (en.isIntersecting) {
      const i = Number(en.target.dataset.i);
      if (i !== curPage) { curPage = i; $("#rpg").textContent = i; S.saveHistory({ ...meta, page: i }); }
    }
  }, { rootMargin: "-45% 0px -45% 0px" });
  $$(".r-img").forEach((im) => io.observe(im));
  cleanup = () => { io.disconnect(); S.flushHistory(); };
  setActs({ back: () => go(comicHref(src, id)), retry: () => vReader(src, id, chId) });
  // sambung ke posisi terakhir bila membuka chapter yang sama
  const h = S.histItem(src, id);
  if (h?.chapter_id === chId && h.page > 1) {
    const target = $(`.r-img[data-i="${h.page}"]`);
    if (target) setTimeout(() => target.scrollIntoView({ block: "start" }), 300);
  }
}

/* ---------- Favorit ---------- */
let favTab = "lib";
function vFav() {
  const lib = [...S.state.lib.values()].sort((a, b) => (b.added_at || "").localeCompare(a.added_at || ""));
  const hist = S.history();
  view.innerHTML = `
<div class="page-h"><h1>Favorit</h1></div>
<div class="pad">${pills([{ id: "lib", name: `Koleksi · ${lib.length}` }, { id: "hist", name: `Riwayat · ${hist.length}` }], favTab, "tab")}</div>
${!S.loggedIn() ? `<div class="note pad-x">${icon("cloud", 18)}<span>Koleksi dan riwayat tersimpan di HP ini. <a href="#/more">Masuk</a> agar tersinkron di semua perangkat.</span></div>` : ""}
<div class="pad">${favTab === "lib"
  ? (lib.length ? `<div class="g3">${lib.map((m) => `<a class="grid-card" href="${comicHref(m.source, m.comic_id)}"><span class="gc-cv">${cover(m.cover, m.title)}${m.notify ? `<span class="badge bell">${icon("bellF", 12)}</span>` : ""}</span><b class="t2">${esc(m.title)}</b><span class="mu sm">${esc(srcName(m.source))}</span></a>`).join("")}</div>`
    : `<div class="empty"><span class="empty-ic">${icon("heart", 24)}</span><b>Koleksi masih kosong</b><span>Ketuk ikon hati di halaman komik untuk menyimpannya di sini.</span><a class="btn ghost" href="#/search">Cari komik</a></div>`)
  : (hist.length ? `<div class="list">${hist.map((h) => `<a class="row-card" href="${h.chapter_id ? readHref(h.source, h.comic_id, h.chapter_id) : comicHref(h.source, h.comic_id)}">${cover(h.cover, h.title, "sm")}<span class="rc-mid"><b class="t2">${esc(h.title)}</b><span class="mu sm">Chapter ${esc(h.chapter)} · ${esc(ago(h.read_at))}</span></span><span class="mu">${icon("play", 18)}</span></a>`).join("")}</div>`
    : `<div class="empty"><span class="empty-ic">${icon("clock", 24)}</span><b>Belum ada riwayat</b><span>Chapter yang kamu baca akan muncul di sini.</span></div>`)}
</div><div class="pad-nav"></div>`;
  setActs({ tab: (el) => { favTab = el.dataset.v; vFav(); } });
}

/* ---------- Lainnya ---------- */
let authMode = "in";
function vMore() {
  const p = S.state.profile, lv = S.levelOf(p), user = api.currentUser();
  const row = (ic, label, sub, act, danger = false) => act === "none" ? `<div class="mrow"><span class="mrow-ic">${icon(ic, 19)}</span><span class="rc-mid"><b>${label}</b>${sub ? `<span class="mu sm">${sub}</span>` : ""}</span></div>` : `<button class="mrow ${danger ? "danger" : ""}" data-act="${act}"><span class="mrow-ic">${icon(ic, 19)}</span><span class="rc-mid"><b>${label}</b>${sub ? `<span class="mu sm">${sub}</span>` : ""}</span>${danger ? "" : `<span class="mu">${icon("chev", 18)}</span>`}</button>`;
  const group = (t, inner) => `<section class="sec"><h2 class="cap">${t}</h2><div class="group">${inner}</div></section>`;
  view.innerHTML = `
<div class="page-h"><h1>Lainnya</h1></div>
${!api.configured ? `<div class="note warn pad-x">${icon("info", 18)}<span>Aplikasi belum tersambung ke server (config.js kosong). Login dan sinkron tidak tersedia.</span></div>` : ""}
${user ? `<div class="me pad-x"><span class="avatar t${lv.tier}">${esc((p?.name || "?")[0].toUpperCase())}</span>
    <span class="rc-mid"><span class="me-name"><b>${esc(p?.name || "Memuat…")}</b>${p?.verified ? `<span class="verif" title="Terverifikasi">${icon("check", 10, 3.2)}</span>` : ""}${p?.role === "developer" ? `<span class="pill-dev">DEV</span>` : p?.role === "moderator" ? `<span class="pill-mod">MOD</span>` : ""}</span>
      <span class="mu sm">${lv.rank} · Lv ${lv.lv}${lv.max ? " · maksimal" : ` · ${lv.need - lv.cur} EXP lagi`}</span>
      <span class="bar-exp"><span style="width:${lv.max ? 100 : Math.round(lv.cur / lv.need * 100)}%"></span></span></span></div>
  ${group("Akun", row("user", "Nama tampilan", esc(p?.name || ""), "name") + row("msg", "Email", esc(user.email || ""), "none") + row("out", "Keluar", "", "logout", true))}`
  : `<div class="auth pad-x"><b class="auth-t">${authMode === "up" ? "Daftar akun Ninokuu" : authMode === "reset" ? "Lupa password" : "Masuk ke Ninokuu"}</b>
    <span class="mu sm">${authMode === "reset" ? "Kami kirim link untuk membuat password baru." : "Masuk agar koleksi, riwayat, dan level tersimpan di akun. Untuk berkomentar dan mendapatkan Level &amp; Rank, kamu harus masuk."}</span>
    <form id="auth" class="auth-f">
      ${authMode === "up" ? `<label>Nama<input name="name" required maxlength="24" autocomplete="nickname" placeholder="Nama panggilan"></label>` : ""}
      <label>Email<input name="email" type="email" required autocomplete="email" placeholder="nama@email.com"></label>
      ${authMode !== "reset" ? `<label>Password<input name="pw" type="password" required minlength="8" autocomplete="${authMode === "up" ? "new-password" : "current-password"}" placeholder="Minimal 8 karakter"></label>` : ""}
      <span class="err" id="aerr" role="alert"></span>
      <button class="btn primary" type="submit" ${api.configured ? "" : "disabled"}>${authMode === "up" ? "Daftar" : authMode === "reset" ? "Kirim link" : "Masuk"}</button>
    </form>
    <span class="auth-links">${authMode === "in" ? `<button class="link" data-act="mode" data-v="up">Belum punya akun? Daftar</button><button class="link" data-act="mode" data-v="reset">Lupa password?</button>` : `<button class="link" data-act="mode" data-v="in">Sudah punya akun? Masuk</button>`}</span></div>`}
${group("Pengalaman baca", row("scroll", "Mode baca", "Gulir ke bawah (mode slide hadir berikutnya)", "soon"))}
${group("Data", row("trash", "Bersihkan cache gambar", "Mengosongkan gambar sampul & halaman yang tersimpan", "cache"))}
${group("Dukungan", row("info", "Tentang aplikasi", "Ninokuu versi " + esc(window.NINOKUU_CONFIG?.VERSION || "1.0.0"), "about"))}
<p class="mu sm center">Ninokuu · baca manga, manhwa, manhua</p><div class="pad-nav"></div>`;
  const form = $("#auth");
  if (form) form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(form), btn = form.querySelector("button[type=submit]"), err = $("#aerr");
    err.textContent = ""; btn.disabled = true;
    try {
      if (authMode === "reset") { await api.recover(f.get("email")); toast("Link reset dikirim. Cek email (dan folder spam)."); authMode = "in"; vMore(); return; }
      if (authMode === "up") {
        const r = await api.signUp(f.get("email"), f.get("pw"), f.get("name"));
        if (r.confirm) { toast("Cek email untuk konfirmasi akun, lalu masuk.", 4500); authMode = "in"; vMore(); return; }
      } else await api.signIn(f.get("email"), f.get("pw"));
      await S.syncAfterLogin().catch(() => {});
      toast("Berhasil masuk"); vMore();
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  });
  setActs({
    mode: (el) => { authMode = el.dataset.v; vMore(); },
    soon, none: () => {},
    logout: async () => { if (!confirm("Keluar dari akun? Koleksi tetap aman di server.")) return; await S.flushHistory(); await api.signOut(); S.clearUserData(); toast("Kamu sudah keluar"); vMore(); },
    name: async () => {
      const n = prompt("Nama tampilan (maks 24 karakter)", p?.name || "");
      if (n == null) return;
      const v = n.trim().slice(0, 24);
      if (!v) return;
      try { await S.setName(v); toast("Nama disimpan"); vMore(); } catch (e) { toast(e.message); }
    },
    cache: async () => {
      if (!("caches" in window)) return;
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("ninokuu-img")).map((k) => caches.delete(k)));
      toast("Cache gambar dibersihkan");
    },
    about: () => toast("Ninokuu " + (window.NINOKUU_CONFIG?.VERSION || "1.0.0") + " · data dari Komiku, Kiryuu, Shinigami, WestManga"),
  });
}

const VIEWS = { home: vHome, search: vSearch, fav: vFav, more: vMore, detail: vDetail, reader: vReader };

/* ---------- mulai ---------- */
api.onAuth((s) => { if (!s) S.clearUserData(); });
if (S.loggedIn()) { S.loadProfile().catch(() => {}); S.pull().catch(() => {}); }
S.subscribe(() => { if (route.name === "fav") vFav(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") S.flushHistory(); });
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
(async () => {
  try {
    const type = await api.sessionFromUrl();
    if (type) {
      await S.syncAfterLogin().catch(() => {});
      if (type === "recovery") {
        render();
        const pw = prompt("Buat password baru (minimal 8 karakter)");
        if (pw && pw.length >= 8) { await api.updateUser({ password: pw }); toast("Password baru disimpan"); }
        else toast("Password tidak diubah. Kamu tetap masuk; ganti lewat Lupa password bila perlu.", 4500);
        return;
      }
      toast(type === "signup" ? "Email terkonfirmasi. Selamat datang!" : "Berhasil masuk", 3500);
    }
  } catch (e) { toast(e.message, 4500); }
  render();
})();
