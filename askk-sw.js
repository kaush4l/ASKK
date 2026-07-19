/* askk-sw.js — service worker: COOP/COEP isolation + persist blob store +
   ingress relay for the guest hermes dashboard (ADR-047 unit 4).

   Follows Eliza's docs/eliza-sw.js pattern (coi-serviceworker header
   injection + Cache-API persist), extended with the ingress queue.

   Routes (all RELATIVE to the registration scope, so the site works under
   /ASKK/ on gh-pages — the page registers this file with a relative path):

     PUT  __persist/<name>        store blob in the Cache API
     GET  __persist/<name>        return blob or 404
     GET  __ingress/poll          long-poll (<=25s): one queued browser
                                  request, or 204 on timeout
     POST __ingress/resp/<id>     guest's answer; resolves the waiting fetch
     *    __hermes/<path>         virtual dashboard origin — enqueued for the
                                  guest relay, answered from its resp
     *    anything else           passthrough fetch + COOP/COEP headers

   WIRE SCHEMA (CONTRACTS.md): JSON is the DEFAULT —
     poll -> {id, method, path, headers, body_b64}
     resp -> {status, headers, body_b64}
   ADDITIVE EXTENSION (negotiated inside unit 4, both ends owned here): a
   client may append `?fmt=raw` to poll/resp to use a line-oriented framing
   that busybox sh can parse without a JSON parser:
     line 1: <id>            (poll)   |  line 1: <status>   (resp)
     line 2: <method>        (poll)
     line 3: <path?query>    (poll)
     then:   h <name_b64> <value_b64>   one per header (UTF-8, base64)
     last:   b <body_b64>               always present, empty allowed
   rootfs/askk-ingressd is the only fmt=raw client. JSON consumers are
   unaffected. If you touch the framing, change BOTH files.

   The queue lives in SW global scope: a SW restart drops in-flight entries;
   waiting browser fetches 502 via the ~180s orphan timeout. Accepted ceiling
   (Eliza pattern). No WebSocket support — accepted ceiling per CONTRACTS. */

"use strict";

/* ---------------------------------------------------------------- *
 *  Pure core — no SW APIs, attached on globalThis so node:test can  *
 *  load this file directly (docs/ingress.test.mjs).                 *
 * ---------------------------------------------------------------- */
(function (g) {
  const B64_CHUNK = 0x8000;

  function bytesToB64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i += B64_CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + B64_CHUNK));
    }
    return btoa(bin);
  }

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function strToB64(s) {
    return bytesToB64(new TextEncoder().encode(s));
  }

  function b64ToStr(b64) {
    return new TextDecoder().decode(b64ToBytes(b64));
  }

  /* request -> wire (browser -> guest) */

  function encodeReqJson(req) {
    return JSON.stringify({
      id: req.id,
      method: req.method,
      path: req.path,
      headers: req.headers || {},
      body_b64: req.body_b64 || "",
    });
  }

  function encodeReqRaw(req) {
    const lines = [req.id, req.method, req.path];
    for (const [n, v] of Object.entries(req.headers || {})) {
      lines.push("h " + strToB64(n) + " " + strToB64(v));
    }
    lines.push("b " + (req.body_b64 || ""));
    return lines.join("\n") + "\n";
  }

  /* wire -> response (guest -> browser) */

  function parseRespJson(text) {
    const o = JSON.parse(text);
    if (typeof o !== "object" || o === null || typeof o.status !== "number") {
      throw new Error("resp wire: bad shape");
    }
    return { status: o.status, headers: o.headers || {}, body_b64: o.body_b64 || "" };
  }

  function parseRespRaw(text) {
    const lines = text.split("\n");
    const status = Number((lines[0] || "").trim());
    if (!Number.isFinite(status)) throw new Error("resp wire: bad status line");
    const headers = {};
    let body_b64 = "";
    for (let i = 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.startsWith("h ")) {
        const sp = l.indexOf(" ", 2);
        if (sp < 0) throw new Error("resp wire: bad header line " + (i + 1));
        // ponytail: duplicate names (Set-Cookie) last-wins; array-valued headers if it bites
        headers[b64ToStr(l.slice(2, sp))] = b64ToStr(l.slice(sp + 1).trim());
      } else if (l.startsWith("b ")) {
        body_b64 = l.slice(2).trim();
      } else if (l.trim() !== "") {
        throw new Error("resp wire: bad line " + (i + 1));
      }
    }
    return { status, headers, body_b64 };
  }

  /* path juggling */

  // scope-relative path -> guest path ('/'+rest+query), or null if not __hermes
  function hermesPath(rel, search) {
    if (rel === "__hermes" || rel === "__hermes/") return "/" + (search || "");
    if (rel.startsWith("__hermes/")) {
      return "/" + rel.slice("__hermes/".length) + (search || "");
    }
    return null;
  }

  // Location header from the guest -> browser-side path under the scope.
  // Only trivially safe rewrites: absolute-path, or absolute URL to the
  // guest's own 127.0.0.1:9119 / localhost:9119. Everything else untouched.
  function rewriteLocation(loc, scopePath) {
    if (typeof loc !== "string" || loc === "") return loc;
    if (loc.startsWith("/")) return scopePath + "__hermes" + loc;
    try {
      const u = new URL(loc);
      if ((u.hostname === "127.0.0.1" || u.hostname === "localhost") && u.port === "9119") {
        return scopePath + "__hermes" + u.pathname + u.search + u.hash;
      }
    } catch (_e) { /* relative or garbage: leave it */ }
    return loc;
  }

  // guest resp -> a real Response. NOTE on bodies: the SPA's own absolute-path
  // references inside HTML/JS bodies are NOT rewritten (base-path problem) —
  // hermes' dashboard is expected to use relative paths; if it does not, the
  // fix is a <base> tag / build-time base path, not body regex surgery here.
  function respToResponse(resp, scopePath) {
    const h = new Headers();
    for (const [n, v] of Object.entries(resp.headers || {})) {
      const ln = n.toLowerCase();
      // stripped: recomputed by the browser / meaningless after relay
      if (ln === "content-length" || ln === "transfer-encoding" ||
          ln === "connection" || ln === "keep-alive") continue;
      const val = ln === "location" ? rewriteLocation(v, scopePath) : v;
      try { h.append(n, val); } catch (_e) { /* invalid name from wire: drop */ }
    }
    let status = Number(resp.status);
    if (!Number.isFinite(status) || status < 200 || status > 599) status = 502;
    const noBody = status === 204 || status === 205 || status === 304;
    const body = noBody ? null : b64ToBytes(resp.body_b64 || "");
    return new Response(body, { status, headers: h });
  }

  /* the queue: browser fetches in, guest pollers out */

  function createQueue(opts) {
    const orphanMs = (opts && opts.orphanMs) || 30000;
    const queue = [];          // wire requests waiting for a guest poller
    const waiters = [];        // guest pollers waiting for a request
    const pending = new Map(); // id -> waiting browser fetch

    // returns a promise for the guest's resp; rejects after orphanMs
    function submit(req) {
      const p = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(req.id);
          reject(new Error("orphaned after " + orphanMs + "ms"));
        }, orphanMs);
        pending.set(req.id, { resolve, timer });
      });
      const w = waiters.shift();
      if (w) {
        clearTimeout(w.timer);
        w.resolve(req);
      } else {
        queue.push(req);
      }
      return p;
    }

    // returns a promise for one wire request, or null after maxWaitMs
    function poll(maxWaitMs) {
      if (queue.length) return Promise.resolve(queue.shift());
      return new Promise((resolve) => {
        const w = { resolve, timer: 0 };
        w.timer = setTimeout(() => {
          const i = waiters.indexOf(w);
          if (i >= 0) waiters.splice(i, 1);
          resolve(null);
        }, maxWaitMs);
        waiters.push(w);
      });
    }

    // guest answered; false if the id is unknown (orphaned or bogus)
    function resolve(id, resp) {
      const e = pending.get(id);
      if (!e) return false;
      pending.delete(id);
      clearTimeout(e.timer);
      e.resolve(resp);
      return true;
    }

    return { submit, poll, resolve };
  }

  g.AskkIngressCore = {
    bytesToB64, b64ToBytes, strToB64, b64ToStr,
    encodeReqJson, encodeReqRaw, parseRespJson, parseRespRaw,
    hermesPath, rewriteLocation, respToResponse,
    createQueue,
  };
})(typeof self !== "undefined" ? self : globalThis);

/* ---------------------------------------------------------------- *
 *  Shelf cache core — pure decision logic for the bin/ asset cache. *
 *  No SW APIs; node-testable (docs/shelf.test.mjs), same pattern as  *
 *  AskkIngressCore above.                                            *
 * ---------------------------------------------------------------- */
(function (g) {
  // Everything under bin/ is a cacheable shelf asset — tarballs, .part-*
  // pieces, .parts indexes, bare binaries — EXCEPT bin/BUNDLES.json, the
  // version manifest itself (must always come from the network). Small text
  // files (README, SIZES.txt) are cached too: they ride the revalidation
  // fallback and excluding them buys nothing.
  function isShelfAsset(rel) {
    return rel.startsWith("bin/") && rel !== "bin/BUNDLES.json";
  }

  // The BUNDLES.json sha256 governing <basename>, or null when uncovered.
  // Schema: {artifacts:{<basename>:{bytes,sha256,parts?:[...]}}}. A part
  // and the <name>.parts index inherit the parent artifact's sha256.
  function resolveSha(manifest, basename) {
    const arts = manifest && manifest.artifacts;
    if (!arts || !basename) return null;
    const direct = arts[basename];
    if (direct && direct.sha256) return direct.sha256;
    if (basename.endsWith(".parts")) {
      const parent = arts[basename.slice(0, -".parts".length)];
      if (parent && parent.sha256) return parent.sha256;
    }
    for (const e of Object.values(arts)) {
      if (Array.isArray(e.parts) && e.parts.includes(basename)) {
        return e.sha256 || null;
      }
    }
    return null;
  }

  // How to serve a shelf asset:
  //   "cache"      cached sha matches the manifest sha — zero network
  //   "network"    manifest covers it but the cache doesn't match — fetch,
  //                store under the manifest sha (network failure with a
  //                cached copy degrades to the cache; without one, the
  //                error propagates)
  //   "revalidate" manifest absent or entry missing — pre-manifest
  //                conditional ETag/Last-Modified behavior
  function serveDecision(s) {
    if (!s.manifestSha) return "revalidate";
    if (s.cachedSha && s.cachedSha === s.manifestSha) return "cache";
    return "network";
  }

  g.AskkShelfCore = { isShelfAsset, resolveSha, serveDecision };
})(typeof self !== "undefined" ? self : globalThis);

/* ---------------------------------------------------------------- *
 *  Service-worker wiring — only in a real SW global.                *
 * ---------------------------------------------------------------- */
if (typeof ServiceWorkerGlobalScope !== "undefined" &&
    typeof self !== "undefined" && self instanceof ServiceWorkerGlobalScope) {
  const core = self.AskkIngressCore;
  const shelf = self.AskkShelfCore;
  // normalized to a trailing "/" — route slicing and Location rewriting rely on it
  const rawScope = new URL(self.registration.scope).pathname;
  const scopePath = rawScope.endsWith("/") ? rawScope : rawScope + "/";
  // 180s: hermes API endpoints under Bochs emulation routinely need >30s
  // real time (model options probe the backend + catalogs); 30s orphaned
  // them and the dashboard showed "guest did not answer" on every settings
  // mutation while fast GETs still worked.
  const q = core.createQueue({ orphanMs: 180000 });
  const POLL_MS = 25000;
  const PERSIST_CACHE = "askk-persist";
  const IMAGE_CACHE = "askk-image";

  // credentialless default; the page can flip to require-corp (coi pattern)
  let coepCredentialless = true;

  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
  self.addEventListener("message", (e) => {
    if (e.data && e.data.type === "coepCredentialless") coepCredentialless = !!e.data.value;
  });

  // COOP/COEP/CORP on every response we can touch (opaque ones pass as-is)
  function withCoi(resp) {
    if (!resp || resp.status === 0) return resp;
    const h = new Headers(resp.headers);
    h.set("Cross-Origin-Opener-Policy", "same-origin");
    h.set("Cross-Origin-Embedder-Policy", coepCredentialless ? "credentialless" : "require-corp");
    h.set("Cross-Origin-Resource-Policy", "cross-origin");
    return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
  }

  async function handlePersist(req, rel) {
    const cache = await caches.open(PERSIST_CACHE);
    const key = new URL(rel, self.registration.scope).href; // same-origin key
    if (req.method === "PUT") {
      await cache.put(key, new Response(await req.arrayBuffer()));
      return withCoi(new Response("saved", { status: 200 }));
    }
    if (req.method === "GET") {
      const hit = await cache.match(key);
      return withCoi(hit || new Response("not found", { status: 404 }));
    }
    if (req.method === "DELETE") {
      const had = await cache.delete(key);
      return withCoi(new Response(had ? "deleted" : "not found", { status: had ? 200 : 404 }));
    }
    return withCoi(new Response("method not allowed", { status: 405 }));
  }

  async function handlePoll(url) {
    const wire = await q.poll(POLL_MS);
    if (!wire) return withCoi(new Response(null, { status: 204 }));
    const raw = url.searchParams.get("fmt") === "raw";
    return withCoi(new Response(
      raw ? core.encodeReqRaw(wire) : core.encodeReqJson(wire),
      { status: 200, headers: { "Content-Type": raw ? "text/plain" : "application/json" } }
    ));
  }

  async function handleResp(req, rel, url) {
    const id = rel.slice("__ingress/resp/".length);
    let resp;
    try {
      const text = await req.text();
      resp = url.searchParams.get("fmt") === "raw"
        ? core.parseRespRaw(text)
        : core.parseRespJson(text);
    } catch (err) {
      return withCoi(new Response("bad wire: " + err.message, { status: 400 }));
    }
    const known = q.resolve(id, resp);
    return withCoi(new Response(null, { status: known ? 204 : 404 }));
  }

  // WS-over-relay (CONTRACTS.md): SWs can't intercept WebSocket upgrades, so
  // every relayed dashboard HTML document gets docs/askk-ws.js injected —
  // it replaces window.WebSocket with a shim that tunnels frames as plain
  // /__ws/* fetches through this very relay (guest side: askk-ingressd ->
  // askk-wsbridge:9219). CSP headers are dropped on injected documents so
  // the added script can run.
  function injectWsShim(resp) {
    const ct = (resp.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("text/html")) return Promise.resolve(resp);
    return resp.text().then((html) => {
      const tag = '<script src="/__askk-ws.js"></script>';
      let out;
      const m = /<head[^>]*>/i.exec(html);
      if (m) out = html.slice(0, m.index + m[0].length) + tag + html.slice(m.index + m[0].length);
      else out = tag + html;
      const h = new Headers(resp.headers);
      h.delete("content-security-policy");
      h.delete("content-security-policy-report-only");
      h.delete("content-length");
      return new Response(out, { status: resp.status, headers: h });
    });
  }

  async function handleHermes(req, guestPath) {
    const headers = {};
    for (const [n, v] of req.headers.entries()) headers[n] = v;
    let body_b64 = "";
    if (req.method !== "GET" && req.method !== "HEAD") {
      body_b64 = core.bytesToB64(new Uint8Array(await req.arrayBuffer()));
    }
    const wire = {
      id: crypto.randomUUID(),
      method: req.method,
      path: guestPath,
      headers,
      body_b64,
    };
    let resp;
    try {
      resp = await q.submit(wire);
    } catch (err) {
      return withCoi(new Response("guest did not answer: " + err.message, { status: 502 }));
    }
    try {
      return await injectWsShim(core.respToResponse(resp, scopePath)).then(withCoi);
    } catch (err) {
      return withCoi(new Response("bad guest resp: " + err.message, { status: 502 }));
    }
  }

  /* Client-side cache for the big boot payloads — without it every page
     load re-downloads the ~40MB image chunks and the ~120MB shelf
     tarballs (browser HTTP cache won't hold them: gh-pages sends
     max-age=600, serve.py nothing).
       chunks   cache-first. boot.js appends ?g=<gz_total> to every chunk
                URL, so the URL itself is the content version: a new image
                is a cache miss, and stale same-path entries are purged
                after the new one lands.
       shelf    (bin/* — tarballs, .part-* pieces, .parts indexes, bare
                binaries) hash-keyed. bin/BUNDLES.json maps each artifact
                to its sha256; a cached copy remembers the sha it was
                fetched under (x-askk-sha256 synthetic header). Sha match
                serves the cache with ZERO network; mismatch refetches;
                assets the manifest doesn't cover fall back to conditional
                ETag/Last-Modified revalidation; network failure with a
                cached copy serves the cache (availability > freshness).
     Quota errors degrade to plain network — caching must never block boot. */

  function isImageChunk(rel) { return rel.startsWith("wasm/out.wasm.gz.part-"); }

  // BUNDLES.json, fetched no-store at most once per MANIFEST_TTL_MS per SW
  // lifetime (module scope resets on every SW restart, so a new SW — and
  // thus every activation — refreshes for free). Fetch failure resolves
  // null: every shelf asset then takes the revalidation fallback.
  const MANIFEST_TTL_MS = 5 * 60 * 1000;
  let manifestAt = 0;
  let manifestPromise = null;
  function getManifest() {
    if (!manifestPromise || Date.now() - manifestAt > MANIFEST_TTL_MS) {
      manifestAt = Date.now();
      manifestPromise = fetch(scopePath + "bin/BUNDLES.json", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
    }
    return manifestPromise;
  }

  async function handleChunk(req) {
    const cache = await caches.open(IMAGE_CACHE);
    const hit = await cache.match(req.url);
    if (hit) return withCoi(hit);
    const resp = await fetch(req);
    if (resp.ok) {
      try {
        await cache.put(req.url, resp.clone());
        const path = new URL(req.url).pathname;
        for (const k of await cache.keys()) {
          if (new URL(k.url).pathname === path && k.url !== req.url) await cache.delete(k);
        }
      } catch (_e) { /* quota exceeded — keep serving from the network */ }
    }
    return withCoi(resp);
  }

  async function handleShelf(req, rel) {
    const cache = await caches.open(IMAGE_CACHE);
    const hit = await cache.match(req.url);
    const manifestSha = shelf.resolveSha(await getManifest(), rel.slice(rel.lastIndexOf("/") + 1));
    const decision = shelf.serveDecision({
      cachedSha: hit && hit.headers.get("x-askk-sha256"),
      manifestSha,
    });
    if (decision === "cache") return withCoi(hit); // sha match: zero network
    if (decision === "revalidate") return revalidateShelf(req, cache, hit);
    // "network": manifest sha differs from (or is missing on) the cached copy
    let resp;
    try {
      resp = await fetch(req);
    } catch (err) {
      if (hit) return withCoi(hit); // availability over freshness
      throw err;
    }
    if (resp.ok) {
      try {
        const h = new Headers(resp.headers);
        h.set("x-askk-sha256", manifestSha);
        await cache.put(req.url, new Response(resp.clone().body, {
          status: resp.status, statusText: resp.statusText, headers: h,
        }));
        const path = new URL(req.url).pathname;
        for (const k of await cache.keys()) {
          if (new URL(k.url).pathname === path && k.url !== req.url) await cache.delete(k);
        }
      } catch (_e) { /* quota exceeded — keep serving from the network */ }
      return withCoi(resp);
    }
    return hit ? withCoi(hit) : withCoi(resp);
  }

  // Pre-manifest behavior, kept for shelf assets BUNDLES.json doesn't cover.
  async function revalidateShelf(req, cache, hit) {
    const cond = new Headers();
    if (hit) {
      const et = hit.headers.get("ETag");
      const lm = hit.headers.get("Last-Modified");
      if (et) cond.set("If-None-Match", et);
      if (lm) cond.set("If-Modified-Since", lm);
    }
    let resp;
    try {
      resp = await fetch(req.url, { headers: cond });
    } catch (err) {
      if (hit) return withCoi(hit);
      throw err;
    }
    if (resp.status === 304 && hit) return withCoi(hit);
    if (resp.ok) {
      try { await cache.put(req.url, resp.clone()); } catch (_e) { /* quota */ }
      return withCoi(resp);
    }
    return hit ? withCoi(hit) : withCoi(resp);
  }

  // Window clients whose document came from __hermes/ — the dashboard
  // iframe. The hermes SPA fetches absolute paths (/assets/…, /api/…) that
  // fall OUTSIDE the virtual prefix; requests from these clients are routed
  // into the guest wholesale instead of 404ing against the page origin.
  // SW restart drops the set — the iframe reloads and re-registers.
  const hermesClients = new Set();

  self.addEventListener("fetch", (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // scope-relative path; the net stack (unit 3) rewrites the sentinel
    // hosts (persist/ingress.askk.internal) to same-origin under the scope,
    // so guest traffic lands here exactly like page traffic (CONTRACTS.md)
    let rel = null;
    if (url.origin === self.location.origin && url.pathname.startsWith(scopePath)) {
      rel = url.pathname.slice(scopePath.length);
    }

    if (rel !== null) {
      if (rel.startsWith("__persist/")) return event.respondWith(handlePersist(req, rel));
      if (rel === "__ingress/poll" && req.method === "GET") {
        return event.respondWith(handlePoll(url));
      }
      if (rel.startsWith("__ingress/resp/") && req.method === "POST") {
        return event.respondWith(handleResp(req, rel, url));
      }
      if (req.method === "GET" && isImageChunk(rel)) return event.respondWith(handleChunk(req));
      if (req.method === "GET" && shelf.isShelfAsset(rel)) return event.respondWith(handleShelf(req, rel));
      const guestPath = core.hermesPath(rel, url.search);
      if (guestPath !== null) {
        // A navigation to __hermes/ creates the iframe's document — remember
        // the client id it will get, so its SPA's absolute-path fetches can
        // be recognized below.
        if (req.mode === "navigate" && event.resultingClientId) {
          hermesClients.add(event.resultingClientId);
        }
        return event.respondWith(handleHermes(req, guestPath));
      }
    }

    // Absolute-path requests from the dashboard iframe (SPA assets and API
    // calls) — forward into the guest exactly like __hermes/ traffic. The
    // injected WS shim itself is a page asset, not guest content.
    if (event.clientId && hermesClients.has(event.clientId) &&
        url.origin === self.location.origin) {
      if (url.pathname.endsWith("/__askk-ws.js")) {
        return event.respondWith(fetch(scopePath + "askk-ws.js").then(withCoi));
      }
      return event.respondWith(handleHermes(req, url.pathname + url.search));
    }

    // everything else: coi-serviceworker passthrough (Eliza pattern)
    if (req.cache === "only-if-cached" && req.mode !== "same-origin") return;
    const outbound = coepCredentialless && req.mode === "no-cors"
      ? new Request(req, { credentials: "omit" })
      : req;
    event.respondWith(fetch(outbound).then(withCoi));
  });
}

/* ---------------------------------------------------------------- *
 *  Window wiring — the coi-serviceworker half of the pattern.      *
 *  index.html loads this file as a plain <script>; in that context *
 *  we register ourselves (relative path, so the gh-pages subpath   *
 *  becomes the scope) and reload once if isolation isn't up yet.   *
 * ---------------------------------------------------------------- */
if (typeof window !== "undefined" && typeof document !== "undefined" &&
    "serviceWorker" in navigator &&
    // ?nosw=1 — debugging escape hatch: run without the service worker
    // (local serve.py provides real COOP/COEP headers; gh-pages needs the SW).
    !new URLSearchParams(window.location.search).get("nosw")) {
  navigator.serviceWorker.register(document.currentScript && document.currentScript.src
      ? document.currentScript.src : "./askk-sw.js")
    .then((reg) => {
      // First visit: no controller yet. Reload once when the SW activates so
      // this load runs under its COOP/COEP headers (needed on gh-pages,
      // where no server headers exist). serve.py sends real headers, so the
      // reload only happens when isolation is actually missing.
      if (!navigator.serviceWorker.controller &&
          typeof SharedArrayBuffer === "undefined" &&
          !sessionStorage.getItem("askk-sw-reloaded")) {
        sessionStorage.setItem("askk-sw-reloaded", "1");
        const target = reg.installing || reg.waiting;
        if (target) {
          target.addEventListener("statechange", () => {
            if (target.state === "activated") window.location.reload();
          });
        } else if (reg.active) {
          window.location.reload();
        }
      }
    })
    .catch((err) => console.error("askk-sw registration failed:", err));

  // Safari COEP escape hatch — ?coep=require-corp on the page URL flips the
  // SW's COEP header from credentialless (default; historically unsupported
  // by Safari) to require-corp. The trade: require-corp demands CORP on
  // every cross-origin subresource — withCoi stamps CORP on responses the
  // SW relays, but direct cross-origin fetches by the page may break.
  // Escape hatch only; credentialless stays the default.
  if (new URLSearchParams(window.location.search).get("coep") === "require-corp") {
    sessionStorage.setItem("askk-coep", "require-corp");
  }
  if (sessionStorage.getItem("askk-coep") === "require-corp") {
    navigator.serviceWorker.ready.then((reg) => {
      if (!reg.active) return;
      reg.active.postMessage({ type: "coepCredentialless", value: false });
      // This document may already be stamped credentialless: one recovery
      // reload after the flag lands (the message is queued ahead of the
      // reload's navigation fetch, so the refetch gets require-corp).
      // ponytail: an idle SW restart forgets the flag; the guard allows one
      // recovery per tab-session — a manual refresh re-runs this block.
      if (navigator.serviceWorker.controller && !window.crossOriginIsolated &&
          !sessionStorage.getItem("askk-coep-reloaded")) {
        sessionStorage.setItem("askk-coep-reloaded", "1");
        window.location.reload();
      }
    });
  }
}
