// Offline: the whole game is a static shell, precached on first load; after that it needs no network.
const SHELL = "shell-v22";
const FILES = ["./", "index.html", "game.css", "game.js", "sprites.js", "info.js", "geo.js", "data/airports.js", "data/landmarks.js", "data/geodata.js", "data/land.js",
  "fonts/press-start-2p.woff2", "fonts/vt323.woff2", "manifest.webmanifest", "icons/icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  // stale-while-revalidate: instant from cache, refreshed in the background when online
  e.respondWith(caches.open(SHELL).then(async (c) => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req, { cache: "no-cache" }).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
