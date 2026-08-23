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

const VERSION = "dev";
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
  // PREVIOUS build's snippet and the page stayed on the boot message.
  //
  // THAT COMMENT WAS HERE, AND THE BUG SHIPPED ANYWAY (2026-08-23). It said a
  // deploy dodges the problem by stamping a new cache NAME. It does not: the
  // stamp only empties this worker's Cache Storage, and the stale bytes were
  // never coming from there — they came from the HTTP cache underneath
  // `fetch`. Routing `/snippets/` here was the right rule with a mechanism
  // that did not obey it; see the branch below for what does. A comment that
  // names the bug is not a fix.
  const isData =
    path.includes("/snippets/") ||
    path.includes("/agents/") ||
    path.endsWith("/models.json") ||
    path.endsWith("/agent-worker.js");
  if (request.mode === "navigate" || isData) {
    // Network-first: a stale index.html would point at asset names that no
    // longer exist, and refresh is the update channel (I11). Same reason the
    // agent files ride this branch.
    //
    // `{cache: "reload"}` IS THE NETWORK-FIRST. A plain `fetch(request)` runs
    // at cache mode "default", so the BROWSER HTTP CACHE — a layer below this
    // worker — answers it without a round trip. GitHub Pages serves these
    // files with `cache-control: max-age=600` (measured 2026-08-23 against
    // the live origin), so for ten minutes after a visit "network-first" was
    // reading the same stale bytes cache-first would have. That is how a
    // returning visitor got a page where the NEW index.html and the OLD
    // `snippets/adapters_web-<crate-hash>/src/c2w.js` were paired: the snippet
    // path is keyed by the CRATE hash, not the file's content, so its URL is
    // identical across deploys while its bytes change. Subresource Integrity
    // then blocked the module and the boot fallback stayed up forever.
    //
    // WHY "reload" AND NOT "no-store". Both skip the cache on the way in;
    // only "reload" WRITES THE RESPONSE BACK, so the HTTP cache converges on
    // the truth. "no-store" would leave the poisoned entry in place for every
    // consumer that does not come through this worker — the browser's own
    // module preload on an uncontrolled first load, or the same page after the
    // worker is unregistered — and re-brick exactly the visitor this fixes.
    //
    // BOTH ARMS OF THIS BRANCH OR NEITHER. The failure is a MISMATCH, not
    // staleness: an old index.html with an old snippet boots fine. Bypassing
    // the cache for `isData` alone would hand a new snippet to an old
    // document, whose `integrity` attribute names the old hash — the same SRI
    // block from the other side. One call site covers navigations and data
    // together, which is why the fix is one argument and not two.
    //
    // OFFLINE IS UNCHANGED: "reload" fails the same way a plain fetch does
    // when there is no network, and the `catch` below still answers from the
    // Cache Storage copy `store` wrote. THE NEW FAILURE MODE IS COST, not
    // correctness: these few files (the document, `/snippets/`, `/agents/`,
    // `models.json`, `agent-worker.js`) now spend a real round trip on every
    // load instead of a free cache hit, so a slow connection pays for them
    // each time. Everything else on the page is content-hashed and still
    // cache-first. Unchanged and still true: a reachable origin that answers
    // 404 or 500 does not throw, so `store` skips it and the error response is
    // returned rather than the cached copy.
    try {
      return store(request, await fetch(request, { cache: "reload" }));
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
