// Pop-up "Yang baru" setelah aplikasi diperbarui (sekali per versi) + tur sorotan fitur baru.
// - Lihat: tur langkah demi langkah. Layar lain digelapkan, hanya tombol/fitur yang baru yang terang,
//   keterangan di bawahnya. Selama tur layar tidak bisa digeser atau diketuk, kecuali tombol
//   Sebelumnya / Berikutnya / Lewati. Langkah tanpa sasaran (fitur seluruh layar) tidak menggelapkan layar.
// - Hanya baca Changelog: ringkasan fitur (penting di atas, perbaikan bug paling bawah).
// - Tutup: lewati. Versi yang sudah ditampilkan dicatat, jadi pop-up tidak muncul lagi.
import { esc, icon } from "./ui.js";

// Isi per versi. Langkah tur: hash halaman, sel = elemen yang disorot (null = seluruh layar).
export const WHATS_NEW = {
  "1.6.3": {
    title: "Yang baru di Ninokuu 1.6.3",
    intro: "Membaca jadi lebih nyaman: lanjut dari halaman terakhir, layar penuh, urutan daftar, dan pengaturan baru.",
    features: [
      ["Lanjut dari halaman terakhir", "Keluar di halaman 12/48, buka lagi chapter itu → langsung ke halaman 12."],
      ["Urutkan Beranda & Koleksi", "Beranda: Update terbaru, Populer, Judul A-Z/Z-A, Rating (sesuai sumber). Koleksi: Update terbaru, Terakhir ditambah, Judul A-Z/Z-A."],
      ["Layar penuh saat membaca", "Ketuk layar bacaan, bilah status HP disembunyikan."],
      ["Muat ulang gambar yang gagal", "Halaman yang gagal dimuat punya tombol muat ulang; dicoba lagi otomatis saat internet kembali."],
      ["Otomatis lanjut chapter", "Terus gulir lewat akhir chapter untuk membuka chapter berikutnya (nyalakan di Pengaturan)."],
      ["Pengaturan baru", "Mode efek avatar dan pilihan bacaan dikumpulkan di Lainnya → Pengaturan, juga di menu ⋯ saat membaca."],
      ["Posisi daftar tersimpan", "Kembali dari halaman komik, Beranda dan Pencarian tetap di posisi terakhir."],
      ["Martial Peak & komik ribuan chapter", "Daftar chapter lengkap sampai chapter 1, sisanya dimuat di belakang layar."],
      ["Reset password di ninokuu.site", "Tautan lupa password membuka halaman baru dengan tombol kembali ke aplikasi."],
    ],
    fixes: [
      "Menu bacaan langsung muncul saat layar diketuk (sebelumnya tertunda).",
      "Menu bacaan sembunyi otomatis setelah digulir ±40 px, tidak perlu gulir cepat.",
      "File CBZ/ZIP besar bisa dibuka; pesan error menyebut alasan sebenarnya.",
    ],
    tour: [
      { hash: "#/home", sel: "[data-act=hsort]", title: "Urutkan Beranda", text: "Pilih urutan daftar: Update terbaru, Populer, Judul A-Z/Z-A, atau Rating (pilihan menyesuaikan sumber)." },
      { hash: "#/home", sel: "#upd", title: "15 judul per muatan", text: "Daftar tampil 3 × 5. Gulir ke bawah, judul berikutnya dimuat otomatis. Posisinya tetap saat kamu kembali." },
      { hash: "#/fav", sel: "[data-act=fsort]", title: "Urutkan koleksi", text: "Update terbaru, Terakhir ditambah, Judul A-Z, atau Judul Z-A." },
      { hash: "#/more", sel: "[data-act=settings]", title: "Pengaturan", text: "Mode efek avatar dan pilihan bacaan sekarang ada di sini." },
      { hash: "#/p/settings", sel: "#setRead", title: "Pilihan bacaan", text: "Sembunyikan menu otomatis, layar penuh, dan otomatis lanjut chapter. Juga ada di menu ⋯ saat membaca." },
      { hash: null, sel: null, title: "Saat membaca", text: "Buka lagi chapter yang belum selesai → langsung ke halaman terakhir. Ketuk layar untuk layar penuh. Gambar gagal? Ketuk tombol muat ulang di halaman itu." },
    ],
  },
};

const SEEN = "ninokuu:seenVersion";
const seen = () => { try { return localStorage.getItem(SEEN) || ""; } catch { return ""; } };
const markSeen = (v) => { try { localStorage.setItem(SEEN, v); } catch {} };

// Panggil sekali saat aplikasi dibuka. Global: hanya setelah memperbarui dari versi lama (bukan pemasangan baru).
// Dev: sekali per build, termasuk pemasangan baru, supaya bisa diuji.
export function maybeShow(ctx) {
  const { version, build, dev } = ctx;
  const info = WHATS_NEW[version];
  const key = dev ? `${version}-dev${build}` : version;
  const before = seen();
  if (before === key) return;
  markSeen(key);
  if (!info || (!dev && !before)) return;
  setTimeout(() => popup(info, ctx), 900);
}

function host(cls) {
  document.querySelector(".tw-host")?.remove();
  const h = document.createElement("div");
  h.className = "tw-host " + cls;
  document.body.append(h);
  return h;
}
const close = () => { document.querySelector(".tw-host")?.remove(); document.body.classList.remove("tw-lock"); };

function popup(info, ctx) {
  const h = host("tw-pop");
  h.innerHTML = `<div class="tw-card glass" role="dialog" aria-modal="true" aria-label="${esc(info.title)}">
    <span class="tw-ic">${icon("star", 22)}</span><b class="tw-t">${esc(info.title)}</b><p class="tw-p">${esc(info.intro)}</p>
    <button class="btn primary" data-tw="look">${icon("play", 16, 2)}Lihat</button>
    <button class="btn ghost" data-tw="log">Hanya baca Changelog</button>
    <button class="tw-skip" data-tw="close">Tutup</button></div>`;
  h.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tw]"); if (!b) return;
    if (b.dataset.tw === "look") tour(info, ctx, 0);
    else if (b.dataset.tw === "log") changelog(info, ctx);
    else close();
  });
}

function changelog(info, ctx) {
  const h = host("tw-pop");
  h.innerHTML = `<div class="tw-card glass tw-log" role="dialog" aria-modal="true" aria-label="Changelog">
    <b class="tw-t">${esc(info.title)}</b>
    <div class="tw-scroll"><span class="cap">Fitur baru</span>
      ${info.features.map(([t, d]) => `<div class="tw-it"><span class="redt">${icon("star", 15)}</span><span><b>${esc(t)}</b><span class="mu sm block">${esc(d)}</span></span></div>`).join("")}
      <span class="cap mt8">Perbaikan bug</span>
      ${info.fixes.map((t) => `<div class="tw-it"><span class="gold">${icon("check", 15, 2.2)}</span><span class="sm">${esc(t)}</span></div>`).join("")}</div>
    <div class="row g8"><button class="btn ghost grow" data-tw="close">Tutup</button><button class="btn primary grow" data-tw="look">Lihat fiturnya</button></div></div>`;
  h.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tw]"); if (!b) return;
    if (b.dataset.tw === "look") tour(info, ctx, 0); else close();
  });
}

// tur: layar dikunci (tidak bisa digeser/diketuk) kecuali tombol tur
const block = (e) => { if (!e.target.closest?.(".tw-bar")) e.preventDefault(); };
async function tour(info, ctx, i) {
  const steps = info.tour, st = steps[i];
  if (!st) { end(ctx); return; }
  const h = host("tw-tour");
  document.body.classList.add("tw-lock");
  h.addEventListener("touchmove", block, { passive: false });
  h.addEventListener("wheel", block, { passive: false });
  h.innerHTML = `<div class="tw-shade"></div>`;
  // pindah halaman dulu; elemen dicari setelah halaman baru tergambar (bukan sisa halaman sebelumnya)
  if (st.hash && location.hash !== st.hash) { ctx.go(st.hash); await new Promise((r) => setTimeout(r, 250)); }
  const el = st.sel ? await waitFor(st.sel) : null;
  if (document.querySelector(".tw-host") !== h) return;            // tur ditutup selagi menunggu
  let box = "";
  if (el) {
    // tunggu halaman selesai memulihkan posisi gulirnya sendiri, baru sorot elemennya
    await new Promise((r) => setTimeout(r, 350));
    el.scrollIntoView({ block: "center", behavior: "instant" });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (document.querySelector(".tw-host") !== h) return;
    const r = el.getBoundingClientRect(), pad = 8;
    const top = Math.max(6, r.top - pad), left = Math.max(6, r.left - pad), w = Math.min(innerWidth - 12, r.width + pad * 2), hh = Math.min(innerHeight * 0.6, r.height + pad * 2);
    box = `<div class="tw-spot" style="top:${top}px;left:${left}px;width:${w}px;height:${hh}px"></div>`;
    const below = top + hh + 190 < innerHeight;
    box += `<div class="tw-tip" style="${below ? `top:${top + hh + 12}px` : `bottom:${innerHeight - top + 12}px`}"><b>${esc(st.title)}</b><span>${esc(st.text)}</span></div>`;
  } else {
    box = `<div class="tw-tip tw-full"><b>${esc(st.title)}</b><span>${esc(st.text)}</span></div>`;
  }
  h.innerHTML = `${el ? "" : `<div class="tw-shade clear"></div>`}${box}
    <div class="tw-bar glass"><button class="tw-b" data-tw="skip">Lewati</button><span class="mu xs">${i + 1} / ${steps.length}</span>
      <span class="row g8"><button class="tw-b" data-tw="prev" ${i ? "" : "disabled"}>Sebelumnya</button><button class="tw-b on" data-tw="next">${i === steps.length - 1 ? "Selesai" : "Berikutnya"}</button></span></div>`;
  h.addEventListener("click", (e) => {
    e.stopPropagation();
    const b = e.target.closest("[data-tw]"); if (!b) return;
    if (b.dataset.tw === "next") tour(info, ctx, i + 1);
    else if (b.dataset.tw === "prev") tour(info, ctx, i - 1);
    else end(ctx);
  });
}
function end(ctx) { close(); ctx.go("#/home"); }
function waitFor(sel, ms = 4000) {
  return new Promise((res) => {
    const t0 = Date.now();
    const tick = () => { const el = document.querySelector(`#view ${sel}`) || document.querySelector(sel); if (el && el.getBoundingClientRect().height) return res(el); if (Date.now() - t0 > ms) return res(null); setTimeout(tick, 80); };
    tick();
  });
}
