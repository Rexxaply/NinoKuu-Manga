// Chat publik + Panel developer (mengikuti prototipe desain).
import * as api from "./api.js";
import * as S from "./store.js";
import { esc, icon, $, $$, toast, ago, rankBadge } from "./ui.js";
import { frameImage } from "./exp.js";

// bingkai avatar rank untuk chat & komentar: gambar bingkai yang sama dengan profil, dibuat sekali per rank
// (lihat frameImage di exp.js) supaya chat panjang tetap lancar. Mode Ringan: bingkai diam.
const FR = {};
let frP = null;
export const framesReady = () => (frP ||= Promise.all([0, 1, 2, 3, 4, 6, 7, 8].map((t) => frameImage(t).then((u) => { if (u) FR[t] = u; }))).catch(() => {}));

const RANK_BG = ["linear-gradient(135deg,#7A8396,#4A5266)", "linear-gradient(135deg,#C48A50,#7A4A22)", "linear-gradient(135deg,#F0823F,#9C3A12)", "linear-gradient(135deg,#BFE8FF,#4AA5DE)", "linear-gradient(135deg,#5DD39E,#127048)", "linear-gradient(135deg,#6E95FF,#1C3FA8)", "linear-gradient(135deg,#B08AFF,#5A22C9)", "linear-gradient(135deg,#FF8AB2,#D61F63)", "linear-gradient(135deg,#FFD36B,#E0242B)"];
const RANK_FG = ["#F2F4F8", "#FFF4E8", "#FFF1E8", "#06263A", "#04241A", "#fff", "#fff", "#fff", "#1A0A00"];
const RING = ["conic-gradient(from 200deg,#6B7486,#C9D0DC,#59617A,#AEB6C4,#6B7486)", "conic-gradient(from 210deg,#8C5A2B,#F0BE84,#8C5A2B,#D3955A,#8C5A2B)", "conic-gradient(from 200deg,#B4471C,#FFA36B,#B4471C,#EE7A3C,#B4471C)", "conic-gradient(from 180deg,#6FC3F2,#F2FBFF,#3D9BD6,#BFE8FF,#6FC3F2)", "conic-gradient(from 160deg,#1E9E6A,#9BFFD0,#167A52,#5DD39E,#1E9E6A)", "conic-gradient(from 140deg,#2C5BE0,#B4C9FF,#1C3FA8,#6E95FF,#2C5BE0)", "conic-gradient(#7B3FF2,#E3D2FF,#5A22C9,#B48CFF,#7B3FF2)", "conic-gradient(#FF4F8B,#FFD6E5,#D61F63,#FF9CC0,#FF4F8B)", "conic-gradient(#E0242B,#F2B33D,#FF6B70,#FFE29A,#E0242B)"];
const BAD = ["anjing", "bangsat", "goblok", "tolol", "kontol", "memek", "bajingan", "babi"];
const clean = (t) => BAD.reduce((x, w) => x.replace(new RegExp("\\b" + w + "\\b", "gi"), (m) => m[0] + "*".repeat(m.length - 1)), t);
const MAX_IMG = 30 * 1024 * 1024;
const VB = `<span class="verif" title="Terverifikasi">${icon("check", 10, 3.2)}</span>`;
const isStaff = () => ["developer", "moderator"].includes(S.state.profile?.role) && !S.state.settings.asUser;
const isDev = () => S.state.profile?.role === "developer" && !S.state.settings.asUser;

// teks ||spoiler|| → tombol yang menutup teks sampai diketuk
const revealed = new Set();
function bodyHtml(m) {
  const t = String(m.body || "");
  let out = "", last = 0, k = 0;
  for (const r of t.matchAll(/\|\|([\s\S]+?)\|\|/g)) {
    out += esc(t.slice(last, r.index));
    const key = m.id + ":" + k++, open = revealed.has(key);
    out += `<button class="sp ${open ? "open" : ""}" data-c="sp" data-k="${key}" aria-label="${open ? "Spoiler terbuka" : "Spoiler tertutup, ketuk untuk membuka"}">${esc(r[1])}</button>`;
    last = r.index + r[0].length;
  }
  return out + esc(t.slice(last));
}
// isi lingkaran avatar: foto profil bila ada, selain itu huruf awal nama
// animasi bingkai hanya berjalan saat avatar terlihat di layar
const avIO = "IntersectionObserver" in window ? new IntersectionObserver((es) => es.forEach((e) => e.target.classList.toggle("off", !e.isIntersecting)), { rootMargin: "120px 0px" }) : null;
export const watchAvatars = (root) => { if (avIO) root.querySelectorAll(".m-avc:not([data-w])").forEach((el) => { el.dataset.w = "1"; el.classList.add("off"); avIO.observe(el); }); };
// pembatas tanggal (WIB), contoh: 15 November 2026
const dayKey = (iso) => new Date(Date.parse(iso) + 7 * 3600e3).toISOString().slice(0, 10);
const dayLabel = (iso) => new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });
const avPhoto = (m) => (m.avatar_path ? `<img class="av-img" src="${esc(api.publicUrl("avatars", m.avatar_path))}" alt="" loading="lazy" decoding="async" data-rm>` : "");
const chatAv = (m, lv) => {
  const ini = esc((m.name || "?")[0].toUpperCase()), ph = avPhoto(m), fr = FR[lv.tier];
  if (!fr) return `<span class="m-av" style="background:${RING[lv.tier]}"><span>${ini}${ph}</span></span>`;
  return `<span class="m-avc t${lv.tier}"><img class="m-fr" src="${fr}" alt="" aria-hidden="true"><span class="m-in">${ini}${ph}</span></span>`;
};
const avInner = (m) => esc((m.name || "?")[0].toUpperCase()) + (m.avatar_path ? `<img class="av-img" src="${esc(api.publicUrl("avatars", m.avatar_path))}" alt="" loading="lazy" decoding="async" data-rm>` : "");
const plain = (t) => String(t || "").replace(/\|\|([\s\S]+?)\|\|/g, "$1");

/* ---------- kompres gambar sebelum diunggah (hemat kuota penyimpanan) ---------- */
async function compress(file) {
  if (file.type === "image/gif") return { blob: file, ext: "gif" };
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, "image/webp", 0.78));
    if (blob && blob.size < file.size) return { blob, ext: "webp", w: c.width, h: c.height };
    return { blob: file, ext: file.type.split("/")[1].replace("jpeg", "jpg"), w: bmp.width, h: bmp.height };
  } catch { return { blob: file, ext: file.type.split("/")[1].replace("jpeg", "jpg") }; }
}

/* ---------- pengumuman tersemat di chat publik ---------- */
// hanya yang disematkan dan belum lewat masa sematnya. Pengguna biasa bisa menyembunyikan untuk dirinya
// sendiri selama 24 jam (setelah itu muncul lagi); Developer melepasnya untuk semua pengguna.
const HIDE_MS = 24 * 3600e3;
const hiddenPins = () => {
  const h = api.lsGet("annHidden", {});
  const o = h && !Array.isArray(h) && typeof h === "object" ? h : {};   // format lama (daftar id) diabaikan
  return Object.fromEntries(Object.entries(o).filter(([, t]) => Date.now() - t < HIDE_MS));
};
const hidePin = (id) => api.lsSet("annHidden", { ...hiddenPins(), [id]: Date.now() });
async function activePin() {
  const now = encodeURIComponent(`(pinned_until.is.null,pinned_until.gt."${new Date().toISOString()}")`);
  const rows = await api.rest(`announcements?select=id,title,body,created_at,pinned_until&pinned=eq.true&or=${now}&order=created_at.desc&limit=3`)
    .catch(() => api.rest("announcements?select=id,title,body,created_at&pinned=eq.true&order=created_at.desc&limit=3").catch(() => []));
  const hidden = hiddenPins();
  return (rows || []).find((a) => !hidden[a.id]) || null;
}

/* ---------- Ruang obrolan: chat publik, komentar komik, komentar chapter ---------- */
// opt.room: "public" | "c:<sumber>:<id>" | "ch:<sumber>:<id>:<chapter>"
export const roomFor = (src, id, chId) => (chId ? `ch:${src}:${id}:${chId}` : `c:${src}:${id}`);
export async function roomPreview(room, n = 3) {
  return ((await api.rest(`chat_feed?select=*&room=eq.${encodeURIComponent(room)}&order=id.desc&limit=${n}`)) || []).reverse();
}
export const roomCount = (room) => api.count(`chat_feed?select=id&room=eq.${encodeURIComponent(room)}`);
// baris komentar ringkas (pratinjau di info komik)
export function miniMsg(m) {
  const lv = S.levelOf({ exp: m.exp, role: m.role }), t = lv.tier;
  return `<div class="cm">${chatAv(m, lv)}
    <span class="rc-mid g4"><span class="m-head">${esc(m.name)}${m.verified ? VB : ""}${m.role === "developer" ? `<span class="pill-dev">DEV</span>` : m.role === "moderator" ? `<span class="pill-mod">MOD</span>` : ""}${rankBadge(lv, "sm")}<span class="mu xs cm-t">${esc(ago(m.created_at))}</span></span>
    ${m.body ? `<span class="cm-b">${bodyHtml(m)}</span>` : ""}${m.image_path ? `<span class="mu xs row g4">${icon("img", 14)}Gambar${m.image_spoiler ? " · spoiler" : ""}</span>` : ""}</span></div>`;
}
export function bindSpoilers(el) {
  el.addEventListener("click", (e) => { const b = e.target.closest(".sp"); if (!b) return; e.preventDefault(); e.stopPropagation(); b.classList.toggle("open"); });
}
export async function vChat(view, ctx, opt = {}) {
  const { topbar, setActs, go, back, loading } = ctx;
  await framesReady();
  const room = opt.room || "public", pub = room === "public";
  const rq = `room=eq.${encodeURIComponent(room)}`;
  let msgs = [], pin = null, att = null, timer = null, menuId = null, sending = false, lastSent = 0, selHandler = null;
  const seenKey = pub ? "chatSeen" : "seen:" + room;
  let seenAtOpen = null, newFrom = 0, newCount = 0, stick = true;
  const onSel = () => selHandler && selHandler();
  document.addEventListener("selectionchange", onSel);
  const me = api.userId();
  view.innerHTML = `<div id="chatroot">${topbar(esc(opt.title || "Chat publik"))}<div class="chat" id="chat">${loading(6, "sk-lrow")}</div>
  <div class="composer" id="comp"></div><div class="sheet-host" id="host"></div></div>`;
  const root = $("#chatroot");
  const load = async (full = true) => {
    const lastId = msgs.length ? msgs[msgs.length - 1].id : 0;
    const q = full || !lastId ? `chat_feed?select=*&${rq}&order=id.desc&limit=100` : `chat_feed?select=*&${rq}&id=gt.${lastId}&order=id.desc&limit=100`;
    const rows = await api.rest(q);
    const fresh = (rows || []).reverse();
    msgs = full ? fresh : msgs.concat(fresh);
    // pesan terakhir yang pernah dilihat (dipakai untuk pembatas "Pesan Baru"); chat publik juga mematikan titik merah di Beranda
    if (seenAtOpen === null) {
      seenAtOpen = Number(api.lsGet(seenKey, 0)) || 0;
      const first = seenAtOpen ? msgs.find((m) => m.id > seenAtOpen && m.user_id !== me) : null;
      newFrom = first ? first.id : 0;
      newCount = first ? msgs.filter((m) => m.id >= first.id && m.user_id !== me).length : 0;
    }
    if (msgs.length) api.lsSet(seenKey, Math.max(Number(api.lsGet(seenKey, 0)) || 0, msgs[msgs.length - 1].id));
    if (full && pub) pin = await activePin();
    return fresh.length;
  };
  const atBottom = () => { const el = document.scrollingElement; return el.scrollHeight - el.scrollTop - el.clientHeight < 140; };
  // menempel di paling bawah sampai pengguna menggulir ke atas (gambar/avatar yang dimuat belakangan tidak menggeser posisi)
  const toBottom = () => { stick = true; requestAnimationFrame(() => { window.scrollTo(0, document.scrollingElement.scrollHeight); floatBtns(); }); };
  const floatBtns = () => {
    const dn = $("#chDown"), jp = $("#chJump"), dv = $("#newDiv");
    if (dn) dn.hidden = stick || atBottom();
    if (jp) jp.hidden = !dv || dv.getBoundingClientRect().top > 70;
  };
  const draw = () => {
    const staff = isStaff(), active = new Set(msgs.filter((m) => Date.now() - Date.parse(m.created_at) < 15 * 60e3).map((m) => m.user_id)).size;
    let prev = null;
    $("#chat").innerHTML = `${pub ? `<div class="chat-info"><span class="online-dot"></span>${active || 1} pembaca aktif · Jaga obrolan tetap sopan, tandai spoiler.</div>`
      : `<a class="room-h" href="${esc(opt.backHref || "#/home")}">${opt.cover || ""}<span class="rc-mid g4"><b class="t1">${esc(opt.sub || "")}</b><span class="mu xs">${msgs.length ? msgs.length + (msgs.length >= 100 ? "+" : "") + " komentar" : "Belum ada komentar"} · tandai spoiler dengan ||teks||</span></span></a>`}
  ${pin ? `<div class="pin" data-c="pinx"><span class="pin-ic">${icon("mega", 18)}</span><span class="rc-mid g4"><span class="pin-cap">Pengumuman · Developer · ${esc(ago(pin.created_at))}</span><b>${esc(pin.title)}</b>${pin.body ? `<span class="mu sm pre pin-body">${esc(pin.body)}</span>` : ""}</span>
      <button class="x-btn" data-c="${isDev() ? "unpin" : "pinhide"}" aria-label="${isDev() ? "Lepas pengumuman untuk semua pengguna" : "Sembunyikan pengumuman selama 24 jam"}">${icon("x", 14, 2.2)}</button></div>` : ""}
  ${msgs.map((m) => {
      const day = dayKey(m.created_at), newDay = !prev || dayKey(prev.created_at) !== day, isNew = newFrom && m.id === newFrom;
      const mine = m.user_id === me, head = !prev || prev.user_id !== m.user_id || newDay || isNew; prev = m;
      const sep = (newDay ? `<div class="ch-sep"><span>${esc(dayLabel(m.created_at))}</span></div>` : "") + (isNew ? `<div class="ch-sep new" id="newDiv"><span>Pesan Baru</span></div>` : "");
      const lv = S.levelOf({ exp: m.exp, role: m.role }), t = lv.tier;
      const hid = m.hidden;
      return `${sep}<div class="msg ${mine ? "mine" : ""}">
      ${head ? chatAv(m, lv) : `<span class="m-avc"></span>`}
      <div class="m-col">
        ${head ? `<span class="m-head">${esc(mine ? "Kamu" : m.name)}${m.verified ? VB : ""}${m.role === "developer" ? `<span class="pill-dev">DEV</span>` : m.role === "moderator" ? `<span class="pill-mod">MOD</span>` : ""}${rankBadge(lv, "sm")}</span>` : ""}
        ${m.image_path ? `<button class="m-img ${m.image_spoiler && !revealed.has(m.id + ":img") ? "spo" : ""}" data-c="img" data-id="${m.id}"><img src="${esc(api.publicUrl("chat-images", m.image_path))}" alt="" loading="lazy">${m.image_spoiler && !revealed.has(m.id + ":img") ? `<span class="spo-cap"><span class="spo-tag">${icon("eye", 15)}Spoiler</span><span class="xs">Ketuk untuk melihat</span></span>` : ""}</button>` : ""}
        ${m.body ? `<span class="bubble">${bodyHtml(m)}</span>` : ""}
        ${hid && staff ? `<span class="m-hid">${icon("eye", 13)}Disembunyikan dari pengguna · hanya terlihat staf</span>` : ""}
        <span class="m-meta">${esc(ago(m.created_at))}<button class="m-dots" data-c="menu" data-id="${m.id}" aria-label="Opsi pesan">${icon("dots", 16)}</button></span>
      </div></div>`;
    }).join("") || `<div class="empty"><span class="empty-ic">${icon("msg", 24)}</span><b>${pub ? "Belum ada pesan" : "Belum ada komentar"}</b><span>${pub ? "Jadilah yang pertama menyapa pembaca lain." : "Jadilah yang pertama berkomentar. Jangan lupa tandai spoiler."}</span></div>`}
  <div style="height:${att ? 200 : 130}px"></div>
  <button class="ch-jump" id="chJump" hidden>${icon("chev", 15, 2.4)}<span>${newCount} pesan baru sejak terakhir dilihat</span><b>Lompat</b></button>
  <button class="ch-down" id="chDown" hidden aria-label="Ke pesan terbaru">${icon("down", 20, 2.2)}</button>`;
    watchAvatars($("#chat"));
    $("#chJump").onclick = () => { stick = false; $("#newDiv")?.scrollIntoView({ block: "center", behavior: "smooth" }); };
    $("#chDown").onclick = () => toBottom();
    floatBtns();
  };
  const drawComposer = () => {
    const c = $("#comp");
    if (!S.loggedIn()) {
      c.innerHTML = `<div class="comp-note glass"><div class="note m0">${icon("key", 18)}<span>Untuk berkomentar dan mendapatkan <b>Level &amp; Rank</b>, kamu harus <b>masuk</b> terlebih dahulu.</span></div><a class="btn primary sm" href="#/more">Masuk sekarang</a></div>`;
      return;
    }
    c.innerHTML = `<div class="sel-bar glass" id="selbar" hidden><button data-c="selsp" class="gold">${icon("eye", 15)}Spoiler</button><button data-c="selcopy">Salin</button><button data-c="selcut">Potong</button></div>
    <div class="sp-hint" id="sphint" hidden>Teks di antara <b class="gold">||</b> akan tertutup sebagai spoiler</div>
    ${att ? `<div class="att glass"><img src="${att.url}" alt="Pratinjau gambar" class="${att.sp ? "blur" : ""}"><span class="rc-mid g4"><b class="t1 sm">${esc(att.name)}</b><span class="mu xs">${(att.size / 1048576).toFixed(1).replace(".", ",")} MB · maks 30 MB</span></span>
      <button class="att-sp ${att.sp ? "on" : ""}" data-c="attsp" aria-pressed="${att.sp}">${icon("eye", 14)}Spoiler</button><button class="x-btn" data-c="attx" aria-label="Hapus gambar">${icon("x", 15, 2.2)}</button></div>` : ""}
    <div class="comp-row glass"><label class="c-img" aria-label="Unggah gambar (maks 30 MB)">${icon("img", 21)}<input type="file" id="pick" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>
      <input id="cin" maxlength="300" enterkeyhint="send" autocomplete="off" placeholder="${att ? "Tambahkan keterangan (opsional)…" : pub ? "Tulis pesan untuk semua pembaca…" : "Tulis komentar…"}" aria-label="Pesan">
      <button class="c-send" data-c="send" aria-label="Kirim" ${att ? "" : "disabled"}>${icon("send", 19, 2)}</button></div>`;
    const inp = $("#cin"), send = $("[data-c=send]");
    const upd = () => {
      send.disabled = !(inp.value.trim() || att);
      $("#sphint").hidden = !/\|\|[\s\S]+?\|\|/.test(inp.value);
      const a = inp.selectionStart, b = inp.selectionEnd;
      $("#selbar").hidden = !(b > a && inp.value.slice(a, b).trim());
    };
    ["input", "select", "keyup", "click"].forEach((ev) => inp.addEventListener(ev, upd));
    selHandler = upd;
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doSend(); } });
    $("#selbar").addEventListener("pointerdown", (e) => e.preventDefault()); // jaga seleksi teks
    $("#pick").addEventListener("change", async (e) => {
      const f = e.target.files?.[0]; e.target.value = "";
      if (!f) return;
      if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) return toast("Format harus JPG, PNG, WEBP, atau GIF");
      if (f.size > MAX_IMG) return toast(`Gambar terlalu besar (${(f.size / 1048576).toFixed(1).replace(".", ",")} MB). Maksimal 30 MB.`);
      att = { file: f, name: f.name, size: f.size, sp: false, url: URL.createObjectURL(f) };
      drawComposer(); draw(); toBottom();
    });
  };
  const doSend = async () => {
    const inp = $("#cin"); if (!inp || sending) return;
    const text = clean(inp.value.trim()).slice(0, 300);
    if (!text && !att) return;
    if (!isStaff() && Date.now() - lastSent < 5000) return toast(`Pelan-pelan ya, tunggu ${Math.ceil((5000 - (Date.now() - lastSent)) / 1000)} detik lagi`);
    sending = true; $("[data-c=send]").disabled = true;
    try {
      let image_path = null;
      if (att) {
        toast("Mengunggah gambar…", 8000);
        const c = await compress(att.file);
        image_path = `${me}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${c.ext}`;
        await api.upload("chat-images", image_path, new File([c.blob], "x." + c.ext, { type: c.blob.type || att.file.type }));
      }
      await api.rest("chat_messages", { method: "POST", body: { body: text, image_path, image_spoiler: !!att?.sp, room }, prefer: "return=minimal" });
      lastSent = Date.now(); inp.value = ""; att = null;
      await load(false); drawComposer(); draw(); toBottom(); toast("Terkirim", 1200);
    } catch (e) { toast(e.message, 4000); }
    finally { sending = false; const b = $("[data-c=send]"); if (b) b.disabled = !($("#cin")?.value.trim() || att); }
  };
  const sel = () => { const i = $("#cin"); const a = Math.min(i.selectionStart, i.selectionEnd), b = Math.max(i.selectionStart, i.selectionEnd); return [i, a, b, i.value.slice(a, b)]; };
  const sheet = (html) => { $("#host").innerHTML = html ? `<button class="pop-bg" data-c="close" aria-label="Tutup"></button><div class="sheet glass">${html}</div>` : ""; };
  const openMenu = (id) => {
    const m = msgs.find((x) => String(x.id) === String(id)); if (!m) return;
    menuId = m.id;
    const mine = m.user_id === me, staff = isStaff(), canRestrict = !mine && m.role !== "developer" && (isDev() || m.role !== "moderator");
    sheet(`<span class="sheet-prev">${esc(mine ? "Pesanmu" : m.name)}: ${esc(plain(m.body) || "Gambar")}</span>
      <button class="sh-row" data-c="mcopy">${icon("doc", 18)}Salin pesan</button>
      ${!mine && S.loggedIn() ? `<button class="sh-row red" data-c="mreport">${icon("shield", 18)}Laporkan pesan</button>` : ""}
      ${mine ? `<button class="sh-row red" data-c="mdel">${icon("trash", 18)}Hapus pesan</button>` : ""}
      ${staff && !mine ? `<span class="sheet-cap">Moderasi</span>
        <button class="sh-row" data-c="mhide">${icon("eye", 18)}${m.hidden ? "Tampilkan lagi untuk semua" : "Sembunyikan dari semua"}</button>
        <button class="sh-row" data-c="mdel">${icon("trash", 18)}Hapus pesan untuk semua</button>
        ${canRestrict ? `<button class="sh-row" data-c="mmute">${icon("mute", 18)}Bisukan ${esc(m.name)} 1 jam</button><button class="sh-row red" data-c="mban">${icon("ban", 18)}Blokir ${esc(m.name)} dari chat</button>` : ""}` : ""}
      <button class="sh-cancel" data-c="close">Batal</button>`);
  };
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-c]"); if (!b) return;
    const a = b.dataset.c, m = msgs.find((x) => x.id === menuId);
    const run = async (fn, ok) => { try { await fn(); sheet(""); if (ok) toast(ok); await load(true); draw(); } catch (er) { toast(er.message); } };
    if (a === "sp") { const k = b.dataset.k; revealed.has(k) ? revealed.delete(k) : revealed.add(k); draw(); }
    else if (a === "img") {
      const x = msgs.find((y) => String(y.id) === b.dataset.id);
      if (x.image_spoiler && !revealed.has(x.id + ":img")) { revealed.add(x.id + ":img"); draw(); return; }
      sheet(""); $("#host").innerHTML = `<div class="viewer" data-c="close"><img src="${esc(api.publicUrl("chat-images", x.image_path))}" alt="Gambar dari chat"><button class="x-btn big" data-c="close" aria-label="Tutup">${icon("x", 20, 2.2)}</button><span class="v-by">${esc(x.user_id === me ? "Kamu" : x.name)} · ${esc(ago(x.created_at))}</span></div>`;
    }
    else if (a === "menu") openMenu(b.dataset.id);
    else if (a === "close") sheet("");
    else if (a === "send") doSend();
    else if (a === "attsp") { att.sp = !att.sp; drawComposer(); }
    else if (a === "attx") { att = null; drawComposer(); draw(); }
    else if (a === "selsp") { const [i, s0, s1, t] = sel(); if (!t) return; i.value = (i.value.slice(0, s0) + "||" + t + "||" + i.value.slice(s1)).slice(0, 300); i.focus(); i.setSelectionRange(s1 + 4, s1 + 4); i.dispatchEvent(new Event("input")); }
    else if (a === "selcopy") { const [, , , t] = sel(); navigator.clipboard?.writeText(t).catch(() => {}); toast("Teks disalin"); }
    else if (a === "selcut") { const [i, s0, s1, t] = sel(); navigator.clipboard?.writeText(t).catch(() => {}); i.value = i.value.slice(0, s0) + i.value.slice(s1); i.setSelectionRange(s0, s0); i.dispatchEvent(new Event("input")); toast("Teks dipotong"); }
    else if (a === "mcopy") { const t = plain(m?.body); if (t) navigator.clipboard?.writeText(t).catch(() => {}); sheet(""); toast(t ? "Pesan disalin" : "Pesan ini hanya berisi gambar"); }
    else if (a === "mreport") run(() => api.rest("chat_reports", { method: "POST", body: { message_id: m.id }, prefer: "resolution=ignore-duplicates,return=minimal" }), "Pesan dilaporkan. Terima kasih, moderator akan meninjaunya.");
    else if (a === "mdel") { if (!confirm("Hapus pesan ini?")) return; run(async () => { await api.rest(`chat_messages?id=eq.${m.id}`, { method: "DELETE" }); if (m.image_path && m.user_id === me) await api.removeFile("chat-images", m.image_path).catch(() => {}); }, "Pesan dihapus"); }
    else if (a === "mhide") run(() => api.rpc("mod_set_hidden", { p_message: m.id, p_hidden: !m.hidden }), m.hidden ? "Pesan ditampilkan lagi" : "Pesan disembunyikan dari semua pengguna");
    else if (a === "mmute") run(() => api.rpc("mod_restrict", { p_user: m.user_id, p_mute_minutes: 60 }), `${m.name} dibisukan 1 jam`);
    else if (a === "mban") { if (!confirm(`Blokir ${m.name}? Semua pesannya disembunyikan dan dia tidak bisa menulis di chat publik.`)) return; run(() => api.rpc("mod_restrict", { p_user: m.user_id, p_ban: true }), `${m.name} diblokir dari chat`); }
    else if (a === "pinx") b.classList.toggle("open");
    else if (a === "unpin") { if (!confirm("Lepas pengumuman ini dari chat publik untuk semua pengguna?")) return; run(() => api.rest(`announcements?id=eq.${pin.id}`, { method: "PATCH", body: { pinned: false }, prefer: "return=minimal" }), "Pengumuman dilepas dari chat untuk semua pengguna"); }
    else if (a === "pinhide") { hidePin(pin.id); pin = null; draw(); toast("Pengumuman disembunyikan dari layarmu selama 24 jam", 3000); }
  });
  setActs({ back: () => back(opt.backHref || "#/home") });
  // keyboard muncul → tetap lihat pesan terakhir
  const onKb = (e) => { if (e.detail.open && e.detail.phase === "did") toBottom(); };
  window.addEventListener("nk:kb", onKb);
  try { await load(true); } catch (e) { $("#chat").innerHTML = `<div class="empty"><b>Gagal memuat chat</b><span>${esc(e.message)}</span></div>`; }
  draw(); drawComposer(); toBottom();
  // tinggi isi berubah (gambar selesai dimuat) → tetap di paling bawah bila sedang menempel
  const ro = "ResizeObserver" in window ? new ResizeObserver(() => { if (stick) window.scrollTo(0, document.scrollingElement.scrollHeight); floatBtns(); }) : null;
  ro?.observe($("#chat"));
  // gulir oleh pengguna: lepas dari bawah; kembali menempel bila sudah di bawah lagi
  let userScroll = false;
  const markUser = () => { userScroll = true; };
  const onScroll = () => { if (userScroll) stick = atBottom(); floatBtns(); };
  window.addEventListener("touchmove", markUser, { passive: true }); window.addEventListener("wheel", markUser, { passive: true });
  const endUser = () => setTimeout(() => { userScroll = false; }, 400);
  window.addEventListener("touchend", endUser, { passive: true });
  window.addEventListener("scroll", onScroll, { passive: true });
  // pesan baru diambil tiap 5 detik selama halaman chat terbuka (tiap 30 detik muat ulang penuh)
  let n = 0;
  timer = setInterval(async () => {
    if (document.visibilityState !== "visible") return;
    const bottom = atBottom();
    try { const got = ++n % 6 === 0 ? (await load(true), 1) : await load(false); if (got) { const y = scrollY; draw(); if (bottom || stick) toBottom(); else window.scrollTo(0, y); } } catch {}
  }, 5000);
  return () => { clearInterval(timer); ro?.disconnect(); window.removeEventListener("scroll", onScroll); window.removeEventListener("touchmove", markUser); window.removeEventListener("wheel", markUser); window.removeEventListener("touchend", endUser); window.removeEventListener("nk:kb", onKb); document.removeEventListener("selectionchange", onSel); if (att?.url) URL.revokeObjectURL(att.url); };
}

/* ---------- Panel developer: kontrol penyimpanan ---------- */
const fmtB = (b) => { b = Number(b || 0); return b < 1048576 ? (b / 1024).toFixed(b < 10240 ? 1 : 0).replace(".", ",") + " KB" : b < 1073741824 ? (b / 1048576).toFixed(b < 104857600 ? 1 : 0).replace(".", ",") + " MB" : (b / 1073741824).toFixed(2).replace(".", ",") + " GB"; };
// [jenis, judul, pilihan hari (null = tanpa batas umur), keterangan]
const CLEAN = [
  ["chat_public", "Chat publik lama", [30, 14, 7], (s) => `${s.chat_public} pesan${s.oldest_chat ? " · tertua " + ago(s.oldest_chat) : ""}`],
  ["comments", "Komentar komik & chapter lama", [365, 180, 90], (s) => `${s.comments} komentar`],
  ["chat_images", "Gambar chat lama (teksnya tetap)", [60, 30, 14, 7], (s) => `${s.img_count} gambar · ${fmtB(s.img_bytes)}`],
  ["img_orphans", "Gambar tanpa pesan", null, (s) => `${s.img_orphans} file (pesannya sudah dihapus)`],
  ["notifications", "Notifikasi lama", [7, 3], (s) => `${s.notifications} notifikasi`],
  ["read_log", "Log baca lama", [365, 180, 90], (s) => `${s.read_log} baris · EXP tetap, tapi chapter lama bisa memberi EXP lagi`],
  ["bugs_done", "Laporan komik yang sudah selesai", null, (s) => `${s.bugs_done} laporan`],
  ["comic_orphans", "Pantauan komik tanpa pengikut", null, (s) => `${s.comic_orphans} komik tidak lagi berlonceng`],
];
function bar(label, used, quota, extra = "") {
  const pc = quota ? Math.min(100, (used / quota) * 100) : 0, tone = pc >= 85 ? "red" : pc >= 60 ? "gold" : "ok";
  return `<div class="col g6"><span class="row sb sm"><b>${label}</b><span class="mu">${fmtB(used)} / ${fmtB(quota)}</span></span>
    <span class="qbar"><span class="qfill ${tone}" style="width:${Math.max(pc, 1.5).toFixed(1)}%"></span></span>
    <span class="mu xs">${pc.toFixed(1).replace(".", ",")}% terpakai${extra ? " · " + extra : ""}</span></div>`;
}
function storageHtml(s) {
  if (!s) return "";
  if (s.error) return `<section class="col g10"><h2 class="cap m0">Penyimpanan server</h2><div class="note">${icon("info", 18)}<span>Kontrol penyimpanan belum aktif. Jalankan ulang <b>ninokuu-schema.sql</b> di SQL Editor Supabase. <span class="mu">(${esc(s.error)})</span></span></div></section>`;
  const tables = (s.tables || []).slice(0, 14);
  return `<section class="col g10"><h2 class="cap m0">Penyimpanan server</h2>
  <div class="card col g14">${bar("Database", s.db_bytes, s.db_quota)}${bar("Gambar chat (Storage)", s.img_bytes, s.img_quota, `${Number(s.img_count).toLocaleString("id-ID")} file`)}
    <details class="tbls"><summary class="sm b">Rincian tabel</summary>${tables.map((t) => `<span class="row sb xs"><span>${esc(t.name)}</span><span class="mu">${Number(t.rows).toLocaleString("id-ID")} baris · ${fmtB(t.bytes)}</span></span>`).join("")}</details>
    <span class="mu xs">Kuota paket Free Supabase. Bila database penuh, Supabase membuatnya hanya-baca sampai dibersihkan.</span></div>
  <div class="group">${CLEAN.map(([k, title, days, sub]) => `<div class="mrow clean"><span class="rc-mid"><b>${title}</b><span class="mu sm">${sub(s)}</span></span>
    ${days ? `<select data-k="${k}" aria-label="Umur data">${days.map((d) => `<option value="${d}">&gt; ${d} hari</option>`).join("")}</select>` : ""}
    <button class="btn ghost sm" data-d="clean" data-k="${k}">Bersihkan</button></div>`).join("")}</div></section>`;
}

// kartu pengumuman di Panel developer: status sematan & notifikasi, lepas/sematkan, tarik
function annCard(a) {
  const live = a.pinned && (!a.pinned_until || Date.parse(a.pinned_until) > Date.now());
  const until = a.pinned_until ? new Date(a.pinned_until).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  return `<div class="card col g8 ann-c"><span class="row g8 xs"><b class="sm grow t1">${esc(a.title)}</b><span class="mu">${esc(ago(a.created_at))}</span></span>
    ${a.body ? `<span class="sm mu pre">${esc(a.body)}</span>` : ""}
    <span class="row g6 wrap xs"><span class="st-chip ${live ? "on" : ""}">${live ? `Tersemat${until ? " · sampai " + esc(until) : ""}` : a.pinned ? "Masa sematan habis" : "Tidak disematkan"}</span>
      <span class="st-chip">${a.push ? (a.pushed_at ? "Notifikasi terkirim " + esc(ago(a.pushed_at)) : "Notifikasi menunggu cron") : "Tanpa notifikasi"}</span></span>
    <div class="row g6 wrap"><button class="btn ghost sm" data-d="annpin" data-id="${a.id}" data-on="${live}">${live ? "Lepas dari chat" : "Sematkan lagi"}</button>
      <button class="btn ghost sm red" data-d="anndel" data-id="${a.id}">Tarik pengumuman</button></div></div>`;
}

/* ---------- Panel developer ---------- */
// Panduan (khusus developer): domain situs sumber pindah → ganti alamat sampai jadi APK lagi.
const gh = (path, label) => `<a href="https://github.com/Rexxaply/NinoKuu-Manga/${path}" target="_blank" rel="noopener">${label}</a>`;
const SITE_GUIDE = `<section class="col g10"><h2 class="cap m0">Panduan</h2>
<details class="card guide"><summary><b>Situs sumber pindah alamat</b><span class="mu xs">Langkah dari ganti alamat sampai jadi APK lagi</span></summary>
<div class="guide-b">
<p><b>1. Cari alamat baru.</b> Buka situs lama di browser; biasanya langsung dialihkan ke alamat baru. Salin bagian depannya saja, mis. <code>https://v8.kiryuu.to</code> (tanpa garis miring di akhir). Untuk server data (mis. Shinigami <code>api.shngm.io</code>): buka situsnya di browser PC → F12 → tab <b>Network</b> → lihat alamat yang dipakai saat daftar komik dimuat.</p>
<p><b>2A. Komiku &amp; Kiryuu — tanpa kode.</b> Supabase → project <b>ninokuu</b> → Edge Functions → <b>Secrets</b>. Isi / ubah lalu Save:</p>
<ul><li><code>KOMIKU_SITE</code> · mis. <code>https://komiku.org</code></li><li><code>KOMIKU_API</code> · mis. <code>https://api.komiku.org</code></li><li><code>KIRYUU_SITE</code> · mis. <code>https://v8.kiryuu.to</code></li></ul>
<p>Berlaku untuk global &amp; Dev sekaligus, tanpa APK baru. Belum berubah setelah beberapa menit → Edge Functions → <b>ninokuu-api</b> → Deploy sekali.</p>
<p><b>2B. Shinigami &amp; WestManga — ubah 1 baris kode</b> (di APK keduanya diambil langsung dari HP).</p>
<ul><li>GitHub → ${gh("blob/main/app/js/native.js", "app/js/native.js")} → ikon pensil (Edit). Pilih branch <code>dev</code> bila ingin diuji di Ninokuu Dev dulu.</li>
<li>Shinigami: baris <code>const API = "https://api.shngm.io", SITE = "https://…";</code></li>
<li>WestManga: baris <code>const SITES = ["https://v1.westmanga.my", …];</code></li>
<li>Ganti alamat di dalam tanda kutip saja. Server juga punya secret <code>SHNGM_SITE</code>, <code>SHNGM_API</code>, <code>WEST_SITE</code>: isi juga dengan alamat yang sama.</li></ul>
<p><b>3. Naikkan versi</b> (hanya untuk global / branch <code>main</code>). Edit ${gh("blob/main/VERSION", "VERSION")}: naikkan angka terakhir, mis. <code>1.6.3</code> → <code>1.6.4</code>. Tanpa ini APK global tidak dibangun ulang (versi web tetap ter-update).</p>
<p><b>4. Commit changes.</b> GitHub Actions membangun sendiri: ${gh("actions", "tab Actions")} → <b>Build APK</b> (global) atau <b>Build Ninokuu Dev</b> (dev), ±3–5 menit. Tanda centang hijau = selesai; silang merah = buka lalu baca baris error-nya.</p>
<p><b>5. Pasang &amp; cek.</b> Aplikasi menawarkan pembaruan sendiri (Lainnya → Versi aplikasi). APK juga bisa diunduh langsung:<br>global ${gh("releases/download/apk-terbaru/ninokuu.apk", "ninokuu.apk")} · Dev ${gh("releases/download/apk-dev/ninokuu-dev.apk", "ninokuu-dev.apk")}.<br>Buka sumber yang diganti: daftar komik tampil → beres. Masih gagal → Ninokuu Dev → Lainnya → Log error → salin.</p>
</div></details></section>`;
export async function vDev(view, ctx) {
  const { topbar, setActs, back, loading } = ctx;
  const p = S.state.profile, dev = p?.role === "developer", staff = dev || p?.role === "moderator";
  if (!staff) { view.innerHTML = topbar("Panel developer") + `<div class="empty"><b>Khusus developer & moderator</b></div>`; setActs({ back: () => back("#/more") }); return; }
  view.innerHTML = `<div id="devroot">${topbar("Panel developer")}<div class="px col g20" id="dev">${loading(4, "sk-lrow")}</div><div class="pad-nav"></div></div>`;
  const root = $("#devroot");
  const tog = (key, on) => `<button class="switch ${on ? "on" : ""}" role="switch" aria-checked="${on}" data-d="tog" data-k="${key}"><span></span></button>`;
  let form = { title: "", body: "", pin: true, push: false, days: 3 };
  let nf = (n) => Number(n || 0).toLocaleString("id-ID");
  const draw = async () => {
    const [stats, reps, restricted, bugs, sto] = await Promise.all([
      dev ? api.rpc("dev_stats").catch(() => null) : null,
      api.rest("chat_reports?select=message_id,created_at&order=created_at.desc&limit=200").catch(() => []),
      api.rest(`profiles?select=id,name,banned,muted_until&or=${encodeURIComponent(`(banned.eq.true,muted_until.gt."${new Date().toISOString()}")`)}&limit=100`).catch(() => []),
      api.rest("bug_reports?select=*&resolved=eq.false&order=created_at.desc&limit=60").catch(() => []),
      dev ? api.rpc("dev_storage").catch((e) => ({ error: e.message })) : null,
    ]);
    const anns = dev ? (await api.rest("announcements?select=*&order=created_at.desc&limit=10").catch(() => [])) || [] : [];
    const KIND = { gambar: "Gambar tidak muncul / rusak", chapter: "Chapter hilang / tidak lengkap", urutan: "Urutan halaman salah", info: "Info komik salah", lainnya: "Lainnya" };
    const counts = {}; (reps || []).forEach((r) => { counts[r.message_id] = (counts[r.message_id] || 0) + 1; });
    const ids = Object.keys(counts);
    const repMsgs = ids.length ? (await api.rest(`chat_feed?select=*&id=in.(${ids.join(",")})`).catch(() => [])) : [];
    nf = (n) => Number(n || 0).toLocaleString("id-ID");
    $("#dev").innerHTML = `
  <div class="dev-me"><span class="ic-box">${icon("dev", 20)}</span><span class="rc-mid g4"><span class="row g6"><b>${esc(p.name)}</b>${p.verified ? VB : ""}${dev ? `<span class="pill-dev">DEV</span>` : `<span class="pill-mod">MOD</span>`}</span>
    <span class="mu xs">${dev ? (S.state.settings.asUser ? "Developer · sedang melihat sebagai pengguna biasa" : "Developer · Lv 99 · akses penuh") : "Moderator · moderasi chat"}</span></span></div>
  ${dev ? `<section class="col g10"><h2 class="cap m0">Statistik</h2><div class="stats">
      <div class="stat"><b>${nf(stats?.users)}</b><span class="mu xs">Pengguna terdaftar</span></div><div class="stat"><b>${nf(stats?.messages_today)}</b><span class="mu xs">Pesan chat hari ini</span></div>
      <div class="stat"><b>${nf(stats?.reports_open)}</b><span class="mu xs">Laporan chat</span></div><div class="stat"><b>${nf(stats?.bugs_open)}</b><span class="mu xs">Laporan komik</span></div></div>
    <div class="card row g10 sm"><span class="online-dot"></span><span class="grow">Keepalive terakhir ${stats?.last_keepalive ? esc(ago(stats.last_keepalive)) : "belum ada"} · cron ${stats?.last_cron ? esc(ago(stats.last_cron)) : "belum jalan"}</span><button class="btn ghost sm" data-d="cron">Jalankan cron</button></div></section>
  ${storageHtml(sto)}
  ${dev ? SITE_GUIDE : ""}
  <section class="col g10"><h2 class="cap m0">Pengumuman</h2><div class="card col g12">
    <label class="fld">Judul<input id="at" maxlength="80" placeholder="Contoh: Maintenance server malam ini" value="${esc(form.title)}"></label>
    <label class="fld">Isi (opsional)<textarea id="ab" maxlength="500" rows="3" placeholder="Detail singkat untuk pembaca">${esc(form.body)}</textarea></label>
    <div class="row g12"><span class="col grow g4"><b class="sm">Sematkan di chat publik</b><span class="mu xs">Menempel di atas Chat publik</span></span>${tog("pin", form.pin)}</div>
    ${form.pin ? `<div class="row g12"><span class="col grow g4"><b class="sm">Lama disematkan</b><span class="mu xs">Setelah itu hilang sendiri dari chat</span></span>
      <select class="sel" data-d="days">${[[1, "1 hari"], [3, "3 hari"], [7, "7 hari"], [0, "Sampai dilepas"]].map(([v, l]) => `<option value="${v}" ${form.days === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>` : ""}
    <div class="row g12"><span class="col grow g4"><b class="sm">Kirim notifikasi ke semua</b><span class="mu xs">Sekali saja ke lonceng & HP semua pengguna (lewat cron). Matikan untuk info kecil.</span></span>${tog("push", form.push)}</div>
    <button class="btn primary" data-d="ann">${icon("mega", 18)}Kirim pengumuman</button></div>
    ${anns.length ? `<span class="cap m0 mt8">Pengumuman terakhir</span>${anns.map(annCard).join("")}` : ""}</section>` : ""}
  <section class="col g10"><h2 class="cap m0">Laporan chat · ${repMsgs.length}</h2>
    ${repMsgs.length ? repMsgs.map((m) => `<div class="card col g10 ${m.hidden ? "" : "rep-open"}"><span class="row g8 xs"><b class="sm">${esc(m.name)}</b><span class="rep-n">${counts[m.id]} laporan</span>${m.room && m.room !== "public" ? `<span class="mu">${m.room.startsWith("ch:") ? "Komentar chapter" : "Komentar komik"}</span>` : ""}<span class="mu" style="margin-left:auto">${m.hidden ? "Disembunyikan" : "Masih tampil"}</span></span>
      <span class="sm">${esc(plain(m.body) || "Gambar")}</span>
      <div class="row g6 wrap"><button class="btn ghost sm" data-d="hide" data-id="${m.id}" data-h="${m.hidden}">${m.hidden ? "Tampilkan lagi" : "Sembunyikan"}</button><button class="btn ghost sm" data-d="del" data-id="${m.id}">Hapus</button>
        ${m.role === "developer" ? "" : `<button class="btn ghost sm" data-d="mute" data-u="${m.user_id}" data-n="${esc(m.name)}">Bisukan 1 jam</button><button class="btn ghost sm red" data-d="ban" data-u="${m.user_id}" data-n="${esc(m.name)}">Blokir</button>`}</div></div>`).join("")
      : `<div class="card center mu sm">Tidak ada laporan. Chat aman.</div>`}</section>
  <section class="col g10"><h2 class="cap m0">Laporan komik · ${(bugs || []).length}</h2>
    ${(bugs || []).length ? bugs.map((b) => `<div class="card col g8"><span class="row g8 xs"><span class="tag-s">${esc(b.source)}</span><span class="mu" style="margin-left:auto">${esc(ago(b.created_at))}</span></span>
      <b class="sm">${esc(b.title || b.comic_id)}${b.chapter ? ` · Chapter ${esc(b.chapter)}` : ""}</b><span class="sm redt">${esc(KIND[b.kind] || b.kind)}</span>${b.note ? `<span class="sm mu pre">${esc(b.note)}</span>` : ""}
      <div class="row g6 wrap"><a class="btn ghost sm" href="${b.chapter_id ? `#/r/${esc(b.source)}/${encodeURIComponent(b.comic_id)}/${encodeURIComponent(b.chapter_id)}` : `#/c/${esc(b.source)}/${encodeURIComponent(b.comic_id)}`}">${b.chapter_id ? "Buka chapter" : "Buka komik"}</a><button class="btn ghost sm" data-d="bugok" data-id="${b.id}">${icon("check", 15, 2.2)}Selesai</button></div></div>`).join("")
      : `<div class="card center mu sm">Belum ada laporan masalah komik.</div>`}</section>
  <section class="col g10"><h2 class="cap m0">Pengguna dibatasi</h2>
    ${(restricted || []).length ? restricted.map((u) => `<div class="card row g12"><span class="rc-mid g4"><b class="sm">${esc(u.name)}</b><span class="xs ${u.banned ? "redt" : "gold"}">${u.banned ? "Diblokir dari chat" : u.muted_until ? "Dibisukan sampai " + new Date(u.muted_until).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Dibatasi"}</span></span><button class="btn ghost sm" data-d="lift" data-u="${u.id}" data-n="${esc(u.name)}">Cabut</button></div>`).join("")
      : `<div class="card center mu sm">Belum ada yang dibisukan atau diblokir.</div>`}</section>
  ${dev ? `<section class="col g10"><h2 class="cap m0">Alat</h2><div class="group">
    <div class="mrow"><span class="rc-mid"><b>Lihat sebagai pengguna biasa</b><span class="mu sm">Sembunyikan centang, DEV, dan alat moderasi untuk cek tampilan</span></span>${tog("asUser", !!S.state.settings.asUser)}</div>
    <button class="mrow" data-d="test"><span class="mrow-ic">${icon("bell", 18)}</span><span class="rc-mid"><b>Kirim tes notifikasi ke HP ini</b><span class="mu sm">Butuh aplikasi APK dengan izin notifikasi</span></span></button></div>
    <p class="mu xs lh m0">Peran Developer hanya bisa diberikan dari SQL Editor Supabase. Semua aksi di halaman ini dicek ulang oleh server.</p></section>` : ""}`;
  };
  root.addEventListener("change", (e) => { if (e.target.dataset?.d === "days") form.days = Number(e.target.value); });
  root.addEventListener("input", (e) => { if (e.target.id === "at") form.title = e.target.value; if (e.target.id === "ab") form.body = e.target.value; });
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-d]"); if (!b) return;
    const a = b.dataset.d;
    const run = async (fn, ok) => { try { await fn(); if (ok) toast(ok); await draw(); } catch (er) { toast(er.message, 4000); } };
    if (a === "tog") {
      const k = b.dataset.k;
      if (k === "asUser") { S.setSetting("asUser", !S.state.settings.asUser); return draw(); }
      form[k] = !form[k]; b.classList.toggle("on", form[k]); b.setAttribute("aria-checked", form[k]);
      if (k === "pin") return draw();
    }
    if (a === "ann") {
      const t = form.title.trim(); if (!t) return toast("Isi judul pengumuman dulu");
      if (!confirm(`Kirim pengumuman “${t}”${form.push ? " ke semua pengguna" : ""}?`)) return;
      run(async () => {
        const body = { title: t, body: form.body.trim(), pinned: form.pin, push: form.push };
        if (form.pin && form.days) body.pinned_until = new Date(Date.now() + form.days * 864e5).toISOString();
        try { await api.rest("announcements", { method: "POST", body, prefer: "return=minimal" }); }
        catch (e) { if (!/pinned_until/.test(e.message)) throw e; delete body.pinned_until; await api.rest("announcements", { method: "POST", body, prefer: "return=minimal" }); }
        form = { title: "", body: "", pin: true, push: false, days: 3 };
      },
        form.push ? "Pengumuman terkirim · notifikasi dikirim pada jalan cron berikutnya" : "Pengumuman terkirim");
    }
    if (a === "cron") run(async () => { b.disabled = true; await api.call("run_cron"); }, "Cron selesai dijalankan");
    if (a === "test") run(() => api.call("test_push"), "Tes notifikasi dikirim");
    if (a === "hide") run(() => api.rpc("mod_set_hidden", { p_message: Number(b.dataset.id), p_hidden: b.dataset.h !== "true" }), "Status pesan diperbarui");
    if (a === "del") { if (!confirm("Hapus pesan ini untuk semua?")) return; run(() => api.rest(`chat_messages?id=eq.${b.dataset.id}`, { method: "DELETE" }), "Pesan dihapus"); }
    if (a === "mute") run(() => api.rpc("mod_restrict", { p_user: b.dataset.u, p_mute_minutes: 60 }), `${b.dataset.n} dibisukan 1 jam`);
    if (a === "ban") { if (!confirm(`Blokir ${b.dataset.n} dari chat?`)) return; run(() => api.rpc("mod_restrict", { p_user: b.dataset.u, p_ban: true }), `${b.dataset.n} diblokir`); }
    if (a === "clean") {
      const kind = b.dataset.k, sel = root.querySelector(`select[data-k="${kind}"]`), days = sel ? Number(sel.value) : 1;
      const item = CLEAN.find((c) => c[0] === kind);
      if (!confirm(`${item[1]}${sel ? ` lebih dari ${days} hari` : ""} akan dihapus permanen. Lanjutkan?`)) return;
      b.disabled = true; b.textContent = "Membersihkan…";
      return run(async () => {
        const r = await api.rpc("dev_cleanup", { p_kind: kind, p_days: days });
        const imgs = r?.images || [];
        if (imgs.length) await api.removeFiles("chat-images", imgs);
        toast(`${nf(r?.deleted)} data dibersihkan${imgs.length ? ` · ${nf(imgs.length)} file gambar dihapus` : ""}`, 3500);
      });
    }
    if (a === "annpin") {
      const on = b.dataset.on !== "true";
      run(() => api.rest(`announcements?id=eq.${b.dataset.id}`, { method: "PATCH", prefer: "return=minimal", body: on ? { pinned: true, pinned_until: new Date(Date.now() + 3 * 864e5).toISOString() } : { pinned: false } }),
        on ? "Disematkan lagi selama 3 hari" : "Dilepas dari chat untuk semua pengguna");
    }
    if (a === "anndel") {
      if (!confirm("Tarik pengumuman ini?\n\nPengumuman hilang dari Chat publik dan dari lonceng semua pengguna. Notifikasi yang sudah masuk ke HP tidak bisa ditarik.")) return;
      run(() => api.rest(`announcements?id=eq.${b.dataset.id}`, { method: "DELETE" }), "Pengumuman ditarik");
    }
    if (a === "bugok") run(() => api.rest(`bug_reports?id=eq.${b.dataset.id}`, { method: "PATCH", body: { resolved: true }, prefer: "return=minimal" }), "Laporan ditandai selesai");
    if (a === "lift") run(() => api.rpc("mod_restrict", { p_user: b.dataset.u, p_mute_minutes: 0, p_ban: false }), `Batasan ${b.dataset.n} dicabut`);
  });
  setActs({ back: () => back("#/more") });
  await draw();
}
