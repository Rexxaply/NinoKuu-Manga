// Impor dari aplikasi lain (Lainnya → Impor dari aplikasi lain).
// File backup aplikasi BacaKomik ("bk.portable.backup": favorit + riwayat) dibaca di HP. Pengguna memilih judul,
// lalu tiap judul dicari di sumber Ninokuu satu per satu (otomatis, berhenti di sumber pertama yang judulnya cocok
// persis). Cocok persis → masuk Koleksi (rak "Impor") + posisi baca terakhir (nomor chapter; id chapternya dilengkapi
// saat komik dibuka). Cocok sebagian → pengguna memilih sendiri. Tidak ketemu → dicatat.
// Pekerjaan berjalan di modul (tetap jalan walau halaman ditinggal) dan disimpan di HP, jadi bisa dilanjutkan.
import * as api from "./api.js";
import * as S from "./store.js";
import { esc, icon, $, toast, srcName, comicHref, ask, cover } from "./ui.js";
import { normQ, matchQ, setSearchQ } from "./search.js";

const JOB_KEY = "importJob";
const SHELF = "Impor";
// urutan sumber "Otomatis": yang diambil langsung lewat jaringan HP dulu (APK: Shinigami & WestManga), lalu lewat server
const ORDER = ["shinigami", "westmanga", "komiku", "kiryuu", "bacakomik"];
const CONC = 3;

// ---------- membaca file backup ----------
const TYPE_OK = { manga: "manga", manhwa: "manhwa", manhua: "manhua" };
const wibIso = (v) => { const m = /^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d(?::\d\d)?)/.exec(String(v || "")); if (!m) return ""; const t = Date.parse(`${m[1]}T${m[2]}+07:00`); return Number.isFinite(t) ? new Date(t).toISOString() : ""; };
export function parseBackup(text) {
  let j; try { j = JSON.parse(text); } catch { throw new Error("File ini bukan file backup yang bisa dibaca (bukan JSON)."); }
  const d = j?.data || j;
  const favs = Array.isArray(d?.favorites) ? d.favorites : [], hist = Array.isArray(d?.history) ? d.history : [];
  if (!favs.length && !hist.length) throw new Error("Tidak ada favorit atau riwayat di file ini. Pastikan memilih file backup dari aplikasi BacaKomik.");
  const map = new Map();
  const put = (x, isFav) => {
    const title = String(x?.title || "").trim().slice(0, 300); if (!title) return;
    const k = normQ(title); if (!k) return;
    const e = map.get(k) || { k, title, type: "", cover: "", fav: false, ch: "", at: "" };
    e.type ||= TYPE_OK[String(x.type || "").toLowerCase()] || "";
    if (!e.cover && /^https?:\/\//.test(x.imageUrl || "")) e.cover = String(x.imageUrl).slice(0, 1000);
    if (isFav) e.fav = true;
    else {
      const at = wibIso(x.lastReadAt), ch = String(x.chapterLabel ?? "").trim().slice(0, 40);
      if (ch && (!e.at || at > e.at)) { e.ch = ch; e.at = at; }
    }
    map.set(k, e);
  };
  favs.forEach((x) => put(x, true)); hist.forEach((x) => put(x, false));
  return [...map.values()].sort((a, b) => (b.at || "").localeCompare(a.at || "") || a.title.localeCompare(b.title, "id"));
}

// ---------- pekerjaan impor (tersimpan di HP) ----------
// job = { items:[{k,title,type,cover,fav,ch,at, st:"wait"|"ok"|"ask"|"none"|"skip", hit?, cands?}], shelf, startedAt }
let job = api.lsGet(JOB_KEY, null);
if (!job || !Array.isArray(job.items)) job = null;
let running = false, onTick = null;
const save = () => { if (job) api.lsSet(JOB_KEY, job); else api.lsSet(JOB_KEY, null); };
const counts = () => { const c = { wait: 0, ok: 0, ask: 0, none: 0, skip: 0 }; job?.items.forEach((x) => { c[x.st] = (c[x.st] || 0) + 1; }); return c; };
const titleQ = (t) => String(t || "").split(/\s[~(\[|–—:]|\s-\s|[~(\[]/)[0].trim().split(/\s+/).slice(0, 6).join(" ");

async function findOne(it) {
  const want = it.k, q = titleQ(it.title) || it.title;
  const near = [];
  for (const src of ORDER) {
    let r;
    try { r = await api.call("browse", { source: src, q, type: "", status: "", genres: [], sort: "update", page: 1, limit: 12 }); }
    catch { continue; }            // sumber sedang tidak bisa dicari → sumber berikutnya
    const items = r?.items || [];
    // persis: judul sama, atau judul lengkap muncul utuh di judul alternatif (minimal 2 kata, supaya "One" tidak cocok ke mana-mana)
    const exact = items.find((x) => normQ(x.title) === want || (want.includes(" ") && ` ${normQ(x.alt || "")} `.includes(` ${want} `)));
    if (exact) return { st: "ok", hit: { source: src, comic_id: exact.id, title: exact.title, cover: exact.cover || "" } };
    const ok = matchQ(q);
    for (const x of items) if (ok(x) && near.length < 6) near.push({ source: src, comic_id: x.id, title: x.title, cover: x.cover || "" });
  }
  return near.length ? { st: "ask", cands: near } : { st: "none" };
}

// hasil yang cocok disimpan ke koleksi + riwayat per kelompok (bukan satu per satu)
let pend = [];
async function flush() {
  if (!pend.length) return;
  const list = pend; pend = [];
  const lib = list.map((it) => ({ ...it.hit, type: it.type, shelf: job?.shelf ? SHELF : "" }));
  const hist = list.filter((it) => it.ch).map((it) => ({ source: it.hit.source, comic_id: it.hit.comic_id, title: it.hit.title, cover: it.hit.cover, type: it.type,
    chapter: it.ch, chapter_id: null, page: 1, pages: 0, read_at: it.at || new Date().toISOString() }));
  try { await S.importBulk(lib, hist); } catch (e) { toast("Sebagian hasil impor belum tersinkron: " + (e.message || e), 4000); }
}
function accept(it, hit) { it.st = "ok"; it.hit = hit; delete it.cands; pend.push(it); }

async function run() {
  if (running || !job) return;
  running = true;
  if (job.shelf) S.addShelf(SHELF);
  try {
    const next = () => job?.items.find((x) => x.st === "wait" && !x.busy);
    const worker = async () => {
      for (let it = next(); it && running; it = next()) {
        it.busy = true;
        // sudah ada di koleksi dengan judul yang sama → tidak perlu dicari
        const have = [...S.state.lib.values()].find((m) => normQ(m.title) === it.k);
        const res = have ? { st: "ok", hit: { source: have.source, comic_id: have.comic_id, title: have.title, cover: have.cover || "" }, have: true } : await findOne(it);
        delete it.busy;
        if (!job) return;
        if (res.st === "ok") accept(it, res.hit);            // sudah di koleksi: importBulk melewatinya, posisi baca tetap diperbarui
        else { it.st = res.st; if (res.cands) it.cands = res.cands; }
        if (pend.length >= 20) await flush();
        save(); onTick?.();
        await new Promise((r) => setTimeout(r, 150));
      }
    };
    await Promise.all(Array.from({ length: CONC }, worker));
    await flush();
  } finally {
    running = false; job?.items.forEach((x) => delete x.busy); save(); onTick?.();
  }
  if (job && !job.items.some((x) => x.st === "wait")) {
    const c = counts();
    toast(`Impor selesai: ${c.ok} masuk koleksi${c.ask ? `, ${c.ask} perlu dipilih` : ""}${c.none ? `, ${c.none} tidak ketemu` : ""}.`, 4500);
  }
}

// ---------- halaman ----------
let pick = null;          // { list, sel:Set<k>, q, f } saat memilih judul (sebelum impor dimulai)
export async function vImport(view, ctx) {
  const { topbar, setActs, back, go } = ctx;
  const draw = () => (job ? drawJob() : pick ? drawPick() : drawStart());
  // sampul dari situs aplikasi lain: langsung (tanpa proxy), bila gagal cukup inisial judul
  const cv = (url, title) => `<span class="cover sm im-cv" data-ini="${esc((title || "?")[0])}">${url ? `<img src="${esc(url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ""}</span>`;
  if (!view._imErr) { view._imErr = 1; view.addEventListener("error", (e) => { if (e.target?.closest?.(".im-cv")) e.target.remove(); }, true); }
  const inLibTitle = () => new Set([...S.state.lib.values()].map((m) => normQ(m.title)));

  function drawStart() {
    view.innerHTML = topbar("Impor dari aplikasi lain") + `<div class="px col g14 mt6">
  <p class="mu sm lh m0">Pindahkan koleksi & riwayat baca dari aplikasi <b>BacaKomik</b> (file backup <b>.json</b>). Kamu bisa memilih judul mana yang diimpor; tiap judul dicari otomatis di sumber Ninokuu.</p>
  <div class="card col g6"><b>Cara mendapatkan file backup</b><span class="mu sm lh">Di aplikasi BacaKomik buka menu backup / cadangkan data, lalu simpan file-nya di HP.</span></div>
  <label class="btn primary">${icon("restore", 18, 2)}Pilih file backup<input type="file" accept="application/json,.json" id="imf" hidden></label><span class="err" id="perr"></span>
  <p class="mu xs lh m0">${S.loggedIn() ? "Hasil impor ikut tersinkron ke akunmu." : "Kamu belum masuk: hasil impor hanya tersimpan di HP ini."}</p></div><div class="pad-nav"></div>`;
    $("#imf").addEventListener("change", async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      try {
        const list = parseBackup(await f.text()), have = inLibTitle();
        pick = { list, sel: new Set(list.filter((x) => !have.has(x.k)).map((x) => x.k)), q: "", f: "all", shelf: true };
        draw();
      } catch (er) { $("#perr").textContent = er.message; }
    });
    setActs({ back: () => back("#/more") });
  }

  function drawPick() {
    const have = inLibTitle(), P = pick;
    const qq = normQ(P.q);
    const shown = P.list.filter((x) => (!qq || x.k.includes(qq))
      && (P.f === "all" || (P.f === "fav" ? x.fav : P.f === "hist" ? !!x.ch : x.type === P.f)));
    const nFav = P.list.filter((x) => x.fav).length, nHist = P.list.filter((x) => x.ch).length;
    const chip = (id, name) => `<button aria-pressed="${P.f === id}" data-act="imf" data-v="${id}">${name}</button>`;
    const rows = shown.slice(0, P.lim || 120).map((x) => `<label class="dl-row im-row${have.has(x.k) ? " off" : ""}"><input type="checkbox" data-k="${esc(x.k)}" ${P.sel.has(x.k) ? "checked" : ""} ${have.has(x.k) ? "disabled" : ""}>
      ${cv(x.cover, x.title)}<span class="col grow" style="min-width:0"><b class="t1">${esc(x.title)}</b>
      <span class="mu xs">${[x.type && x.type[0].toUpperCase() + x.type.slice(1), x.ch && `Ch. ${esc(x.ch)}`, x.fav && "Favorit", have.has(x.k) && "sudah di koleksi"].filter(Boolean).join(" · ")}</span></span></label>`).join("");
    const keepY = scrollY;
    view.innerHTML = topbar("Pilih judul") + `<div class="px col g10 mt6">
  <div class="mu sm">${P.list.length} judul di file · ${nFav} favorit · ${nHist} dengan posisi baca</div>
  <label class="search box"><span class="mu">${icon("search", 19)}</span><span class="sr">Cari judul</span><input id="imq" type="search" enterkeyhint="search" autocomplete="off" placeholder="Cari judul di file backup" value="${esc(P.q)}"></label>
  <div class="chips" role="group">${chip("all", "Semua")}${chip("fav", "Favorit")}${chip("hist", "Riwayat")}${chip("manga", "Manga")}${chip("manhwa", "Manhwa")}${chip("manhua", "Manhua")}</div>
  <div class="row sb"><span class="mu xs">${shown.length} tampil · <b>${P.sel.size}</b> dipilih</span><span class="row g10"><button class="link-red sm" data-act="imall">Pilih yang tampil</button><button class="link-red sm" data-act="imnone">Kosongkan</button></span></div>
  <div class="dl-rows">${rows || `<div class="empty sm"><b>Tidak ada yang cocok</b></div>`}${shown.length > (P.lim || 120) ? `<button class="btn ghost" data-act="immore">Tampilkan lebih banyak (${shown.length - (P.lim || 120)} lagi)</button>` : ""}</div>
  <label class="dl-row im-opt"><input type="checkbox" id="imshelf" ${P.shelf ? "checked" : ""}><span class="col grow"><b>Masukkan ke rak “${SHELF}”</b><span class="mu xs">Supaya mudah dicari & dirapikan nanti</span></span></label>
  </div><div class="im-bar glass"><button class="btn primary wide" data-act="imgo" ${P.sel.size ? "" : "disabled"}>Impor ${P.sel.size} judul</button></div><div class="pad-nav"></div>`;
    scrollTo(0, keepY);
    const inp = $("#imq");
    inp.addEventListener("input", () => { P.q = inp.value; P.lim = 120; const pos = inp.selectionStart; drawPick(); const n = $("#imq"); n.focus({ preventScroll: true }); n.setSelectionRange(pos, pos); });
    view.querySelector(".dl-rows").addEventListener("change", (e) => {
      const k = e.target.dataset?.k; if (k == null) return;
      e.target.checked ? P.sel.add(k) : P.sel.delete(k);
      view.querySelector(".row.sb .mu b").textContent = P.sel.size;
      const b = view.querySelector("[data-act=imgo]"); b.textContent = `Impor ${P.sel.size} judul`; b.disabled = !P.sel.size;
    });
    $("#imshelf").addEventListener("change", (e) => { P.shelf = e.target.checked; });
    setActs({
      back: () => { pick = null; draw(); },
      imf: (el) => { P.f = el.dataset.v; P.lim = 120; drawPick(); },
      imall: () => { shown.forEach((x) => { if (!have.has(x.k)) P.sel.add(x.k); }); drawPick(); },
      imnone: () => { P.sel.clear(); drawPick(); },
      immore: () => { P.lim = (P.lim || 120) + 200; drawPick(); },
      imgo: async () => {
        const n = P.sel.size; if (!n) return;
        if (!(await ask(`Impor ${n} judul ke Koleksi?\nTiap judul dicari di sumber Ninokuu (± ${Math.max(1, Math.round(n / 60))} menit). Proses jalan terus walau kamu membuka halaman lain.`, { ok: "Mulai impor" }))) return;
        job = { startedAt: new Date().toISOString(), shelf: P.shelf, items: P.list.filter((x) => P.sel.has(x.k)).map((x) => ({ ...x, st: "wait" })) };
        pick = null; save(); scrollTo(0, 0); draw(); run();
      },
    });
  }

  function drawJob() {
    const c = counts(), total = job.items.length, done = total - c.wait, pctv = Math.round((done / Math.max(1, total)) * 100);
    const asks = job.items.filter((x) => x.st === "ask"), nones = job.items.filter((x) => x.st === "none");
    const keepY = scrollY;
    view.innerHTML = topbar("Impor dari aplikasi lain") + `<div class="px col g14 mt6">
  <div class="card col g8"><div class="row sb"><b>${c.wait ? (running ? "Mengimpor…" : "Impor dijeda") : "Impor selesai"}</b><span class="mu sm">${done} / ${total}</span></div>
    <span class="fa-bar im-pg"><i style="width:${pctv}%"></i></span>
    <span class="mu sm">${icon("check", 14, 2.4)} ${c.ok} masuk koleksi · ${c.ask} perlu dipilih · ${c.none} tidak ketemu${c.skip ? ` · ${c.skip} dilewati` : ""}</span>
    ${c.wait ? (running ? `<span class="mu xs lh">Boleh tinggalkan halaman ini, impor tetap berjalan selama aplikasi terbuka.</span>` : `<button class="btn primary" data-act="imrun">Lanjutkan impor</button>`) : ""}</div>
  ${asks.length ? `<section class="col g8"><h2 class="cap">Perlu dipilih (${asks.length})</h2><span class="mu xs lh">Judulnya mirip tapi tidak persis sama. Ketuk yang benar, atau lewati.</span>
    ${asks.slice(0, 30).map((x) => `<div class="card col g6 im-ask"><div class="row g10">${cv(x.cover, x.title)}<span class="col grow" style="min-width:0"><b class="t2">${esc(x.title)}</b><span class="mu xs">${x.ch ? `Ch. ${esc(x.ch)}` : "Favorit"}</span></span><button class="link-red sm" data-act="imskip" data-k="${esc(x.k)}">Lewati</button></div>
      ${(x.cands || []).map((h, i) => `<button class="mg-it" data-act="impick" data-k="${esc(x.k)}" data-i="${i}">${cover(h.cover, h.title, "sm")}<span class="grow col" style="min-width:0"><span class="t2">${esc(h.title)}</span><span class="mu xs">${esc(srcName(h.source))}</span></span><span class="redt sm">Pilih</span></button>`).join("")}</div>`).join("")}
    ${asks.length > 30 ? `<span class="mu xs">… dan ${asks.length - 30} lagi (muncul setelah yang di atas dipilih/dilewati)</span>` : ""}</section>` : ""}
  ${nones.length ? `<section class="col g8"><h2 class="cap">Tidak ketemu (${nones.length})</h2><span class="mu xs lh">Tidak ada di sumber Ninokuu dengan judul ini. Ketuk untuk mencari manual.</span>
    <div class="dl-rows">${nones.slice(0, 60).map((x) => `<button class="dl-row im-none" data-act="imfind" data-k="${esc(x.k)}">${cv(x.cover, x.title)}<span class="col grow" style="min-width:0;text-align:left"><b class="t1">${esc(x.title)}</b><span class="mu xs">${x.ch ? `Ch. ${esc(x.ch)}` : "Favorit"}</span></span><span class="mu">${icon("search", 16)}</span></button>`).join("")}</div>
    ${nones.length > 60 ? `<span class="mu xs">… dan ${nones.length - 60} lagi</span>` : ""}</section>` : ""}
  ${!c.wait ? `<button class="btn ghost" data-act="imclear">Selesai & hapus daftar impor</button>` : `<button class="link-red sm" data-act="imstop">Batalkan sisa impor</button>`}
  ${c.ok ? `<a class="btn ghost" href="#/fav">${icon("heart", 17, 2)}Lihat Koleksi</a>` : ""}</div><div class="pad-nav"></div>`;
    scrollTo(0, keepY);
    const find = (k) => job.items.find((x) => x.k === k);
    setActs({
      back: () => back("#/more"),
      imrun: () => { run(); draw(); },
      impick: async (el) => { const it = find(el.dataset.k), h = it?.cands?.[+el.dataset.i]; if (!h) return; accept(it, h); save(); await flush(); draw(); toast(`“${h.title}” masuk koleksi`); },
      imskip: (el) => { const it = find(el.dataset.k); if (it) { it.st = "skip"; delete it.cands; save(); draw(); } },
      imfind: (el) => { const it = find(el.dataset.k); if (it) { setSearchQ(titleQ(it.title)); go("#/search"); } },
      imstop: async () => { if (!(await ask("Batalkan judul yang belum dicari? Yang sudah masuk koleksi tetap ada.", { ok: "Batalkan", danger: true }))) return; job.items.forEach((x) => { if (x.st === "wait") x.st = "skip"; }); save(); draw(); },
      imclear: () => { job = null; save(); draw(); },
    });
  }

  // progres diperbarui paling sering 2× per detik selama halaman ini terbuka
  let t = 0;
  onTick = () => { if (!view.isConnected || !job || pick) return; if (!t) t = setTimeout(() => { t = 0; if (location.hash.startsWith("#/p/import")) drawJob(); }, 500); };
  draw();
  // impor yang terputus (aplikasi ditutup) dilanjutkan saat halaman ini dibuka lagi
  if (job && job.items.some((x) => x.st === "wait") && !running) run();
  return () => { onTick = null; clearTimeout(t); t = 0; };
}
