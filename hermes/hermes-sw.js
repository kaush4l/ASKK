/* hermes-sw.js — cross-origin isolation + the browser <-> guest relay.

   Ported from ASKK docs/askk-sw.js (commit 80564a2), which proved this
   design against hermes 0.19.0 in a real browser. Dropped from that
   version: the persist blob store, the wasm-chunk cache, and the binary
   shelf, all of which existed to feed a single welded 349MB module. Here
   the image is a lazily-pulled OCI layout, so none of it applies.

   Added: sentinel-host routing. ASKK's custom net stack rewrote the guest's
   relay hostname to same-origin before the fetch reached the worker; the
   stock c2w proxy does not, so the router matches the hostname directly.

   Routes (relative to the registration scope, so a gh-pages subpath works):
     GET  __ingress/poll        long-poll (<=25s): one queued browser
                                request, or 204 on timeout
     POST __ingress/resp/<id>   the guest's answer; resolves the waiting fetch
     *    __hermes/<path>       virtual dashboard origin
     *    anything else         passthrough + COOP/COEP headers

   WIRE: JSON by default; `?fmt=raw` selects a line framing that busybox sh
   can parse without a JSON parser. rootfs/hermes-ingressd is the only raw
   client. Touching the framing means changing BOTH files.

   The queue lives in SW global scope: a restart drops in-flight entries and
   waiting fetches 502 via the orphan timeout. Accepted ceiling. */

"use strict";


/* ---------------------------------------------------------------- *
 *  Pure core — no SW APIs, attached on globalThis so node:test can  *
 *  load this file directly (ingress.test.mjs).                 *
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

  g.HermesIngressCore = {
    bytesToB64, b64ToBytes, strToB64, b64ToStr,
    encodeReqJson, encodeReqRaw, parseRespJson, parseRespRaw,
    hermesPath, rewriteLocation, respToResponse,
    createQueue,
  };
})(typeof self !== "undefined" ? self : globalThis);


/* ---------------------------------------------------------------- *
 *  Service-worker half: COI headers + the browser <-> guest relay.  *
 *  Guarded: this same file is also loaded as a plain <script> by the *
 *  page, where self.registration does not exist — an unguarded block *
 *  throws there and the window-wiring at the bottom never runs, so   *
 *  the worker silently never registers.                             *
 * ---------------------------------------------------------------- */
if (typeof ServiceWorkerGlobalScope !== "undefined" &&
    typeof self !== "undefined" && self instanceof ServiceWorkerGlobalScope) {
  const core = self.HermesIngressCore;

  // Normalized to a trailing "/" — route slicing and Location rewriting
  // rely on it, and it is what makes a gh-pages subpath (/wasmbox/) work
  // without any absolute URLs in the page.
  const rawScope = new URL(self.registration.scope).pathname;
  const scopePath = rawScope.endsWith("/") ? rawScope : rawScope + "/";

  // The guest reaches the relay by name. Its HTTP proxy is the in-browser
  // gvisor stack, which issues a real fetch() for the absolute URL — and a
  // fetch from a controlled worker passes through this handler before any
  // DNS happens, so a hostname that resolves nowhere is exactly right.
  const SENTINEL_HOST = "ingress.hermes.internal";

  // The model endpoint is reached by sentinel name too, and for a sharper
  // reason. The guest's own 127.0.0.1 is the GUEST's loopback, and the
  // runtime hardcodes no_proxy=localhost,127.0.0.1 — so a guest configured
  // with http://127.0.0.1:8873 talks to itself and never leaves the VM. The
  // machine that can actually reach the user's LLM is the BROWSER. So the
  // guest always points at this fixed name and the worker rewrites it to
  // whatever endpoint the page configured, then fetches it itself. That also
  // makes "connect to any externally hosted LLM" a page setting rather than
  // anything baked into the image.
  const SENTINEL_LLM = "llm.hermes.internal";

  // Persisted, not just held in a variable: the browser terminates an idle
  // service worker and restarts it on the next event, so a value set by the
  // page at boot is gone by the time the guest — minutes later, under an
  // x86 interpreter — makes its first model call. That failure looks exactly
  // like a broken endpoint: HTTP 503 from this worker, no request on the
  // wire, nothing in the guest's log.
  const CFG_CACHE = "hermes-config";
  const CFG_KEY = "https://hermes.internal/llm-base";
  let llmBase = null;

  async function setLlmBase(v) {
    llmBase = v || null;
    const cache = await caches.open(CFG_CACHE);
    if (llmBase) await cache.put(CFG_KEY, new Response(llmBase));
    else await cache.delete(CFG_KEY);
  }

  async function getLlmBase() {
    if (llmBase) return llmBase;
    const hit = await caches.open(CFG_CACHE).then((c) => c.match(CFG_KEY));
    if (hit) llmBase = await hit.text();
    return llmBase;
  }

  // 180s: hermes endpoints under an x86 interpreter routinely need far more
  // than 30s of real time (model probes, config writes). 30s orphaned them
  // and every dashboard mutation returned "guest did not answer".
  const q = core.createQueue({ orphanMs: 180000 });
  const POLL_MS = 25000;

  // credentialless default; the page flips it to require-corp (coi pattern)
  let coepCredentialless = true;

  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
  self.addEventListener("message", (e) => {
    if (e.data && e.data.type === "coepCredentialless") {
      coepCredentialless = !!e.data.value;
    }
    if (e.data && e.data.type === "llmBase") {
      e.waitUntil(setLlmBase(e.data.value));
    }
  });

  // Guest -> user's model endpoint. Path is rewritten off the sentinel's /v1
  // prefix onto whatever prefix the configured base URL already carries, so
  // both ".../v1" and bare-host bases work.
  async function handleLlm(req, url) {
    const base = await getLlmBase();
    if (!base) {
      return new Response("no model endpoint configured", { status: 503 });
    }
    const target = base.replace(/\/+$/, "") +
      url.pathname.replace(/^\/v1/, "") + url.search;
    const init = {
      method: req.method,
      headers: req.headers,
      mode: "cors",
      credentials: "omit",
    };
    if (req.method !== "GET" && req.method !== "HEAD") {
      init.body = await req.arrayBuffer();
    }
    try {
      return await fetch(target, init);
    } catch (err) {
      // Most often CORS or, from an https origin to a loopback endpoint,
      // Private Network Access. Both surface here as a TypeError.
      return new Response("model fetch failed: " + err.message,
                          { status: 502 });
    }
  }

  // COOP/COEP/CORP on every response we can touch (opaque ones pass as-is).
  // This is the whole reason a service worker is required on gh-pages: it
  // serves no headers of its own, and without cross-origin isolation there
  // is no SharedArrayBuffer, and without that xterm-pty's TtyServer cannot
  // block on Atomics.wait — the terminal never receives a byte.
  function withCoi(resp) {
    if (!resp || resp.status === 0) return resp;
    const h = new Headers(resp.headers);
    h.set("Cross-Origin-Opener-Policy", "same-origin");
    h.set("Cross-Origin-Embedder-Policy",
          coepCredentialless ? "credentialless" : "require-corp");
    h.set("Cross-Origin-Resource-Policy", "cross-origin");
    return new Response(resp.body,
      { status: resp.status, statusText: resp.statusText, headers: h });
  }

  async function handlePoll(url) {
    const wire = await q.poll(POLL_MS);
    if (!wire) return withCoi(new Response(null, { status: 204 }));
    const raw = url.searchParams.get("fmt") === "raw";
    return withCoi(new Response(
      raw ? core.encodeReqRaw(wire) : core.encodeReqJson(wire),
      { status: 200,
        headers: { "Content-Type": raw ? "text/plain" : "application/json" } }));
  }

  async function handleResp(req, rel, url) {
    const id = rel.slice("__ingress/resp/".length);
    const text = await req.text();
    let parsed;
    try {
      parsed = url.searchParams.get("fmt") === "raw"
        ? core.parseRespRaw(text) : core.parseRespJson(text);
    } catch (err) {
      return withCoi(new Response("bad resp: " + err.message, { status: 400 }));
    }
    const ok = q.resolve(id, parsed);
    return withCoi(new Response(ok ? "ok" : "unknown id",
                                { status: ok ? 200 : 404 }));
  }

  // Every relayed dashboard HTML document gets the WebSocket shim injected:
  // a service worker cannot intercept WebSocket handshakes, so the shim
  // replaces window.WebSocket with one that tunnels frames as plain /__ws/*
  // fetches through this same relay. CSP is dropped on injected documents so
  // the added script is allowed to run.
  function injectWsShim(resp) {
    const ct = (resp.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("text/html")) return Promise.resolve(resp);
    return resp.text().then((html) => {
      const tag = '<script src="' + scopePath + '__hermes-ws.js"></script>';
      const m = /<head[^>]*>/i.exec(html);
      const out = m
        ? html.slice(0, m.index + m[0].length) + tag +
          html.slice(m.index + m[0].length)
        : tag + html;
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
    let resp;
    try {
      resp = await q.submit({
        id: crypto.randomUUID(),
        method: req.method,
        path: guestPath,
        headers,
        body_b64,
      });
    } catch (err) {
      return withCoi(new Response("guest did not answer: " + err.message,
                                  { status: 502 }));
    }
    try {
      return await injectWsShim(core.respToResponse(resp, scopePath))
        .then(withCoi);
    } catch (err) {
      return withCoi(new Response("bad guest resp: " + err.message,
                                  { status: 502 }));
    }
  }

  // Window clients whose document came from __hermes/ — the dashboard
  // iframe. The hermes SPA fetches absolute paths (/assets/…, /api/…) that
  // fall outside the virtual prefix; requests from these clients are routed
  // into the guest wholesale instead of 404ing against the page origin.
  const hermesClients = new Set();

  self.addEventListener("fetch", (event) => {
    const req = event.request;
    const url = new URL(req.url);

    if (url.hostname === SENTINEL_LLM) {
      return event.respondWith(handleLlm(req, url));
    }

    // Guest traffic: absolute URLs at the sentinel host, no origin match.
    if (url.hostname === SENTINEL_HOST) {
      const rel = url.pathname.replace(/^\//, "");
      if (rel === "__ingress/poll" && req.method === "GET") {
        return event.respondWith(handlePoll(url));
      }
      if (rel.startsWith("__ingress/resp/") && req.method === "POST") {
        return event.respondWith(handleResp(req, rel, url));
      }
      return event.respondWith(new Response("no such relay route",
                                            { status: 404 }));
    }

    let rel = null;
    if (url.origin === self.location.origin &&
        url.pathname.startsWith(scopePath)) {
      rel = url.pathname.slice(scopePath.length);
    }

    if (rel !== null) {
      // Same-origin form of the relay routes, so a page-side debug client
      // (and the ingress self-test) can drive the queue without the proxy.
      if (rel === "__ingress/poll" && req.method === "GET") {
        return event.respondWith(handlePoll(url));
      }
      if (rel.startsWith("__ingress/resp/") && req.method === "POST") {
        return event.respondWith(handleResp(req, rel, url));
      }
      const guestPath = core.hermesPath(rel, url.search);
      if (guestPath !== null) {
        if (req.mode === "navigate" && event.resultingClientId) {
          hermesClients.add(event.resultingClientId);
        }
        return event.respondWith(handleHermes(req, guestPath));
      }
    }

    // Absolute-path requests from the dashboard iframe (SPA assets and API
    // calls) — forwarded into the guest exactly like __hermes/ traffic. The
    // injected shim itself is a page asset, not guest content.
    if (event.clientId && hermesClients.has(event.clientId) &&
        url.origin === self.location.origin) {
      if (url.pathname.endsWith("__hermes-ws.js")) {
        return event.respondWith(
          fetch(scopePath + "hermes-ws.js").then(withCoi));
      }
      return event.respondWith(handleHermes(req, url.pathname + url.search));
    }

    // Everything else: coi-serviceworker passthrough.
    if (req.cache === "only-if-cached" && req.mode !== "same-origin") return;
    const outbound = coepCredentialless && req.mode === "no-cors"
      ? new Request(req, { credentials: "omit" })
      : req;
    event.respondWith(fetch(outbound).then(withCoi));
  });
}

/* ---------------------------------------------------------------- *
 *  Window wiring — the coi-serviceworker half. index.html loads     *
 *  this file as a plain <script>; in that context it registers      *
 *  itself with a RELATIVE path, so a gh-pages subpath becomes the   *
 *  scope, and reloads once if isolation is not up yet.              *
 * ---------------------------------------------------------------- */
if (typeof window !== "undefined" && typeof document !== "undefined" &&
    "serviceWorker" in navigator &&
    !new URLSearchParams(window.location.search).get("nosw")) {
  const src = (document.currentScript && document.currentScript.src)
    ? document.currentScript.src : "./hermes-sw.js";
  navigator.serviceWorker.register(src).then((reg) => {
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      if (w) w.addEventListener("statechange", () => {
        if (w.state === "activated" && !window.crossOriginIsolated) {
          window.location.reload();
        }
      });
    });
    if (reg.active && !navigator.serviceWorker.controller) {
      window.location.reload();
    }
  }).catch((e) => console.error("hermes-sw registration failed", e));

  // serve.py already sends real COOP/COEP locally, so the reload only ever
  // fires on a host that does not (gh-pages).
  if (navigator.serviceWorker.controller && !window.crossOriginIsolated) {
    navigator.serviceWorker.controller.postMessage(
      { type: "coepCredentialless", value: false });
  }
}
