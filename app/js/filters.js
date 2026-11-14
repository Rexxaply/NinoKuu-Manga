// Filter pencarian: tipe, status, genre, demografis, tema, konten.
// Daftar genre diambil dari penyedia (action "filters" di Edge Function), jadi hanya yang benar-benar ada di sumber itu.
import * as api from "./api.js";
import { esc, icon, $, $$, toast, srcName } from "./ui.js";

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
export const GROUPS = [["genre", "Genre", "Romance, slice of life, komedi, dll."], ["demo", "Demografis", "Target pembaca"], ["tema", "Tema", "Fantasy, isekai, harem, dll."], ["konten", "Konten", "Konten dewasa / sensitif"]];
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
  const host = document.createElement("div");
  host.className = "flt-host";
  document.body.append(host);
  document.body.classList.add("flt-open");
  const close = () => { host.classList.add("out"); document.body.classList.remove("flt-open"); setTimeout(() => host.remove(), 200); };
  const chip = (on, act, v, label, dis = false) => `<button class="fchip ${on ? "on" : ""}" aria-pressed="${on}" data-f="${act}" data-v="${esc(v)}" ${dis ? "disabled" : ""}>${on ? icon("check", 14, 2.6) : ""}${esc(label)}</button>`;
  const draw = () => {
    const max = data?.maxGenres || 10, full = st.genres.length >= max;
    const groups = data ? groupGenres(data.genres) : null;
    const n = activeCount(st);
    const body = host.querySelector(".flt-body"), y = body ? body.scrollTop : 0;
    host.innerHTML = `<button class="flt-bg" data-f="close" aria-label="Tutup filter"></button>
    <div class="flt-card" role="dialog" aria-label="Filter komik">
      <div class="flt-h"><span class="col grow g2"><b>Filter</b><span class="mu xs">Sesuai komik yang ada di ${esc(srcName(src))}</span></span><button class="x-btn" data-f="close" aria-label="Tutup">${icon("x", 16, 2.2)}</button></div>
      <div class="flt-body">
        <section><h3>Tipe komik</h3><div class="fchips">${TYPES.map(([v, l]) => chip(st.type === v, "type", v, l)).join("")}</div></section>
        <section><h3>Status</h3><div class="fchips">${chip(!st.status, "status", "", "Semua")}${(data?.status || ["ongoing", "completed"]).map((v) => chip(st.status === v, "status", v, STATUS_NAME[v] || v)).join("")}</div></section>
        ${err ? `<div class="note">${icon("info", 18)}<span>${esc(err)}</span></div>`
        : !groups ? `<div class="flt-load">${Array.from({ length: 10 }, (_, i) => `<span class="sk" style="width:${60 + ((i * 37) % 50)}px"></span>`).join("")}</div>`
        : `${max < 10 ? `<div class="note gold-n">${icon("info", 18)}<span>${esc(srcName(src))} hanya bisa memfilter <b>${max} genre/tag</b> sekaligus${full ? " — hapus salah satu untuk memilih yang lain" : ""}.</span></div>` : ""}
          ${GROUPS.map(([k, title, sub]) => groups[k].length ? `<section><h3>${title}${(() => { const c = groups[k].filter((x) => st.genres.includes(x.id)).length; return c ? ` <span class="fcount">${c}</span>` : ""; })()}<span class="mu xs">${sub}</span></h3>
            <div class="fchips ${k === "konten" ? "warn" : ""}">${groups[k].map((x) => chip(st.genres.includes(x.id), "g", x.id, x.name, full && !st.genres.includes(x.id))).join("")}</div></section>` : "").join("")}`}
      </div>
      <div class="flt-f"><button class="btn ghost" data-f="reset" ${n ? "" : "disabled"}>Reset</button><button class="btn primary grow" data-f="apply">Terapkan filter${n ? ` (${n})` : ""}</button></div>
    </div>`;
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
    err = /action|tidak dikenal|unknown/i.test(e.message) ? "Daftar genre belum tersedia: Edge Function ninokuu-api perlu diperbarui." : /blocked|Cloudflare|dijangkau|403/i.test(e.message) ? `${srcName(src)} tidak bisa dijangkau dari web. Filter genre tersedia di aplikasi APK.` : e.message;
    if (host.isConnected) draw();
  });
  return close;
}
