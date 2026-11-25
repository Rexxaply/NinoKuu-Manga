// Pencarian: hasil sambil mengetik, filter, riwayat cari, pencarian longgar Shinigami/WestManga + cache hasil.
// Dipecah dari main.js; perilaku sama persis.
import * as api from "./api.js";
import * as S from "./store.js";
import { openFilter, activeCount, genreName, STATUS_NAME } from "./filters.js";
import { savedSrc, SRC_IDS, setHomeSrc } from "./home.js";
import { esc, icon, $, $$, toast, SOURCES, srcName, TYPES, typeName, comicHref, errBox, loading, ask } from "./ui.js";

// dari main.js (router, lembar, pengaturan, halaman lain) — diisi sekali lewat bindSearch() sebelum halaman pertama tampil
let view, seg, viewBtn, chips, gcard, minRow, setActs, setCleanup;
export function bindSearch(c) { ({ view, seg, viewBtn, chips, gcard, minRow, setActs, setCleanup } = c); }

/* ---------- Pencarian (hasil muncul sambil mengetik) ---------- */
let sState = { q: "", src: savedSrc("homeSrc"), type: "", status: "", genres: [] };
// Sumber di Beranda dan Pencarian satu pilihan yang sama: diganti di salah satu, ikut di yang lain
export function setSrc(v) {
  if (!SRC_IDS.includes(v)) return;
  setHomeSrc(v); api.lsSet("homeSrc", v); api.lsSet("searchSrc", v);
  if (sState.src !== v) { sState.src = v; sState.genres = []; sMem = null; }
}
// hasil Pencarian yang sudah dimuat: kembali dari halaman komik → daftar & posisi gulir utuh
let sMem = null;
// hasil pencarian terakhir per sumber/kata kunci/filter (10 menit, maks. 12): pindah sumber bolak-balik langsung tampil
const sCache = new Map();
const sCachePut = (m) => { sCache.delete(m.key); sCache.set(m.key, m); if (sCache.size > 12) sCache.delete(sCache.keys().next().value); };
// Shinigami & WestManga mencari per kata ("Genius Hitter" ikut memunculkan semua judul berisi "Genius"). Hasilnya
// disaring di aplikasi: setiap kata yang dicari harus ada sebagai awal kata di judul atau judul alternatif, seperti
// pencarian Komiku/Kiryuu/BacaKomik yang sudah tepat sasaran.
const LOOSE_SEARCH = new Set(["shinigami", "westmanga"]);
export const normQ = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[’'`]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export const matchQ = (q) => {
  const ws = normQ(q).split(" ").filter(Boolean);
  return (it) => { const hay = " " + normQ(it.title + " " + (it.alt || "")) + " "; return ws.every((w) => hay.includes(" " + w)); };
};
const sKey = () => JSON.stringify([sState.src, sState.q, sState.type, sState.status, sState.genres]);
export async function vSearch(type) {
  if (type !== undefined) sState.type = TYPES.some((t) => t.id === type) ? type : "";
  view.innerHTML = `
<div class="page-h"><h1>Pencarian</h1></div>
<div class="px row g8 s-wrap"><label class="search grow"><span class="mu">${icon("search", 20)}</span><span class="sr">Cari judul</span>
  <input id="sq" type="search" enterkeyhint="search" autocomplete="off" placeholder="Cari judul manga, manhwa, manhua…" value="${esc(sState.q)}">
  <button type="button" class="clr" data-act="clear" aria-label="Hapus pencarian" ${sState.q ? "" : "hidden"}>${icon("x", 16, 2.2)}</button>
  <div class="sh-pop" id="shpop" role="listbox" aria-label="Pencarian terakhir"></div></label>
  <span id="fltbtn"></span></div>
<div class="sec s14">${seg(SOURCES, sState.src, "src", "src")}</div>
<div class="px mt10 t-row"><div id="tchips"></div>${viewBtn(S.state.settings.searchView === "grid", "view")}</div>
<div class="px" id="factive"></div>
<div class="sec-h px mt10"><span class="mu sm" id="sinfo"></span></div>
<div id="sres" class="px">${loading(6, "sk-lrow")}</div>
<button class="more-auto" data-act="more" id="sMore" hidden><span class="spin-s" aria-hidden="true"></span>Memuat lainnya…</button>
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
  let busyMore = false;
  const load = async (more = false) => {
    if (more && busyMore) return;
    const my = ++seq;
    if (more) busyMore = true;
    const hit = !more && sCache.get(sKey());
    if (hit && Date.now() - hit.at < 10 * 60e3) {
      ({ items, page } = hit); sMem = hit;
      const nf0 = (sState.status ? 1 : 0) + sState.genres.length;
      $("#sinfo").textContent = (sState.q ? `Hasil “${sState.q}” di ${srcName(sState.src)}` : `Terbaru di ${srcName(sState.src)}${sState.type ? " · " + typeName(sState.type) : ""}`) + (nf0 ? ` · ${nf0} filter` : "");
      draw(); $("#sMore").hidden = !hit.hasNext; return;
    }
    if (!more) { page = 1; $("#sres").innerHTML = loading(6, "sk-lrow"); $("#sMore").hidden = true; }
    const nf = (sState.status ? 1 : 0) + sState.genres.length;
    $("#sinfo").textContent = (sState.q ? `Hasil “${sState.q}” di ${srcName(sState.src)}` : `Terbaru di ${srcName(sState.src)}${sState.type ? " · " + typeName(sState.type) : ""}`) + (nf ? ` · ${nf} filter` : "");
    try {
      const ask = () => api.call("browse", { source: sState.src, q: sState.q, type: sState.type, status: sState.status, genres: sState.genres, sort: "update", page, limit: 24 });
      let r = await ask(), got = r.items;
      if (sState.q && LOOSE_SEARCH.has(sState.src)) {
        // Hasil Shinigami/WestManga yang cocok sebagian kata dibuang. Halaman berikutnya diambil sendiri (maks. 3 lagi)
        // selama masih ada yang dibuang dan hasil cocok belum 24; "Muat lagi" hanya tampil bila halaman terakhir yang
        // diambil seluruhnya cocok (berarti hasil yang tepat memang masih berlanjut).
        const ok = matchQ(sState.q);
        got = r.items.filter(ok);
        let mixed = got.length < r.items.length;
        for (let n = 0; mixed && r.hasNext && got.length < 24 && n < 3 && my === seq; n++) {
          page++; r = await ask();
          const g = r.items.filter(ok); got = got.concat(g); mixed = g.length < r.items.length;
        }
        if (mixed) r = { ...r, hasNext: false };
        const seen = new Set(more ? items.map((x) => x.id) : []); got = got.filter((x) => !seen.has(x.id) && seen.add(x.id));
      }
      if (my !== seq || !$("#sres")) return;
      items = more ? items.concat(got) : got;
      sMem = { key: sKey(), items, page, hasNext: !!r.hasNext, at: Date.now() }; sCachePut(sMem);
      draw();
      $("#sMore").hidden = !r.hasNext;
    } catch (e) { if (more) { page--; if (my === seq) toast(e.message); } else if (my === seq && $("#sres")) $("#sres").innerHTML = errBox(e); }
    finally { if (more) busyMore = false; }
  };
  // seperti Beranda: "Memuat lainnya…" (cincin berputar) dimuat otomatis saat hampir terlihat, bisa juga diketuk
  const moreIo = new IntersectionObserver((es) => { const m = $("#sMore"); if (es[0].isIntersecting && m && !m.hidden && !busyMore) { page++; load(true); } }, { rootMargin: "400px" });
  moreIo.observe($("#sMore"));
  const inp = $("#sq");
  // Riwayat pencarian: 10 kata kunci terakhir (disimpan di HP). Muncul di bawah kolom cari saat kolomnya
  // diketuk dan masih kosong. Disimpan saat Enter, saat memilih hasil, atau saat meninggalkan halaman.
  const HK = "searchHist";
  const shList = () => { const h = api.lsGet(HK); return Array.isArray(h) ? h : []; };
  const saveQ = (q) => { q = String(q || "").trim(); if (q.length < 2) return; api.lsSet(HK, [q, ...shList().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 10)); };
  const pop = $("#shpop");
  const drawHist = () => {
    // kolom kosong: semua riwayat; kolom berisi: riwayat yang memuat teks itu (selain yang persis sama)
    const v = normQ(inp.value), all = shList();
    const h = v ? all.filter((q) => normQ(q).includes(v) && normQ(q) !== v).slice(0, 5) : all;
    pop.innerHTML = h.length ? `<div class="shp-h"><span class="cap">Pencarian terakhir</span>${v ? "" : `<button type="button" class="link-red sm" data-shall>Hapus semua</button>`}</div>
      ${h.map((q) => `<div class="shp-row" role="option"><button type="button" class="shp-q" data-sh="${esc(q)}"><span class="mu">${icon("clock", 16)}</span><span class="t1">${esc(q)}</span></button><button type="button" class="shp-x" data-shx="${esc(q)}" aria-label="Hapus ${esc(q)} dari riwayat">${icon("x", 14, 2.2)}</button></div>`).join("")}` : "";
    return h.length > 0;
  };
  const showHist = (on) => pop.classList.toggle("on", on && document.activeElement === inp && drawHist());
  pop.addEventListener("pointerdown", (e) => e.preventDefault());          // kolom cari tetap fokus saat panel diketuk
  pop.addEventListener("click", (e) => {
    const b = e.target.closest("[data-sh], [data-shx], [data-shall]"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    if (b.dataset.sh != null) { const q = b.dataset.sh; inp.value = q; sState.q = q; saveQ(q); $("[data-act=clear]").hidden = false; pop.classList.remove("on"); inp.blur(); load(); }
    else if (b.dataset.shx != null) { api.lsSet(HK, shList().filter((x) => x !== b.dataset.shx)); showHist(true); }
    else { api.lsSet(HK, []); pop.classList.remove("on"); }
  });
  inp.addEventListener("focus", () => showHist(true));
  // ketuk kolom yang sudah fokus (fokus tidak berpindah, jadi event focus tidak terpanggil) tetap memunculkan riwayat
  inp.addEventListener("click", () => showHist(true));
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
  setCleanup(() => { moreIo.disconnect(); clearTimeout(timer); if (sState.q && items.length) saveQ(sState.q); });
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
    more: () => { if (!busyMore) { page++; load(true); } },
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
