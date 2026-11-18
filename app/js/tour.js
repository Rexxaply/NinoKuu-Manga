// Pop-up "Yang baru" setelah aplikasi diperbarui (sekali per versi).
// - Lihat: slide gambar fitur baru (tangkapan layar ringan di img/new/, ±15 KB per gambar, dimuat saat dibuka).
//   Tidak memindahkan halaman aplikasi, jadi ringan. Sebelumnya / Berikutnya / Lewati, bisa juga digeser.
// - Hanya baca Changelog: ringkasan fitur (penting di atas, perbaikan bug paling bawah).
// - Tutup: lewati. Versi yang sudah ditampilkan dicatat, jadi pop-up tidak muncul lagi.
import { esc, icon } from "./ui.js";

// Isi per versi. Slide: img = nama file di img/new/ (tanpa .webp).
export const WHATS_NEW = {
  "1.6.3": {
    title: "Yang baru di Ninokuu 1.6.3",
    intro: "Lebih hemat kuota, membaca lebih nyaman, dan aplikasi terasa lebih responsif saat disentuh.",
    features: [
      ["Bar bawah ringkas", "Saat digulir ke bawah, bar menu mengecil jadi 1 tombol di tengah dengan animasi ala iOS. Ketuk untuk membukanya lagi."],
      ["Hemat kuota", "Halaman chapter dimuat bertahap saat mendekati layar (sebelumnya seluruh chapter sekaligus). Sampul di daftar memakai versi kecil, sampai 94% lebih ringan."],
      ["Lanjut dari halaman terakhir", "Keluar di halaman 12/48, buka lagi chapter itu → langsung ke halaman 12."],
      ["Zoom cubit lebih mulus", "Gambar mengikuti jari saat dicubit dan digeser. Manhwa/manhua maks. 300%, manga 400%."],
      ["Tombol muat ulang di atas", "Ikon muat ulang di bar atas pembaca; titik merah bila ada gambar yang gagal dimuat."],
      ["Mode fullscreen", "Lainnya → Pengaturan → Tampilan layar. Bilah status HP ikut menu bacaan: muncul bersama menu, hilang saat menu disembunyikan."],
      ["Pilihan di akhir chapter", "Tampilkan menu (bawaan) atau Otomatis lanjut ke chapter berikutnya (bisa dibatalkan)."],
      ["Urutkan Beranda & Koleksi", "Beranda: Update terbaru, Populer, Judul A-Z/Z-A, Rating (sesuai sumber), 15 judul per muatan. Koleksi: grid 3 kolom, label Terbaru muncul sendiri."],
      ["Pembaca aktif sungguhan", "Angka di Chat publik menghitung orang yang sedang membuka Ninokuu saat ini, realtime."],
      ["Lebih responsif disentuh", "Tombol dan kartu langsung bereaksi saat disentuh; lembar bawah bisa digeser turun untuk menutup."],
      ["Pengaturan baru", "Mode efek avatar dan pilihan bacaan di Lainnya → Pengaturan, juga di menu ⋯ saat membaca."],
      ["Posisi daftar tersimpan", "Kembali dari halaman komik, Beranda dan Pencarian tetap di posisi terakhir."],
      ["Komik ribuan chapter & reset password", "Daftar chapter lengkap sampai chapter 1. Lupa password membuka ninokuu.site dengan tombol kembali ke aplikasi."],
    ],
    fixes: [
      "Shinigami kembali bisa dibuka: pindah ke server barunya (s1.shinigami.mx).",
      "Menu bacaan langsung muncul saat layar diketuk, dan sembunyi setelah digulir ±40 px.",
      "Menu ⋯ pembaca tidak lagi terpotong.",
      "Label Terbaru di Koleksi tidak perlu membuka komiknya dulu; judul grid maksimal 2 baris.",
      "File CBZ/ZIP besar bisa dibuka; pesan error menyebut alasan sebenarnya.",
    ],
    tour: [
      { img: "bar", title: "Bar bawah ringkas", text: "Gulir ke bawah, bar mengecil jadi 1 tombol di tengah. Ketuk tombol itu untuk memunculkan Beranda, Cari, Favorit, dan Lainnya lagi." },
      { img: "sort", title: "Urutkan Beranda", text: "Ketuk ikon urutkan di Update terbaru. Pilihan menyesuaikan sumber. 15 judul per muatan, berikutnya dimuat otomatis." },
      { img: "koleksi", title: "Koleksi 3 kolom", text: "Urutkan koleksi lewat ikon di samping pencarian. Label Terbaru muncul sendiri tanpa membuka komiknya." },
      { img: "pengaturan", title: "Pengaturan bacaan", text: "Lainnya → Pengaturan: sembunyikan menu otomatis, Mode standar/fullscreen, dan pilihan di akhir chapter." },
      { img: "baca", title: "Saat membaca", text: "Ikon muat ulang ada di bar atas; titik merah berarti ada gambar yang gagal. Chapter lanjut dari halaman terakhir, cubit untuk zoom." },
      { img: "menu", title: "Menu ⋯ pembaca", text: "Pilihan bacaan yang sama juga bisa diubah langsung dari menu ⋯ saat membaca." },
    ],
  },
};

const SEEN = "ninokuu:seenVersion";
const seen = () => { try { return localStorage.getItem(SEEN) || ""; } catch { return ""; } };
const markSeen = (v) => { try { localStorage.setItem(SEEN, v); } catch {} };

// Panggil sekali saat aplikasi dibuka. Global: hanya setelah memperbarui dari versi lama (bukan pemasangan baru).
// Dev: sekali setiap isi changelog berubah, termasuk pemasangan baru, supaya bisa diuji.
// Dev: muncul lagi hanya bila ISI changelog berubah (bukan setiap build), supaya isinya bisa dicek tanpa berulang.
const hashOf = (o) => { let h = 0; const t = JSON.stringify(o || ""); for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
export function maybeShow(ctx) {
  const { version, dev } = ctx;
  const info = WHATS_NEW[version];
  const key = dev ? `${version}-dev-${hashOf(info)}` : version;
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
const close = () => document.querySelector(".tw-host")?.remove();

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

// Slide gambar: hanya gambar slide ini & berikutnya yang dimuat.
const IMG = (n) => `img/new/${n}.webp`;
function tour(info, ctx, i) {
  const steps = info.tour, st = steps[i];
  if (!st) { close(); return; }
  const h = host("tw-pop");
  if (steps[i + 1]) new Image().src = IMG(steps[i + 1].img);
  const last = i === steps.length - 1;
  h.innerHTML = `<div class="tw-card glass tw-slide" role="dialog" aria-modal="true" aria-label="${esc(st.title)}">
    <div class="tw-shot"><img src="${IMG(st.img)}" alt="${esc(st.title)}" width="420" height="909" decoding="async" draggable="false"></div>
    <b class="tw-t">${esc(st.title)}</b><p class="tw-p">${esc(st.text)}</p>
    <div class="tw-dots" aria-label="Slide ${i + 1} dari ${steps.length}">${steps.map((_, k) => `<span class="${k === i ? "on" : ""}"></span>`).join("")}</div>
    <div class="row g8"><button class="tw-b grow" data-tw="prev" ${i ? "" : "disabled"}>Sebelumnya</button><button class="tw-b on grow" data-tw="next">${last ? "Selesai" : "Berikutnya"}</button></div>
    <button class="tw-skip" data-tw="close">Lewati</button></div>`;
  const go = (k) => { if (k >= 0) tour(info, ctx, k); };
  h.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tw]"); if (!b) return;
    if (b.dataset.tw === "next") go(i + 1); else if (b.dataset.tw === "prev") go(i - 1); else close();
  });
  // geser kiri/kanan pada gambar untuk pindah slide
  let x0 = null;
  const shot = h.querySelector(".tw-shot");
  shot.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  shot.addEventListener("touchend", (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 50) go(dx < 0 ? i + 1 : i - 1); });
}
