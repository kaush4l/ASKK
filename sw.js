// ASKK service worker — caching and updates (ADR-007). No routing, no state,
// no logic: the Wasm core never depends on this file existing.
//
// It also carries the cross-origin isolation headers, but does not own them:
// coi-sw.js owns that policy and exposes one function. A worker may call
// respondWith once per fetch, so the two responsibilities compose here rather
// than in two workers, which the platform does not permit in one scope.
//
// UPDATE PATH (= refresh, I11): navigations are network-first, so a deploy is
// live on the next load; hashed asset filenames make the rest cache-first
// safely. Bump VERSION on release to drop the old cache.
importScripts("coi-sw.js");

const VERSION = "03-0.3.0";
const CACHE = "askk-" + VERSION;

// Only the unhashed shell is pre-cached; trunk fingerprints the JS and Wasm,
// so those are picked up by the runtime cache under names that change on every
// build (which is what makes cache-first correct for them).
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg"];

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

function store(request, response) {
  if (response.ok) {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy));
  }
  return response;
}

async function respond(request) {
  // Agents are DATA, edited and redeployed without a rebuild (increment 03),
  // so their filenames never change — cache-first would serve yesterday's
  // prompt forever. Network-first with a cache fallback: a reload after a
  // deploy shows the edited agent.md, and an offline load still has one.
  const isAgentFile = new URL(request.url).pathname.includes("/agents/");
  if (request.mode === "navigate" || isAgentFile) {
    // Network-first: a stale index.html would point at asset names that no
    // longer exist, and refresh is the update channel (I11). Same reason the
    // agent files ride this branch.
    try {
      return store(request, await fetch(request));
    } catch (e) {
      return (await caches.match(request)) || Response.error();
    }
  }
  return (await caches.match(request)) || store(request, await fetch(request));
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Never touch cross-origin traffic or writes; same-origin GETs only.
  if (event.request.method !== "GET") return;
  if (url.origin !== location.origin) return;
  event.respondWith(respond(event.request).then(self.withCoiHeaders));
});
