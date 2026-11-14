// Filter pencarian: tipe, status, genre, demografis, tema, konten.
// Daftar genre diambil dari penyedia (action "filters" di Edge Function), jadi hanya yang benar-benar ada di sumber itu.
import * as api from "./api.js";
import { esc, icon, $, $$, toast, srcName } from "./ui.js";
import { isApp } from "./native.js";

const norm = (n) => String(n || "").toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
const DEMO = new Set(["shounen", "shonen", "shoujo", "shojo", "seinen", "josei", "kodomo"]);
const KONTEN = new Set(["ecchi", "gore", "sexual violence", "smut", "mature", "adult", "hentai", "violence", "shotacon", "lolicon", "trauma", "yaoi", "yuri", "shounen ai", "shoujo ai", "doujinshi"]);
const TEMA = new Set(["fantasy", "dark fantasy", "isekai", "harem", "reverse harem", "reincarnation", "regression", "mc rebirth", "time travel", "magic", "magical girls",
  "martial art", "martial arts", "murim", "wuxia", "xianxia", "xuanhuan", "cultivation", "system", "game", "video games", "survival", "apocalypse", "post apocalyptic",
  "monster", "monsters", "monster girls", "demon", "demons", "ghosts", "vampire", "zombies", "villainess", "revenge", "military", "police", "medical", "cooking", "music",
  "office workers", "academy", "school", "school life", "sport", "sports", "super power", "supernatural", "supranatural", "mecha", "gender bender", "genderswap",
  "crossdressing", "beasts", "knight", "sword fight", "sword master", "swormanship", "blacksmith", "genius", "strategy", "slow life", "gyaru", "fight"]);
// label format (tipe sudah dipilih di bagian Tipe komik)
const HIDE = new Set(["comic", "manga", "manhwa", "manhua", "webtoon", "webtoons", "web comic", "long strip", "mangatoon", "latest", "dra", "shoujo(g)", "entertainment"]);
export const GROUPS = [["genre", "Genre", "Romance, slice of life, komedi, dan lainnya"], ["demo", "Demografis", "Target pembaca: shounen, seinen, josei, dll."], ["tema", "Tema", "Fantasy, isekai, harem, dan lainnya"], ["konten", "Konten", "Konten dewasa atau sensitif"]];
export function groupGenres(list) {
  const g = { genre: [], demo: [], tema: [], konten: [] };
  for (const x of list || []) {
    const n = norm(x.name);
    if (HIDE.has(n)) continue;
    (DEMO.has(n) ? g.demo : KONTEN.has(n) ? g.konten : TEMA.has(n) ? g.tema : g.genre).push(x);
  }
  return g;
}
export const STATUS_NAME = { ongoing: "Berjalan", completed: "Tamat", hiatus: "Hiatus" };

const mem = {};
export async function loadFilters(src) {
  if (mem[src]) return mem[src];
  const k = "ninokuu:flt:" + src;
  try { const c = JSON.parse(localStorage.getItem(k) || "null"); if (c && Date.now() - c.at < 864e5 && c.data?.genres?.length) return (mem[src] = c.data); } catch {}
  const r = await api.call("filters", { source: src });
  const data = { genres: r.genres || [], status: r.status || ["ongoing", "completed"], maxGenres: r.maxGenres || 10 };
  mem[src] = data;
  try { localStorage.setItem(k, JSON.stringify({ at: Date.now(), data })); } catch {}
  return data;
}
export const genreName = (src, id) => mem[src]?.genres.find((g) => g.id === id)?.name || id;
export const activeCount = (f) => (f.type ? 1 : 0) + (f.status ? 1 : 0) + (f.genres?.length || 0);

const TYPES = [["", "Semua"], ["manga", "Manga"], ["manhwa", "Manhwa"], ["manhua", "Manhua"]];
// kartu filter; onApply({type, status, genres}) dipanggil saat "Terapkan filter"
export function openFilter(src, cur, onApply) {
  let st = { type: cur.type || "", status: cur.status || "", genres: [...(cur.genres || [])] }, data = null, err = null;
  const open = {}; // grup yang sedang dibuka penuh
  const SHOW = 9;
  const host = document.createElement("div");
  host.className = "flt-host";
  document.body.append(host);
  document.body.classList.add("flt-open");
  const close = () => { host.classList.add("out"); document.body.classList.remove("flt-open"); setTimeout(() => host.remove(), 200); };
  const seg = (act, list, val) => `<div class="fseg" style="--n:${list.length}" role="radiogroup">${list.map(([v, l]) => `<button role="radio" aria-checked="${val === v}" data-f="${act}" data-v="${esc(v)}">${esc(l)}</button>`).join("")}</div>`;
  const tile = (x, on, dis) => `<button class="ftile ${on ? "on" : ""}" aria-pressed="${on}" data-f="g" data-v="${esc(x.id)}" ${dis ? "disabled" : ""}>${esc(x.name)}${on ? `<span class="fck">${icon("check", 11, 3.2)}</span>` : ""}</button>`;
  const head = (title, sub, c = 0) => `<div class="fsec-h"><span class="col g4 grow"><b>${title}${c ? `<span class="fcount">${c}</span>` : ""}</b><span class="mu xs">${sub}</span></span></div>`;
  const draw = () => {
    const max = data?.maxGenres || 10, full = st.genres.length >= max;
    const groups = data ? groupGenres(data.genres) : null;
    const n = activeCount(st);
    const body = host.querySelector(".flt-body"), y = body ? body.scrollTop : 0;
    const groupHtml = (k, title, sub) => {
      const list = groups[k]; if (!list.length) return "";
      const sel = list.filter((x) => st.genres.includes(x.id));
      // yang dipilih selalu terlihat walau grup diringkas
      const shown = open[k] || list.length <= SHOW + 3 ? list : [...sel, ...list.filter((x) => !sel.includes(x)).slice(0, Math.max(0, SHOW - sel.length))];
      return `<section class="fsec ${k === "konten" ? "warn" : ""}">${head(title, sub, sel.length)}
        <div class="fgrid">${shown.map((x) => tile(x, st.genres.includes(x.id), full && !st.genres.includes(x.id))).join("")}</div>
        ${list.length > SHOW + 3 ? `<button class="fmore ${open[k] ? "open" : ""}" data-f="more" data-v="${k}">${open[k] ? "Ringkas" : `Lihat semua ${list.length}`}${icon("chev", 15, 2.2)}</button>` : ""}</section>`;
    };
    const bodyHtml = `        <section class="fsec">${head("Tipe komik", "Asal komik")}${seg("type", TYPES, st.type)}</section>
        <section class="fsec">${head("Status", "Masih berjalan atau sudah tamat")}${seg("status", [["", "Semua"], ...(data?.status || ["ongoing", "completed"]).map((v) => [v, STATUS_NAME[v] || v])], st.status)}</section>
        ${err ? `<div class="note">${icon("info", 18)}<span>${esc(err)}</span></div>`
        : !groups ? `<div class="fgrid flt-load">${Array.from({ length: 9 }, () => `<span class="sk"></span>`).join("")}</div>`
        : `${max < 10 ? `<div class="flt-lim ${full ? "full" : ""}">${icon("info", 16)}<span>${full ? `Sudah ${max} dari ${max} genre/tag. Hapus salah satu untuk ganti.` : `${esc(srcName(src))} maksimal <b>${max} genre/tag</b> sekaligus · dipilih ${st.genres.length}/${max}`}</span></div>` : ""}
          ${GROUPS.map(([k, title, sub]) => groupHtml(k, title, sub)).join("")}`}`;
    const footHtml = `<button class="btn ghost" data-f="reset" ${n ? "" : "disabled"}>${icon("refresh", 17, 2)}Reset</button><button class="btn primary grow" data-f="apply">Terapkan filter${n ? ` <span class="fbadge">${n}</span>` : ""}</button>`;
    // kartu dibuat sekali; ketukan berikutnya hanya memperbarui isi (tanpa animasi muncul ulang)
    if (!host.querySelector(".flt-card")) {
      host.innerHTML = `<button class="flt-bg" data-f="close" aria-label="Tutup filter"></button>
    <div class="flt-card" role="dialog" aria-label="Filter komik">
      <span class="flt-grab" aria-hidden="true"></span>
      <div class="flt-h"><span class="col grow g4"><span class="row g8"><b>Filter</b><span class="tag-s">${esc(srcName(src))}</span></span><span class="mu xs">Hanya pilihan yang tersedia di sumber ini</span></span>
        <button class="x-btn" data-f="close" aria-label="Tutup">${icon("x", 16, 2.2)}</button></div>
      <div class="flt-body"></div><div class="flt-f"></div>
    </div>`;
    }
    host.querySelector(".flt-body").innerHTML = bodyHtml;
    host.querySelector(".flt-f").innerHTML = footHtml;
    const nb = host.querySelector(".flt-body"); if (nb) nb.scrollTop = y;
  };
  host.addEventListener("click", (e) => {
    const b = e.target.closest("[data-f]"); if (!b || b.disabled) return;
    const a = b.dataset.f, v = b.dataset.v;
    if (a === "close") return close();
    if (a === "type") st.type = v;
    if (a === "status") st.status = v;
    if (a === "g") {
      if (st.genres.includes(v)) st.genres = st.genres.filter((x) => x !== v);
      else if (st.genres.length < (data?.maxGenres || 10)) st.genres.push(v);
      else return toast(`Maksimal ${data?.maxGenres} genre/tag di ${srcName(src)}`);
    }
    if (a === "reset") st = { type: "", status: "", genres: [] };
    if (a === "more") open[v] = !open[v];
    if (a === "apply") { close(); onApply(st); return; }
    draw();
  });
  const onKey = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);
  draw();
  loadFilters(src).then((d) => {
    data = d;
    if (st.status && !d.status.includes(st.status)) st.status = "";
    st.genres = st.genres.filter((g) => d.genres.some((x) => x.id === g));
    if (host.isConnected) draw();
  }).catch((e) => {
    err = /action|tidak dikenal|unknown/i.test(e.message) ? "Daftar genre belum tersedia: Edge Function ninokuu-api perlu diperbarui." : !isApp && /blocked|Cloudflare|dijangkau|403/i.test(e.message) ? `${srcName(src)} tidak bisa dijangkau dari web. Filter genre tersedia di aplikasi APK.` : e.message;
    if (host.isConnected) draw();
  });
  return close;
}
