// HARNESS service worker — caching and updates ONLY (ADR-007). No routing,
// no state, no logic: the Wasm core never depends on this file existing.
//
// UPDATE PATH (= refresh, I11): bump VERSION on every release. A new VERSION
// is a new cache name; install pre-caches the shell, activate deletes every
// old cache and claims clients, so one refresh after deploy serves the new
// bytes. Nothing else in this file should ever need to change.
const VERSION = "g4-0.1.0";
const CACHE = "harness-" + VERSION;

const SHELL = [
  "./",
  "./index.html",
  "./transport.js",
  "./vendor/htmx.min.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./pkg/adapters_web.js",
  "./pkg/adapters_web_bg.wasm",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Never touch the model proxy or cross-origin traffic; cache-first for
  // same-origin GETs (offline = serve current cache, full stop).
  if (event.request.method !== "GET") return;
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/v1/")) return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: false }).then(
      (hit) =>
        hit ||
        fetch(event.request).then((resp) => {
          // Cache successful same-origin fetches into the CURRENT cache so
          // a first load without install still converges.
          if (resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return resp;
        })
    )
  );
});
