// EXP v2: login harian + streak, pil "+EXP", halaman Level & Rank (Ringkasan · Riwayat · Tangga),
// rekap bacaan 7/30 hari yang bisa dibagikan sebagai gambar 9:16.
// Semua EXP dihitung di server (lihat bagian 13 ninokuu-schema.sql); di sini hanya tampilan.
import * as api from "./api.js";
import * as S from "./store.js";
import * as N from "./native.js";
import { esc, icon, $, $$, toast } from "./ui.js";

// login beruntun ke-n: minggu 1 = 10…40, tiap minggu kotak +10, mulai minggu ke-5 sama dengan minggu ke-4
export const slotOf = (n) => ((n - 1) % 7) + 1;
export const weekOf = (n) => Math.floor((n - 1) / 7) + 1;
export const loginExp = (n) => 5 + 5 * slotOf(n) + 10 * (Math.min(4, weekOf(n)) - 1);
const dayExp = (n) => loginExp(n) + (slotOf(n) === 7 ? BONUS7 : 0);
export const BONUS7 = 50;
export const RULES = [
  { k: "login", ic: "cal", t: "Login harian", d: "Minggu 1: 10–40 EXP · tiap minggu +10 per hari (maks minggu ke-4: 40–70)", amt: "+10–70", cap: 1 },
  { k: "streak7", ic: "flame", t: "7 hari beruntun", d: "Bonus tiap akhir minggu (Day 7, 14, 21, …)", amt: "+50", cap: 7 },
  { k: "read", ic: "book", t: "Baca chapter sampai habis", d: "Sekali per chapter", amt: "+3", cap: 100 },
  { k: "like_comic", ic: "thumb", t: "Like seri komik", d: "Sekali per komik", amt: "+5", cap: 20 },
  { k: "like_chapter", ic: "thumb", t: "Like chapter", d: "Sekali per chapter", amt: "+3", cap: 30 },
  { k: "library", ic: "bookmark", t: "Simpan komik ke koleksi", d: "Sekali per komik", amt: "+3", cap: 20 },
];
const KIND = Object.fromEntries(RULES.map((r) => [r.k, r]));
const KIND_LABEL = { login: "Login harian", streak7: "Bonus 7 hari beruntun", read: "Baca chapter", like_comic: "Like komik", like_chapter: "Like chapter", library: "Simpan ke koleksi" };

// tanggal hari ini menurut WIB (reset 00.00 WIB, sama dengan server)
export const wibToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const num = (n) => Number(n || 0).toLocaleString("id-ID");
const pctOf = (a, b) => (b ? Math.max(0, Math.min(100, (a / b) * 100)) : 0);

/* ---------- status harian (cache singkat) ---------- */
let status = null, statusAt = 0;
export async function loadStatus(force = false) {
  if (!S.loggedIn()) { status = null; return null; }
  if (!force && status && status.today === wibToday() && Date.now() - statusAt < 20e3) return status;
  try { status = await api.rpc("daily_status"); statusAt = Date.now(); } catch { status = null; }
  return status;
}
export const cachedStatus = () => status;

/* ---------- pil "+EXP" dengan progres level ---------- */
let pillT = null;
function showExpPill(from, to) {
  const a = S.levelOf({ exp: from }), b = S.levelOf({ exp: to });
  document.querySelector(".xp-pill")?.remove();
  const el = document.createElement("div");
  el.className = "xp-pill";
  el.setAttribute("role", "status");
  const up = b.lv > a.lv;
  el.innerHTML = `<span class="xp-top"><span class="xp-ic">${icon("star", 14, 2)}</span><b>+${num(to - from)} EXP</b></span>
    <span class="xp-sub">${up ? `Naik ke Lv ${b.lv}!` : `Lv ${b.lv} · ${num(b.cur)} / ${num(b.need)}`}</span>
    <span class="xp-bar"><span style="width:${up ? 0 : pctOf(a.cur, a.need)}%"></span></span>`;
  document.body.append(el);
  requestAnimationFrame(() => requestAnimationFrame(() => { el.classList.add("on"); el.querySelector(".xp-bar span").style.width = pctOf(b.cur, b.need) + "%"; }));
  if (up) toast(`Selamat! Kamu naik ke Level ${b.lv}${b.rank !== a.rank ? ` · rank ${b.rank}` : ""}`, 3200);
  clearTimeout(pillT);
  pillT = setTimeout(() => { el.classList.remove("on"); setTimeout(() => el.remove(), 400); }, 3200);
}
window.addEventListener("nk:exp", (e) => { if (S.state.profile?.role !== "developer") showExpPill(e.detail.from, e.detail.to); status = null; });

/* ---------- popup login harian ---------- */
// sudah ditampilkan di sesi ini? (dibuka ulang aplikasi → muncul lagi selama belum diklaim)
const seen = { get: () => { try { return sessionStorage.getItem("ninokuu:dailySeen"); } catch { return null; } }, set: (d) => { try { sessionStorage.setItem("ninokuu:dailySeen", d); } catch {} } };
let dailyOpen = false;
const tile = (d, cur, claimed) => {
  const done = d < cur || (d === cur && claimed), now = d === cur, last = slotOf(d) === 7;
  const amt = last ? `+${loginExp(d)} EXP · bonus +${BONUS7}` : `+${loginExp(d)} EXP`;
  return `<div class="dl-t ${last ? "w" : ""} ${done ? "done" : ""} ${now ? "now" : ""}">
    <span class="dl-c">${done ? icon("check", 15, 3) : last ? icon("gift", 17, 2) : d}</span>
    <span class="col"><b>Day ${d}</b><span>${amt}</span></span></div>`;
};
function dailyHtml(st, phase, res) {
  const claimed = phase === "done" || st.claimed;
  const streak = res ? res.streak : st.streak;
  const day = res ? res.day : st.day;
  const gained = res ? (res.gained || 0) + (res.bonus || 0) : 0;
  return `<div class="dl-card" role="dialog" aria-modal="true" aria-label="Login harian">
  <button class="dl-x" data-d="close" aria-label="Tutup">${icon("x", 18, 2.2)}</button>
  <div class="dl-h"><span class="dl-hic">${icon("cal", 24, 2)}</span><span class="col"><b class="dl-ttl">${phase === "done" ? "Klaim berhasil" : "Login harian"}</b>
    <span class="dl-day">Day ${day} · Minggu ke-${weekOf(day)}</span><span class="dl-st">${icon("flame", 13, 2)}Total streak: ${streak} hari</span></span></div>
  ${phase === "done" ? `<span class="dl-gain">+${num(gained)} EXP</span>` : ""}
  <div class="dl-grid">${[1, 2, 3, 4, 5, 6, 7].map((i) => tile((weekOf(day) - 1) * 7 + i, day, claimed)).join("")}</div>
  <p class="dl-note">${icon("clock", 14)}<span>Reset setiap pukul 00.00 WIB. Tiap minggu EXP setiap hari naik +10 (sampai minggu ke-4). Lewat sehari tanpa klaim, streak mulai lagi dari Day 1.</span></p>
  <button class="btn primary dl-btn" data-d="${claimed ? "close" : "claim"}" ${phase === "busy" ? "disabled" : ""}>${phase === "busy" ? "Memproses…" : claimed ? "Siap!" : `Klaim +${num(dayExp(day))} EXP`}</button>
</div>`;
}
export async function openDaily(force = false) {
  if (dailyOpen || !S.loggedIn()) return;
  const st = await loadStatus(true);
  if (!st || (st.claimed && !force)) return;
  dailyOpen = true;
  seen.set(st.today);
  const host = document.createElement("div");
  host.className = "dl-host";
  document.body.append(host);
  const draw = (phase, res) => { host.innerHTML = dailyHtml(st, phase, res); };
  draw(st.claimed ? "done" : "idle", st.claimed ? { streak: st.streak, day: st.day, gained: 0, bonus: 0 } : null);
  if (st.claimed) host.querySelector(".dl-ttl").textContent = "Sudah diklaim hari ini";
  requestAnimationFrame(() => host.classList.add("on"));
  const close = () => { host.classList.remove("on"); setTimeout(() => host.remove(), 250); dailyOpen = false; window.dispatchEvent(new Event("nk:daily")); };
  host.addEventListener("click", async (e) => {
    if (e.target === host) { close(); return; }
    const b = e.target.closest("[data-d]"); if (!b) return;
    if (b.dataset.d === "close") { close(); return; }
    if (b.dataset.d === "claim") {
      draw("busy");
      try {
        const res = await api.rpc("claim_daily");
        status = null;
        draw("done", res);
        if (res.already) host.querySelector(".dl-ttl").textContent = "Sudah diklaim hari ini";
        S.refreshExp();
      } catch (err) { draw("idle"); toast(err.message || "Gagal klaim, coba lagi."); }
    }
  });
}
export const closeDaily = () => { const b = $(".dl-host [data-d=close]"); if (b) { b.click(); return true; } return false; };

// cek otomatis: saat aplikasi dibuka, kembali dari latar, dan tepat setelah 00.00 WIB
let lastDay = wibToday();
export function startDaily() {
  const check = () => {
    if (!S.loggedIn() || document.visibilityState !== "visible") return;
    if (seen.get() === wibToday()) return;
    openDaily(false);
  };
  setTimeout(check, 1800);
  document.addEventListener("visibilitychange", check);
  setInterval(() => { const t = wibToday(); if (t !== lastDay) { lastDay = t; status = null; check(); } }, 15e3);
  window.addEventListener("nk:login", () => setTimeout(check, 800));
}

/* ---------- halaman Level & Rank ---------- */
const ring = (lv) => {
  const p = lv.max ? 100 : pctOf(lv.cur, lv.need);
  return `<div class="lv-ring" style="--p:${p.toFixed(1)}"><span class="col"><small>LEVEL</small><b>${lv.lv}</b><small>${Math.floor(p)}%</small></span></div>`;
};
const totalFor = (lv) => { let t = 0; for (let i = 1; i < lv; i++) t += S.need(i); return t; };

function rulesHtml(st) {
  const c = st?.counts || {};
  return RULES.map((r) => {
    let have = c[r.k] || 0, cap = r.cap, lab;
    if (r.k === "streak7") { have = st ? (st.claimed ? slotOf(st.day) : slotOf(st.day) - 1) : 0; lab = `${have}/7 hari minggu ini`; }
    else if (r.k === "login") lab = have ? "Sudah diklaim hari ini" : "Belum diklaim hari ini";
    else lab = `${have}/${cap} hari ini`;
    const full = have >= cap;
    return `<div class="er"><span class="er-ic k-${r.k}">${icon(r.ic, 17, 2)}</span>
      <span class="col grow gp2"><span class="row sb g8"><b>${r.t}</b><b class="er-amt">${r.amt} EXP</b></span>
        <span class="mu xs">${r.d}</span>
        <span class="er-bar ${full ? "full" : ""}"><span style="width:${pctOf(have, cap)}%"></span></span>
        <span class="row sb xs"><span class="${full ? "ok" : "mu"}">${lab}</span>${full && r.k !== "login" && r.k !== "streak7" ? `<span class="ok">Batas harian tercapai</span>` : ""}</span></span></div>`;
  }).join("");
}

function ladderHtml(lv, L) {
  const chips = [];
  for (let i = 1; i <= 99; i++) {
    const t = S.levelOf({ exp: totalFor(i) });
    chips.push(`<div class="lad ${i === lv.lv ? "me" : ""} ${i < lv.lv ? "past" : ""}" data-lv="${i}"><b>Lv.${i}</b><span class="lad-r t${t.tier}">${t.rank}</span>
      <span class="xs">${num(totalFor(i))} EXP</span><span class="mu xs">${i < 99 ? `+${num(S.need(i))} ke Lv.${i + 1}` : "Maksimal"}</span></div>`);
  }
  return `<div class="card col g6"><span class="row g8"><span class="gold">${icon("chart", 18, 2)}</span><b>Tangga level</b></span>
    <span class="mu xs lh">Angka EXP = total yang dibutuhkan untuk mencapai level itu. Tiap level butuh 40 EXP lebih banyak dari level sebelumnya.</span></div>
  <div class="lad-row" id="ladRow">${chips.join("")}</div>
  <h2 class="cap">Tangga rank</h2>
  <div class="group">${L.RANK_INFO.map(([n, a, b, c], i) => `<div class="rank-row ${i === lv.tier ? "me" : ""} ${i > lv.tier ? "lock" : ""}">${L.avatarHtml(S.state.profile, lv, 46, { tier: i, ini: S.state.profile?.name || n, noMedal: true })}
      <span class="rc-mid"><b style="color:${c}">${n}</b><span class="mu xs">Lv ${a}–${b} · mulai ${num(totalFor(a))} EXP</span></span><span class="xs b ${i === lv.tier ? "gold" : i < lv.tier ? "ok" : "mu"}">${i === lv.tier ? "RANK-MU" : i < lv.tier ? "Terlewati" : "Terkunci"}</span></div>`).join("")}</div>`;
}

const dayLabel = (iso) => {
  const d = new Date(iso), t = wibToday(), k = new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10);
  const y = new Date(Date.now() - 864e5 + 7 * 3600e3).toISOString().slice(0, 10);
  if (k === t) return "Hari ini";
  if (k === y) return "Kemarin";
  return d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Jakarta" });
};
async function historyHtml() {
  let rows;
  try { rows = await api.rest(`exp_log?select=kind,amount,total_after,note,created_at&order=created_at.desc&limit=300`); }
  catch { return `<div class="empty"><b>Riwayat EXP belum tersedia</b><span class="mu sm">Jalankan ulang ninokuu-schema.sql di Supabase.</span></div>`; }
  if (!rows?.length) return `<div class="empty"><b>Belum ada riwayat</b><span class="mu sm">Klaim login harian, baca chapter sampai habis, atau beri like untuk mendapat EXP.</span></div>`;
  let out = "", cur = "";
  for (const r of rows) {
    const g = dayLabel(r.created_at);
    if (g !== cur) { if (cur) out += `</div>`; cur = g; out += `<h2 class="cap mt8">${esc(g)}</h2><div class="group">`; }
    const a = S.levelOf({ exp: r.total_after - r.amount }), b = S.levelOf({ exp: r.total_after });
    const time = new Date(r.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
    out += `<div class="eh"><span class="er-ic k-${esc(r.kind)}">${icon(KIND[r.kind]?.ic || "star", 17, 2)}</span>
      <span class="col grow gp2"><b>${esc(KIND_LABEL[r.kind] || r.kind)}</b><span class="mu xs t1">${esc(r.note || "")}</span>
      <span class="xs ${b.lv > a.lv ? "gold b" : "mu"}">${time}${b.lv > a.lv ? ` · naik ke Lv.${b.lv}` : ""}</span></span><b class="er-amt">+${num(r.amount)} EXP</b></div>`;
  }
  return out + `</div><p class="mu xs lh">Riwayat EXP disimpan 30 hari, lalu dihapus otomatis supaya hemat ruang. Total EXP-mu tidak berkurang.</p>`;
}

export async function vLevel(view, L, tab = "sum") {
  await L.loadAvatars();
  const user = api.currentUser();
  const draw = async () => {
    const p = S.state.profile, lv = S.levelOf(p);
    const st = user ? await loadStatus() : null;
    const tabs = `<div class="seg s2 lv-tabs" role="tablist">${[["sum", "Ringkasan"], ["hist", "Riwayat"], ["lad", "Tangga"]].map(([k, n]) =>
      `<button role="tab" aria-selected="${tab === k}" data-act="tab" data-v="${k}">${n}</button>`).join("")}</div>`;
    let body = "";
    if (!user) body = `<div class="note">${icon("key", 18)}<span>Untuk mendapat EXP, streak, dan <b>Level &amp; Rank</b>, kamu harus <a href="#/more">masuk</a> terlebih dahulu.</span></div>`;
    if (tab === "sum") {
      const nextNeed = lv.max ? 0 : lv.need - lv.cur;
      body += `<div class="lv-card">
        <div class="row g14">${ring(lv)}<span class="col g4 grow">${L.rankPill(lv)}<b class="lv-exp">${num(p?.exp || 0)} EXP</b>
          <span class="mu xs">${lv.max ? (p?.role === "developer" ? "Developer · Lv 99" : "Level maksimal tercapai") : `${num(nextNeed)} EXP lagi ke level ${lv.lv + 1}`}</span>
          <span class="prog l"><span style="width:${lv.max ? 100 : pctOf(lv.cur, lv.need)}%"></span></span></span></div>
        <div class="lv-stats"><span><b class="fire">${icon("flame", 15, 2)}${st?.streak ?? 0} Hari</b><small>Streak</small></span>
          <span><b>${st?.best ?? 0} hari</b><small>Streak terbaik</small></span>
          <span><b>Lv.${Math.min(99, lv.lv + 1)}</b><small>Level berikutnya</small></span></div></div>
      ${user ? `<button class="daily-cta ${st?.claimed ? "done" : ""}" data-act="daily"><span class="dl-hic sm">${icon(st?.claimed ? "check" : "gift", 20, 2)}</span>
          <span class="col grow gp2"><b>${st?.claimed ? `Login harian diklaim · Day ${st.day}` : `Klaim login harian · Day ${st?.day || 1}`}</b>
          <span class="mu xs">${st?.claimed ? `Minggu ke-${weekOf(st.day)} · kembali besok setelah 00.00 WIB supaya streak tidak putus` : `+${loginExp(st?.day || 1)} EXP${slotOf(st?.day || 1) === 7 ? ` + bonus ${BONUS7}` : ""} · minggu ke-${weekOf(st?.day || 1)} · klaim sebelum 00.00 WIB`}</span>
          <span class="dl-dots">${[1, 2, 3, 4, 5, 6, 7].map((i) => `<i class="${st && (i < slotOf(st.day) || (i === slotOf(st.day) && st.claimed)) ? "on" : ""}"></i>`).join("")}</span></span>
          <span class="mu">${icon("chev", 18)}</span></button>
        <a class="daily-cta recap" href="#/p/recap"><span class="dl-hic sm blue">${icon("share", 20, 2)}</span><span class="col grow gp2"><b>Rekap bacaan</b><span class="mu xs">7 & 30 hari terakhir · bagikan sebagai gambar</span></span><span class="mu">${icon("chev", 18)}</span></a>` : ""}
      <h2 class="cap row g6"><span class="gold">${icon("star", 15, 2)}</span>Cara dapat EXP</h2>
      <div class="group er-list">${rulesHtml(st)}</div>
      <p class="mu xs lh">Progres harian dihitung sejak 00.00 WIB. Batas harian mencegah EXP didapat dengan cara curang; setelah batas tercapai, aktivitas tetap tercatat tapi tanpa EXP.</p>`;
    } else if (tab === "hist") {
      body += user ? `<div id="ehist">${L.loading(5, "sk-lrow")}</div>` : "";
    } else body += ladderHtml(lv, L);
    view.innerHTML = L.topbar("Level &amp; Rank") + `<div class="px col g14 mt6 lv-page">${tabs}${body}</div><div style="height:calc(40px + env(safe-area-inset-bottom))"></div>`;
    if (tab === "hist" && user) { const h = await historyHtml(); const box = $("#ehist"); if (box) box.innerHTML = h; }
    if (tab === "lad") { const me = $("#ladRow .lad.me"); if (me) $("#ladRow").scrollLeft = me.offsetLeft - 16; }
  };
  L.setActs({
    back: () => L.back("#/more"),
    tab: (el) => { if (tab === el.dataset.v) return; tab = el.dataset.v; draw(); },
    daily: () => openDaily(true),
  });
  const again = () => { if (document.body.dataset.screen === "page" && $(".lv-page")) draw(); };
  window.addEventListener("nk:daily", again);
  await draw();
  return () => window.removeEventListener("nk:daily", again);
}

/* ---------- Rekap bacaan ---------- */
const MON = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const range = (a, b) => { const x = new Date(a + "T00:00:00Z"), y = new Date(b + "T00:00:00Z");
  return x.getUTCMonth() === y.getUTCMonth() ? `${x.getUTCDate()}–${y.getUTCDate()} ${MON[y.getUTCMonth()]} ${y.getUTCFullYear()}` : `${x.getUTCDate()} ${MON[x.getUTCMonth()]} – ${y.getUTCDate()} ${MON[y.getUTCMonth()]} ${y.getUTCFullYear()}`; };

export async function vRecap(view, L) {
  await L.loadAvatars();
  if (!api.currentUser()) { view.innerHTML = L.topbar("Rekap bacaan") + `<div class="px"><div class="note">${icon("key", 18)}<span>Masuk dulu untuk melihat rekap bacaanmu. <a href="#/more">Masuk</a></span></div></div>`; L.setActs({ back: () => L.back("#/more") }); return; }
  let days = 7, data = null, busy = false;
  const cache = {};
  const draw = () => {
    const p = S.state.profile, lv = S.levelOf(p), st = cachedStatus();
    const maxD = Math.max(1, ...(data?.per_day || [0]));
    view.innerHTML = L.topbar("Rekap bacaan", `<button class="icon-btn" data-act="reload" aria-label="Muat ulang">${icon("refresh", 20)}</button>`) + `<div class="px col g14 mt6">
  <div class="seg s2" role="tablist">${[[7, "Mingguan", "7 hari terakhir"], [30, "Bulanan", "30 hari terakhir"]].map(([k, n, s]) =>
    `<button role="tab" class="seg-2l" aria-selected="${days === k}" data-act="days" data-v="${k}"><b>${n}</b><small>${s}</small></button>`).join("")}</div>
  ${!data ? L.loading(1, "sk-hero") : `<div class="rc-card" id="rcCard">
    <div class="row g12">${L.avatarHtml(p, lv, 56)}<span class="col g4 grow"><b class="b16">${esc(p?.name || "Pembaca")}</b><span class="row g6"><span class="lv-chip">Lv. ${lv.lv}</span>${L.rankPill(lv)}</span></span>
      <span class="fire-chip">${icon("flame", 14, 2)}${st?.streak ?? 0} hari</span></div>
    <span class="rc-kick">NINOKUU · ${days} HARI TERAKHIR</span>
    <b class="rc-title">Rekap ${days} Hari</b>
    <span class="rc-range"><i></i>${range(data.from, data.to)}</span>
    <div class="rc-big"><span><b class="gold">${num(data.chapters)}</b><small>CHAPTER</small><em>dibaca sampai habis</em></span><span><b class="redt">${num(data.series)}</b><small>SERIES</small><em>judul berbeda</em></span></div>
    <div class="rc-chart" aria-label="Chapter per hari">${(data.per_day || []).map((n) => `<i style="height:${n ? Math.max(8, (n / maxD) * 100) : 3}%" class="${n ? "on" : ""}"></i>`).join("")}</div>
    ${data.top?.length ? `<span class="rc-sub">Paling sering dibaca</span><div class="rc-top">${data.top.map((t, i) => `<a class="rc-tc" href="#/c/${esc(t.source)}/${encodeURIComponent(t.comic_id)}">
      <span class="rc-cv">${t.cover ? `<img src="${esc(t.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}<i>${i + 1}</i></span>
      <span class="t2 xs b">${esc(t.title || t.comic_id)}</span><span class="mu xs">${num(t.n)} chapter</span></a>`).join("")}</div>` : `<span class="mu sm">Belum ada chapter yang dibaca sampai habis di periode ini.</span>`}
    <div class="rc-mini">${[["star", num(data.exp), "EXP"], ["thumb", num(data.likes), "Like"], ["bookmark", num(data.saved), "Koleksi"], ["cal", `${num(data.active)}/${days}`, "Hari aktif"]].map(([ic, v, n]) =>
      `<span><i>${icon(ic, 17, 2)}</i><b>${v}</b><small>${n}</small></span>`).join("")}</div>
    <span class="rc-brand"><img src="icons/icon-192.png" alt="">Ninokuu</span>
  </div>
  <button class="btn primary" data-act="share" ${busy ? "disabled" : ""}>${icon("share", 18, 2)}${busy ? "Menyiapkan gambar…" : "Bagikan"}</button>
  <p class="mu xs center m0">Dibagikan sebagai gambar 9:16, pas untuk story.</p>`}</div><div style="height:calc(40px + env(safe-area-inset-bottom))"></div>`;
  };
  const load = async (force = false) => {
    if (!force && cache[days]) { data = cache[days]; draw(); return; }
    data = null; draw();
    await loadStatus();
    try { data = cache[days] = await api.rpc("my_recap", { p_days: days }); }
    catch (e) { view.querySelector(".px").innerHTML += `<div class="note warn">${icon("info", 18)}<span>Rekap belum bisa dimuat (${esc(e.message)}). Pastikan ninokuu-schema.sql terbaru sudah dijalankan.</span></div>`; return; }
    if (document.body.dataset.screen === "page") draw();
  };
  L.setActs({
    back: () => L.back("#/p/level"),
    days: (el) => { const v = Number(el.dataset.v); if (v === days) return; days = v; load(); },
    reload: () => load(true),
    share: async () => {
      if (!data || busy) return;
      busy = true; draw();
      try { const blob = await drawRecap(data, days); await shareImage(blob, `ninokuu-rekap-${days}-hari.png`); }
      catch (e) { if (e?.name !== "AbortError") toast(e.message || "Gagal membuat gambar"); }
      busy = false; draw();
    },
  });
  await load();
}

/* ---------- gambar rekap 1080×1920 ---------- */
const loadImg = (src) => new Promise((ok) => {
  if (!src) return ok(null);
  const im = new Image(); im.crossOrigin = "anonymous"; im.referrerPolicy = "no-referrer";
  const t = setTimeout(() => ok(null), 6000);
  im.onload = () => { clearTimeout(t); ok(im); }; im.onerror = () => { clearTimeout(t); ok(null); };
  im.src = src;
});
const rr = (c, x, y, w, h, r) => { c.beginPath(); c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h); };
function fit(c, text, max) { let t = String(text || ""); if (c.measureText(t).width <= max) return t; while (t && c.measureText(t + "…").width > max) t = t.slice(0, -1); return t + "…"; }

export async function drawRecap(data, days) {
  const p = S.state.profile, lv = S.levelOf(p), st = cachedStatus();
  const W = 1080, H = 1920, F = getComputedStyle(document.body).getPropertyValue("--font") || "sans-serif";
  try { await document.fonts?.ready; } catch {}
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const c = cv.getContext("2d");
  const f = (w, s) => `${w} ${s}px ${F}`;
  // latar navy + cahaya merah/emas + bintang
  let g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#151D2C"); g.addColorStop(1, "#0B1018"); c.fillStyle = g; c.fillRect(0, 0, W, H);
  g = c.createRadialGradient(900, 240, 40, 900, 240, 760); g.addColorStop(0, "rgba(224,36,43,.35)"); g.addColorStop(1, "rgba(224,36,43,0)"); c.fillStyle = g; c.fillRect(0, 0, W, H);
  g = c.createRadialGradient(120, 1560, 40, 120, 1560, 700); g.addColorStop(0, "rgba(242,179,61,.18)"); g.addColorStop(1, "rgba(242,179,61,0)"); c.fillStyle = g; c.fillRect(0, 0, W, H);
  let seed = 7; const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 90; i++) { c.fillStyle = `rgba(255,255,255,${0.15 + rnd() * 0.5})`; c.beginPath(); c.arc(rnd() * W, rnd() * H, 1 + rnd() * 2.6, 0, 7); c.fill(); }
  // kartu (posisi pasti supaya tidak pernah meluber)
  const X = 60, Y = 110, CW = W - 120, CH = 1690;
  rr(c, X, Y, CW, CH, 56); c.fillStyle = "rgba(20,27,39,.82)"; c.fill(); c.strokeStyle = "rgba(255,255,255,.08)"; c.lineWidth = 2; c.stroke();
  const ax = X + 64, bw = CW - 128;
  // avatar
  const av = p?.avatar_path ? await loadImg(api.publicUrl("avatars", p.avatar_path)) : null;
  const ay = Y + 64, AS = 140;
  c.save(); c.beginPath(); c.arc(ax + AS / 2, ay + AS / 2, AS / 2 + 6, 0, 7); g = c.createLinearGradient(ax, ay, ax + AS, ay + AS); g.addColorStop(0, "#F2B33D"); g.addColorStop(1, "#E0242B"); c.fillStyle = g; c.fill();
  c.beginPath(); c.arc(ax + AS / 2, ay + AS / 2, AS / 2, 0, 7); c.clip();
  if (av) c.drawImage(av, ax, ay, AS, AS); else { c.fillStyle = "#1C2533"; c.fillRect(ax, ay, AS, AS); c.fillStyle = "#fff"; c.font = f(800, 66); c.textAlign = "center"; c.textBaseline = "middle"; c.fillText((p?.name || "?").trim()[0]?.toUpperCase() || "?", ax + AS / 2, ay + AS / 2 + 4); }
  c.restore(); c.textAlign = "left"; c.textBaseline = "alphabetic";
  c.fillStyle = "#F2F4F8"; c.font = f(800, 52); c.fillText(fit(c, p?.name || "Pembaca", 440), ax + AS + 36, ay + 62);
  const pill = (x, y, txt, bg, fg) => { c.font = f(800, 28); const w = c.measureText(txt).width + 40; rr(c, x, y, w, 52, 26); c.fillStyle = bg; c.fill(); c.fillStyle = fg; c.fillText(txt, x + 20, y + 36); return w; };
  let px = ax + AS + 36; px += pill(px, ay + 86, `Lv. ${lv.lv}`, "rgba(242,179,61,.18)", "#F2B33D") + 12; pill(px, ay + 86, lv.rank.toUpperCase(), "rgba(224,36,43,.22)", "#FF8A8E");
  c.font = f(800, 30); const sTxt = `🔥 ${st?.streak ?? 0} hari`, sw = c.measureText(sTxt).width + 44;
  rr(c, X + CW - 64 - sw, ay + 4, sw, 60, 30); c.fillStyle = "rgba(255,120,60,.16)"; c.fill(); c.strokeStyle = "rgba(255,140,80,.5)"; c.stroke(); c.fillStyle = "#FFB27A"; c.fillText(sTxt, X + CW - 64 - sw + 22, ay + 45);
  // judul
  c.fillStyle = "#A3ACBD"; c.font = f(800, 28); c.fillText(`NINOKUU  ·  ${days} HARI TERAKHIR`, ax, 390);
  c.fillStyle = "#fff"; c.font = f(800, 96); c.fillText(`Rekap ${days} Hari`, ax, 490);
  g = c.createLinearGradient(ax, 0, ax + 80, 0); g.addColorStop(0, "#F2B33D"); g.addColorStop(1, "#E0242B"); c.fillStyle = g; rr(c, ax, 536, 80, 10, 5); c.fill();
  c.fillStyle = "#F2B33D"; c.font = f(700, 38); c.fillText(range(data.from, data.to), ax + 104, 554);
  // angka besar
  let y = 596; rr(c, ax, y, bw, 220, 34); c.fillStyle = "rgba(255,255,255,.05)"; c.fill(); c.strokeStyle = "rgba(255,255,255,.08)"; c.stroke();
  c.fillStyle = "rgba(255,255,255,.1)"; c.fillRect(ax + bw / 2, y + 36, 2, 148);
  const big = (x, v, lab, sub, col) => { c.fillStyle = col; c.font = f(800, 100); c.fillText(num(v), x, y + 112); c.fillStyle = "#F2F4F8"; c.font = f(800, 30); c.fillText(lab, x, y + 160); c.fillStyle = "#A3ACBD"; c.font = f(500, 28); c.fillText(sub, x, y + 196); };
  big(ax + 40, data.chapters, "CHAPTER", "dibaca sampai habis", "#F2B33D"); big(ax + bw / 2 + 40, data.series, "SERIES", "judul berbeda", "#FF6B70");
  // grafik per hari
  c.fillStyle = "#A3ACBD"; c.font = f(700, 28); c.fillText("Chapter per hari", ax, 880);
  y = 900; const pd = data.per_day || [], mx = Math.max(1, ...pd), gw = bw / Math.max(1, pd.length), gh = 120;
  pd.forEach((n, i) => { const h = n ? Math.max(10, (n / mx) * gh) : 6; g = c.createLinearGradient(0, y + gh - h, 0, y + gh); g.addColorStop(0, n ? "#F2B33D" : "rgba(255,255,255,.12)"); g.addColorStop(1, n ? "#E0242B" : "rgba(255,255,255,.12)"); c.fillStyle = g; rr(c, ax + i * gw + gw * 0.18, y + gh - h, gw * 0.64, h, Math.min(10, gw * 0.3)); c.fill(); });
  // judul teratas
  c.fillStyle = "#A3ACBD"; c.font = f(700, 28); c.fillText("Paling sering dibaca", ax, 1076);
  y = 1098; const cw = (bw - 40) / 3, chh = 250;
  if (data.top?.length) {
    const covers = await Promise.all(data.top.map((t) => loadImg(t.cover)));
    data.top.forEach((t, i) => {
      const x = ax + i * (cw + 20);
      c.save(); rr(c, x, y, cw, chh, 22); c.fillStyle = "#1C2533"; c.fill(); c.clip();
      const im = covers[i]; if (im) { const s = Math.max(cw / im.width, chh / im.height); c.drawImage(im, x + (cw - im.width * s) / 2, y + (chh - im.height * s) / 2, im.width * s, im.height * s); }
      c.restore();
      c.beginPath(); c.arc(x + 32, y + 32, 22, 0, 7); c.fillStyle = i === 0 ? "#F2B33D" : "rgba(11,16,24,.8)"; c.fill(); c.fillStyle = i === 0 ? "#111" : "#fff"; c.font = f(800, 24); c.textAlign = "center"; c.fillText(String(i + 1), x + 32, y + 41); c.textAlign = "left";
      c.fillStyle = "#F2F4F8"; c.font = f(700, 26); c.fillText(fit(c, t.title || t.comic_id, cw), x, y + chh + 38);
      c.fillStyle = "#A3ACBD"; c.font = f(500, 24); c.fillText(`${num(t.n)} chapter`, x, y + chh + 68);
    });
  } else { c.fillStyle = "#A3ACBD"; c.font = f(500, 28); c.fillText("Belum ada chapter yang selesai dibaca di periode ini.", ax, y + 40); }
  // statistik kecil
  y = 1460; rr(c, ax, y, bw, 150, 30); c.fillStyle = "rgba(255,255,255,.05)"; c.fill();
  const minis = [[num(data.exp), "EXP", "#F2B33D"], [num(data.likes), "Like", "#6FC3F2"], [num(data.saved), "Koleksi", "#FF6B70"], [`${data.active}/${days}`, "Hari aktif", "#5DD39E"]];
  minis.forEach(([v, n, col], i) => { const cx = ax + (bw / 4) * (i + 0.5); c.textAlign = "center"; c.fillStyle = col; c.font = f(800, 50); c.fillText(v, cx, y + 82); c.fillStyle = "#A3ACBD"; c.font = f(600, 26); c.fillText(n, cx, y + 122); });
  c.textAlign = "left";
  // merek
  const logo = await loadImg("icons/icon-192.png");
  const by = 1666;
  if (logo) { c.save(); rr(c, ax, by, 64, 64, 16); c.clip(); c.drawImage(logo, ax, by, 64, 64); c.restore(); }
  c.fillStyle = "#fff"; c.font = f(800, 42); c.fillText("Ninokuu", ax + (logo ? 84 : 0), by + 46);
  c.fillStyle = "#A3ACBD"; c.font = f(500, 26); c.textAlign = "right"; c.fillText("manga · manhwa · manhua", X + CW - 64, by + 44); c.textAlign = "left";
  c.fillStyle = "rgba(255,255,255,.45)"; c.font = f(600, 28); c.textAlign = "center"; c.fillText("Dibuat dengan Ninokuu", W / 2, 1866); c.textAlign = "left";
  return await new Promise((ok, no) => cv.toBlob((b) => (b ? ok(b) : no(new Error("Gagal membuat gambar"))), "image/png"));
}

const toB64 = (blob) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.onerror = no; r.readAsDataURL(blob); });
// APK: simpan di cache lalu buka lembar bagikan Android. Web: Web Share API atau unduh.
export async function shareImage(blob, name) {
  const C = N.isApp ? window.Capacitor : null;
  if (C?.isPluginAvailable?.("Filesystem") && C.isPluginAvailable("Share") && C.registerPlugin) {
    const FS = C.Plugins?.Filesystem || C.registerPlugin("Filesystem"), SH = C.Plugins?.Share || C.registerPlugin("Share");
    const { uri } = await FS.writeFile({ path: name, data: await toB64(blob), directory: "CACHE" });
    try { await SH.share({ title: "Rekap bacaan Ninokuu", files: [uri], dialogTitle: "Bagikan rekap" }); }
    catch (e) { if (!/cancel/i.test(e?.message || "")) throw e; }
    return;
  }
  const file = new File([blob], name, { type: "image/png" });
  if (!N.isApp && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: "Rekap bacaan Ninokuu" }); return; }
  if (!N.isApp) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast("Gambar rekap disimpan ke Unduhan"); return;
  }
  // APK lama (belum ada plugin bagikan): tampilkan gambarnya
  const url = URL.createObjectURL(blob);
  const h = document.createElement("div"); h.className = "dl-host on img-prev";
  h.innerHTML = `<div class="dl-card"><button class="dl-x" data-d="close" aria-label="Tutup">${icon("x", 18, 2.2)}</button><img src="${url}" alt="Rekap"><p class="mu xs center">Perbarui aplikasi ke versi terbaru untuk membagikan langsung.</p></div>`;
  h.addEventListener("click", (e) => { if (e.target === h || e.target.closest("[data-d=close]")) { h.remove(); URL.revokeObjectURL(url); } });
  document.body.append(h);
}
