// EXP v2: login harian + streak, pil "+EXP", halaman Level & Rank (Ringkasan · Riwayat · Tangga),
// rekap bacaan 7/30 hari yang bisa dibagikan sebagai gambar 9:16.
// Semua EXP dihitung di server (lihat bagian 13 ninokuu-schema.sql); di sini hanya tampilan.
import * as api from "./api.js";
import * as S from "./store.js";
import * as N from "./native.js";
import { esc, icon, $, $$, toast, rankBadge, rankText } from "./ui.js";

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
  try { status = await api.rpc("daily_status"); statusAt = Date.now(); if (status) api.lsSet("dailyStatus", status); } catch { status = null; }
  return status;
}
export const cachedStatus = () => status;
// status terakhir yang tersimpan di HP (hanya bila masih hari yang sama)
const savedStatus = () => { const c = status || api.lsGet("dailyStatus"); return c && c.today === wibToday() ? c : null; };
api.onAuth((sess) => { if (!sess) { status = null; api.lsSet("dailyStatus", null); } });

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
const seenKey = () => "ninokuu:dailySeen:" + (api.userId() || "");
const seen = { get: () => { try { return sessionStorage.getItem(seenKey()); } catch { return null; } }, set: (d) => { try { sessionStorage.setItem(seenKey(), d); } catch {} } };
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
    chips.push(`<div class="lad ${i === lv.lv ? "me" : ""} ${i < lv.lv ? "past" : ""}" data-lv="${i}"><b>Lv.${i}</b>${rankBadge(t, "xs")}
      <span class="xs">${num(totalFor(i))} EXP</span><span class="mu xs">${i < 99 ? `+${num(S.need(i))} ke Lv.${i + 1}` : "Maksimal"}</span></div>`);
  }
  return `<div class="card col g6"><span class="row g8"><span class="gold">${icon("chart", 18, 2)}</span><b>Tangga level</b></span>
    <span class="mu xs lh">Angka EXP = total yang dibutuhkan untuk mencapai level itu. Tiap level butuh 40 EXP lebih banyak dari level sebelumnya.</span></div>
  <div class="lad-row" id="ladRow">${chips.join("")}</div>
  <h2 class="cap">Tangga rank</h2>
  <div class="group">${L.RANK_INFO.map(([n, a, b, c, t], i) => `<div class="rank-row ${i === lv.ri ? "me" : ""} ${i > lv.ri ? "lock" : ""}">${L.avatarHtml(S.state.profile, lv, 46, { tier: t, ini: S.state.profile?.name || n, noMedal: true })}
      <span class="rc-mid">${rankText(n, t)}<span class="mu xs">Lv ${a}–${b} · mulai ${num(totalFor(a))} EXP</span></span><span class="xs b ${i === lv.ri ? "gold" : i < lv.ri ? "ok" : "mu"}">${i === lv.ri ? "RANK-MU" : i < lv.ri ? "Terlewati" : "Terkunci"}</span></div>`).join("")}</div>`;
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
  // digambar langsung dari data terakhir (tanpa layar kosong), lalu diperbarui setelah server menjawab
  const draw = async () => {
    const p = S.state.profile, lv = S.levelOf(p);
    const st = user ? savedStatus() : null;
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
  const alive = () => document.body.dataset.screen === "page" && $(".lv-page");
  const again = () => { if (alive()) loadStatus(true).then(() => { if (alive()) { const y = scrollY; draw().then(() => scrollTo(0, y)); } }); };
  window.addEventListener("nk:daily", again);
  window.addEventListener("nk:exp", again);
  await draw();
  if (user) {
    const before = JSON.stringify(savedStatus());
    loadStatus().then((st) => { if (st && JSON.stringify(st) !== before && alive() && tab === "sum") { const y = scrollY; draw().then(() => scrollTo(0, y)); } });
  }
  return () => { window.removeEventListener("nk:daily", again); window.removeEventListener("nk:exp", again); };
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
    const p = S.state.profile, lv = S.levelOf(p), st = savedStatus();
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
const loadRaw = (src, cors) => new Promise((ok) => {
  if (!src) return ok(null);
  const im = new Image(); if (cors) im.crossOrigin = "anonymous"; im.referrerPolicy = "no-referrer";
  const t = setTimeout(() => ok(null), 8000);
  im.onload = () => { clearTimeout(t); ok(im); }; im.onerror = () => { clearTimeout(t); ok(null); };
  im.src = src;
});
// gambar untuk kanvas harus boleh dibaca (CORS). Situs seperti Shinigami/WestManga menolak →
// di APK diambil lewat jaringan HP lalu dipakai sebagai blob lokal.
async function loadImg(src) {
  if (!src) return null;
  if (/^(blob:|data:)/.test(src) || !/^https?:/i.test(src) || src.startsWith(location.origin)) return loadRaw(src, false);
  const im = await loadRaw(src, true);
  if (im || !N.isApp) return im;
  try { return await loadRaw(await N.imageViaNative(src), false); } catch { return null; }
}
// bingkai avatar kosmik (sama dengan di aplikasi) digambar ulang di kanvas: cincin, ornamen SVG, medali level
const conic = (c, cx, cy, fromDeg, colors) => {
  if (!c.createConicGradient) { const g = c.createLinearGradient(cx - 50, cy - 50, cx + 50, cy + 50); colors.forEach((col, i) => g.addColorStop(i / Math.max(1, colors.length - 1), col)); return g; }
  const g = c.createConicGradient((fromDeg - 90) * Math.PI / 180, cx, cy);
  colors.forEach((col, i) => g.addColorStop(i / Math.max(1, colors.length - 1), col)); return g;
};
const svgImg = async (inner, defs) => {
  const url = URL.createObjectURL(new Blob([`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-52 -52 224 224" width="448" height="448">${defs}${inner}</svg>`], { type: "image/svg+xml" }));
  const im = await loadRaw(url, false); setTimeout(() => URL.revokeObjectURL(url), 2000); return im;
};
async function drawAvatar(c, ax, ay, AS, p, lv, F, opt = {}) {
  const k = AS / 116, cx = ax + AS / 2, cy = ay + AS / 2;
  const photo = p?.avatar_path ? await loadImg(api.publicUrl("avatars", p.avatar_path)) : null;
  let M = null; try { M = await import("./avatars.js"); } catch {}
  const tpl = M?.AV?.[116]?.[lv.tier];
  const circle = (r, fill) => { c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fillStyle = fill; c.fill(); };
  const inside = (r) => {
    c.save(); c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.clip();
    if (photo) { const sc = Math.max(2 * r / photo.width, 2 * r / photo.height); c.drawImage(photo, cx - photo.width * sc / 2, cy - photo.height * sc / 2, photo.width * sc, photo.height * sc); }
    c.restore();
  };
  if (!tpl) {   // cadangan: cincin emas-merah sederhana
    const g = c.createLinearGradient(ax, ay, ax + AS, ay + AS); g.addColorStop(0, "#F2B33D"); g.addColorStop(1, "#E0242B");
    circle(AS / 2 + 6, g); circle(AS / 2, "#1C2533"); inside(AS / 2);
    if (!photo) { c.fillStyle = "#fff"; c.font = `800 ${Math.round(AS * 0.47)}px ${F}`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText((p?.name || "?").trim()[0]?.toUpperCase() || "?", cx, cy + 3); c.textAlign = "left"; c.textBaseline = "alphabetic"; }
    return;
  }
  const num1 = (re, d = null) => { const m = tpl.match(re); return m ? m.slice(1) : d; };
  const pulse = num1(/nk-pulse[^>]*?inset:(-?[\d.]+)px[^>]*?closest-side,(#[0-9A-Fa-f]+)/);
  const neb = num1(/nk3-neb[^>]*?conic-gradient\(from 0deg,([^)]*)\);box-shadow:0 0 ([\d.]+)px (rgba\([^)]*\))/);
  const ring2 = num1(/nk3-neb[\s\S]*?<\/span><span style="position:absolute;inset:([\d.]+)px;border-radius:50%;background:([^"]+)">/);
  const inner = num1(/inset:([\d.]+)px;border-radius:50%;overflow:hidden;background:radial-gradient\(circle at 35% 30%,(#[0-9A-Fa-f]+)/, ["6", "#1C2533"]);
  const medal = num1(/clip-path:inherit;background:radial-gradient\(circle at 40% 30%,(#[0-9A-Fa-f]+)/, ["#F2B33D"]);
  const glow = num1(/text-shadow:0 0 ([\d.]+)px (#[0-9A-Fa-f]+)/, ["6", "#FFFFFFaa"]);
  const svgs = [...tpl.matchAll(/<svg[^>]*>([\s\S]*?)<\/svg>/g)].map((m) => m[1]);
  const defs = M.SPRITE.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  const [back, front] = await Promise.all(svgs.map((x) => svgImg(x, defs)));
  const sx = ax - 50 * k, sw = 217 * k;
  // cahaya berdenyut
  if (pulse) { const r = (58 - Number(pulse[0])) * k, g = c.createRadialGradient(cx, cy, 0, cx, cy, r); const pc = pulse[1].slice(0, 7); g.addColorStop(0, pc + "66"); g.addColorStop(.72, pc + "00"); circle(r, g); }
  if (back) c.drawImage(back, sx, ay - 50 * k, sw, sw);
  // cincin nebula + cincin kedua
  if (neb) { c.save(); c.shadowColor = neb[2]; c.shadowBlur = Number(neb[1]) * k; circle(58 * k, conic(c, cx, cy, 0, neb[0].split(","))); c.restore(); }
  if (ring2) { const bg = ring2[1].startsWith("conic") ? conic(c, cx, cy, 45, ring2[1].replace(/^conic-gradient\(from 45deg,/, "").replace(/\)$/, "").split(",")) : ring2[1]; circle((58 - Number(ring2[0])) * k, bg); }
  const ri = (58 - Number(inner[0])) * k;
  const ig = c.createRadialGradient(ax + AS * .35, ay + AS * .3, 0, ax + AS * .35, ay + AS * .3, ri * 1.6); ig.addColorStop(0, inner[1]); ig.addColorStop(.78, "#05070D"); ig.addColorStop(1, "#05070D");
  circle(ri, ig);
  if (opt.bare) { /* tengah dibiarkan gelap: foto/inisial dipasang di atasnya oleh chat */ }
  else if (photo) inside(ri);
  else { c.save(); c.fillStyle = "#F7F2E6"; c.shadowColor = glow[1]; c.shadowBlur = Number(glow[0]) * k; c.font = `${Math.round(48 * k)}px "Instrument Serif", Georgia, serif`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText((p?.name || "?").trim()[0]?.toUpperCase() || "?", cx, cy + 2 * k); c.restore(); }
  if (front) c.drawImage(front, sx, ay - 50 * k, sw, sw);
  if (opt.bare) return;
  // medali level (segi enam) di kanan bawah
  const txt = String(lv.lv); c.font = `800 ${10.6 * k}px ${F}`;
  const mw = Math.max(29, c.measureText(txt).width / k + 8) * k, mh = 29 * k, mx = ax + 120 * k - mw, my = ay + 118 * k - mh;
  const hex = (x, y, w, h) => { c.beginPath(); c.moveTo(x + w * .25, y); c.lineTo(x + w * .75, y); c.lineTo(x + w, y + h / 2); c.lineTo(x + w * .75, y + h); c.lineTo(x + w * .25, y + h); c.lineTo(x, y + h / 2); c.closePath(); };
  hex(mx, my, mw, mh); c.fillStyle = conic(c, mx + mw / 2, my + mh / 2, 30, ["#F2D27A", "#7A5A1C", "#FFF4D1", "#F2D27A", "#9A7426", "#F2D27A"]); c.fill();
  const b = 1.9 * k; hex(mx + b, my + b, mw - 2 * b, mh - 2 * b);
  const mg = c.createRadialGradient(mx + mw * .4, my + mh * .3, 0, mx + mw * .4, my + mh * .3, mw * .8); mg.addColorStop(0, medal[0]); mg.addColorStop(.85, "#05070D"); mg.addColorStop(1, "#05070D"); c.fillStyle = mg; c.fill();
  c.fillStyle = "#FFF4D1"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(txt, mx + mw / 2, my + mh / 2 + .5 * k); c.textAlign = "left"; c.textBaseline = "alphabetic";
}
// bingkai rank sebagai gambar siap pakai (untuk chat & komentar): digambar sekali per rank lalu disimpan,
// jadi menggulir daftar panjang tetap ringan. Gambar 150×150 untuk avatar 40 px (2×), bingkai melebar ±17 px.
const frameCache = new Map();
export function frameImage(tier) {
  if (!frameCache.has(tier)) frameCache.set(tier, (async () => {
    const cv = document.createElement("canvas"); cv.width = cv.height = 150;
    const c = cv.getContext("2d");
    await drawAvatar(c, 34.5, 34.5, 80, null, { tier, lv: 1 }, "sans-serif", { bare: true });
    return cv.toDataURL("image/png");
  })().catch(() => null));
  return frameCache.get(tier);
}
const rr = (c, x, y, w, h, r) => { c.beginPath(); c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h); };
function fit(c, text, max) { let t = String(text || ""); if (c.measureText(t).width <= max) return t; while (t && c.measureText(t + "…").width > max) t = t.slice(0, -1); return t + "…"; }

export async function drawRecap(data, days) {
  const p = S.state.profile, lv = S.levelOf(p), st = savedStatus();
  const W = 1080, H = 1920, F = getComputedStyle(document.body).getPropertyValue("--font") || "sans-serif";
  // pastikan font aplikasi (semua ketebalan) sudah termuat; kanvas tidak memuat font sendiri
  try { await Promise.all(["500", "600", "700", "800"].map((w) => document.fonts.load(`${w} 40px "Plus Jakarta Sans"`))); await document.fonts.ready; } catch {}
  const sp = (px) => { if ("letterSpacing" in c) c.letterSpacing = px + "px"; };
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
  // avatar dengan bingkai rank (bingkai melebar ±45% di luar lingkaran)
  const AS = 128, avx = ax + 40, avy = Y + 84;
  await drawAvatar(c, avx, avy, AS, p, lv, F);
  const nx = avx + AS + 78;
  c.fillStyle = "#F2F4F8"; c.font = f(700, 44); c.fillText(fit(c, p?.name || "Pembaca", X + CW - 64 - nx), nx, avy + 60);
  const pill = (x, y, txt, bg, fg, ls = 0) => { c.font = f(800, 27); sp(ls); const w = c.measureText(txt).width + 36; rr(c, x, y, w, 50, 16); c.fillStyle = bg; c.fill(); c.fillStyle = fg; c.fillText(txt, x + 18, y + 35); sp(0); return w; };
  let px = nx; px += pill(px, avy + 86, `Lv. ${lv.lv}`, "rgba(242,179,61,.18)", "#F2B33D") + 12;
  // label rank: border & warna mengikuti bingkai (sama dengan di aplikasi)
  const RC = ["#C9D2E3", "#F0BE84", "#FF9A66", "#6FD0FF", "#4FE3B8", "#8FA5FF", "#C49BFF", "#FF8DBB", "#F7C14E"][lv.tier] || "#C9D2E3";
  { const txt = lv.rank.toUpperCase(); c.font = f(800, 27); sp(1.5); const w = c.measureText(txt).width + 36, y0 = avy + 86;
    rr(c, px, y0, w, 50, 16); c.fillStyle = RC + "2E"; c.fill(); c.strokeStyle = RC + "B0"; c.lineWidth = 2.5; c.stroke();
    if (lv.tier >= 6) { c.save(); c.shadowColor = RC; c.shadowBlur = 16; c.strokeStyle = RC + "60"; c.stroke(); c.restore(); }
    if (lv.tier === 8) { const gg = c.createLinearGradient(px, 0, px + w, 0); gg.addColorStop(0, "#C8871A"); gg.addColorStop(.45, "#FFF1BF"); gg.addColorStop(.6, "#F7C14E"); gg.addColorStop(1, "#C8871A"); c.fillStyle = gg; }
    else if (lv.tier >= 6) { const gg = c.createLinearGradient(px, 0, px + w, 0); gg.addColorStop(0, RC); gg.addColorStop(.5, "#ffffff"); gg.addColorStop(1, RC); c.fillStyle = gg; }
    else c.fillStyle = RC;
    c.fillText(txt, px + 18, y0 + 35); sp(0);
    if (lv.tier === 8) [[.18, .25], [.72, .7], [.95, .3]].forEach(([fx, fy]) => { const sx2 = px + w * fx, sy2 = y0 + 50 * fy, rg = c.createRadialGradient(sx2, sy2, 0, sx2, sy2, 9); rg.addColorStop(0, "#fff"); rg.addColorStop(.35, "#FFE29A"); rg.addColorStop(1, "rgba(255,226,154,0)"); c.fillStyle = rg; c.beginPath(); c.arc(sx2, sy2, 9, 0, 7); c.fill(); }); }
  c.font = f(800, 32); const sTxt = `🔥 ${st?.streak ?? 0} hari`, sw = c.measureText(sTxt).width + 44;
  px = X + CW - 56 - sw; rr(c, px, Y + 44, sw, 56, 28); c.fillStyle = "rgba(255,120,60,.16)"; c.fill(); c.strokeStyle = "rgba(255,140,80,.5)"; c.lineWidth = 2; c.stroke(); c.fillStyle = "#FFB27A"; c.fillText(sTxt, px + 22, Y + 82);
  // judul (rata kiri, sama dengan kartu di aplikasi)
  c.fillStyle = "#A3ACBD"; c.font = f(800, 29); sp(5.2);
  c.fillText(`NINOKUU · ${days} HARI TERAKHIR`, ax, 424); sp(0);
  c.fillStyle = "#fff"; c.font = f(800, 96); c.fillText(`Rekap ${days} Hari`, ax - 3, 528);
  g = c.createLinearGradient(ax, 0, ax + 88, 0); g.addColorStop(0, "#F2B33D"); g.addColorStop(1, "#E0242B");
  c.fillStyle = g; rr(c, ax, 579, 88, 10, 5); c.fill();
  c.fillStyle = "#F2B33D"; c.font = f(700, 38); c.fillText(range(data.from, data.to), ax + 112, 598);
  // angka besar
  let y = 646; rr(c, ax, y, bw, 214, 34); c.fillStyle = "rgba(255,255,255,.05)"; c.fill(); c.strokeStyle = "rgba(255,255,255,.08)"; c.stroke();
  c.fillStyle = "rgba(255,255,255,.1)"; c.fillRect(ax + bw / 2, y + 36, 2, 148);
  const big = (x, v, lab, sub, col) => { c.fillStyle = col; c.font = f(800, 104); c.fillText(num(v), x, y + 108); c.fillStyle = "#F2F4F8"; c.font = f(800, 30); sp(3); c.fillText(lab, x, y + 152); sp(0); c.fillStyle = "#A3ACBD"; c.font = f(500, 29); c.fillText(sub, x, y + 188); };
  big(ax + 40, data.chapters, "CHAPTER", "dibaca sampai habis", "#F2B33D"); big(ax + bw / 2 + 40, data.series, "SERIES", "judul berbeda", "#FF6B70");
  // grafik per hari
  c.fillStyle = "#A3ACBD"; c.font = f(700, 30); c.fillText("Chapter per hari", ax, 912);
  y = 930; const pd = data.per_day || [], mx = Math.max(1, ...pd), gw = bw / Math.max(1, pd.length), gh = 120;
  pd.forEach((n, i) => { const h = n ? Math.max(10, (n / mx) * gh) : 6; g = c.createLinearGradient(0, y + gh - h, 0, y + gh); g.addColorStop(0, n ? "#F2B33D" : "rgba(255,255,255,.12)"); g.addColorStop(1, n ? "#E0242B" : "rgba(255,255,255,.12)"); c.fillStyle = g; rr(c, ax + i * gw + gw * 0.18, y + gh - h, gw * 0.64, h, Math.min(10, gw * 0.3)); c.fill(); });
  // judul teratas
  c.fillStyle = "#A3ACBD"; c.font = f(700, 30); c.fillText("Paling sering dibaca", ax, 1104);
  y = 1126; const cw = (bw - 40) / 3, chh = 240;
  if (data.top?.length) {
    const covers = await Promise.all(data.top.map((t) => loadImg(t.cover)));
    data.top.forEach((t, i) => {
      const x = ax + i * (cw + 20);
      c.save(); rr(c, x, y, cw, chh, 22); c.fillStyle = "#1C2533"; c.fill(); c.clip();
      const im = covers[i]; if (im) { const s = Math.max(cw / im.width, chh / im.height); c.drawImage(im, x + (cw - im.width * s) / 2, y + (chh - im.height * s) / 2, im.width * s, im.height * s); }
      c.restore();
      c.beginPath(); c.arc(x + 32, y + 32, 22, 0, 7); c.fillStyle = i === 0 ? "#F2B33D" : "rgba(11,16,24,.8)"; c.fill(); c.fillStyle = i === 0 ? "#111" : "#fff"; c.font = f(800, 24); c.textAlign = "center"; c.fillText(String(i + 1), x + 32, y + 41); c.textAlign = "left";
      c.fillStyle = "#F2F4F8"; c.font = f(700, 29); c.fillText(fit(c, t.title || t.comic_id, cw), x, y + chh + 40);
      c.fillStyle = "#A3ACBD"; c.font = f(500, 27); c.fillText(`${num(t.n)} chapter`, x, y + chh + 74);
    });
  } else { c.fillStyle = "#A3ACBD"; c.font = f(500, 28); c.fillText("Belum ada chapter yang selesai dibaca di periode ini.", ax, y + 40); }
  // statistik kecil
  y = 1484; rr(c, ax, y, bw, 150, 30); c.fillStyle = "rgba(255,255,255,.05)"; c.fill();
  const minis = [[num(data.exp), "EXP", "#F2B33D"], [num(data.likes), "Like", "#6FC3F2"], [num(data.saved), "Koleksi", "#FF6B70"], [`${data.active}/${days}`, "Hari aktif", "#5DD39E"]];
  minis.forEach(([v, n, col], i) => { const cx = ax + (bw / 4) * (i + 0.5); c.textAlign = "center"; c.fillStyle = col; c.font = f(800, 46); c.fillText(v, cx, y + 80); c.fillStyle = "#A3ACBD"; c.font = f(500, 28); c.fillText(n, cx, y + 120); });
  c.textAlign = "left";
  // merek
  const logo = await loadImg("icons/icon-192.png");
  const by = 1680;
  if (logo) { c.save(); rr(c, ax, by, 64, 64, 16); c.clip(); c.drawImage(logo, ax, by, 64, 64); c.restore(); }
  c.fillStyle = "#fff"; c.font = f(800, 44); c.fillText("Ninokuu", ax + (logo ? 84 : 0), by + 46);
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
