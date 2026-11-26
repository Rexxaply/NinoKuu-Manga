// Beranda: sumber pilihan, Top 10 (carousel berputar + parallax), daftar update / urutan, sapaan & Lanjut baca.
// Dipecah dari main.js; perilaku sama persis.
import * as api from "./api.js";
import * as S from "./store.js";
import * as O from "./online.js";
import { QUOTES } from "./assets.js";
import { esc, icon, $, toast, SOURCES, srcName, typeName, cover, comicHref, readHref, greeting, errBox, loading } from "./ui.js";

// dari main.js (router, lembar, pengaturan, halaman lain) — diisi sekali lewat bindHome() sebelum halaman pertama tampil
let openSheet, closeSheet, view, pct, viewBtn, seg, gcard, minRow, CROWN, scoreTag, setActs, openNotif, setSrc, refreshDots, setCleanup;
export function bindHome(c) { ({ openSheet, closeSheet, view, pct, viewBtn, seg, gcard, minRow, CROWN, scoreTag, setActs, openNotif, setSrc, refreshDots, setCleanup } = c); }

/* ---------- Beranda ---------- */
export const SRC_IDS = SOURCES.map((x) => x.id);
export const savedSrc = (k) => { const v = api.lsGet(k); return SRC_IDS.includes(v) ? v : "komiku"; };
let homeSrc = savedSrc("homeSrc");
// sumber pilihan dipakai bersama Pencarian (memilih sumber di sana ikut mengganti sumber Beranda)
export const setHomeSrc = (v) => { homeSrc = v; };
export const browseCache = new Map();
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
export const NO_SCORE = new Set(["komiku"]);
const SRC_SORTS = { komiku: ["update", "popular"], kiryuu: ["update", "popular", "az", "za", "rating"], shinigami: ["update", "popular", "rating"], westmanga: ["update", "popular", "az", "za"], bacakomik: ["update", "popular", "az", "za"] };
const homeSortOf = (src) => { const v = (S.state.settings.homeSort || {})[src]; return (SRC_SORTS[src] || ["update"]).includes(v) ? v : "update"; };
// daftar Beranda yang sudah dimuat (per sumber + urutan): kembali dari halaman komik → daftar & posisi gulir utuh
const homeMem = new Map();
const HOME_STEP = 15;   // 3 kolom × 5 baris per muatan
export function sortSheet(title, list, cur, onPick) {
  openSheet(`<span class="sheet-ttl">${esc(title)}</span><div class="col g4" role="radiogroup">${list.map(([k, n]) => `<button class="sh-row" role="radio" aria-checked="${k === cur}" data-s="pick" data-v="${esc(k)}"><span class="grow">${esc(n)}</span>${k === cur ? `<span class="redt">${icon("check", 18, 2.4)}</span>` : ""}</button>`).join("")}</div>`,
    (b) => { if (b.dataset.s === "pick") { closeSheet(); onPick(b.dataset.v); } });
}
// carousel tengah (Top 10). Digerakkan sendiri (bukan gulir bawaan WebView, yang di sebagian HP tersendat dan
// "menyentak" karena snap): kartu mengikuti jari, saat dilepas meluncur ke kartu terdekat (ikut kecepatan jari, maks.
// 2 kartu) dengan kurva iOS. Ketuk kartu samping → meluncur ke tengah; ketuk kartu tengah → buka komik.
// loop = jumlah kartu asli (daftar digambar 3×) → berputar tanpa ujung (lompat diam-diam ke salinan tengah).
// Ringan: jarak kartu diukur sekali, hanya ±3 kartu di sekitar tengah yang diubah per frame & dijadikan lapisan GPU.
function coverflow(box, loop = 0) {
  // Carousel tanpa gulir: posisi "pos" (indeks kartu, pecahan saat bergeser) diubah oleh jari/luncuran, lalu tiap kartu
  // ditempatkan dengan transform. Berputar: jarak kartu ke tengah dihitung melingkar (modulo jumlah kartu), jadi
  // dari #10 ke #1 tidak ada lompatan posisi / salinan kartu (dulu daftar digambar 3× dan scrollLeft dilompatkan
  // diam-diam di ujung → di WebView sempat 1 frame kartu bertumpuk & mahkota berkedip).
  const cards = [...box.querySelectorAll(".cf-card")], n = cards.length; if (!n) return;
  box.classList.add("cfx");
  const short = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let step = 0, pos = 0, on = null, anim = 0, drag = null, moved = false;
  // Parallax: sampul di dalam kartu bergeser sedikit berlawanan arah dengan kartunya (seperti dilihat lewat jendela).
  // Sampul diperbesar 1,24× supaya geserannya tidak pernah memperlihatkan tepi. Mati saat "Hapus animasi".
  const pics = cards.map((c) => c.querySelector(".cf-in .cover img")), PX = short ? 0 : 0.08;
  const measure = () => { step = (cards[0].offsetWidth || 200) + 10; };
  const off = (k) => { let d = k - pos; if (loop) { d = ((d % n) + n) % n; if (d > n / 2) d -= n; } return d; };
  const tick = () => {
    if (!step) measure();
    for (let k = 0; k < n; k++) {
      const el = cards[k], d = off(k), a = Math.abs(d);
      if (a > 2.6) { if (el.style.visibility !== "hidden") el.style.visibility = "hidden"; continue; }
      el.style.visibility = "";
      const m = Math.min(1, a);
      el.style.transform = `translate3d(${(d * step).toFixed(2)}px,0,0) scale(${(1 - m * 0.15).toFixed(4)})`;
      el.style.opacity = (1 - m * 0.5).toFixed(3); el.style.zIndex = String(10 - Math.round(a * 2));
      const pic = pics[k]; if (pic && PX) pic.style.transform = `translate3d(${(-Math.max(-1.3, Math.min(1.3, d)) * PX * (step - 10)).toFixed(1)}px,0,0) scale(1.24)`;
    }
    const i = loop ? ((Math.round(pos) % n) + n) % n : Math.max(0, Math.min(n - 1, Math.round(pos)));
    const best = cards[i];
    if (best !== on) { on?.classList.remove("on"); best.classList.add("on"); on = best; }
  };
  const norm = () => { if (loop) pos = ((pos % n) + n) % n; };
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const glide = (to) => {
    cancelAnimationFrame(anim);
    if (!loop) to = Math.max(0, Math.min(n - 1, to));
    const from = pos, dist = to - from;
    if (Math.abs(dist) < 0.002) { pos = to; norm(); tick(); return; }
    const t0 = performance.now(), dur = short ? 140 : Math.min(520, Math.max(260, 380 * Math.min(1.6, Math.abs(dist))));
    const frame = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      pos = from + dist * ease(k); tick();
      if (k < 1) anim = requestAnimationFrame(frame); else { anim = 0; pos = to; norm(); tick(); }
    };
    anim = requestAnimationFrame(frame);
  };
  // Geser dengan jari: touch events, touchmove tidak-pasif. Begitu gerakan condong mendatar, gulir halaman dicegah
  // dan kartu mengikuti jari; gerakan condong tegak dibiarkan menggulir halaman. Mouse (web) lewat pointer events.
  const start = (x, y) => { cancelAnimationFrame(anim); anim = 0; drag = { x, y, p: pos, h: false, v: false, pts: [[x, performance.now()]] }; moved = false; };
  const move = (x, y, e) => {
    if (!drag || drag.v) return;
    const dx = x - drag.x, dy = y - drag.y;
    if (!drag.h) {
      if (Math.abs(dx) < 7 && Math.abs(dy) < 7) return;
      if (Math.abs(dx) < Math.abs(dy) * 0.85) { drag.v = true; return; }
      drag.h = true; moved = true; drag.x = x; drag.p = pos;
    }
    if (e?.cancelable) e.preventDefault();
    let p = drag.p - (x - drag.x) / step;
    if (!loop) p = p < 0 ? p / 3 : p > n - 1 ? n - 1 + (p - n + 1) / 3 : p;   // ujung: tertahan seperti karet
    pos = p; tick();
    drag.pts.push([x, performance.now()]); if (drag.pts.length > 6) drag.pts.shift();
  };
  box.addEventListener("touchstart", (e) => { if (e.touches.length !== 1) { drag = null; return; } const t = e.touches[0]; start(t.clientX, t.clientY); }, { passive: true });
  box.addEventListener("touchmove", (e) => { if (e.touches.length !== 1) return; const t = e.touches[0]; move(t.clientX, t.clientY, e); }, { passive: false });
  box.addEventListener("touchend", () => release()); box.addEventListener("touchcancel", () => release());
  box.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse" || e.button > 0) return; start(e.clientX, e.clientY); try { box.setPointerCapture(e.pointerId); } catch {} });
  box.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") move(e.clientX, e.clientY, e); });
  box.addEventListener("pointerup", (e) => { if (e.pointerType === "mouse") release(); });
  function release() {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.h) { if (anim === 0 && pos !== Math.round(pos)) glide(Math.round(pos)); return; }
    const [a, b] = [d.pts[0], d.pts[d.pts.length - 1]], v = (b[0] - a[0]) / Math.max(1, b[1] - a[1]);   // px/ms
    let i = Math.abs(v) > 0.35 ? (v < 0 ? Math.floor(pos) + 1 : Math.ceil(pos) - 1) : Math.round(pos);
    if (Math.abs(v) > 1.4) i += v < 0 ? 1 : -1;                    // kibasan cepat: sampai 2 kartu
    glide(i);
  }
  box.addEventListener("dragstart", (e) => e.preventDefault());
  box.addEventListener("click", (e) => {
    if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; return; }   // akhir geseran bukan ketukan
    const c = e.target.closest(".cf-card"); if (!c || e.target.closest(".cv-re")) return;
    if (c.classList.contains("on")) return;
    e.preventDefault(); glide(pos + Math.round(off(cards.indexOf(c))));
  });
  addEventListener("resize", () => { if (!box.isConnected) return; measure(); tick(); }, { passive: true });
  measure(); tick();
}
export async function vHome() {
  const name = S.state.profile?.name || (S.loggedIn() ? "" : "Pembaca");
  let qi = Math.floor(Math.random() * QUOTES.length);
  const last = S.history()[0];
  view.innerHTML = `
<header class="top"><img class="logo" src="icons/logo.png" alt="Ninokuu" width="110" height="34">
  <span class="top-r"><a class="gl-btn gl-chat${O.count() ? " on" : ""}" id="chatBtn" href="#/chat" aria-label="Chat publik${O.count() ? ` · ${O.count()} pembaca aktif` : ""}">${icon("msg", 20)}<span class="onl-n" id="onlN"><i></i><b>${O.count() || ""}</b></span><span class="c-dot" id="chatDot" hidden></span></a><button class="gl-btn" data-act="bell" aria-label="Notifikasi" aria-expanded="false">${icon("bell", 21)}<span class="bell-n" id="bellN" hidden></span></button></span></header>
<section class="hello"><h1>${greeting()}${name ? `, <span class="gold">${esc(name)}</span>` : ""}</h1>
  <button class="quote" data-act="quote" title="Ketuk untuk kutipan lain">“${esc(QUOTES[qi])}”</button></section>
${last ? `<section class="sec s16"><h2 class="cap">Lanjut baca</h2>
  <a class="resume" href="${last.chapter_id ? readHref(last.source, last.comic_id, last.chapter_id) : comicHref(last.source, last.comic_id)}">${cover(last.cover, last.title, "rs")}
    <span class="rc-mid g6"><span class="meta"><span class="tag-s">${esc(srcName(last.source))}</span>${last.type ? `<span>${esc(typeName(last.type))}</span>` : ""}</span>
      <span class="rs-t">${esc(last.title)}</span>
      <span class="mu sm">Chapter ${esc(last.chapter)}${last.pages ? ` · halaman ${Number(last.page) || 1} dari ${Number(last.pages) || 0}` : ""}</span>
      <span class="prog"><span style="width:${pct(last.page || 1, last.pages || 0) || 6}%"></span></span></span>
    <span class="play">${icon("play", 19, 2)}</span></a></section>` : ""}
<section class="sec s26 nox"><div class="sec-h px"><h2>Top 10 populer</h2><span class="mu sm">${esc(srcName(homeSrc))}</span></div><div class="cf" id="pop"><div class="cf-sk sk"></div><div class="cf-sk sk"></div><div class="cf-sk sk"></div></div></section>
<section class="sec s24"><h2>Jelajah kategori</h2><div class="cats">
  ${[["manga", "Jepang"], ["manhwa", "Korea"], ["manhua", "Tiongkok"]].map(([t, c]) => `<a class="cat" href="#/search/${t}"><span class="flag f-${t}"></span><span class="col"><b>${typeName(t)}</b><span class="mu xs">${c}</span></span></a>`).join("")}
  <a class="cat" href="#/search"><span class="cat-ic">${icon("search", 20)}</span><span class="col"><b>Semua</b><span class="mu xs">Cari judul</span></span></a>
</div></section>
<section class="sec s26"><div class="sec-h"><h2 id="updH">${esc(SORT_NAME[homeSortOf(homeSrc)])}</h2><span class="row g8"><a class="link-red" href="#/search">Lihat semua</a><button class="sq-btn" data-act="hsort" aria-label="Urutkan">${icon("sort", 18, 2)}</button>${viewBtn(S.state.settings.updView === "grid", "updView")}</span></div>
  ${seg(SOURCES, homeSrc, "src", "src")}
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
  setCleanup(() => io.disconnect());
  const loadPop = async () => {
    const src = homeSrc;
    try {
      const r = await browse(src, { sort: "popular", page: 1, limit: 10 });
      if (src !== homeSrc || !$("#pop")) return;
      const pop = $("#pop"), top = r.items.slice(0, 10);
      // Top 10 gaya NinoNime: carousel tengah. Kartu di tengah besar & menyala (warna peringkat), kiri-kanan mengecil
      // & meredup; judul + bintang di dalam kartu, nomor peringkat kiri atas, skor kanan atas, mahkota di peringkat 1.
      const card = (it, i) => {
        const sc = Number(it.score), stars = !NO_SCORE.has(src) && sc > 0 && sc <= 10;
        return `<a class="cf-card ${i < 3 ? "r" + (i + 1) : ""}" aria-label="Peringkat ${i + 1}: ${esc(it.title)}" href="${comicHref(src, it.id)}">
        ${i === 0 ? `<span class="cf-crown">${CROWN}</span>` : ""}<span class="cf-in">${cover(it.cover, it.title, "cf")}<span class="cf-shade"></span>
        <span class="cf-rank" aria-hidden="true">${i + 1}</span>${scoreTag(it, src)}
        <span class="cf-info"><b class="cf-t">${esc(it.title)}</b>${stars ? `<span class="cf-stars" style="--p:${Math.round(sc * 10)}%" aria-hidden="true">★★★★★</span>` : `<span class="cf-sub">${esc(typeName(it.type) || srcName(src))}</span>`}</span></span></a>`;
      };
      // berputar tanpa ujung (≥ 4 kartu): cukup digambar sekali, posisinya melingkar (lihat coverflow)
      pop.innerHTML = !top.length ? `<span class="mu sm px">Belum ada data</span>` : top.map(card).join("");
      if (top.length) coverflow(pop, top.length >= 4 ? top.length : 0);
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
