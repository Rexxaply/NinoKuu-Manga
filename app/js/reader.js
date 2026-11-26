// Pembaca chapter (mode gulir & slide): halaman, zoom + efek jeli, gulir otomatis, pindah chapter, bagikan
// halaman / pilih bagian. Dipecah dari main.js; perilaku sama persis.
import * as api from "./api.js";
import * as S from "./store.js";
import * as N from "./native.js";
import * as DL from "./dl.js";
import { roomCount, roomFor } from "./chat.js";
import { esc, icon, $, $$, toast, ago, comicHref, readHref, errBox } from "./ui.js";

// dari main.js (router, lembar, pengaturan, halaman lain) — diisi sekali lewat bindReader() sebelum halaman pertama tampil
let parse, cachedDetail, view, back, backTo, chaptersHref, setActs, getDetail, typeFromTags, chLike, commentsHref, readPrefsCompact, soon, openSheet, closeSheet, sheet, setCleanup, choiceVal, openReport, flipToggle, flipChoice, goReplace, matchCh;
export function bindReader(c) { ({ parse, cachedDetail, view, back, backTo, chaptersHref, setActs, getDetail, typeFromTags, chLike, commentsHref, readPrefsCompact, soon, openSheet, closeSheet, sheet, setCleanup, choiceVal, openReport, flipToggle, flipChoice, goReplace, matchCh } = c); }

/* ---------- Pembaca (gulir atau slide), tampilan sama seperti prototipe ---------- */
const pagesMem = new Map(), pagesWait = new Map();
// daftar halaman chapter: dari ingatan (30 mnt), atau ikut menunggu permintaan yang sedang berjalan (mis. dimulai saat
// jari baru menyentuh baris chapter), atau minta ke server. Dipakai pembaca & pengambilan awal.
export function pagesLoad(src, chId) {
  const pk = src + "|" + chId, pc = pagesMem.get(pk);
  if (pc && Date.now() - pc.t < 30 * 60e3) return Promise.resolve(pc.p);
  if (pagesWait.has(pk)) return pagesWait.get(pk);
  const pr = api.call("pages", { source: src, chapter_id: chId }).then((p) => {
    if (p?.images?.length) { pagesMem.set(pk, { p, t: Date.now() }); if (pagesMem.size > 12) pagesMem.delete(pagesMem.keys().next().value); }
    return p;
  }).finally(() => pagesWait.delete(pk));
  pagesWait.set(pk, pr); return pr;
}
// Masuk chapter terasa lebih cepat: daftar halaman mulai diambil begitu jari menyentuh tautan chapter (±100–300 md
// sebelum ketukan selesai & halaman pindah), bukan setelah pembaca dibuka.
document.addEventListener("pointerdown", (e) => {
  const a = e.target.closest?.('a[href^="#/r/"]'); if (!a) return;
  const [, , src, , ch] = a.getAttribute("href").split("/").map(decodeURIComponent);
  if (src && ch && src !== "local") pagesLoad(src, ch).catch(() => {});
}, { capture: true, passive: true });
let readerSeq = 0;
// Memilih bagian gambar untuk dibagikan: gambar selebar layar (bisa digulir), kotak pilihan dengan garis atas/bawah/
// kiri/kanan yang bisa diseret, kotak bisa digeser utuh. Hasil: pecahan { x, y, w, h } dari gambar, atau null (batal).
let rdLast = null, rdBack = false;   // chapter terakhir yang dibuka di pembaca (arah animasi pindah chapter)
let cropClose = null;
// tombol kembali Android: tutup layar pilih bagian bila sedang terbuka
export const closeCrop = () => { if (!cropClose) return false; cropClose(); return true; };
function cropPick(srcUrls, init, label) {
  return new Promise((done) => {
    const host = document.createElement("div");
    host.className = "crop-host"; host.setAttribute("role", "dialog"); host.setAttribute("aria-label", "Pilih bagian gambar");
    host.innerHTML = `<div class="crop-top"><b>Pilih bagian · ${esc(label)}</b><span class="mu xs">Seret garis untuk mengatur, seret kotak untuk memindahkan</span></div>
  <div class="crop-sc"><div class="crop-wrap">${srcUrls.map((u) => `<img class="crop-img" src="${esc(u)}" alt="" draggable="false">`).join("")}
    <b class="crop-dim"></b><b class="crop-dim"></b><b class="crop-dim"></b><b class="crop-dim"></b>
    <div class="crop-box"><i class="ch-t"></i><i class="ch-b"></i><i class="ch-l"></i><i class="ch-r"></i></div></div></div>
  <div class="crop-bar"><button class="btn ghost" data-c="no">Batal</button><button class="btn ghost" data-c="all">Seluruh</button><button class="btn primary" data-c="ok">${icon("share", 17)}Bagikan</button></div>`;
    document.body.append(host);
    const sc = $(".crop-sc", host), wrap = $(".crop-wrap", host), boxEl = $(".crop-box", host), imgs = $$(".crop-img", host);
    host.addEventListener("selectstart", (e) => e.preventDefault()); host.addEventListener("contextmenu", (e) => e.preventDefault());
    let c = { ...init };
    if (c.h > 0.98 && c.w > 0.98) c = { x: 0, y: 0, w: 1, h: 1 };
    // bagian di luar pilihan digelapkan dengan 4 lapisan (atas, bawah, kiri, kanan) yang menutupi seluruh tumpukan
    // halaman; dulu bayangan kotak yang jangkauannya terbatas, sehingga halaman panjang di bawahnya tetap putih
    const dims = $$(".crop-dim", host);
    const pos = (el, l, t, w, h) => { el.style.left = l + "%"; el.style.top = t + "%"; el.style.width = w + "%"; el.style.height = h + "%"; };
    const paint = () => {
      pos(boxEl, c.x * 100, c.y * 100, c.w * 100, c.h * 100);
      pos(dims[0], 0, 0, 100, c.y * 100); pos(dims[1], 0, (c.y + c.h) * 100, 100, (1 - c.y - c.h) * 100);
      pos(dims[2], 0, c.y * 100, c.x * 100, c.h * 100); pos(dims[3], (c.x + c.w) * 100, c.y * 100, (1 - c.x - c.w) * 100, c.h * 100);
    };
    paint();
    const center = () => { const H = wrap.offsetHeight; sc.scrollTop = Math.max(0, (c.y + c.h / 2) * H - sc.clientHeight / 2); };
    // pilihan awal (bagian yang terlihat di pembaca) muat utuh di layar, garis atas & bawahnya langsung terlihat:
    // gambar diperkecil secukupnya (paling kecil setengah lebar layar)
    const fit = () => {
      const R = wrap.offsetHeight / (wrap.offsetWidth || 1), room = sc.clientHeight - 56, full = wrap.parentElement.clientWidth - 36;
      if (R > 0 && c.h * R * full > room) wrap.style.width = Math.max(full * 0.5, room / (c.h * R)) + "px";
      center();
    };
    Promise.all(imgs.map((x) => (x.complete ? 0 : new Promise((r) => { x.onload = x.onerror = r; })))).then(fit);
    const finish = (v) => { cropClose = null; host.classList.add("out"); setTimeout(() => host.remove(), 200); done(v); };
    cropClose = () => finish(null);
    host.addEventListener("click", (e) => { const b = e.target.closest("[data-c]"); if (!b) return;
      finish(b.dataset.c === "ok" ? { ...c } : b.dataset.c === "all" ? { x: 0, y: 0, w: 1, h: 1 } : null); });
    // seret: garis tepi (t/b/l/r) atau kotak utuh (m). Dekat tepi atas/bawah layar → gulir otomatis (halaman panjang).
    let dr = null, auto = 0;
    const MIN = 36;
    const apply = (x, y) => {
      const W = wrap.offsetWidth, H = wrap.offsetHeight, r = wrap.getBoundingClientRect();
      const px = Math.max(0, Math.min(W, x - r.left)), py = Math.max(0, Math.min(H, y - r.top));
      let { x: L, y: T, w, h } = dr.c0; L *= W; T *= H; w *= W; h *= H; let R = L + w, B = T + h;
      if (dr.k === "m") { L = Math.max(0, Math.min(W - w, L + (x - r.left) - dr.px0)); T = Math.max(0, Math.min(H - h, T + (y - r.top) - dr.py0)); R = L + w; B = T + h; }
      else if (dr.k === "t") T = Math.min(py, B - MIN);
      else if (dr.k === "b") B = Math.max(py, T + MIN);
      else if (dr.k === "l") L = Math.min(px, R - MIN);
      else if (dr.k === "r") R = Math.max(px, L + MIN);
      c = { x: L / W, y: T / H, w: (R - L) / W, h: (B - T) / H }; paint();
    };
    const loop = () => {
      if (!dr) { auto = 0; return; }
      const v = sc.getBoundingClientRect(), edge = 70;
      const sp = dr.y < v.top + edge ? -(v.top + edge - dr.y) / 4 : dr.y > v.bottom - edge ? (dr.y - (v.bottom - edge)) / 4 : 0;
      if (sp && dr.k !== "l" && dr.k !== "r") { sc.scrollTop += sp; apply(dr.x, dr.y); }
      auto = requestAnimationFrame(loop);
    };
    boxEl.addEventListener("pointerdown", (e) => {
      const t = e.target.className, k = t === "ch-t" ? "t" : t === "ch-b" ? "b" : t === "ch-l" ? "l" : t === "ch-r" ? "r" : "m";
      const r = wrap.getBoundingClientRect();
      dr = { k, c0: { ...c }, px0: e.clientX - r.left, py0: e.clientY - r.top, x: e.clientX, y: e.clientY };
      try { boxEl.setPointerCapture(e.pointerId); } catch {}
      e.preventDefault(); if (!auto) auto = requestAnimationFrame(loop);
    });
    boxEl.addEventListener("pointermove", (e) => { if (!dr) return; dr.x = e.clientX; dr.y = e.clientY; apply(e.clientX, e.clientY); });
    const up = () => { dr = null; };
    boxEl.addEventListener("pointerup", up); boxEl.addEventListener("pointercancel", up);
    addEventListener("hashchange", () => { if (host.isConnected) finish(null); }, { once: true });
  });
}
export async function vReader(src, id, chId) {
  const shell = (inner) => `<div class="reader ui enter" id="rd" data-shell="1">${inner}<div class="r-top"><button class="r-round glass" data-act="back" aria-label="Kembali">${icon("back", 22, 2)}</button><div class="r-pill glass"><b class="t1">Memuat…</b></div><span class="r-sp"></span></div></div>`;
  // Halaman sebelumnya tetap terlihat selama data chapter dimuat; layar tunggu dipasang bila butuh > 0,3 dtk (dulu 1,2 dtk:
  // ketukan terasa tidak ditanggapi/berat)
  // (sebelumnya langsung tampil layar gelap kosong sekejap sebelum halaman komik → terlihat seperti kedipan)
  const myR = ++readerSeq;
  // Animasi bar meluncur masuk HANYA saat masuk dari luar pembaca (mis. info komik), dan baru setelah halaman siap.
  // Pindah chapter di dalam pembaca (lanjut/sebelumnya/daftar chapter/muat ulang) langsung tampil tanpa animasi.
  const rd0 = $("#rd"), inReader = !!rd0 && !rd0.dataset.shell, rdPrev = rdLast;
  let shellShown = false;
  setTimeout(() => {
    if (myR !== readerSeq || parse().name !== "reader" || $("#rd")) return;
    // layar "Memuat…" tampil diam (tanpa bar meluncur) supaya tidak terlihat seperti macet
    // layar tunggu yang sama dengan saat pindah chapter (dulu kerangka halaman abu-abu gelap yang tampak seperti
    // kotak hitam bergaris di layar gelap)
    const cd = cachedDetail(src, id), chN = cd?.chapters.find((c) => c.id === chId)?.ch ?? "";
    view.innerHTML = shell(`<div class="r-pages"><div class="r-wait" role="status" aria-live="polite"><span class="rw-ring" aria-hidden="true"></span>
      <b class="rw-t">${chN !== "" ? `Chapter ${esc(chN)}` : "Membuka chapter"}</b><span class="mu sm">Menyiapkan halaman…</span><span class="rw-bar" aria-hidden="true"><i></i></span></div></div>`)
      .replace('class="reader ui enter"', 'class="reader ui"').replace("<b class=\"t1\">Memuat…</b>", `<b class="t1">${esc(cd?.manga?.title || "Memuat…")}</b>`);
    shellShown = true;
  }, 300);
  // Pindah chapter di dalam pembaca (lanjut otomatis, tombol lanjut/sebelumnya, daftar chapter): bila chapter baru belum
  // siap dalam 0,25 dtk (jaringan lambat), langsung pindah ke layar tunggu chapter baru (chapter lama bergeser keluar),
  // jadi tidak terlihat macet di chapter lama. Koneksi cepat tetap langsung ke halaman baru tanpa layar tunggu.
  let drawnNew = false;
  if (inReader) setTimeout(() => {
    if (drawnNew || myR !== readerSeq || parse().name !== "reader") return;
    const cd = cachedDetail(src, id), ci = cd ? cd.chapters.findIndex((c) => c.id === chId) : -1;
    const chN = ci >= 0 ? cd.chapters[ci].ch : "", back = !!rdPrev && rdPrev.k === src + "|" + id && ci >= 0 && ci < rdPrev.i;
    const ob = $("#rbox"), anim = !!ob && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    let g = null;
    if (anim) {
      const st = ob.scrollTop, sl = ob.scrollLeft;
      ob.removeAttribute("id"); ob.querySelectorAll("[id]").forEach((x) => x.removeAttribute("id"));
      g = document.createElement("div"); g.className = `r-ghost ${back ? "gb" : "gf"}`; g.setAttribute("aria-hidden", "true"); g.inert = true; g.append(ob);
      g._pos = [st, sl];
    }
    view.innerHTML = `<div class="reader ui ${g ? (back ? "swap-b" : "swap-f") : ""}" id="rd" data-shell="1">
  <div class="r-wait" role="status" aria-live="polite"><span class="rw-ring" aria-hidden="true"></span>
    <b class="rw-t">${chN ? `Chapter ${esc(chN)}` : "Chapter berikutnya"}</b><span class="mu sm" id="rwmsg">Menyiapkan halaman…</span>
    <span class="rw-bar" aria-hidden="true"><i></i></span><button class="btn ghost sm" data-act="retry" id="rwretry" hidden>${icon("refresh", 16)}Coba lagi</button></div>
  <div class="r-top"><button class="r-round glass" data-act="back" aria-label="Kembali">${icon("back", 22, 2)}</button><div class="r-pill glass"><b class="t1">${esc(cd?.manga?.title || "Memuat…")}</b>${chN ? `<span class="mu xs">Chapter ${esc(chN)}</span>` : ""}</div></div></div>`;
    shellShown = true;
    const rdw = $("#rd");
    if (g) {
      rdw.prepend(g); const [st, sl] = g._pos; g.firstChild.scrollTop = st; g.firstChild.scrollLeft = sl;
      const end = () => { g.remove(); rdw.classList.remove("swap-f", "swap-b"); };
      g.addEventListener("animationend", end, { once: true }); setTimeout(end, 600);
    }
    // jaringan sangat lambat: beri tahu, lalu tawarkan coba lagi (pemuatan tetap berjalan di belakang)
    setTimeout(() => { if (!drawnNew && myR === readerSeq) { const m = $("#rwmsg"); if (m) m.textContent = "Jaringan lambat, masih memuat…"; } }, 6000);
    setTimeout(() => { if (!drawnNew && myR === readerSeq) { const b = $("#rwretry"); if (b) b.hidden = false; } }, 15000);
  }, 250);
  const fail = (e) => {
    if (myR !== readerSeq || parse().name !== "reader") return;
    if (!$("#rd")) view.innerHTML = shell(`<div class="r-pages"></div>`);
    $("#rd").classList.remove("enter"); const host = $(".r-pages") || $(".r-wait"); if (host) host.innerHTML = errBox(e);
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
    try { p = await pagesLoad(src, chId); } catch (e) { fail(e); return; }
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
  drawnNew = true;
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
    <div class="rq-acts"><button class="rq-act rq-wide" data-act="rshare"><span class="redt">${icon("share", 18)}</span>Bagikan halaman ini</button><button class="rq-act" data-act="chlist"><span class="gold">${icon("list", 18)}</span>Chapter <span class="mu">${esc(ch.ch)}</span></button><button class="rq-act" data-act="rreport"><span class="redt">${icon("bug", 18)}</span>Laporkan</button></div>
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
  S.markChRead(src, id, ch.id);
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
  const menuOpen = () => { const m = $(".r-menu", rd); return !!m && !m.hidden; };   // rd sendiri: aman setelah pembaca ditutup
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
    let sbDrag = null;
    const sbHide = (ms) => { clearTimeout(sbT); sbT = setTimeout(() => { if (!sbDrag) sb.classList.remove("on"); }, ms); };
    box.addEventListener("scroll", () => {
      if (!sbRaf) sbRaf = requestAnimationFrame(sbDraw);
      sb.classList.add("on"); sbHide(sbDrag ? 0 : 1400);
    }, { passive: true });
    // Indikator bisa dipegang & diseret (gulir cepat): hanya saat sedang tampil (setelah halaman bergerak), jadi ketukan di
    // tepi kanan saat membaca biasa tidak tertangkap. Saat dipegang indikator membesar & berwarna; posisi jari di jalur
    // = posisi di chapter.
    th.addEventListener("pointerdown", (e) => {
      if (!sb.classList.contains("on")) return;
      e.preventDefault(); e.stopPropagation();
      const H = box.clientHeight, S2 = box.scrollHeight, track = sb.clientHeight, len = th.offsetHeight;
      if (S2 <= H + 4 || track <= len) return;
      sbDrag = { y: e.clientY, top: box.scrollTop, k: (S2 - H) / (track - len) };
      seeking = true; sb.classList.add("on", "drag"); clearTimeout(sbT);
      try { th.setPointerCapture(e.pointerId); } catch {}
      navigator.vibrate?.(8);
    });
    th.addEventListener("pointermove", (e) => {
      if (!sbDrag) return;
      e.preventDefault();
      box.scrollTop = sbDrag.top + (e.clientY - sbDrag.y) * sbDrag.k;
    });
    const sbEnd = () => { if (!sbDrag) return; sbDrag = null; seeking = false; quietUntil = Date.now() + 400; sb.classList.remove("drag"); sbHide(1400); };
    th.addEventListener("pointerup", sbEnd); th.addEventListener("pointercancel", sbEnd); th.addEventListener("lostpointercapture", sbEnd);
    th.addEventListener("click", (e) => e.stopPropagation());
  }
  box.addEventListener("scroll", () => {
    // chapter lama yang sedang digeser keluar (salinan) / pembaca yang sudah ditutup: jangan ikut menyimpan posisi,
    // riwayat, atau menggerakkan bilah halaman chapter baru
    if (box.id !== "rbox" || !box.isConnected) return;
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
    try { rubClear(); } catch {}   // efek jeli (dideklarasikan di bawah)
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
  // Tekan lama satu gambar (±0,55 dtk, jari tidak bergeser) → lembar "Bagikan gambar ini" lewat menu bagikan HP
  let lp = null, lpFired = 0;
  const pageSheet = (i) => {
    try { getSelection()?.removeAllRanges(); } catch {}
    const im = p.images[i - 1]; if (!im) return;
    const el = $(`.r-img[data-i="${i}"]`, box), title = d.manga?.title || "";
    const ok = (x) => !!x && !!x.currentSrc && x.complete && x.naturalWidth > 0 && !x.classList.contains("fail");
    const ready = ok(el);
    // Panel bisa terbelah di batas 2 gambar: mode gulir ikut menyertakan halaman sebelum & sesudahnya (yang sudah
    // termuat), ditumpuk seperti di pembaca. Pilihan awal = persis bagian yang sedang terlihat di layar.
    let set = ready ? [i] : [], init = { x: 0, y: 0, w: 1, h: 1 };
    if (ready && !slide) {
      const pe = $(`.r-img[data-i="${i - 1}"]`, box), ne = $(`.r-img[data-i="${i + 1}"]`, box);
      if (ok(pe)) set.unshift(i - 1); if (ok(ne)) set.push(i + 1);
      const els = set.map((k) => $(`.r-img[data-i="${k}"]`, box)), rs = els.map((x) => x.getBoundingClientRect());
      const H = rs.reduce((a, r) => a + r.height, 0), vb = box.getBoundingClientRect();
      // posisi dalam tumpukan (tanpa celah di antara gambar, mis. tombol gagal)
      const at = (y) => { let acc = 0; for (const r of rs) { if (y <= r.bottom) return acc + Math.max(0, y - r.top); acc += r.height; } return acc; };
      const t = at(Math.max(vb.top, rs[0].top)), bt = at(Math.min(vb.bottom, rs[rs.length - 1].bottom));
      if (H > 0 && bt > t) init = { x: 0, y: t / H, w: 1, h: (bt - t) / H };
    } else if (ready) init = { x: 0, y: 0, w: 1, h: 1 };
    const name = ("ninokuu-" + title.slice(0, 40) + "-ch" + ch.ch + "-" + i).toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
    const txt = `${title} · Chapter ${ch.ch} — dibaca di Ninokuu`;
    const run = async (fn) => {
      // layar hitam + cincin berputar sampai lembar bagikan HP muncul (gambar diunduh & dipotong dulu, bisa beberapa dtk)
      const w = document.createElement("div"); w.className = "share-wait"; w.setAttribute("role", "status");
      w.innerHTML = `<span class="rw-ring" aria-hidden="true"></span><b class="rw-t">Menyiapkan gambar…</b><span class="mu sm">Lembar bagikan akan muncul sebentar lagi</span>`;
      document.body.append(w);
      let t = 0;
      const off = () => { clearTimeout(t); removeEventListener("nk:sharing", soon); document.removeEventListener("visibilitychange", off); removeEventListener("blur", off); w.classList.add("out"); setTimeout(() => w.remove(), 220); };
      const soon = () => { t = setTimeout(off, 1200); document.addEventListener("visibilitychange", off, { once: true }); addEventListener("blur", off, { once: true }); };
      addEventListener("nk:sharing", soon, { once: true });
      try { await fn(); } catch (e) { toast(e?.message || "Gagal membagikan gambar", 4000); } finally { if (w.isConnected) off(); }
    };
    // berkas halaman mulai diunduh sekarang (selagi memilih), supaya Bagikan tidak lama menunggu
    DL.prefetchPage(im, p.ref || ""); set.forEach((k) => { if (k !== i) DL.prefetchPage(p.images[k - 1], p.ref || ""); });
    openSheet(`<span class="sheet-ttl">Halaman ${i} dari ${total}</span><span class="sheet-prev">${esc(title)} · Chapter ${esc(ch.ch)}</span>
      ${ready ? `<img class="pg-prev" src="${esc(el.currentSrc)}" alt="Pratinjau halaman ${i}">` : ""}
      ${ready ? `<button class="sh-row" data-s="crop"><span class="redt">${icon("share", 19)}</span><span class="grow col"><b>Pilih bagian lalu bagikan</b><span class="mu xs">Mulai dari yang terlihat di layar, bisa melewati batas halaman</span></span></button>` : ""}
      <button class="sh-row" data-s="share"><span class="redt">${icon("share", 19)}</span><span class="grow">Bagikan seluruh halaman</span></button>`,
    async (b) => {
      if (b.dataset.s === "share") { closeSheet(); run(() => DL.sharePage(im, p.ref || "", name, txt)); }
      else if (b.dataset.s === "crop") {
        closeSheet();
        const urls = set.map((k) => $(`.r-img[data-i="${k}"]`, box).currentSrc);
        const c = await cropPick(urls, init, set.length > 1 ? `Halaman ${set[0]}–${set[set.length - 1]}` : `Halaman ${i}`);
        const sizes = set.map((k) => { const x = $(`.r-img[data-i="${k}"]`, box); return [x.naturalWidth, x.naturalHeight]; });
        if (c) run(() => DL.sharePages(set.map((k) => p.images[k - 1]), p.ref || "", name, txt, c, sizes));
      }
    });
    // jari masih menempel saat lembar ini muncul: tanpa ini tahanan berikutnya memblok teks di lembar (judul, tombol)
    sheet()?.classList.add("nosel"); sheet()?.addEventListener("selectstart", (e) => e.preventDefault());
  };
  const lpCancel = () => { if (lp) { clearTimeout(lp.t); lp = null; } };
  box.addEventListener("pointerdown", (e) => {
    // tekan lama untuk bagikan: bawaan mati, dinyalakan di Pengaturan → Bacaan
    const im = e.target.closest?.(".r-img"); if (!im || e.button > 0 || !e.isPrimary || !S.state.settings.holdShare) { lpCancel(); return; }
    lpCancel();
    lp = { x: e.clientX, y: e.clientY, t: setTimeout(() => { lp = null; if (zoom > 1.05 || seeking) return; lpFired = Date.now(); navigator.vibrate?.(12); pageSheet(Number(im.dataset.i)); }, 550) };
  });
  box.addEventListener("pointermove", (e) => { if (lp && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 10) lpCancel(); }, { passive: true });
  ["pointerup", "pointercancel", "scroll"].forEach((ev) => box.addEventListener(ev, lpCancel, { passive: true }));
  box.addEventListener("touchstart", (e) => { if (e.touches.length > 1) lpCancel(); }, { passive: true });
  box.addEventListener("contextmenu", (e) => { if (e.target.closest?.(".r-img")) e.preventDefault(); });
  // ketukan yang mengakhiri tekan lama tidak ikut memunculkan/menyembunyikan menu
  box.addEventListener("click", (e) => { if (Date.now() - lpFired < 700) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
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
  // Geser satu jari saat diperbesar: digerakkan sendiri ke dua arah sekaligus (+ luncuran saat dilepas). WebView Android
  // sering mengunci gulir ke satu sumbu (naik-turun) pada wadah yang panjang, sehingga di pojok gambar tidak bisa
  // digeser ke samping ("nempel"). Selama diperbesar, gulir bawaan dimatikan (touch-action: none, lihat CSS).
  // Di tepi gambar: efek "jeli" — gambar ikut tertarik melewati tepi dengan hambatan makin berat, lalu memantul
  // kembali saat jari dilepas. Hanya saat diperbesar; posisi FIT (tidak diperbesar) tidak ada efek sama sekali.
  // Efek jeli = meregang seperti gulir bawaan Android di halaman mentok: gambar DIREGANGKAN dari tepi yang ditarik
  // (tepi itu diam di tempatnya), bukan digeser — jadi tidak pernah ada latar hitam yang terlihat. rub.x / rub.y =
  // besar regangan (px, sudah diberi hambatan); positif = tepi kiri/atas yang ditarik.
  // Stabil: jari hanya mencatat sasaran; posisi gulir & regangan digambar SEKALI per frame (rAF), dan regangan yang
  // tampil mengejar sasarannya dengan peredam (dulu ditulis di tiap touchmove — sentuhan 120 Hz + baca tata letak
  // tiap kejadian membuat gambar bergetar/goyang). Saat dilepas, regangan kembali dengan peredam yang lebih pelan.
  let pan = null, panRaf = 0, rubRaf = 0, rubT = 0;
  let rub = { x: 0, y: 0, tx: 0, ty: 0, el: null, sc: null, ex: 0, ey: 0, sl: 0, st: 0 };
  // Batas regangan: tarikan sejauh apa pun paling banyak meregangkan gambar ±9% (RUB = 18% layar sebagai batas
  // tarikan, regangan = setengahnya). Makin jauh ditarik makin berat, dan berhenti di batas itu (dulu sampai ±50%).
  const RUB = 0.18;
  const rubber = (o, dim) => { const L = dim * RUB; return Math.sign(o) * (1 - 1 / ((Math.abs(o) * 0.55) / L + 1)) * L; };
  const inv0 = (r, dim) => { const L = dim * RUB; return r ? (Math.sign(r) * L * (1 / (1 - Math.min(0.95, Math.abs(r) / L)) - 1)) / 0.55 : 0; };
  const rubPaint = () => {
    const el = rub.el, sc = rub.sc; if (!el || !sc) return;
    if (Math.abs(rub.x) < 0.25 && Math.abs(rub.y) < 0.25) { el.style.transform = el.style.transformOrigin = ""; return; }
    const W = sc.clientWidth, H = sc.clientHeight;
    const ox = rub.sl - rub.ex + (rub.x < 0 ? W : 0), oy = rub.st - rub.ey + (rub.y < 0 ? H : 0);
    const sx = 1 + (Math.abs(rub.x) / W) * 0.5, sy = 1 + (Math.abs(rub.y) / H) * 0.5;
    el.style.transformOrigin = `${ox.toFixed(1)}px ${oy.toFixed(1)}px`;
    el.style.transform = `scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
  };
  const rubClear = () => {
    cancelAnimationFrame(rubRaf); rubRaf = 0;
    if (rub.el) rub.el.style.transform = rub.el.style.transformOrigin = "";
    rub = { x: 0, y: 0, tx: 0, ty: 0, el: null, sc: null, ex: 0, ey: 0, sl: 0, st: 0 };
  };
  const frame = (t) => {
    rubRaf = 0;
    const dt = Math.min(50, t - (rubT || t)); rubT = t;
    if (pan?.dirty) {                                                       // posisi gulir dari jari, sekali per frame
      pan.dirty = false;
      if (pan.sc.scrollLeft !== pan.cx) pan.sc.scrollLeft = pan.cx;
      if (pan.sc.scrollTop !== pan.cy) pan.sc.scrollTop = pan.cy;
      rub.sl = pan.cx; rub.st = pan.cy;
    }
    const k = 1 - Math.exp(-dt / (pan ? 34 : 95));                          // peredam: ikut jari / kembali pelan
    rub.x += (rub.tx - rub.x) * k; rub.y += (rub.ty - rub.y) * k;
    if (!pan && Math.abs(rub.x) < 0.3 && Math.abs(rub.y) < 0.3) { rubClear(); return; }
    rubPaint();
    if (pan || rub.x || rub.y) rubRaf = requestAnimationFrame(frame);
  };
  const kick = () => { if (!rubRaf) { rubT = 0; rubRaf = requestAnimationFrame(frame); } };
  const rubBack = () => { rub.tx = rub.ty = 0; if (rub.el) kick(); };
  box.addEventListener("touchstart", (e) => {
    cancelAnimationFrame(panRaf); panRaf = 0;
    if (zoom <= 1.01 || e.touches.length !== 1) { pan = null; if (e.touches.length > 1) rubClear(); return; }
    const t = e.touches[0], sc = slide ? zTarget()?.parentElement : box;
    if (!sc) { pan = null; return; }
    const el = zTarget(); if (rub.el && rub.el !== el) rubClear();
    if (!rub.el) {
      // posisi gambar di dalam wadah gulir (dibaca sekali di awal, tidak di tiap frame)
      const same = el.offsetParent === sc;
      rub.ex = same ? el.offsetLeft : el.offsetLeft - sc.offsetLeft - sc.clientLeft;
      rub.ey = same ? el.offsetTop : el.offsetTop - sc.offsetTop - sc.clientTop;
    }
    rub.el = el; rub.sc = sc; rub.sl = sc.scrollLeft; rub.st = sc.scrollTop;
    // posisi "mentah" = posisi gulir + regangan yang sedang berlangsung (supaya bisa ditangkap lagi saat kembali)
    pan = { x: t.clientX, y: t.clientY, x0: t.clientX, y0: t.clientY, dir: Math.abs(rub.x) > 0.5 ? "h" : Math.abs(rub.y) > 0.5 ? "v" : "", sc,
      vx: 0, vy: 0, t: performance.now(), cx: sc.scrollLeft, cy: sc.scrollTop, dirty: false,
      W: sc.clientWidth, H: sc.clientHeight, mx: Math.max(0, sc.scrollWidth - sc.clientWidth), my: Math.max(0, sc.scrollHeight - sc.clientHeight),
      rx: sc.scrollLeft - inv0(rub.x, sc.clientWidth), ry: sc.scrollTop - inv0(rub.y, sc.clientHeight) };
    rub.tx = rub.x; rub.ty = rub.y;
  }, { passive: true });
  box.addEventListener("touchmove", (e) => {
    if (!pan || pinch || e.touches.length !== 1) return;
    const t = e.touches[0], dx = t.clientX - pan.x, dy = t.clientY - pan.y, now = performance.now(), dt = Math.max(1, now - pan.t);
    if (e.cancelable) e.preventDefault();
    const { W, H, mx, my } = pan;
    // Arah gerakan ditentukan setelah 8 px. Regangan hanya di sumbu gerakan itu dan hanya bila tepinya sudah mentok:
    // dorong ke samping di tepi kiri/kanan → meregang mendatar; tarik naik/turun di awal/akhir chapter → meregang tegak.
    // Gulir naik-turun yang jarinya sedikit miring tidak meregang ke samping.
    if (!pan.dir) { const ax = Math.abs(t.clientX - pan.x0), ay = Math.abs(t.clientY - pan.y0); if (Math.max(ax, ay) >= 8) pan.dir = ax > ay * 1.2 ? "h" : "v"; }
    pan.rx -= dx; pan.ry -= dy;
    const cx = Math.min(mx, Math.max(0, pan.rx)), cy = Math.min(my, Math.max(0, pan.ry));
    if (pan.dir === "h") rub.tx = rubber(cx - pan.rx, W); else { rub.tx = 0; pan.rx = cx; }
    if (pan.dir === "v") rub.ty = rubber(cy - pan.ry, H); else { rub.ty = 0; pan.ry = cy; }
    pan.cx = cx; pan.cy = cy; pan.dirty = true; kick();
    pan.vx = (-dx / dt) * 0.7 + pan.vx * 0.3; pan.vy = (-dy / dt) * 0.7 + pan.vy * 0.3;
    pan.x = t.clientX; pan.y = t.clientY; pan.t = now;
  }, { passive: false });
  box.addEventListener("touchend", (e) => {
    if (!pan || e.touches.length) return;
    const p = pan; pan = null;
    if (p.dirty) { p.sc.scrollLeft = p.cx; p.sc.scrollTop = p.cy; }
    const pulledX = Math.abs(rub.tx) > 0.5, pulledY = Math.abs(rub.ty) > 0.5;
    rubBack();
    if (performance.now() - p.t > 90 || Math.hypot(p.vx, p.vy) < 0.05) return;   // jari sudah berhenti → tanpa luncuran
    let vx = pulledX ? 0 : p.vx, vy = pulledY ? 0 : p.vy, last = performance.now();
    const step = (t) => {
      const dt = Math.min(40, t - last); last = t;
      const sc = p.sc, mx = sc.scrollWidth - sc.clientWidth, my = sc.scrollHeight - sc.clientHeight;
      sc.scrollLeft += vx * dt; sc.scrollTop += vy * dt;
      if (sc.scrollLeft <= 0 || sc.scrollLeft >= mx - 0.5) vx = 0;                 // sampai tepi: berhenti di situ
      if (sc.scrollTop <= 0 || sc.scrollTop >= my - 0.5) vy = 0;
      const f = Math.pow(0.994, dt); vx *= f; vy *= f;
      panRaf = Math.hypot(vx, vy) > 0.02 && zoom > 1.01 ? requestAnimationFrame(step) : 0;
    };
    panRaf = requestAnimationFrame(step);
  }, { passive: true });
  box.addEventListener("touchcancel", () => { if (pan) { pan = null; rubBack(); } }, { passive: true });
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
    // bagikan halaman yang sedang terlihat (pengganti tekan lama, yang bawaannya mati)
    rshare: () => { menu(false); pageSheet(curPage); },
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
    { root: box, rootMargin: slide ? "0px 100%" : "100% 0px 400% 0px" });
  $$(".r-img[data-src]", box).forEach((im) => lazyIo.observe(im));
  // Gambar macet: tidak selesai & tidak gagal (server situs menggantung, tidak pernah memberi galat). Halaman di dekat
  // posisi baca yang > 8 dtk belum tampil dicoba lewat jalur lain (APK: jaringan HP), lalu dimuat ulang,
  // maksimal 3×. Dulu halaman seperti ini tetap hitam selamanya, bahkan setelah "Muat ulang chapter".
  $$(".r-img", box).forEach((im) => { if (!im.dataset.src && !im.dataset.t0) im.dataset.t0 = String(Date.now()); });
  const stuckT = setInterval(() => {
    if (!rd.isConnected) { clearInterval(stuckT); return; }
    const now = Date.now();
    for (const im of $$(".r-img.wait", box)) {
      const i = Number(im.dataset.i);
      if (im.dataset.src || im.classList.contains("fail") || (im.complete && im.naturalWidth) || i < curPage - 1 || i > curPage + 3) continue;
      const t0 = Number(im.dataset.t0 || 0), n = Number(im.dataset.wd || 0);
      if (!t0 || now - t0 < 8000 || n >= 3) continue;
      im.dataset.wd = String(n + 1); im.dataset.t0 = String(now);
      if (!n) N.logDev("img", `halaman ${i} macet > 8 dtk, dicoba jalur lain`, `${src} · ${(im.dataset.o || "").slice(0, 120)}`);
      // TIDAK lewat Supabase (proxy gambar = kuota): APK → ambil langsung lewat jaringan HP; web / bila itu gagal →
      // muat ulang alamat langsung yang sama dengan penanda baru supaya tidak memakai permintaan lama yang menggantung
      const d0 = im.dataset.d;
      const again = () => { if (!im.isConnected || !d0) return; im.dataset.fb = "2"; im.removeAttribute("src"); requestAnimationFrame(() => { im.src = d0 + (d0.includes("?") ? "&" : "?") + "nkr=" + now; }); };
      if (N.isApp && d0 && n < 2) N.imageViaNative(d0, im.dataset.ref || "").then((b) => { if (im.isConnected && im.classList.contains("wait")) { im.dataset.fb = "1"; im.src = b; } }, again);
      else again();
    }
  }, 2000);
  // Tinggi sementara halaman yang belum dimuat = rasio gambar terakhir yang sudah tampil (halaman satu chapter
  // biasanya sama ukurannya), bukan 1 layar penuh. Jadi saat gambar datang, isi layar hampir tidak bergeser.
  rd.addEventListener("load", (e) => {
    const im = e.target; if (!im.classList?.contains("r-img")) return;
    im.classList.remove("wait");
    // Antrean ke depan: halaman yang baru selesai di dekat posisi baca langsung menyusulkan 2 halaman berikutnya,
    // jadi unduhan tidak berhenti menunggu halaman itu masuk jarak pantau (dulu: blok hitam saat menggulir ke situs
    // yang lambat). Dibatasi ±5 halaman di depan posisi baca supaya tidak mengunduh seluruh chapter sekaligus.
    const ii = Number(im.dataset.i);
    if (ii <= curPage + 5) [ii + 1, ii + 2].forEach((k) => { const x = $(`.r-img[data-i="${k}"]`, box); if (x?.dataset.src) { loadImg(x); lazyIo.unobserve(x); } });
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
    // selama hitung mundur, daftar halaman chapter berikutnya diambil duluan (kecil, tanpa gambar) supaya chapter baru
    // lebih cepat siap saat waktunya habis; chapter yang sudah diunduh tidak perlu
    const npk = src + "|" + next.id;
    if (!isLocal && !pagesMem.has(npk)) pagesLoad(src, next.id).catch(() => {});
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
  setCleanup(() => { lazyIo.disconnect(); clearInterval(stuckT); fsObs.disconnect(); clearTimeout(tapT); clearTimeout(nextT); cancelAnimationFrame(rafPos); endIo?.disconnect(); removeEventListener("online", onOnline); (parse().name === "reader" ? 0 : N.setFullscreen(false, false)); S.flushHistory(); });   // ke halaman lain: bilah status dikembalikan SEBELUM halaman baru digambar (tidak melompat setelahnya); pindah chapter: status layar tidak disentuh sama sekali sampai chapter baru tampil (dulu dilepas setelah 0,3 dtk → seluruh layar bergeser naik-turun saat chapter lambat dimuat)
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
