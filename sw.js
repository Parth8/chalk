// Offline support: serve the app from the cache, refresh the cache in the background.
// The shared-game API is never cached. Bump VERSION when files are added or removed.

const VERSION = "snooker-v1";
const FILES = [
  "./",
  "index.html",
  "css/app.css",
  "js/app.js",
  "js/engine.js",
  "js/rules.js",
  "js/table.js",
  "js/api.js",
  "js/install.js",
  "js/guide.js",
  "favicon.svg",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  const key = e.request.mode === "navigate" ? "index.html" : e.request;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(key, { ignoreSearch: e.request.mode === "navigate" });
      const fresh = fetch(e.request)
        .then((res) => {
          if (res.ok && res.type === "basic") cache.put(key, res.clone());
          return res;
        })
        .catch(() => hit);
      if (hit) {
        e.waitUntil(fresh);
        return hit;
      }
      return fresh;
    })
  );
});
