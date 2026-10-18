// Offline support: serve the app from the cache, refresh the cache in the background.
// The shared-game API is never cached. Bump VERSION with every release, so phones that
// already have the app swap the whole cache at once instead of file by file.
// tests/sw.test.mjs checks that FILES lists every script and stylesheet.

const VERSION = "chalk-v9";
const FILES = [
  "./",
  "index.html",
  "css/base.css",
  "css/pool.css",
  "css/snooker.css",
  "js/app.js",
  "js/games.js",
  "js/theme.js",
  "js/core/api.js",
  "js/core/coach.js",
  "js/core/dom.js",
  "js/core/install-guide.js",
  "js/core/install.js",
  "js/core/lessons.js",
  "js/core/match.js",
  "js/core/qr.js",
  "js/core/search.js",
  "js/core/session.js",
  "js/core/share-card.js",
  "js/core/sheet.js",
  "js/core/sound.js",
  "js/core/store.js",
  "js/core/sync.js",
  "js/core/toss.js",
  "js/pool/engine.js",
  "js/pool/rules.js",
  "js/pool/table.js",
  "js/pool/ui.js",
  "js/screens/ask.js",
  "js/screens/game.js",
  "js/screens/home.js",
  "js/screens/install.js",
  "js/screens/join.js",
  "js/screens/menu.js",
  "js/screens/share.js",
  "js/screens/technique.js",
  "js/screens/views.js",
  "js/snooker/engine.js",
  "js/snooker/rules.js",
  "js/snooker/table.js",
  "js/snooker/ui.js",
  "vendor/qrcode-generator/qrcode.js",
  "favicon.svg",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" })))).then(() => self.skipWaiting()));
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
  const scope = new URL(self.registration.scope);
  const navigate = e.request.mode === "navigate";
  // the app itself (with or without ?g=…) is served from the cached index.html; any other page
  // opened directly (an icon, the manifest) goes to the network and is never saved as the app
  const isApp = navigate && (url.pathname === scope.pathname || url.pathname === `${scope.pathname}index.html`);
  if (navigate && !isApp) return;
  const key = isApp ? "index.html" : e.request;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(key, { ignoreSearch: isApp });
      const fresh = fetch(e.request, { cache: "no-cache" })
        .then((res) => {
          const page = !isApp || (res.headers.get("content-type") || "").includes("text/html");
          if (res.ok && res.type === "basic" && page) cache.put(key, res.clone());
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
