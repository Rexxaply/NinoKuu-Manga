// Favorit: Koleksi (rak, filter, cari, label NEW), Riwayat, Unduhan; pengecek chapter terbaru koleksi di latar.
// Dipecah dari main.js; perilaku sama persis.
import * as api from "./api.js";
import * as S from "./store.js";
import * as N from "./native.js";
import * as DL from "./dl.js";
import { sortSheet } from "./home.js";
import { openNextChapter } from "./detail.js";
import { esc, icon, $, $$, toast, ago, srcName, typeName, cover, comicHref, readHref, ask } from "./ui.js";

// dari main.js (router, lembar, pengaturan, halaman lain) — diisi sekali lewat bindFav() sebelum halaman pertama tampil
let loadNotifs, pct, viewBtn, seg, view, setActs, promptText, openSheet, closeSheet, parse, setCleanup;
export function bindFav(c) { ({ loadNotifs, pct, viewBtn, seg, view, setActs, promptText, openSheet, closeSheet, parse, setCleanup } = c); }

/* ---------- Favorit ---------- */
// Label "Terbaru" & urutan "Update terbaru" di Koleksi butuh chapter terbaru tiap komik. Sebelumnya baru diketahui
// setelah komik dibuka (HP / pemasangan baru: kosong semua). Sekarang dicek di belakang layar saat Koleksi dibuka:
// maks. 12 komik per putaran, 2 sekaligus, tiap komik paling sering 45 menit sekali. Putaran berjalan saat Koleksi
// dibuka dan juga saat aplikasi dibuka / kembali dari latar belakang (paling sering 10 menit sekali). Shinigami/WestManga di APK
// diambil lewat jaringan HP (detail), sumber lain lewat action "latest" yang hanya mengirim chapter terbaru.
let latestRun = false;
async function refreshLatest(items) {
  if (latestRun) return;
  const chk = api.lsGet("latestChk", {}) || {}, now = Date.now();
  const last = (m) => chk[m.source + "|" + m.comic_id] || 0;
  const due = items.filter((m) => now - last(m) > 45 * 60e3)
    .sort((a, b) => (a.latest == null ? 0 : 1) - (b.latest == null ? 0 : 1) || last(a) - last(b)).slice(0, 12);
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
// cek chapter terbaru koleksi di belakang layar saat aplikasi dibuka / kembali dibuka (tidak menunggu Koleksi dibuka)
let latestBg = 0;
function latestSoon(delay) {
  setTimeout(() => {
    if (document.visibilityState !== "visible" || Date.now() - latestBg < 10 * 60e3) return;
    latestBg = Date.now();
    loadNotifs().catch(() => {});
    const all = [...S.state.lib.values()];
    if (all.length) refreshLatest(all);
  }, delay);
}
latestSoon(5000);
setInterval(() => latestSoon(0), 5 * 60e3);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") latestSoon(1500); });
const FAV_SORTS = [["update", "Update terbaru"], ["added", "Terakhir ditambah"], ["az", "Judul A-Z"], ["za", "Judul Z-A"]];
let fav = { tab: "lib", q: "", hq: "", filter: "all", bar: false };
// kata kunci tab aktif: Koleksi (q) dan Riwayat (hq) punya pencarian masing-masing
const qKey = () => (fav.tab === "hist" ? "hq" : "q");
// Bilah atas Favorit yang menempel: muncul begitu pilihan Koleksi/Riwayat/Unduhan di atas halaman tergulir keluar layar.
// Isinya hanya pilihan tab + tombol cari (menyatu di kotak yang sama); tombol cari membuka kolom pencarian koleksi.
let favBarOn = false;
function favBarTick() {
  const bar = $("#favbar"), anchor = $("#favtop");
  if (!bar || !anchor) return;
  const on = fav.bar || anchor.getBoundingClientRect().bottom < 8;
  if (on !== favBarOn || bar.classList.contains("on") !== on) { favBarOn = on; bar.classList.toggle("on", on); bar.setAttribute("aria-hidden", String(!on)); bar.inert = !on; }
}
window.addEventListener("scroll", favBarTick, { passive: true });
window.addEventListener("resize", favBarTick, { passive: true });
// perilaku tab Unduhan dilepas setiap kali Favorit digambar ulang (tidak menumpuk)
let favDlOff = null, favShell = "";
const FAV_CARDS = "<!--kartu-->";
export function vFav(tab, soft = false) {
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
    && (fav.filter === "all" || (fav.filter === "new" ? isFresh(m) : fav.filter.startsWith("r:") ? m.shelf === fav.filter.slice(2) : m.type === fav.filter)));
  const histAll = S.history();
  const hq = fav.hq.trim().toLowerCase();
  const hist = hq ? histAll.filter((x) => String(x.title || "").toLowerCase().includes(hq)) : histAll;
  // baris riwayat: judul, sumber · waktu, "Ch. 23 · hal 12/48" + bar halaman; tombol Lanjut (ke halaman terakhir)
  // atau Berikutnya (bila chapter itu sudah selesai dibaca)
  const histBtn = (x, cls = "") => {
    const done = x.pages && x.page >= x.pages;
    if (!x.chapter_id) return x.chapter != null && x.chapter !== "?" ? `<button class="hl-go${cls}" type="button" data-next data-same data-src="${esc(x.source)}" data-id="${esc(x.comic_id)}" data-ch="" data-n="${esc(x.chapter)}">${icon("play", 12, 2.6)}${cls ? "Lanjut baca" : "Lanjut"}</button>` : "";
    return done
      ? `<button class="hl-go nx${cls}" type="button" data-next data-src="${esc(x.source)}" data-id="${esc(x.comic_id)}" data-ch="${esc(x.chapter_id)}" data-n="${esc(x.chapter ?? "")}">Berikutnya${icon("chev", 13, 2.6)}</button>`
      : `<button class="hl-go${cls}" type="button" data-go="${esc(readHref(x.source, x.comic_id, x.chapter_id))}">${icon("play", 12, 2.6)}${cls ? "Lanjut baca" : "Lanjut"}</button>`;
  };
  // "Terakhir dibuka": kartu besar untuk komik terakhir, tombol Lanjut baca / Berikutnya
  const histHero = (x) => {
    const done = x.pages && x.page >= x.pages;
    return `<a class="hl-hero" href="${comicHref(x.source, x.comic_id)}">${cover(x.cover, x.title, "sm")}<span class="fa-mid">
      <b class="hl-ht">${esc(x.title)}</b>
      <span class="fa-meta"><i class="fa-dot s-${esc(x.source)}"></i>${esc(srcName(x.source))}<span class="fa-sep">·</span>${esc(ago(x.read_at))}</span>
      <span class="fa-meta"><b class="fa-rd">Ch. ${esc(x.chapter)}</b>${x.pages ? `<span class="fa-sep">·</span>${done ? "selesai" : `hal ${Number(x.page) || 1} / ${Number(x.pages) || 0}`}` : ""}</span>
      <span class="fa-bar"><i style="width:${pct(x.page || 1, x.pages || 0) || 4}%"></i></span>
      <span class="hl-hb">${histBtn(x, " lg")}</span>
    </span><button class="hl-more" type="button" data-act="hmenu" data-src="${esc(x.source)}" data-id="${esc(x.comic_id)}" aria-label="Pilihan untuk ${esc(x.title)}">${icon("dots", 20, 2.4)}</button></a>`;
  };
  const histRow = (x) => {
    const done = x.pages && x.page >= x.pages;
    const btn = !x.chapter_id ? histBtn(x) : done
      ? `<button class="hl-go nx" type="button" data-next data-src="${esc(x.source)}" data-id="${esc(x.comic_id)}" data-ch="${esc(x.chapter_id)}" data-n="${esc(x.chapter ?? "")}">Berikutnya${icon("chev", 13, 2.6)}</button>`
      : `<button class="hl-go" type="button" data-go="${esc(readHref(x.source, x.comic_id, x.chapter_id))}">${icon("play", 12, 2.6)}Lanjut</button>`;
    return `<a class="fa-row" href="${comicHref(x.source, x.comic_id)}">${cover(x.cover, x.title, "sm")}<span class="fa-mid">
      <b class="fa-t">${esc(x.title)}</b>
      <span class="fa-meta"><i class="fa-dot s-${esc(x.source)}"></i>${esc(srcName(x.source))}<span class="fa-sep">·</span>${esc(ago(x.read_at))}</span>
      <span class="fa-meta"><b class="fa-rd">Ch. ${esc(x.chapter)}</b>${x.pages ? `<span class="fa-sep">·</span>${done ? "selesai" : `hal ${Number(x.page) || 1} / ${Number(x.pages) || 0}`}` : ""}</span>
      <span class="fa-bar"><i style="width:${pct(x.page || 1, x.pages || 0) || 4}%"></i></span>
    </span>${btn}<button class="hl-more" type="button" data-act="hmenu" data-src="${esc(x.source)}" data-id="${esc(x.comic_id)}" aria-label="Pilihan untuk ${esc(x.title)}">${icon("dots", 20, 2.4)}</button></a>`;
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
  // chip Koleksi: Semua, New update, lalu rak buatan sendiri, jenis komik, dan "+ Rak"
  const shelfList = S.shelves();
  if (fav.filter.startsWith("r:") && !shelfList.includes(fav.filter.slice(2))) fav.filter = "all";
  const shelfOn = fav.filter.startsWith("r:") ? fav.filter.slice(2) : "";
  const favChips = () => `<div class="chips" role="group">${[{ id: "all", name: "Semua" }, { id: "new", name: "New update" }, ...shelfList.map((n) => ({ id: "r:" + n, name: n, shelf: 1 })),
    { id: "manga", name: "Manga" }, { id: "manhwa", name: "Manhwa" }, { id: "manhua", name: "Manhua" }].map((x) => `<button aria-pressed="${x.id === fav.filter}" data-act="ff" data-v="${esc(x.id)}"${x.shelf ? ` class="ch-shelf"` : ""}>${x.shelf ? icon("folder", 14) : ""}${esc(x.name)}</button>`).join("")}<button class="ch-add" data-act="shelfNew" aria-label="Buat rak baru">${icon("plus", 15, 2.2)}Rak</button></div>`;
  if (fav.tab === "lib") {
    body = `<div class="row g8"><label class="search box grow"><span class="mu">${icon("search", 19)}</span><span class="sr">Cari di koleksi</span><input id="fq" placeholder="Cari di koleksimu" value="${esc(fav.q)}"></label><button class="sq-btn lg" data-act="fsort" aria-label="Urutkan: ${esc(FAV_SORTS.find(([k]) => k === fs)[1])}">${icon("sort", 18, 2)}</button>${viewBtn(grid, "fview", "lg")}</div>
  ${favChips()}
  ${shelfOn ? `<div class="shelf-bar"><span class="mu xs">${icon("folder", 14)}Rak <b>${esc(shelfOn)}</b> · ${lib.length} judul</span><button class="link-red sm" data-act="shelfRen">Ubah nama</button><button class="link-red sm" data-act="shelfDel">Hapus rak</button></div>`
    : `<div class="mu xs info">${libAll.length ? `${lib.length} dari ${libAll.length} judul · ${esc(FAV_SORTS.find(([k]) => k === fs)[1])} · ${S.loggedIn() ? "tersinkron" : "tersimpan di HP ini"}` : ""}</div>`}
  ${!lib.length ? (libAll.length ? `<div class="empty"><b>Tidak ada yang cocok</b><span>Ubah kata kunci atau filter.</span></div>`
      : `<div class="empty"><span class="empty-ic">${icon("heart", 24)}</span><b>Koleksi masih kosong</b><span>Ketuk ikon hati di halaman komik untuk menyimpannya di sini.</span><a class="btn ghost" href="#/search">Cari komik</a></div>`)
    : grid ? `<div class="g3 favg">${FAV_CARDS}</div>`
    : `<div class="frows">${FAV_CARDS}</div>`}`;
    cards = grid ? lib.map((m) => { const r = readOf(m); return `<a class="grid-card" href="${comicHref(m.source, m.comic_id)}"><span class="gc-cv">${cover(m.cover, m.title, "fav3")}
        <span class="stack">${m.latest != null ? `<span class="st-red">Terbaru ${esc(m.latest)}</span>` : ""}<span class="st-dark">${r ? "Dibaca " + esc(r.chapter) : "Belum dibaca"}</span></span>
        ${isFresh(m) ? `<span class="new-up">NEW UPDATE</span>` : ""}${m.notify ? `<span class="bell-b">${icon("bellF", 12)}</span>` : ""}</span>
        <b class="fg-t">${esc(m.title)}</b><span class="mu xs">${srcType(m)}</span></a>`; }) : lib.map(favRow);
  } else if (fav.tab === "hist") {
    // tanpa kata kunci: "Terakhir dibuka" (kartu besar) lalu "Bacaan sebelumnya"; saat mencari: semua hasil dalam satu daftar
    const top = !hq && hist.length ? hist[0] : null, rest = top ? hist.slice(1) : hist;
    cards = rest.map(histRow);
    const searchRow = `<label class="search box"><span class="mu">${icon("search", 19)}</span><span class="sr">Cari di riwayat</span><input id="hqi" type="search" enterkeyhint="search" autocomplete="off" placeholder="Cari di riwayat" value="${esc(fav.hq)}">${fav.hq ? `<button type="button" class="fb-x" data-act="hqclr" aria-label="Hapus kata kunci">${icon("x", 16, 2.2)}</button>` : ""}</label>`;
    body = !histAll.length ? `<div class="empty"><span class="empty-ic">${icon("clock", 24)}</span><b>Belum ada riwayat</b><span>Chapter yang kamu baca akan muncul di sini.</span></div>`
      : `${searchRow}
  ${top ? `<div class="sec-h hl-sec"><h2>Terakhir dibuka</h2></div>${histHero(top)}` : ""}
  <div class="sec-h hl-sec"><h2>${hq ? "Hasil pencarian" : "Bacaan sebelumnya"}</h2><span class="mu xs">${rest.length} judul</span><button class="link-red sm" data-act="clearHist">Bersihkan</button></div>
  ${rest.length ? `<div class="frows">${FAV_CARDS}</div>` : `<div class="empty"><b>${hq ? "Tidak ada yang cocok" : "Belum ada bacaan lain"}</b>${hq ? "<span>Ubah kata kunci.</span>" : ""}</div>`}`;
  } else {
    body = DL.favTab();
  }
  const TABS = [{ id: "lib", name: "Koleksi" }, { id: "hist", name: "Riwayat" }, { id: "dl", name: "Unduhan" }];
  if (fav.tab === "dl") fav.bar = false;
  const barOn = fav.bar || favBarOn;
  // kotak pilihan di bilah atas: tab + tombol cari (hanya di Koleksi) menyatu; mode cari: kolom pencarian + tombol tutup
  // tombol cari menyatu di kotak pilihan; saat diketuk kolom pencarian muncul di BAWAH kotak (pilihan tab tetap ada)
  const favBar = `<div class="fav-bar${barOn ? " on" : ""}" id="favbar" aria-hidden="${!barOn}"${barOn ? "" : " inert"}>
    <div class="seg s2 fb-seg" role="tablist">${TABS.map((x) => `<button role="tab" aria-selected="${x.id === fav.tab}" data-act="tab" data-v="${x.id}">${x.name}</button>`).join("")}${fav.tab !== "dl" ? `<button type="button" class="seg-ic${fav.bar ? " on" : ""}" data-act="${fav.bar ? "fbx" : "fbs"}" aria-label="${fav.bar ? "Tutup pencarian" : fav.tab === "hist" ? "Cari di riwayat" : "Cari di koleksi"}" aria-expanded="${fav.bar}">${icon(fav.bar ? "x" : "search", 18, 2.2)}</button>` : ""}</div>
    ${fav.bar ? `<label class="search box fb-search"><span class="mu">${icon("search", 18)}</span><span class="sr">${fav.tab === "hist" ? "Cari di riwayat" : "Cari di koleksi"}</span><input id="fbq" type="search" enterkeyhint="search" autocomplete="off" placeholder="${fav.tab === "hist" ? "Cari di riwayat" : "Cari di koleksimu"}" value="${esc(fav[qKey()])}">${fav[qKey()] ? `<button type="button" class="fb-x" data-act="fbclr" aria-label="Hapus kata kunci">${icon("x", 16, 2.2)}</button>` : ""}</label>` : ""}</div>`;
  const shell = `${favBar}
<div class="page-h" id="favtop"><h1>Favorit</h1>${seg(TABS, fav.tab, "tab")}</div>
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
  const fbq = $("#fbq");
  if (fbq) {
    fbq.addEventListener("input", () => { fav[qKey()] = fbq.value; const pos = fbq.selectionStart; vFav(); const n = $("#fbq"); if (n) { n.focus({ preventScroll: true }); n.setSelectionRange(pos, pos); } });
    fbq.addEventListener("keydown", (e) => { if (e.key === "Enter") fbq.blur(); if (e.key === "Escape") { fav.bar = false; vFav(); } });
  }
  const hqi = $("#hqi");
  if (hqi) {
    hqi.addEventListener("input", () => { fav.hq = hqi.value; const pos = hqi.selectionStart; vFav(); const n = $("#hqi"); if (n) { n.focus({ preventScroll: true }); n.setSelectionRange(pos, pos); } });
    hqi.addEventListener("keydown", (e) => { if (e.key === "Enter") hqi.blur(); });
  }
  favBarTick();
  setActs({
    // dari bilah atas: halaman digulir ke awal daftar supaya isi tab baru langsung terlihat di bawah bilah
    tab: (el) => { const fromBar = !!el.closest("#favbar"); fav.tab = el.dataset.v; vFav(); if (fromBar) { const t = $("#favtop"); if (t) scrollTo({ top: t.offsetTop + t.offsetHeight - 4, behavior: "auto" }); favBarTick(); } },
    fbs: () => { fav.bar = true; vFav(); const n = $("#fbq"); if (n) { n.focus({ preventScroll: true }); const l = n.value.length; n.setSelectionRange(l, l); } },
    fbx: () => { fav.bar = false; fav[qKey()] = ""; vFav(); },
    fbclr: () => { fav[qKey()] = ""; vFav(); const n = $("#fbq"); if (n) n.focus({ preventScroll: true }); },
    hqclr: () => { fav.hq = ""; vFav(); const n = $("#hqi"); if (n) n.focus({ preventScroll: true }); },
    // ⋯ di baris riwayat: lanjut/berikutnya, buka komik, hapus dari riwayat
    hmenu: (el, e) => {
      e?.preventDefault?.();
      const x = S.histItem(el.dataset.src, el.dataset.id); if (!x) return;
      const done = x.pages && x.page >= x.pages;
      openSheet(`<span class="sheet-ttl">${esc(x.title)}</span><div class="col g4">
        ${x.chapter_id || (x.chapter != null && x.chapter !== "?") ? `<button class="sh-row" data-s="${!x.chapter_id ? "same" : done ? "next" : "go"}">${icon(done ? "chev" : "play", 18, 2.2)}<span class="grow">${done ? "Baca chapter berikutnya" : `Lanjut baca Ch. ${esc(x.chapter)}`}</span></button>` : ""}
        <button class="sh-row" data-s="open">${icon("book", 18, 2)}<span class="grow">Buka halaman komik</span></button>
        <button class="sh-row redt" data-s="del">${icon("trash", 18, 2)}<span class="grow">Hapus dari riwayat</span></button></div>`,
      async (b) => {
        const a = b.dataset.s; closeSheet();
        if (a === "go") location.hash = readHref(x.source, x.comic_id, x.chapter_id);
        else if (a === "next") openNextChapter(x.source, x.comic_id, x.chapter_id, x.chapter);
        else if (a === "same") openNextChapter(x.source, x.comic_id, "", x.chapter, null, true);
        else if (a === "open") location.hash = comicHref(x.source, x.comic_id);
        else if (a === "del") { try { await S.removeHistory(x.source, x.comic_id); toast("Dihapus dari riwayat"); } catch (er) { toast(er.message); } }
      });
    },
    ff: (el) => { fav.filter = el.dataset.v; vFav(); },
    shelfNew: async () => {
      const v = await promptText("Rak baru", { placeholder: "mis. Sedang dibaca, Nanti, Tamat" }); if (!v) return;
      const n = S.addShelf(v); fav.filter = "r:" + n; vFav();
      toast(`Rak ${n} dibuat. Masukkan komik lewat tombol Rak di halaman komik.`, 3600);
    },
    shelfRen: async () => {
      const from = fav.filter.slice(2), v = await promptText("Ubah nama rak", { value: from }); if (!v || v === from) return;
      if (S.shelves().some((x) => x !== from && x.toLowerCase() === v.toLowerCase())) { toast("Nama rak itu sudah ada."); return; }
      try { await S.renameShelf(from, v); fav.filter = "r:" + S.cleanShelf(v); vFav(); } catch (e) { toast(e.message); }
    },
    shelfDel: async () => {
      const n = fav.filter.slice(2);
      if (!(await ask(`Hapus rak ${n}? Komiknya tetap ada di koleksi, hanya keluar dari rak ini.`, { ok: "Hapus", danger: true }))) return;
      try { await S.deleteShelf(n); fav.filter = "all"; vFav(); toast("Rak dihapus"); } catch (e) { toast(e.message); }
    },
    fview: () => S.setSetting("favView", grid ? "list" : "grid"),
    fsort: () => sortSheet("Urutkan koleksi", FAV_SORTS, fs, (v) => S.setSetting("favSort", v)),
    clearHist: async () => { if (!(await ask("Hapus semua riwayat baca?", { ok: "Hapus", danger: true }))) return; try { await S.clearHistory(); toast("Riwayat dibersihkan"); } catch (e) { toast(e.message); } },
  });
  if (fav.tab === "lib" && libAll.length) refreshLatest(libAll);
  if (fav.tab === "dl") {
    favDlOff = DL.mountFav(view, { openSheet, closeSheet, redraw: () => { if (parse().name === "fav" && fav.tab === "dl") { const y = scrollY; vFav(); scrollTo(0, y); } } });
    setCleanup(() => { favDlOff?.(); favDlOff = null; });
  }
}
