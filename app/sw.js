// Ninokuu service worker: kerangka aplikasi bisa dibuka offline, gambar komik disimpan sementara.
const VER = "ninokuu-app-1.4.3";
const IMG = "ninokuu-img-v1";
const SHELL = ["./", "index.html", "config.js", "css/app.css", "js/main.js", "js/api.js", "js/store.js", "js/ui.js", "js/assets.js", "js/docs.js", "js/avatars.js", "js/chat.js", "js/filters.js", "js/native.js", "js/exp.js", "css/avatars.css", "icons/logo.png", "icons/icon-192.png", "manifest.webmanifest"];
const IMG_MAX = 400;

self.addEventListener("install", (e) => { e.waitUntil(caches.open(VER).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("ninokuu-app-") && k !== VER).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
async function trimImg() {
  const c = await caches.open(IMG), ks = await c.keys();
  for (let i = 0; i < ks.length - IMG_MAX; i++) await c.delete(ks[i]);
}
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // gambar lewat proxy ninokuu-api: simpan, pakai salinan bila ada
  if (url.pathname.endsWith("/functions/v1/ninokuu-api") && url.searchParams.has("img")) {
    e.respondWith(caches.open(IMG).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok) { c.put(req, r.clone()); trimImg(); }
      return r;
    }));
    return;
  }
  // file aplikasi: utamakan jaringan (selalu versi terbaru), cadangan dari cache saat offline
  if (url.origin === location.origin) {
    e.respondWith(fetch(req, { cache: "no-cache" }).then((r) => { if (r.ok) caches.open(VER).then((c) => c.put(req, r.clone())); return r; }).catch(() => caches.match(req).then((m) => m || caches.match("index.html"))));
  }
});
