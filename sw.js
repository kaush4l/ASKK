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
// safely.
//
// VERSION is STAMPED BY THE DEPLOY (`publish.sh` rewrites the line below with
// the commit it is publishing). It used to be a constant nobody remembered to
// bump, which meant this file's bytes never changed across releases — so the
// browser had no reason to install the new worker, the old one kept serving
// `askk-06-0.6.0` for every deploy that ever shipped, and the only cache-
// busting left was the hashed asset names. A worker that never updates is a
// worker that can serve a shell from a build whose assets are gone.
importScripts("coi-sw.js");

const VERSION = "e27a387";
const CACHE = "askk-" + VERSION;

// The container2wasm runtime is ~47MB of bytes that DO NOT CHANGE between
// deploys, so it gets its own cache, deliberately, outside the versioned one:
// in `CACHE` every deploy's `activate` would delete it and the next boot would
// re-fetch 47MB over a mobile connection to run the same image. Its contents
// are addressed by the build that produced them, not by this site's version.
const RUNTIME = "askk-c2w";
const RUNTIME_PATH = "/c2w/";

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
        Promise.all(
          keys
            .filter((k) => k !== CACHE && k !== RUNTIME)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

function store(request, response, name) {
  // status 200 only: a 206 body is a fragment, and `Cache.put` rejects on it.
  if (response.status === 200) {
    const copy = response.clone();
    caches.open(name || CACHE).then((cache) => cache.put(request, copy));
  }
  return response;
}

async function respond(request) {
  // Agents are DATA, edited and redeployed without a rebuild (increment 03),
  // so their filenames never change — cache-first would serve yesterday's
  // prompt forever. Network-first with a cache fallback: a reload after a
  // deploy shows the edited agent.md, and an offline load still has one.
  // models.json is the same kind of thing (increment 04): a hand-edited
  // catalogue with a fixed filename, so cache-first would pin the app to a
  // stale endpoint after a deploy.
  // `Cache.match` ignores the Range header, so a cached full body would answer
  // a ranged request with the WHOLE body at 200 — silent corruption for any
  // media element or range-reading library. Ranged traffic skips the cache in
  // both directions and goes to the network, which answers it correctly.
  if (request.headers.has("range")) return fetch(request);
  const path = new URL(request.url).pathname;
  // The c2w runtime, cache-first into its own long-lived cache (see RUNTIME).
  if (path.includes(RUNTIME_PATH)) {
    const held = await caches.match(request, { cacheName: RUNTIME });
    return held || store(request, await fetch(request), RUNTIME);
  }
  // agent-worker.js is the third file with a FIXED name whose content
  // changes with a deploy (increment 06); cache-first would boot every
  // sub-agent from the previous build's shim.
  // …and so is every wasm-bindgen SNIPPET: trunk fingerprints the bundle but
  // NOT the snippet modules it imports, so their URLs are fixed while their
  // contents change with every build. Cache-first served a new bundle the
  // PREVIOUS build's snippet, the module graph failed to link, and the page
  // stayed on the boot message with no console error — the exact failure
  // #boot's text describes. A deploy dodges it by stamping a new cache name;
  // a dev server with a fixed VERSION does not, which is where it was found.
  const isData =
    path.includes("/snippets/") ||
    path.includes("/agents/") ||
    path.endsWith("/models.json") ||
    path.endsWith("/agent-worker.js");
  if (request.mode === "navigate" || isData) {
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
