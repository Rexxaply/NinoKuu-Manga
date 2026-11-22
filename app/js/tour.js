// Pop-up "Yang baru" setelah aplikasi diperbarui (sekali per versi).
// - Lihat: slide gambar fitur baru (tangkapan layar ringan di img/new/, ±15 KB per gambar, dimuat saat dibuka).
//   Tidak memindahkan halaman aplikasi, jadi ringan. Sebelumnya / Berikutnya / Lewati, bisa juga digeser.
// - Hanya baca Changelog: ringkasan fitur (penting di atas, perbaikan bug paling bawah).
// - Tutup: lewati. Versi yang sudah ditampilkan dicatat, jadi pop-up tidak muncul lagi.
import { esc, icon } from "./ui.js";

// Isi per versi. Slide: img = nama file di img/new/ (tanpa .webp).
export const WHATS_NEW = {
  "1.9.0": {
    title: "Yang baru di Ninokuu 1.9.0",
    intro: "Gulir otomatis, skor komik, pindah chapter yang mulus, pembersih cache, dan Komiku tetap bisa dibaca walau situsnya menolak server.",
    features: [
      ["Gulir otomatis", "Mode Scroll bisa menggulir sendiri 1×, 2×, atau 3×. Tekan layar untuk berhenti, lepas untuk lanjut. Atur di menu ⋯ pembaca atau Pengaturan."],
      ["Lanjut otomatis", "Sampai di akhir chapter, chapter berikutnya terbuka sendiri setelah 1–5 detik (bawaan 3 detik). Ketuk untuk batal."],
      ["Pindah chapter mulus", "Chapter berikutnya masuk dari kanan, chapter sebelumnya dari kiri, tanpa layar hitam atau halaman yang meloncat."],
      ["Skor komik", "Info komik menampilkan skor ★ dari situs sumber, bila sumbernya menyediakan."],
      ["Bersihkan cache", "Lainnya → Bersihkan cache: lihat perkiraan cache di HP lalu kosongkan. Koleksi, riwayat, dan unduhan tetap aman."],
      ["Layar penuh sampai ujung", "Mode layar penuh memakai area sekitar lubang kamera. Bilah status yang ditarik muncul transparan lalu hilang sendiri."],
      ["Komiku tetap jalan", "Komiku sedang menolak server Ninokuu. Di aplikasi, Komiku otomatis dibuka langsung lewat jaringan HP."],
      ["Akun & Pengaturan rapi", "Panel Akun baru (foto, nama, email, password), Mode baca pindah ke Pengaturan, dan semua dialog kini gaya Ninokuu."],
    ],
    fixes: [
      "Tombol Chapter di menu ⋯ menampilkan nomor chapter yang sedang dibaca.",
      "Zoom terkunci di dalam halaman, tanpa celah hitam di tepi dan tanpa label persen.",
      "Bar bawah yang mengecil terbuka lagi sendiri setelah layar diam ±2,5 detik.",
      "HP boleh diputar terbalik dalam posisi potret.",
      "Perbaikan keamanan di server, unduhan, restore backup, dan gambar chat.",
    ],
    tour: [
      { img: "gulir", title: "Gulir otomatis", text: "Buka menu ⋯ di pembaca, pilih 1×, 2×, atau 3×. Tekan layar untuk berhenti sebentar, lepas untuk lanjut." },
      { img: "skor", title: "Skor komik", text: "Skor ★ dari situs sumber tampil di info komik, di sebelah status komik." },
      { img: "cache", title: "Bersihkan cache", text: "Di Lainnya, ketuk Bersihkan cache untuk melihat perkiraan cache di HP lalu mengosongkannya." },
      { img: "setelan", title: "Semua di Pengaturan", text: "Mode baca, gulir otomatis, layar penuh, dan lanjut otomatis kini ada di satu halaman Pengaturan." },
    ],
  },
  "1.8.0": {
    title: "Yang baru di Ninokuu 1.8.0",
    intro: "Dukung Ninokuu lewat Trakteer, pembaruan muncul sendiri tanpa membuka ulang aplikasi, backup jadi file sungguhan, dan banyak tampilan yang dirapikan.",
    features: [
      ["Traktir Ninokuu", "Kartu baru di Lainnya untuk mendukung Ninokuu lewat Trakteer. Ninokuu tetap gratis & tanpa iklan."],
      ["Pembaruan otomatis terdeteksi", "Dicek tiap 15 menit dan saat kembali ke aplikasi. Sedang membaca? Cukup spanduk kecil di atas, bacaan tidak tertutup."],
      ["Backup jadi file", "File backup disimpan di Documents/Ninokuu/Backup dan bisa dibagikan ke Drive, WhatsApp, atau tempat lain."],
      ["Label NEW UPDATE rapi", "Hanya untuk chapter yang rilis kurang dari 24 jam, dan komik itu selalu di urutan teratas."],
      ["Jendela mengambang", "Ninokuu bisa dipakai di jendela mengambang/layar terbagi saat HP miring, dengan tata letak yang menyesuaikan."],
      ["Chat ikut keyboard", "Judul tetap di atas, kolom tulis meluncur halus tepat di atas keyboard, pesan terbaru tetap terlihat."],
      ["Kaca gaya iOS", "Menu ⋯ pembaca, bar bawah, dan tombol kaca lebih buram dan warnanya lebih hidup."],
      ["Yang baru kapan saja", "Lainnya → Yang baru di versi ini: buka lagi pop-up dan panduan bergambar kapan pun."],
    ],
    fixes: [
      "Kolom chat tidak lagi terlempar ke atas layar saat keyboard muncul; judul halaman tidak tertimpa bilah status.",
      "Tab Level & Rank tidak lagi menutupi kartu level.",
      "Chip filter Koleksi tidak melompat ke awal; tombol grid/daftar Pencarian sejajar dengan chip.",
      "Pilihan yang sedang aktif (mis. Scroll) tidak memuat ulang pembaca bila ditekan lagi; tanda pilihan di menu ⋯ tidak hilang.",
      "Efek kaca tidak \"mati\" saat pindah halaman; bar Mulai baca meluncur halus tanpa bayangan melompat.",
    ],
    tour: [
      { img: "trakteer", title: "Traktir Ninokuu", text: "Di Lainnya, ketuk kartu Traktir Ninokuu. Lembar penjelasan muncul dulu, lalu Kirim hadiah membuka Trakteer." },
      { img: "update", title: "Pembaruan muncul sendiri", text: "Tidak perlu membuka ulang aplikasi. Saat membaca cukup spanduk kecil di atas: ketuk Lihat untuk memperbarui." },
      { img: "baru", title: "NEW UPDATE rapi", text: "Label hanya untuk chapter yang rilis kurang dari 24 jam. Urutan Update terbaru menaruhnya paling atas." },
      { img: "backup", title: "Backup jadi file", text: "Simpan file backup ke Documents/Ninokuu/Backup, lalu bagikan ke Drive atau WhatsApp sebelum ganti HP." },
    ],
  },
  "1.7.0": {
    title: "Yang baru di Ninokuu 1.7.0",
    intro: "Tampilan baru yang lebih rapi, lanjut baca cukup 1 ketukan, lebih hemat kuota, dan animasi lebih mulus di semua halaman.",
    features: [
      ["Lanjut baca 1 ketukan", "Di Koleksi, ketuk lencana +N untuk langsung membuka chapter berikutnya. Di Riwayat ada tombol Lanjut (ke halaman terakhir) dan Berikutnya."],
      ["Koleksi & Riwayat baru", "Daftar lebih ramping: sumber berwarna, chapter yang dibaca ditebalkan, bar progres, dan jumlah chapter baru."],
      ["Top 10 bermedali", "Peringkat 1 emas bermahkota, 2 perak, 3 perunggu."],
      ["Riwayat pencarian", "Ketuk kolom cari: 10 kata kunci terakhir muncul, bisa dihapus satu-satu atau semuanya."],
      ["Bar bawah ringkas", "Saat digulir ke bawah, bar menu mengecil jadi 1 tombol di tengah. Ketuk untuk membukanya lagi."],
      ["Animasi gaya iOS", "Pilihan sumber, Koleksi/Riwayat/Unduhan, dan chip jenis meluncur halus ke pilihan baru."],
      ["Menu ⋯ pembaca ringkas", "Mode baca, daftar chapter, laporan, dan pilihan bacaan dalam satu panel pendek."],
      ["Hemat kuota", "Halaman chapter dimuat bertahap tanpa melompat; sampul memakai versi kecil, sampai 94% lebih ringan."],
      ["Sampul cadangan", "Sampul yang gagal dimuat diganti logo Ninokuu dengan tombol muat ulang."],
      ["Lanjut dari halaman terakhir", "Buka lagi chapter yang belum selesai → langsung ke halaman terakhir yang dibaca."],
      ["Pilihan bacaan", "Mode standar/fullscreen dan pilihan di akhir chapter (menu atau otomatis lanjut), di Lainnya → Pengaturan dan menu ⋯."],
      ["Zoom & muat ulang", "Cubit untuk zoom yang mengikuti jari. Tombol muat ulang di bar atas pembaca, titik merah bila ada gambar gagal."],
      ["Urutkan Beranda & Koleksi", "Update terbaru, Populer, Judul A-Z/Z-A, Rating (sesuai sumber); Koleksi juga bisa grid 3 kolom."],
      ["Pembaca aktif sungguhan", "Angka di Chat publik menghitung orang yang sedang membuka Ninokuu, realtime."],
      ["Komik ribuan chapter & reset password", "Daftar chapter lengkap sampai chapter 1. Lupa password lewat ninokuu.site dengan tombol kembali ke aplikasi."],
    ],
    fixes: [
      "Shinigami kembali bisa dibuka (pindah ke server barunya).",
      "Sumber di Beranda dan Pencarian kini selalu sama: pilih di salah satu, ikut di yang lain.",
      "Animasi lebih mulus: pindah halaman, Lainnya, dan halaman komik tidak tersendat; hiasan avatar hanya bergerak saat terlihat.",
      "Halaman komik tidak lagi berkedip saat komentar dimuat.",
      "Menu ⋯ pembaca tidak terpotong; menu bacaan langsung muncul saat layar diketuk.",
      "File CBZ/ZIP besar bisa dibuka; pesan error menyebut alasan sebenarnya.",
    ],
    tour: [
      { img: "koleksi", title: "Lanjut baca 1 ketukan", text: "Ketuk lencana +N di Koleksi untuk langsung membuka chapter berikutnya. Centang hijau berarti sudah sampai chapter terbaru." },
      { img: "riwayat", title: "Riwayat baru", text: "Lanjut membuka chapter yang belum selesai di halaman terakhir. Berikutnya membuka chapter sesudahnya." },
      { img: "top10", title: "Top 10 bermedali", text: "Peringkat 1 emas bermahkota, 2 perak, 3 perunggu. Daftar Beranda dan Pencarian juga lebih ringkas." },
      { img: "cari", title: "Riwayat pencarian", text: "Ketuk kolom cari untuk memilih kata kunci terakhir. Tanda × menghapusnya." },
      { img: "bar", title: "Bar bawah ringkas", text: "Gulir ke bawah, bar mengecil jadi 1 tombol. Ketuk untuk memunculkan Beranda, Cari, Favorit, dan Lainnya lagi." },
      { img: "sort", title: "Urutkan Beranda", text: "Ketuk ikon urutkan di Update terbaru. Pilihan menyesuaikan sumber; judul berikutnya dimuat otomatis." },
      { img: "menu", title: "Menu ⋯ ringkas", text: "Mode baca, daftar chapter, laporan, dan pilihan bacaan dalam satu panel pendek." },
      { img: "baca", title: "Saat membaca", text: "Ikon muat ulang di bar atas; titik merah berarti ada gambar gagal. Lanjut dari halaman terakhir, cubit untuk zoom." },
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
// Versi PATCH (mis. 1.8.1) tanpa entri sendiri memakai entri versi MINOR-nya (1.8.0) dan tidak memunculkan
// pop-up lagi bagi yang sudah melihatnya: pop-up hanya untuk fitur baru, bukan setiap perbaikan kecil.
const lineOf = (v) => String(v).split(".").slice(0, 2).join(".") + ".0";
const entryOf = (v) => (WHATS_NEW[v] ? v : WHATS_NEW[lineOf(v)] ? lineOf(v) : v);
export function maybeShow(ctx) {
  const { dev } = ctx, version = entryOf(ctx.version);
  const info = WHATS_NEW[version];
  const key = dev ? `${version}-dev-${hashOf(info)}` : version;
  const before = seen();
  if (before === key) return;
  markSeen(key);
  if (!info || (!dev && !before)) return;
  setTimeout(() => popup(info, ctx), 900);
}

// Satu lapisan gelap dipakai ulang saat berpindah pop-up → changelog → slide (tidak berkedip/muncul ulang);
// hanya kartunya yang berganti dengan animasi masuk singkat.
// Buka lagi "Yang baru" kapan saja (Lainnya → Yang baru di versi ini): pop-up + panduan bergambar
export function showNow(ctx) {
  const info = WHATS_NEW[entryOf(ctx.version)];
  if (!info) return false;
  popup(info, ctx);
  return true;
}
function host(cls) {
  let h = document.querySelector(".tw-host:not(.out)");
  if (!h) { h = document.createElement("div"); document.body.append(h); }
  h.className = "tw-host " + cls;
  h.onclick = null;
  return h;
}
const close = () => {
  const h = document.querySelector(".tw-host:not(.out)"); if (!h) return;
  h.classList.add("out"); h.onclick = null;
  setTimeout(() => h.remove(), 220);
};

function popup(info, ctx) {
  const h = host("tw-pop");
  h.innerHTML = `<div class="tw-card glass" role="dialog" aria-modal="true" aria-label="${esc(info.title)}">
    <span class="tw-ic">${icon("star", 22)}</span><b class="tw-t">${esc(info.title)}</b><p class="tw-p">${esc(info.intro)}</p>
    <button class="btn primary" data-tw="look">${icon("play", 16, 2)}Lihat</button>
    <button class="btn ghost" data-tw="log">Hanya baca Changelog</button>
    <button class="tw-skip" data-tw="close">Tutup</button></div>`;
  h.onclick = (e) => {
    const b = e.target.closest("[data-tw]"); if (!b) return;
    if (b.dataset.tw === "look") tour(info, ctx, 0);
    else if (b.dataset.tw === "log") changelog(info, ctx);
    else close();
  };
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
  h.onclick = (e) => {
    const b = e.target.closest("[data-tw]"); if (!b) return;
    if (b.dataset.tw === "look") tour(info, ctx, 0); else close();
  };
}

// Slide gambar (carousel): semua slide ada di satu jalur yang digeser dengan transform, jadi pindah slide
// tidak membangun ulang kartu (gambar tidak berkedip/reset). Geser mengikuti jari 1:1, karet di ujung,
// dan lemparan cepat langsung pindah. Gambar dimuat untuk slide ini dan tetangganya saja.
const IMG = (n) => `img/new/${n}.webp`;
const GAP = 12;
function tour(info, ctx, start = 0) {
  const steps = info.tour, n = steps.length;
  const h = host("tw-pop");
  h.innerHTML = `<div class="tw-card glass tw-slide" role="dialog" aria-modal="true" aria-roledescription="carousel" aria-label="Fitur baru">
    <div class="tw-view"><div class="tw-track">${steps.map((st, k) => `<div class="tw-shot" aria-label="Slide ${k + 1} dari ${n}"><img data-src="${IMG(st.img)}" alt="${esc(st.title)}" width="420" height="909" decoding="async" draggable="false"></div>`).join("")}</div></div>
    <div class="tw-txt" aria-live="polite">${steps.map((st) => `<div class="tw-tx"><b class="tw-t">${esc(st.title)}</b><p class="tw-p">${esc(st.text)}</p></div>`).join("")}</div>
    <div class="tw-dots" aria-hidden="true">${steps.map(() => "<span></span>").join("")}</div>
    <div class="row g8"><button class="tw-b grow" data-tw="prev">Sebelumnya</button><button class="tw-b on grow" data-tw="next">Berikutnya</button></div>
    <button class="tw-skip" data-tw="close">Lewati</button></div>`;
  const view = h.querySelector(".tw-view"), track = h.querySelector(".tw-track");
  const imgs = [...h.querySelectorAll(".tw-shot img")], txs = [...h.querySelectorAll(".tw-tx")], dots = [...h.querySelectorAll(".tw-dots span")];
  const prevB = h.querySelector("[data-tw=prev]"), nextB = h.querySelector("[data-tw=next]");
  let i = 0;
  const load = (k) => { const im = imgs[k]; if (im?.dataset.src) { im.src = im.dataset.src; delete im.dataset.src; } };
  const pos = (px = 0) => `translate3d(calc(${-i} * (100% + ${GAP}px) + ${px}px), 0, 0)`;
  const show = (k, anim = true) => {
    i = Math.max(0, Math.min(n - 1, k));
    track.classList.toggle("drag", !anim);
    track.style.transform = pos();
    txs.forEach((t, j) => { t.classList.toggle("on", j === i); t.toggleAttribute("inert", j !== i); });
    dots.forEach((d, j) => d.classList.toggle("on", j === i));
    prevB.disabled = i === 0;
    nextB.textContent = i === n - 1 ? "Selesai" : "Berikutnya";
    load(i); load(i + 1); load(i - 1);
  };
  show(start, false);
  h.onclick = (e) => {
    const b = e.target.closest("[data-tw]"); if (!b) return;
    if (b.dataset.tw === "next") { if (i === n - 1) close(); else show(i + 1); }
    else if (b.dataset.tw === "prev") show(i - 1);
    else close();
  };
  // geser: arah ditentukan di gerakan pertama; vertikal dibiarkan, horizontal mengikuti jari
  let x0 = 0, y0 = 0, t0 = 0, dx = 0, axis = "";
  view.addEventListener("touchstart", (e) => { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; t0 = e.timeStamp; dx = 0; axis = ""; }, { passive: true });
  view.addEventListener("touchmove", (e) => {
    const t = e.touches[0], mx = t.clientX - x0, my = t.clientY - y0;
    if (!axis) { if (Math.abs(mx) < 6 && Math.abs(my) < 6) return; axis = Math.abs(mx) > Math.abs(my) ? "x" : "y"; if (axis === "x") track.classList.add("drag"); }
    if (axis !== "x") return;
    e.preventDefault();
    const edge = (i === 0 && mx > 0) || (i === n - 1 && mx < 0);
    dx = edge ? mx * 0.35 : mx;                                   // karet di slide pertama/terakhir
    track.style.transform = pos(dx);
  }, { passive: false });
  const end = (e) => {
    if (axis !== "x") return;
    axis = "";
    const w = view.clientWidth, v = dx / Math.max(1, e.timeStamp - t0);   // px/ms
    const go = Math.abs(dx) > w * 0.25 || Math.abs(v) > 0.45 ? (dx < 0 ? 1 : -1) : 0;
    show(i + go);
  };
  view.addEventListener("touchend", end);
  view.addEventListener("touchcancel", end);
}
