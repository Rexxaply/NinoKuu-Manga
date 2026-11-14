// Ninokuu PWA · router dan semua layar (mengikuti prototipe desain di canvas).
import * as api from "./api.js";
import * as S from "./store.js";
import { QUOTES } from "./assets.js";
import { DOCS } from "./docs.js";
import { esc, icon, $, $$, toast, ago, SOURCES, srcName, TYPES, typeName, cover, comicHref, readHref, greeting, errBox, loading } from "./ui.js";

const VERSION = window.NINOKUU_CONFIG?.VERSION || "1.0.0";
const view = $("#view");
const nav = $("#nav");
let route = { name: "home", params: [], key: "" };
let cleanup = null;
const scrollMem = new Map();
const detailCache = new Map();

/* ---------- router ---------- */
function parse() {
  const parts = (location.hash.replace(/^#\/?/, "") || "home").split("/").map(decodeURIComponent);
  const map = { c: "detail", r: "reader", p: "page" };
  return { name: map[parts[0]] || parts[0], params: parts.slice(1) };
}
const TABS = ["home", "search", "fav", "more"];
async function render() {
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  scrollMem.set(route.key, window.scrollY);
  route = { ...parse(), key: location.hash || "#/home" };
  const owner = { detail: null, reader: null, page: "more" }[route.name];
  const tab = TABS.includes(route.name) ? route.name : owner;
  document.body.dataset.screen = route.name;
  nav.hidden = route.name === "reader";
  $$("#nav a").forEach((a) => a.setAttribute("aria-current", String(a.dataset.tab === tab)));
  view.classList.remove("in"); void view.offsetWidth; view.classList.add("in");
  await (VIEWS[route.name] || VIEWS.home)(...route.params);
  const y = scrollMem.get(route.key);
  requestAnimationFrame(() => window.scrollTo(0, y || 0));
}
window.addEventListener("hashchange", render);
const go = (h) => { location.hash = h; };
const back = (fallback = "#/home") => (history.length > 1 ? history.back() : go(fallback));

let acts = {};
view.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || !view.contains(el)) return;
  const fn = acts[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
});
const setActs = (a) => { acts = a; };
const soon = (msg) => toast(typeof msg === "string" ? msg : "Fitur ini hadir di bagian berikutnya.");

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
  <span class="top-r"><button class="gl-btn" data-act="soon" aria-label="Chat publik">${icon("msg", 20)}</button><button class="gl-btn" data-act="soon" aria-label="Notifikasi">${icon("bell", 21)}</button></span></header>
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
    soon: () => soon("Chat publik dan notifikasi hadir di bagian berikutnya."),
    src: (el) => { homeSrc = el.dataset.v; const y = window.scrollY; vHome().then(() => window.scrollTo(0, y)); },
    updView: (el) => { S.setSetting("updView", S.state.settings.updView === "grid" ? "list" : "grid"); el.outerHTML = viewBtn(S.state.settings.updView === "grid", "updView"); drawUpd(); },
    more: () => { page++; loadUpd(true); },
    retry: () => vHome(),
  });
  loadPop(); loadUpd();
}

/* ---------- Pencarian (hasil muncul sambil mengetik) ---------- */
let sState = { q: "", src: "komiku", type: "" };
async function vSearch(type) {
  if (type !== undefined) sState.type = TYPES.some((t) => t.id === type) ? type : "";
  view.innerHTML = `
<div class="page-h"><h1>Pencarian</h1></div>
<div class="px"><label class="search"><span class="mu">${icon("search", 20)}</span><span class="sr">Cari judul</span>
  <input id="sq" type="search" enterkeyhint="search" autocomplete="off" placeholder="Cari judul manga, manhwa, manhua…" value="${esc(sState.q)}">
  <button type="button" class="clr" data-act="clear" aria-label="Hapus pencarian" ${sState.q ? "" : "hidden"}>${icon("x", 16, 2.2)}</button></label></div>
<div class="sec s14">${seg(SOURCES, sState.src, "src")}</div>
<div class="px mt10">${chips(TYPES, sState.type, "type")}</div>
<div class="sec-h px mt10"><span class="mu sm" id="sinfo"></span>${viewBtn(S.state.settings.searchView === "grid", "view")}</div>
<div id="sres" class="px">${loading(6, "sk-lrow")}</div>
<button class="btn ghost wide" data-act="more" id="sMore" hidden>Muat lagi</button>
<div class="pad-nav"></div>`;
  let page = 1, items = [], seq = 0, timer = null;
  const draw = () => {
    const grid = S.state.settings.searchView === "grid";
    $("#sres").innerHTML = items.length ? (grid ? `<div class="g3 mt8">${items.map((it) => gcard(comicHref(sState.src, it.id), it, sState.src)).join("")}</div>`
      : `<div class="rows">${items.map((it) => lrow(comicHref(sState.src, it.id), cover(it.cover, it.title, "sm"), esc(it.title), esc(typeName(it.type) || "Komik") + " · " + esc(srcName(sState.src)), `<span class="mu">${icon("chev", 18)}</span>`)).join("")}</div>`)
      : `<div class="empty"><span class="empty-ic">${icon("search", 24)}</span><b>Tidak ditemukan</b><span>Coba kata lain, atau pilih sumber lain di atas.</span></div>`;
  };
  const load = async (more = false) => {
    const my = ++seq;
    if (!more) { page = 1; $("#sres").innerHTML = loading(6, "sk-lrow"); $("#sMore").hidden = true; }
    $("#sinfo").textContent = sState.q ? `Hasil “${sState.q}” di ${srcName(sState.src)}` : `Terbaru di ${srcName(sState.src)}${sState.type ? " · " + typeName(sState.type) : ""}`;
    try {
      const r = await api.call("browse", { source: sState.src, q: sState.q, type: sState.type, sort: "update", page, limit: 24 });
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
    src: (el) => { sState.src = el.dataset.v; pick("src", el); load(); },
    type: (el) => { sState.type = el.dataset.v; pick("type", el); load(); },
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
  let descOpen = false, q = "", asc = false;
  const draw = () => {
    const fav = S.inLib(src, id), bell = !!S.libItem(src, id)?.notify;
    const base = asc ? d.chapters : d.chapters.slice().reverse();
    const list = base.filter((c) => !q || String(c.ch ?? "").startsWith(q) || (c.title || "").toLowerCase().includes(q.toLowerCase()));
    const status = { ongoing: "Berlangsung", completed: "Tamat", hiatus: "Hiatus" }[m.status] || "";
    view.innerHTML = `
<div class="hero"><div class="hero-bg" style="background-image:url('${esc(m.cover)}')"></div>
  <div class="bar"><button class="icon-btn glass" data-act="back" aria-label="Kembali">${icon("back", 22)}</button></div>
  <div class="hero-in">${cover(m.cover, m.title, "det")}
    <div class="hero-t"><span class="meta"><span class="tag-s">${esc(srcName(src))}</span>${type ? `<span>${esc(typeName(type))}</span>` : ""}</span><h1>${esc(m.title)}</h1>
      <span class="mu sm">${[status, m.author].filter(Boolean).map(esc).join(" · ")}</span>
      <span class="mu sm">${d.chapters.length} chapter${latest?.at ? " · update " + esc(ago(latest.at)) : ""}</span></div></div></div>
<div class="px">
  <div class="act-row">
    <a class="btn primary grow" href="${resumeCh ? readHref(src, id, resumeCh.id) : first ? readHref(src, id, first.id) : "#"}">${icon("play", 18, 2)}${resumeCh ? "Lanjut Ch. " + esc(resumeCh.ch) : "Mulai baca"}</a>
    <button class="round-btn ${fav ? "on" : ""}" data-act="fav" aria-pressed="${fav}" aria-label="${fav ? "Hapus dari koleksi" : "Tambah ke koleksi"}">${icon(fav ? "heartF" : "heart", 22)}</button>
    <button class="round-btn ${bell ? "on gold" : ""}" data-act="bell" aria-pressed="${bell}" aria-label="${bell ? "Matikan notifikasi" : "Nyalakan notifikasi chapter baru"}">${icon(bell ? "bellF" : "bell", 22)}</button>
  </div>
  ${m.tags?.length ? `<div class="tags">${m.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
  ${m.desc ? `<p class="desc ${descOpen ? "open" : ""}" data-act="desc">${esc(m.desc)}</p>` : ""}
  <div class="sec-h mt24"><h2>Daftar chapter</h2><button class="link-red row g6" data-act="sort">${asc ? "Terlama" : "Terbaru"} ${icon("sort", 15, 2)}</button></div>
  ${resumeCh ? `<div class="resume-line">Terakhir dibuka · Chapter ${esc(resumeCh.ch)}</div>` : ""}
  <label class="search sm"><span class="mu">${icon("search", 18)}</span><span class="sr">Cari chapter</span><input id="chq" inputmode="decimal" placeholder="Cari chapter…" value="${esc(q)}"></label>
  <div class="rows">${list.map((c) => {
    const cur = h?.chapter_id === c.id;
    return `<a class="ch ${cur ? "cur" : ""}" href="${readHref(src, id, c.id)}"><span class="col"><b>Chapter ${esc(c.ch ?? "?")}</b>${c.title ? `<span class="mu xs">${esc(c.title)}</span>` : ""}</span><span class="mu xs">${cur ? "Terakhir dibaca" : esc(ago(c.at))}</span></a>`;
  }).join("") || `<div class="empty"><span class="empty-ic">${icon("search", 22)}</span><b>Maaf, chapter tidak tersedia</b><span>Coba nomor chapter lain.</span></div>`}</div>
</div><div class="pad-nav"></div>`;
    const inp = $("#chq");
    inp.addEventListener("input", () => { q = inp.value.trim(); const pos = inp.selectionStart; draw(); const n = $("#chq"); n.focus(); n.setSelectionRange(pos, pos); });
  };
  setActs({
    back: () => back(),
    retry: () => vDetail(src, id),
    desc: (el) => { descOpen = !descOpen; el.classList.toggle("open", descOpen); },
    sort: () => { asc = !asc; draw(); },
    fav: async () => {
      try { const on = await S.toggleLib(meta); if (on) S.updateLibMeta(src, id, { type, latest: latest?.ch ?? null }); toast(on ? "Ditambahkan ke koleksi" : "Dihapus dari koleksi"); }
      catch (e) { toast(e.message); }
      draw();
    },
    bell: async () => {
      if (!S.loggedIn()) { toast("Masuk dulu untuk menyalakan notifikasi chapter baru."); return; }
      const on = !S.libItem(src, id)?.notify;
      try { await S.setNotify(meta, on); S.updateLibMeta(src, id, { type, latest: latest?.ch ?? null }); toast(on ? "Notifikasi chapter baru menyala" : "Notifikasi dimatikan"); }
      catch (e) { toast(e.message); }
      draw();
    },
  });
  draw();
}

/* ---------- Pembaca (gulir atau slide) ---------- */
async function vReader(src, id, chId) {
  view.innerHTML = `<div class="reader"><div class="r-top glass"><button class="icon-btn" data-act="back" aria-label="Kembali">${icon("back", 22)}</button><span class="r-title mu">Memuat…</span></div><div class="r-pages">${loading(3, "sk-page")}</div></div>`;
  setActs({ back: () => go(comicHref(src, id)), retry: () => vReader(src, id, chId) });
  let d = cachedDetail(src, id);
  try { if (!d) d = await getDetail(src, id); } catch (e) { $(".r-pages").innerHTML = errBox(e); return; }
  const idx = d.chapters.findIndex((c) => c.id === chId);
  const ch = d.chapters[idx] || { id: chId, ch: "?" };
  const prev = d.chapters[idx - 1], next = d.chapters[idx + 1];
  let p;
  try { p = await api.call("pages", { source: src, chapter_id: chId }); } catch (e) { $(".r-pages").innerHTML = errBox(e); return; }
  if (parse().name !== "reader") return;
  const total = p.images.length, slide = S.state.settings.readMode === "slide", rtl = S.state.settings.readDir !== "ltr";
  const imgs = p.images.map((im, i) => `<img class="r-img" data-i="${i + 1}" src="${esc(api.pageUrl(im.p))}" alt="Halaman ${i + 1}" ${i > 2 ? 'loading="lazy"' : ""} decoding="async" referrerpolicy="no-referrer">`);
  const nextBtn = next ? `<a class="btn primary" href="${readHref(src, id, next.id)}">Chapter berikutnya · ${esc(next.ch)}</a>` : `<span class="mu">Ini chapter terbaru.</span>`;
  view.innerHTML = `<div class="reader ui ${slide ? "slide" : ""}" id="rd">
  <div class="r-top glass"><button class="icon-btn" data-act="back" aria-label="Kembali">${icon("back", 22)}</button>
    <span class="r-title"><b class="t1">${esc(d.manga.title)}</b><span class="mu xs">Chapter ${esc(ch.ch)} · <span id="rpg">1</span>/${total}</span></span></div>
  ${slide ? `<div class="r-slides" id="rpages" dir="${rtl ? "rtl" : "ltr"}">${imgs.map((im) => `<div class="r-slide">${im}</div>`).join("")}<div class="r-slide r-endslide">${nextBtn}</div></div>`
    : `<div class="r-pages" id="rpages">${imgs.join("")}</div><div class="r-end">${nextBtn}</div>`}
  <div class="r-bot glass">
    <a class="icon-btn ${prev ? "" : "dis"}" ${prev ? `href="${readHref(src, id, prev.id)}"` : 'aria-disabled="true"'} aria-label="Chapter sebelumnya">${icon("back", 22)}</a>
    <a class="btn ghost sm" href="${comicHref(src, id)}">${icon("list", 16, 2)}Daftar chapter</a>
    <a class="icon-btn ${next ? "" : "dis"}" ${next ? `href="${readHref(src, id, next.id)}"` : 'aria-disabled="true"'} aria-label="Chapter berikutnya">${icon("chev", 22)}</a>
  </div></div>`;
  const rd = $("#rd");
  rd.addEventListener("click", (e) => { if (!e.target.closest("a,button")) rd.classList.toggle("ui"); });
  const meta = { source: src, comic_id: id, title: d.manga.title, cover: d.manga.cover, chapter: ch.ch, chapter_id: ch.id, pages: total, type: typeFromTags(d.manga.tags) };
  S.saveHistory({ ...meta, page: 1 });
  S.awardRead(src, id, ch.ch);
  let curPage = 1;
  const setPage = (i) => { if (i !== curPage && i >= 1 && i <= total) { curPage = i; $("#rpg").textContent = i; S.saveHistory({ ...meta, page: i }); } };
  let io = null;
  const box = $("#rpages");
  if (slide) box.addEventListener("scroll", () => setPage(Math.round(Math.abs(box.scrollLeft) / (box.clientWidth || 1)) + 1), { passive: true });
  else {
    io = new IntersectionObserver((ents) => { for (const en of ents) if (en.isIntersecting) setPage(Number(en.target.dataset.i)); }, { rootMargin: "-45% 0px -45% 0px" });
    $$(".r-img").forEach((im) => io.observe(im));
  }
  cleanup = () => { io?.disconnect(); S.flushHistory(); };
  const h = S.histItem(src, id);
  if (h?.chapter_id === chId && h.page > 1) {
    const target = $(`.r-img[data-i="${h.page}"]`);
    if (target) setTimeout(() => (slide ? target.parentElement : target).scrollIntoView({ block: "start", inline: "start" }), 300);
  }
}

/* ---------- Favorit ---------- */
let fav = { tab: "lib", q: "", filter: "all" };
function vFav(tab) {
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
    body = `<div class="card row g12"><span class="ic-box">${icon("folder", 20)}</span><span class="rc-mid"><span class="mu xs">Lokasi penyimpanan</span><b class="b14">Tersedia di aplikasi APK</b></span></div>
  <div class="empty"><span class="empty-ic">${icon("down", 24)}</span><b>Belum ada unduhan</b><span>Unduh chapter untuk dibaca offline hadir di aplikasi APK Ninokuu. Versi web tidak bisa menyimpan file ke folder HP.</span></div>`;
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
}

/* ---------- Lainnya ---------- */
let authMode = "in";
const mrow = (ic, label, sub, act, opt = {}) => {
  const inner = `<span class="mrow-ic">${icon(ic, 19)}</span><span class="rc-mid"><b>${label}</b>${sub ? `<span class="mu sm">${sub}</span>` : ""}</span>`;
  return act ? `<button class="mrow ${opt.danger ? "danger" : ""}" data-act="${act}">${inner}${opt.danger ? "" : `<span class="mu">${icon("chev", 18)}</span>`}</button>` : `<div class="mrow">${inner}</div>`;
};
const group = (t, inner) => `<section class="sec s20"><h2 class="cap">${t}</h2><div class="group">${inner}</div></section>`;
const avatarHtml = (p, lv, size = "") => `<span class="avatar ${size} t${lv.tier}"><span>${esc((p?.name || "?")[0].toUpperCase())}</span></span>`;
const badges = (p) => `${p?.verified ? `<span class="verif" title="Terverifikasi">${icon("check", 10, 3.2)}</span>` : ""}${p?.role === "developer" ? `<span class="pill-dev">DEV</span>` : p?.role === "moderator" ? `<span class="pill-mod">MOD</span>` : ""}`;
function vMore() {
  const p = S.state.profile, lv = S.levelOf(p), user = api.currentUser(), st = S.state.settings;
  const gfx = st.gfx || "Normal";
  view.innerHTML = `
<div class="page-h"><h1>Lainnya</h1></div>
${!api.configured ? `<div class="note warn mx">${icon("info", 18)}<span>Aplikasi belum tersambung ke server (config.js kosong).</span></div>` : ""}
${user ? `<button class="me mx" data-act="level">${avatarHtml(p, lv)}
    <span class="rc-mid g5"><span class="me-name"><b class="t1">${esc(p?.name || "Memuat…")}</b>${badges(p)}<span class="rank-pill t${lv.tier}">${lv.rank}</span></span>
      <span class="mu sm">Lv ${lv.lv}${lv.max ? " · level maksimal" : ` · ${(lv.need - lv.cur).toLocaleString("id-ID")} EXP lagi ke Lv ${lv.lv + 1}`}</span>
      <span class="prog"><span style="width:${lv.max ? 100 : pct(lv.cur, lv.need)}%"></span></span></span><span class="mu">${icon("chev", 18)}</span></button>
  ${group("Akun", mrow("user", "Nama tampilan", esc(p?.name || ""), "goName") + mrow("msg", "Email", esc(user.email || ""), "goEmail") + mrow("key", "Ganti password", "", "goPass") + mrow("out", "Keluar", "", "logout", { danger: true }))}`
  : `<div class="guest mx">${avatarHtml(null, S.levelOf(null))}<span class="rc-mid g4"><b class="b16">Tamu</b><span class="mu sm">Belum masuk · level, rank, dan koleksi belum tersimpan di akun</span></span></div>
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
${group("Bacaanmu", mrow("star", "Level &amp; Rank", user ? `${lv.rank} · Lv ${lv.lv}` : "Masuk untuk mulai naik level", "level") + mrow("clock", "Riwayat baca", `${S.history().length} judul`, "goHist") + mrow("down", "Unduhan", "Tersedia di aplikasi APK", "goDl"))}
<section class="sec s20"><h2 class="cap">Tampilan</h2><div class="card col g12"><span class="b145">Mode efek avatar</span>
  ${seg([{ id: "Ringan", name: "Ringan" }, { id: "Normal", name: "Normal" }], gfx, "gfx", "s2")}
  <span class="mu xs lh">${gfx === "Ringan" ? "Partikel dikurangi; komet, aurora, dan awan nebula dimatikan. Hemat baterai, cocok untuk HP spek rendah." : "Bingkai avatar kosmik penuh dengan partikel dan animasi."}</span></div></section>
<section class="sec s20"><h2 class="cap">Pengalaman baca</h2><div class="card col g12"><span class="b145">Mode baca</span>
  ${seg([{ id: "scroll", name: "Scroll (webtoon)" }, { id: "slide", name: "Slide (halaman)" }], st.readMode, "rmode", "s2")}
  ${st.readMode === "slide" ? `<span class="mu sm">Arah geser</span>${seg([{ id: "rtl", name: "Kanan ke kiri" }, { id: "ltr", name: "Kiri ke kanan" }], st.readDir === "ltr" ? "ltr" : "rtl", "dir", "s2")}` : ""}
  <span class="mu xs lh">${st.readMode === "slide" ? "Geser per halaman. Kanan ke kiri cocok untuk manga Jepang." : "Gulir ke bawah, halaman tersambung. Cocok untuk manhwa dan manhua."}</span></div></section>
${group("Data &amp; penyimpanan", mrow("cloud", "Backup data offline", "Simpan koleksi, riwayat, dan pengaturan ke file", "backup") + mrow("restore", "Pulihkan data", "Dari file backup", "restore") + mrow("trash", "Bersihkan cache", "Gambar sampul &amp; halaman yang tersimpan", "cache"))}
${group("Dukungan", mrow("chat", "Lapor bug &amp; saran", "Lewat server Discord Ninokuu", "discord") + mrow("info", "Tentang aplikasi", "Versi " + esc(VERSION), "about") + mrow("shield", "Kebijakan privasi", "", "privacy") + mrow("doc", "Ketentuan pengguna", "", "terms") + mrow("heart", "Dukung di Trakteer", "Traktir pengembang", "trakteer"))}
<p class="mu xs center mt18">Ninokuu versi ${esc(VERSION)}</p><div class="pad-nav"></div>`;
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
      toast("Berhasil masuk"); vMore();
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  });
  setActs({
    auth: (el) => { authMode = el.dataset.v; vMore(); },
    level: () => go("#/p/level"), goName: () => go("#/p/name"), goEmail: () => go("#/p/email"), goPass: () => go("#/p/pass"),
    goHist: () => go("#/fav/hist"), goDl: () => go("#/fav/dl"),
    about: () => go("#/p/about"), privacy: () => go("#/p/privacy"), terms: () => go("#/p/terms"),
    backup: () => go("#/p/backup"), restore: () => go("#/p/restore"),
    discord: () => soon("Server Discord Ninokuu sedang disiapkan."), trakteer: () => soon("Halaman Trakteer sedang disiapkan. Terima kasih!"),
    gfx: (el) => { S.setSetting("gfx", el.dataset.v); vMore(); },
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

/* ---------- halaman turunan Lainnya ---------- */
const RANK_INFO = [["Warrior", 1, 11, "#AEB6C4"], ["Elite", 12, 22, "#F0BE84"], ["Grandmaster", 23, 33, "#FFA36B"], ["Epic", 34, 44, "#6FC3F2"], ["Legend", 45, 55, "#5DD39E"], ["Mythic", 56, 66, "#8FAEFF"], ["Honor", 67, 77, "#B48CFF"], ["Glory", 78, 88, "#FF9CC0"], ["Immortal", 89, 99, "#F2B33D"]];
function vPage(name) {
  const p = S.state.profile, lv = S.levelOf(p), user = api.currentUser();
  if (["name", "email", "pass"].includes(name) && !user) { go("#/more"); return; }
  let html = "";
  const acts2 = { back: () => back("#/more") };
  if (name === "level") {
    html = topbar("Level &amp; Rank") + `<div class="px col g16 mt6">
  ${!user ? `<div class="note">${icon("key", 18)}<span>Untuk berkomentar dan mendapatkan <b>Level &amp; Rank</b>, kamu harus <a href="#/more">masuk</a> terlebih dahulu.</span></div>` : ""}
  <div class="lv-hero">${avatarHtml(p, lv, "xl")}<span class="rank-pill big t${lv.tier}">${lv.rank}</span>
    <span class="lv-name">${esc(p?.name || "Tamu")}${badges(p)}</span>
    <div class="lv-bar"><div class="row sb mu xs"><span>Lv ${lv.lv}</span><span>${lv.max ? "MAKS" : `${lv.cur.toLocaleString("id-ID")} / ${lv.need.toLocaleString("id-ID")} EXP`}</span></div>
      <span class="prog l"><span style="width:${lv.max ? 100 : pct(lv.cur, lv.need)}%"></span></span>
      <span class="sm">${lv.max ? (p?.role === "developer" ? "Developer · Lv 99" : "Level maksimal 99 tercapai") : "Baca chapter baru untuk mendapat EXP (10 EXP per chapter, maks 300 per hari)"}</span></div></div>
  <h2 class="cap">Tangga rank</h2>
  <div class="group">${RANK_INFO.map(([n, a, b, c], i) => `<div class="rank-row ${i === lv.tier ? "me" : ""} ${i > lv.tier ? "lock" : ""}"><span class="avatar sm t${i}"><span>${n[0]}</span></span>
      <span class="rc-mid"><b style="color:${c}">${n}</b><span class="mu xs">Lv ${a}–${b}</span></span><span class="xs b ${i === lv.tier ? "gold" : i < lv.tier ? "ok" : "mu"}">${i === lv.tier ? "RANK-MU" : i < lv.tier ? "Terlewati" : "Terkunci"}</span></div>`).join("")}</div>
  <p class="mu xs lh">Bingkai avatar kosmik penuh untuk tiap rank (seperti di prototipe) hadir di bagian berikutnya.</p></div>`;
  } else if (name === "name") {
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

const VIEWS = { home: vHome, search: vSearch, fav: vFav, more: vMore, detail: vDetail, reader: vReader, page: vPage };

/* ---------- mulai ---------- */
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
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
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
})();
