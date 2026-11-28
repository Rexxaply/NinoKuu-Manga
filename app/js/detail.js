// Info komik & daftar chapter: detail + cache, Lanjut baca, pindah sumber, Mirip ini, komentar terbaru,
// daftar chapter lengkap. Dipecah dari main.js; perilaku sama persis.
import * as api from "./api.js";
import * as S from "./store.js";
import * as N from "./native.js";
import * as X from "./exp.js";
import * as DL from "./dl.js";
import { loadFilters } from "./filters.js";
import { bindSpoilers, watchAvatars, miniMsg, roomFor, roomPreview, roomCount, framesReady } from "./chat.js";
import { esc, icon, $, $$, toast, ago, SOURCES, srcName, typeName, cover, comicHref, readHref, errBox, loading, ask } from "./ui.js";

// dari main.js (router, lembar, pengaturan, halaman lain) — diisi sekali lewat bindDetail() sebelum halaman pertama tampil
let detailCache, normQ, matchQ, openSheet, closeSheet, go, goReplace, typeFromTags, view, parse, setActs, back, backTo, compactNum, NO_SCORE, scoreTag, commentsHref, dlOpen, openReport, shelfSheet, topbar, setCleanup;
export function bindDetail(c) { ({ detailCache, normQ, matchQ, openSheet, closeSheet, go, goReplace, typeFromTags, view, parse, setActs, back, backTo, compactNum, NO_SCORE, scoreTag, commentsHref, dlOpen, openReport, shelfSheet, topbar, setCleanup } = c); }

/* ---------- Detail komik ---------- */
const byCh = (a, b) => (parseFloat(a.ch) || 0) - (parseFloat(b.ch) || 0);
const saveDetail = (k, data) => { try { sessionStorage.setItem("ninokuu:d:" + k, JSON.stringify(data)); } catch {} };
// posisi baca tanpa id chapter (impor dari aplikasi lain / sinkron dari perangkat lain): dicocokkan lewat nomor chapter
function histFill(src, id, d) {
  const h = S.histItem(src, id); if (!h || h.chapter_id || h.chapter == null || !d?.chapters?.length) return;
  const n = parseFloat(h.chapter);
  const c = d.chapters.find((x) => String(x.ch) === String(h.chapter)) || (Number.isFinite(n) ? d.chapters.find((x) => parseFloat(x.ch) === n) : null);
  if (c) S.fillHistChapter(src, id, c.id);
}
export async function getDetail(src, id, force = false) {
  const k = src + "|" + id;
  const c = detailCache.get(k);
  if (c && !force && Date.now() - c.at < 10 * 60e3) { fillMore(src, id, c.data); histFill(src, id, c.data); return c.data; }
  const data = await api.call("detail", { source: src, comic_id: id });
  data.chapters = (data.chapters || []).slice().sort(byCh);
  detailCache.set(k, { at: Date.now(), data });
  saveDetail(k, data);
  fillMore(src, id, data);
  histFill(src, id, data);
  return data;
}
// Buka chapter sesudah chapter yang terakhir dibaca (dipakai lencana +N di Koleksi & tombol di Riwayat).
// Memakai detail yang tersimpan dulu; bila chapter berikutnya belum ada di situ, ambil daftar terbaru.
// same = buka chapter itu sendiri (tombol Lanjut pada riwayat tanpa id chapter, mis. hasil impor)
export async function openNextChapter(src, id, chId, chNum, el, same = false) {
  if (el?.classList.contains("busy")) return;
  el?.classList.add("busy");
  const find = (d) => { const chs = d?.chapters || []; let i = chId ? chs.findIndex((c) => c.id === chId) : -1; if (i < 0 && chNum != null && chNum !== "") i = chs.findIndex((c) => String(c.ch) === String(chNum)); return i >= 0 ? chs[i + (same ? 0 : 1)] || null : undefined; };
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
  else openNextChapter(b.dataset.src, b.dataset.id, b.dataset.ch, b.dataset.n, b, b.dataset.same != null);
}, true);
export function cachedDetail(src, id) {
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
// ---------- pindah sumber ----------
// Cari judul yang sama di sumber lain. Dari koleksi: pindahkan koleksi, lonceng, rak, posisi baca (chapter dengan nomor
// yang sama), dan tanda chapter yang sudah dibaca. Tanpa koleksi: cukup buka komiknya di sumber lain.
const titleQ = (t) => String(t || "").split(/\s[~(\[|–—:]|\s-\s|[~(\[]/)[0].trim().split(/\s+/).slice(0, 6).join(" ");
function migrateSheet(src, id, m) {
  const inLib = S.inLib(src, id), q = titleQ(m.title), want = normQ(m.title);
  const others = SOURCES.filter((x) => x.id !== src);
  const el = openSheet(`<span class="sheet-ttl">${inLib ? "Pindah sumber" : "Cari di sumber lain"}</span>
    <span class="sheet-prev">${inLib ? "Koleksi, lonceng, rak, dan posisi baca ikut pindah." : "Buka komik ini dari sumber lain."} Pencarian: “${esc(q)}”</span>
    <div class="mg-list">${others.map((x) => `<div class="mg-src"><span class="mg-h"><i class="fa-dot s-${esc(x.id)}"></i>${esc(x.name)}</span><div class="mg-res" data-src="${esc(x.id)}"><span class="mu xs">Mencari…</span></div></div>`).join("")}</div>`,
  async (b) => {
    if (b.dataset.s !== "pick") return;
    const to = { source: b.dataset.src, comic_id: b.dataset.id, title: b.dataset.t, cover: b.dataset.c };
    if (!inLib) { closeSheet(); go(comicHref(to.source, to.comic_id)); return; }
    closeSheet();
    if (!(await ask(`Pindahkan “${m.title}” dari ${srcName(src)} ke ${srcName(to.source)}?\nKoleksi, lonceng, rak, posisi baca, dan tanda chapter yang sudah dibaca ikut pindah.`, { ok: "Pindahkan" }))) return;
    toast("Memindahkan…", 8000);
    try { await migrateComic(src, id, to); toast(`Dipindah ke ${srcName(to.source)}`); goReplace(comicHref(to.source, to.comic_id)); }
    catch (e) { toast(e.message || "Gagal memindahkan", 4000); }
  });
  // urutan hasil: judul persis sama dulu, lalu yang memuat semua kata pencarian
  const rank = (it) => { const t = normQ(it.title), a = normQ(it.alt || ""); return t === want || a.includes(want) ? 0 : matchQ(q)(it) ? 1 : 2; };
  for (const x of others) {
    api.call("browse", { source: x.id, q, type: "", status: "", genres: [], sort: "update", page: 1, limit: 12 }).then((r) => {
      const box = el.querySelector(`.mg-res[data-src="${x.id}"]`); if (!box || !el.isConnected) return;
      const list = (r.items || []).map((it) => [rank(it), it]).filter(([k]) => k < 2).sort((a, b) => a[0] - b[0]).slice(0, 4).map(([, it]) => it);
      box.innerHTML = list.length ? list.map((it) => `<button class="mg-it" data-s="pick" data-src="${esc(x.id)}" data-id="${esc(it.id)}" data-t="${esc(it.title)}" data-c="${esc(it.cover || "")}">${cover(it.cover, it.title, "sm")}<span class="grow t2">${esc(it.title)}</span><span class="redt sm">${inLib ? "Pindah" : "Buka"}</span></button>`).join("")
        : `<span class="mu xs">Tidak ditemukan</span>`;
    }).catch(() => { const box = el.querySelector(`.mg-res[data-src="${x.id}"]`); if (box) box.innerHTML = `<span class="mu xs">Sumber ini sedang tidak bisa dicari</span>`; });
  }
}
async function migrateComic(src, id, to) {
  const old = S.libItem(src, id), hist = S.histItem(src, id);
  const [od, nd] = await Promise.all([getDetail(src, id).catch(() => null), getDetail(to.source, to.comic_id)]);
  const num = (c) => { const n = parseFloat(c?.ch); return Number.isFinite(n) ? n : null; };
  const byNum = new Map(nd.chapters.map((c) => [num(c), c]).filter(([n]) => n != null));
  const nm = nd.manga || {}, latest = nd.chapters[nd.chapters.length - 1];
  const meta = { source: to.source, comic_id: to.comic_id, title: nm.title || to.title, cover: nm.cover || to.cover };
  // 1. koleksi baru (lonceng & rak ikut), baru setelah itu yang lama dilepas
  if (!S.inLib(to.source, to.comic_id)) await S.toggleLib(meta);
  S.updateLibMeta(to.source, to.comic_id, { type: typeFromTags(nm.tags), latest: latest?.ch ?? null, latestAt: latest?.at ?? null });
  if (old?.notify && S.loggedIn()) await S.setNotify(meta, true).catch(() => {});
  if (old?.shelf) await S.setShelf(to.source, to.comic_id, old.shelf).catch(() => {});
  // 2. tanda chapter yang sudah dibaca: dicocokkan lewat nomor chapter
  if (od) {
    const rs = S.chReadSet(src, id), ids = [];
    for (const c of od.chapters) if (rs.has(c.id)) { const t = byNum.get(num(c)); if (t) ids.push(t.id); }
    if (ids.length) S.mergeReadChs(to.source, to.comic_id, ids);
  }
  // 3. posisi baca: chapter dengan nomor yang sama di sumber baru
  const at = hist && byNum.get(parseFloat(hist.chapter));
  if (at) S.saveHistory({ source: to.source, comic_id: to.comic_id, title: meta.title, cover: meta.cover, type: typeFromTags(nm.tags), chapter: at.ch, chapter_id: at.id, page: 1, pages: 0 });
  if (old) await S.toggleLib({ source: src, comic_id: id, title: old.title, cover: old.cover });
}
// ---------- mirip ini: komik populer dengan genre yang sama dari sumber yang sama ----------
const simMem = new Map();
const cmMem = new Map();   // pratinjau komentar terakhir per komik (src|id → { l, n })
async function similarOf(src, id, tags) {
  const k = src + "|" + id; if (simMem.has(k)) return simMem.get(k);
  const f = await loadFilters(src).catch(() => null);
  const byName = new Map((f?.genres || []).map((g) => [normQ(g.name), g.id]));
  const ids = (tags || []).map((t) => byName.get(normQ(t))).filter(Boolean);
  if (!ids.length) { simMem.set(k, []); return []; }
  let items = [];
  // dua genre pertama dulu (lebih mirip); bila terlalu sedikit, cukup genre pertama
  for (const g of src === "komiku" ? [ids.slice(0, 1)] : [ids.slice(0, 2), ids.slice(0, 1)]) {
    const r = await api.call("browse", { source: src, q: "", type: "", status: "", genres: g, sort: "popular", page: 1, limit: 18 }).catch(() => null);
    items = (r?.items || []).filter((it) => it.id !== id);
    if (items.length >= 6 || g.length === 1) break;
  }
  items = items.slice(0, 12); simMem.set(k, items); if (simMem.size > 30) simMem.delete(simMem.keys().next().value);
  return items;
}
// halaman komik: latar berhenti di baris tombol "Mulai baca"
function fitDetail() {
  const bg = $("#dtbg"), row = $(".act-row");
  if (bg && row) bg.style.height = Math.round(row.getBoundingClientRect().bottom - view.getBoundingClientRect().top + 28) + "px";
}
addEventListener("resize", () => { if (parse().name === "detail") fitDetail(); });
export async function vDetail(src, id) {
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
    // Komiku tidak punya skor komik (data lama di cache bisa masih membawa skor yang salah)
    const score = !NO_SCORE.has(src) && Number(m.score) > 0 ? (Math.round(Number(m.score) * 10) / 10).toFixed(1).replace(".", ",") : "";
    const age = src === "komiku" && /^\d{1,2}\+$/.test(String(m.age || "")) ? String(m.age) : "";
    // satu baris info ringkas di bawah judul; yang tidak tersedia dari sumber tidak ditampilkan
    const infoLine = [score && `<span class="inf-score" title="Skor di situs sumber (dari 10)">${icon("star", 14, 2)}<b>${esc(score)}</b></span>`,
      age && `<span class="inf-age${age === "18+" ? " adult" : ""}" title="Batas umur pembaca di situs sumber">${esc(age)}</span>`, ST && `<span class="inf-st inf-${ST[1]}">${esc(ST[0])}</span>`, views && `<span title="Dilihat di situs sumber">${icon("eye", 14)}${esc(views)}</span>`,
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
  <div class="dt-tools">${fav ? `<button class="dt-chip${S.libItem(src, id)?.shelf ? " on" : ""}" data-act="shelf">${icon("folder", 16)}<span class="t1">${esc(S.libItem(src, id)?.shelf || "Simpan di rak")}</span></button>` : ""}<button class="dt-chip" data-act="migrate">${icon("swap", 16)}<span>${fav ? "Pindah sumber" : "Cari di sumber lain"}</span></button></div>
  ${m.tags?.length ? `<div class="tags">${m.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
  <p class="syn-h">Sinopsis <b>${esc(m.title)}</b></p>
  ${m.desc ? `<p class="desc ${descOpen ? "open" : ""}" data-act="desc">${esc(m.desc)}</p>` : `<p class="desc mu">Belum ada sinopsis dari sumber.</p>`}
  <div class="sec-h mt24"><h2>Chapter</h2><a class="link-red" href="${chaptersHref(src, id)}">Lihat semua (${d.chapters.length})${icon("chev", 16, 2)}</a></div>
  <div class="ch-card">${preview.map((c) => chRow(c)).join("") || `<div class="empty"><b>Belum ada chapter</b></div>`}</div>
  <div id="simsec">${simHtml()}</div>
  <div id="cmsec">${cmHtml()}</div>
</div><div style="height:calc(120px + env(safe-area-inset-bottom))"></div>
<div class="rfab-wrap"><a class="rfab glass" href="${resumeCh ? readHref(src, id, resumeCh.id) : first ? readHref(src, id, first.id) : chaptersHref(src, id)}"><span class="rfab-ic">${icon("play", 18, 2)}</span><b class="redt">${resumeCh ? "Lanjut baca" : "Mulai baca"}</b><span class="grow">${resumeCh ? "Chapter " + esc(resumeCh.ch) : first ? "Chapter " + esc(first.ch) : ""}</span><span class="redt">${icon("chev", 20, 2)}</span></a></div>`;
    bindSpoilers($("#cmprev")); watchAvatars($("#cmprev"));
    // latar mengikuti warna cover (dihitung sekali, lalu disimpan)
    if (!heroCol) X.coverColor(m.cover).then((c) => { const el = $("#dtbg"); if (c && el && parse().name === "detail") { el.style.setProperty("--hc", c); el.classList.add("tinted"); } });
    onBarScroll();
    fitDetail();
    watchSim();
  };
  // kembali ke halaman ini: "Mirip ini" & komentar langsung digambar dari ingatan (tidak muncul kerangka lalu meloncat);
  // komentar tetap diperbarui di belakang, digambar ulang hanya bila berubah
  const cmKey = src + "|" + id, cmOld = cmMem.get(cmKey);
  let cmList = cmOld ? cmOld.l : null, cmN = cmOld ? cmOld.n : 0, lk = null, lkBusy = false, sim = simMem.has(cmKey) ? simMem.get(cmKey) : null;
  // "Mirip ini": dimuat saat bagiannya hampir terlihat (hemat permintaan untuk yang tidak menggulir sejauh itu)
  function simHtml() {
    if (sim && !sim.length) return "";
    return `<div class="sec-h mt24"><h2>Mirip ini</h2><span class="mu sm">${esc(srcName(src))} · genre sama</span></div>
  <div class="hs sim-row">${sim === null ? loading(3, "sk-top") : sim.map((it) => `<a class="top10" href="${comicHref(src, it.id)}"><span class="t10-cv">${cover(it.cover, it.title, "top")}${scoreTag(it, src)}</span><span class="t10-t"><b class="t2">${esc(it.title)}</b></span></a>`).join("")}</div>`;
  }
  const paintSim = () => { const el = $("#simsec"); if (el) el.innerHTML = simHtml(); };
  let simIo = null;
  const watchSim = () => {
    if (sim !== null || simIo) return;
    const el = $("#simsec"); if (!el) return;
    simIo = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      simIo.disconnect();
      similarOf(src, id, m.tags).then((l) => { sim = l; if (parse().name === "detail") paintSim(); }).catch(() => { sim = []; paintSim(); });
    }, { rootMargin: "300px 0px" });
    simIo.observe(el);
  };
  // bagian komentar digambar terpisah: saat komentar datang, hanya bagian ini yang diganti
  // (sebelumnya seluruh halaman digambar ulang → gambar sampul & latar sempat berkedip)
  function cmHtml() { return `  <div class="sec-h mt24"><h2>Komentar${cmN ? ` <span class="mu cm-n">${cmN}</span>` : ""}</h2><a class="link-red" href="${commentsHref(src, id)}">${cmN ? "Lihat semua" : "Tulis komentar"}${icon("chev", 16, 2)}</a></div>
  <div class="cm-card" id="cmprev">${cmList === null ? `<div class="mu sm cm-empty">Memuat komentar…</div>` : cmList.length ? cmList.map(miniMsg).join("") + `<a class="cm-more" href="${commentsHref(src, id)}">${icon("msg", 17)}Buka semua komentar</a>`
    : `<a class="cm-empty" href="${commentsHref(src, id)}">${icon("msg", 20)}<span class="rc-mid g4"><b class="sm">Belum ada komentar</b><span class="mu xs">Jadilah yang pertama berkomentar tentang komik ini.</span></span></a>`}</div>`; }
  const paintComments = () => { const el = $("#cmsec"); if (!el) return draw(); el.innerHTML = cmHtml(); bindSpoilers($("#cmprev")); watchAvatars($("#cmprev")); };
  const paintLike = () => { const b = $("[data-act=like]"); if (b) b.outerHTML = likeBtn(lk); };
  S.likeInfo(src, id, "").then((i) => { if (i && parse().name === "detail") { lk = i; paintLike(); } });
  // Parallax latar: sampul buram di belakang judul bergerak lebih lambat dari isi halaman (45% kecepatan gulir) dan
  // perlahan memudar, jadi terasa di lapisan belakang. Hanya transform + opacity (ringan); mati saat "Hapus animasi".
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let pxRaf = 0;
  const paintBg = () => {
    pxRaf = 0; const bg = $("#dtbg"); if (!bg) return;
    const y = Math.max(0, window.scrollY);
    if (y > 900) { if (bg.style.opacity !== "0.3") { bg.style.transform = "translate3d(0,405px,0)"; bg.style.opacity = "0.3"; } return; }
    bg.style.transform = `translate3d(0,${(y * 0.45).toFixed(1)}px,0)`; bg.style.opacity = Math.max(0.3, 1 - y / 650).toFixed(3);
  };
  const onBarScroll = () => {
    const b = $("#dbar"); if (b) b.classList.toggle("solid", window.scrollY > 120);
    if (!still && !pxRaf) pxRaf = requestAnimationFrame(paintBg);
  };
  window.addEventListener("scroll", onBarScroll, { passive: true });
  const onMore = (e) => { if (e.detail.key === src + "|" + id && parse().name === "detail") { const y = window.scrollY; draw(); window.scrollTo(0, y); } };
  window.addEventListener("nk:chapters", onMore);
  setCleanup(() => { window.removeEventListener("scroll", onBarScroll); window.removeEventListener("nk:chapters", onMore); simIo?.disconnect(); });
  const room = roomFor(src, id);
  Promise.all([roomPreview(room, 3), roomCount(room).catch(() => 0), new Promise((r) => setTimeout(r, 450)).then(framesReady)]).then(([l, n]) => { const same = cmOld && cmOld.n === n && JSON.stringify(cmOld.l) === JSON.stringify(l); cmMem.set(cmKey, { l, n }); if (cmMem.size > 30) cmMem.delete(cmMem.keys().next().value); if (same) return; cmList = l; cmN = n; if (parse().name === "detail") paintComments(); })
    .catch(() => { if (cmOld) return; cmList = []; if (parse().name === "detail") paintComments(); });
  setActs({
    back: () => back(),
    retry: () => vDetail(src, id),
    desc: (el) => { descOpen = !descOpen; el.classList.toggle("open", descOpen); },
    dl: dlOpen(src, id),
    report: () => openReport({ source: src, comic_id: id, title: m.title }),
    shelf: () => shelfSheet(src, id, draw),
    migrate: () => migrateSheet(src, id, m),
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

export const chLike = (lk) => `<button class="btn ghost rlike like-b ${lk?.liked ? "on" : ""}" data-act="like" aria-pressed="${!!lk?.liked}">${icon(lk?.liked ? "thumbF" : "thumb", 18)}${lk?.liked ? "Kamu suka chapter ini" : "Suka chapter ini"}${lk?.n ? `<span class="cm-n">${lk.n}</span>` : ""}</button>`;
// tombol like (komik di detail, chapter di pembaca); angka = jumlah like semua pembaca
const likeBtn = (lk, cls = "round-btn") => `<button class="${cls} like-b ${lk?.liked ? "on" : ""}" data-act="like" aria-pressed="${!!lk?.liked}" aria-label="${lk?.liked ? "Batal suka" : "Suka"}">${icon(lk?.liked ? "thumbF" : "thumb", 21)}${lk?.n ? `<span class="lk-n">${lk.n > 999 ? (lk.n / 1000).toFixed(1).replace(".0", "") + "rb" : lk.n}</span>` : ""}</button>`;
// cari chapter: angka dicocokkan PERSIS (ketik 1 → hanya chapter 1, bukan 10/100/1000);
// selain angka dicocokkan ke judul chapter
export function matchCh(c, q) {
  q = String(q || "").trim().toLowerCase().replace(",", ".");
  if (!q) return true;
  const num = (q.match(/\d+(?:\.\d+)?/) || [""])[0];
  if (num) return parseFloat(c.ch) === parseFloat(num);
  return (c.title || "").toLowerCase().includes(q);
}
export const chaptersHref = (src, id) => `#/ch/${src}/${encodeURIComponent(id)}`;
// baris chapter: BARU (rilis < 3 hari), TERAKHIR DIBACA, centang bila sudah lewat
function chRowFor(src, id, h, latest) {
  const rs = S.chReadSet(src, id);
  return (c, timeline = false) => {
    const cur = h?.chapter_id === c.id;
    const isNew = !cur && c.at && Date.now() - Date.parse(c.at) < 3 * 864e5;
    // sudah dibaca = chapter itu pernah dibuka (bukan sekadar nomornya di bawah chapter terakhir dibaca)
    const read = !cur && rs.has(c.id);
    const ic = cur ? icon("bookmark", 17, 2) : isNew ? icon("star", 17) : read ? icon("eye", 17) : icon("circle", 15);
    return `<a class="ch ${timeline ? "tl" : ""} ${cur ? "cur" : ""} ${read ? "read" : ""}" href="${readHref(src, id, c.id)}">${timeline ? `<span class="tl-ic ${cur ? "cur" : isNew ? "new" : read ? "read" : ""}">${ic}</span>` : ""}
      <span class="col grow"><b>Chapter ${esc(c.ch ?? "?")}</b><span class="mu xs">${esc(c.title ? c.title + " · " : "")}${esc(ago(c.at))}</span></span>
      ${isNew ? `<span class="badge-s new">BARU</span>` : ""}${cur ? `<span class="badge-s cur">TERAKHIR DIBACA</span>` : ""}${DL.isSaved(src, id, c.id) ? `<span class="dl-mark" aria-label="Tersimpan di HP">${icon("down", 15, 2.2)}</span>` : ""}${read && !timeline ? `<span class="ok">${icon("check", 18, 2.2)}</span>` : ""}
      <span class="mu">${icon("chev", 16)}</span></a>`;
  };
}
export async function vChapters(src, id) {
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
  // Keyboard masih terbuka lalu chapter langsung diketuk: jangan biarkan sentuhan itu melepas fokus kolom cari dulu.
  // Dulu fokus lepas → kolom cari turun ke bawah & daftar bergeser sebelum jari diangkat, jadi ketukannya meleset
  // dan chapter baru terbuka di ketukan kedua. Kini fokus ditahan; ketukan langsung membuka chapter (keyboard
  // tertutup sendiri saat pindah ke pembaca).
  const keep = (e) => { if (document.activeElement === inp && e.target.closest?.("#chl a.ch")) e.preventDefault(); };
  document.addEventListener("pointerdown", keep, true);
  document.addEventListener("mousedown", keep, true);
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
  setCleanup(() => { io.disconnect(); window.removeEventListener("nk:chapters", onMore); window.removeEventListener("nk:kb", onKb); (vv || window).removeEventListener("resize", onVV); window.removeEventListener("touchstart", tstart); window.removeEventListener("touchmove", drop); window.removeEventListener("wheel", drop); document.removeEventListener("click", guard, true); document.removeEventListener("pointerdown", keep, true); document.removeEventListener("mousedown", keep, true); document.body.classList.remove("chfoc"); });
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
