# Spike: coi-serviceworker — cross-origin isolation on GitHub Pages

**Status:** proven (Chromium). **Date:** 2026-06-08.
**Demo:** [`experiments/coi/`](../../experiments/coi/) (`index.html` +
vendored `coi-serviceworker.js`).

## Why this gates everything

ASKK ships as a Rust→WASM/Dioxus single-page app on **GitHub Pages**. The heavy
in-browser execution substrates we are evaluating —
[container2wasm](./container2wasm.md) and the
[WASIX / `@wasmer/sdk`](./wasix.md) path — need **threads**, and threads in the
browser need **`SharedArrayBuffer`**. `SharedArrayBuffer` is only available when
the document is **cross-origin isolated**, which requires two response headers on
the top-level document:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp   (or: credentialless)
```

**GitHub Pages serves static files and cannot set custom response headers.** So
the question that gates the entire execution-model decision (see
[`docs/EXECUTION_MODEL.md`](../EXECUTION_MODEL.md)) is: *can we become
cross-origin isolated on gh-pages without a header-setting backend?*

## Verdict

**Yes, on Chromium-family browsers, with a caveat-laden client-side workaround.**
A same-origin **service worker** ([gzuidhof/coi-serviceworker], MIT) intercepts
every `fetch` for the origin and re-emits the response with the COOP/COEP (and
`Cross-Origin-Resource-Policy`) headers synthesized. Because a service worker
controls navigations *after* it installs, the first visit is not yet controlled;
coi-serviceworker handles this by triggering **exactly one automatic reload** on
first load, after which the document is isolated.

This is a real, deployable answer for ASKK on gh-pages — but it is **not free**.
The reload UX wrinkle and the browser-support gaps below are load-bearing
constraints on the execution model, not footnotes.

[gzuidhof/coi-serviceworker]: https://github.com/gzuidhof/coi-serviceworker

## What was tested

Served `experiments/coi/` from a **plain `python3 -m http.server` on port 8108
with no COOP/COEP headers** — deliberately reproducing the gh-pages "no headers"
constraint (confirmed via `curl -D -`: zero `Cross-Origin-*` headers on the
document). Loaded `http://localhost:8108/` in a Chromium engine (Chrome 146 /
Electron 41 via the preview harness; `localhost` is a secure context so the SW
registers).

Result, read straight off the page and `window.__coiResult`:

| Probe | Value |
|---|---|
| `crossOriginIsolated` | **`true`** |
| `new SharedArrayBuffer(8)` | **ok** (`byteLength === 8`) |
| `isSecureContext` | `true` |
| service worker controlling | `true` |
| SW scope | `http://localhost:8108/` (page origin) |

The before→after transition was also reproduced from a cold state: unregistering
the SW + clearing `sessionStorage`, then reloading, produced the documented
console sequence

```
COOP/COEP Service Worker registered http://localhost:8108/
Reloading page to make use of updated COOP/COEP Service Worker.
```

…and the page came back **isolated** with `SharedArrayBuffer` constructable. That
"Reloading page…" line is the first-load reload — observed live, not assumed.

> Note on the page's "page reloaded by SW once" indicator: it reads a marker that
> coi-serviceworker clears as part of its own flow, so it can show "not yet" even
> when a reload did occur. The console log above is the authoritative evidence.

## How it works (mechanics)

`coi-serviceworker.js` is a dual-mode script:

- **In the page** (`window` defined): on load it checks
  `window.crossOriginIsolated`. If already isolated (or the browser has no notion
  of it) it does nothing. Otherwise, in a secure context, it
  `navigator.serviceWorker.register(document.currentScript.src)` — registering
  *itself* as the worker — and reloads once so the now-active worker controls the
  navigation.
- **In the worker** (`window` undefined): it `skipWaiting()` + `clients.claim()`
  to take control fast, then on every `fetch` it copies the upstream response and
  sets `Cross-Origin-Opener-Policy: same-origin` plus
  `Cross-Origin-Embedder-Policy: require-corp` (or `credentialless`), and
  `Cross-Origin-Resource-Policy: cross-origin` in the non-credentialless path.

It negotiates `require-corp` vs `credentialless` automatically and degrades COEP
on failure (one extra reload at most). The vendored copy is **v0.1.7, unmodified**
(see `experiments/coi/LICENSE.coi-serviceworker`).

## Caveats (precise)

1. **First-load reload — the agent-mid-task hazard.** On a visitor's *first* load
   (and after the SW updates), the page reloads itself once. For a static demo
   this is invisible. For **ASKK it is not**: if the agent is mid-run when an
   unexpected reload fires, in-memory run state is lost. Mitigations:
   - The reload only happens when the page is **not already isolated**. If we ship
     the SW from day one and a returning visitor already has it installed and
     controlling, **no reload occurs** on subsequent visits.
     `SW update` (a changed `coi-serviceworker.js` byte-for-byte) re-triggers it,
     so treat the SW file as **near-immutable** and cache-bust deliberately, not
     incidentally.
   - The reload races *page load*, not a running agent — it happens before any
     run starts because the SW gates isolation, which we require *before* booting
     the heavy substrate. As long as ASKK does not start a run until
     `crossOriginIsolated === true`, the reload cannot interrupt a run. This must
     be an explicit ordering invariant in the boot path (see Integration).
   - ASKK already persists runs to IndexedDB and resumes paused runs on reload
     (see `docs/definition-of-done.md`), so even a worst-case mid-run reload is
     recoverable, not data-loss — but we should still avoid it by ordering boot
     correctly.

2. **HTTPS / secure-context only.** Service workers require a secure context.
   gh-pages is HTTPS, so production is fine; `localhost` counts as secure for dev.
   Plain `http://` on a LAN IP will silently not register (the SW logs
   "a secure context is required" and gives up). No isolation there.

3. **Same-origin SW file — cannot be a CDN.** A service worker can only be
   registered for a script served from **its own origin**, and its control scope
   is the path it is served under. `coi-serviceworker.js` must be served from the
   ASKK origin (gh-pages), sitting at the site root so its scope covers the whole
   app. It **cannot** be bundled into a JS chunk or pulled from a CDN — it has to
   be a standalone same-origin file referenced by a `<script>` tag.

4. **COEP `require-corp` vs `credentialless`.** `require-corp` demands that every
   cross-origin subresource opt in via CORP/CORS. ASKK calls LLM provider APIs
   over `fetch` (BYOK), and those are cross-origin. Under `require-corp` such
   responses need appropriate CORP/CORS or they are blocked once isolated.
   `credentialless` (which coi-serviceworker negotiates, and is the default for
   non-Chromium fallbacks) relaxes this by sending no-cors requests without
   credentials — friendlier to third-party APIs but it strips cookies/credentials
   (irrelevant for bearer-token LLM calls, which is our case). **This interacts
   directly with the provider-fetch path** and must be validated against each
   provider, not assumed.

5. **Safari / Firefox limitations.**
   - **Firefox**: supports COOP/COEP + `crossOriginIsolated` + `SharedArrayBuffer`
     and service workers, so the workaround works — *except* in **private mode**,
     where `navigator.serviceWorker` is unavailable (the SW logs exactly this and
     bails). No isolation → no `SharedArrayBuffer` → heavy substrates unavailable
     in a Firefox private window.
   - **Safari**: historically the weakest link. It implements COOP/COEP and
     `crossOriginIsolated`, but its COEP enforcement and `credentialless` support
     have lagged and varied by version; coi-serviceworker's own README flags
     Safari as the browser most likely to need the `credentialless`/COEP-degrade
     fallback or to fail outright on older versions. **Not verified in this spike**
     (the harness runs a Chromium engine). Treat Safari as *best-effort, must
     feature-detect* — do not assume the heavy substrate runs there.
   - **Feature-detect, never assume.** ASKK must gate the heavy-execution UI on a
     runtime `crossOriginIsolated === true && typeof SharedArrayBuffer !==
     "undefined"` check and degrade gracefully (Tier-1 OPFS-only path) when false,
     rather than crashing on browsers where the workaround does not land.

## Integration steps for the real app

1. **Vendor the file at the site root.** Copy `coi-serviceworker.js` (the v0.1.7
   MIT copy in `experiments/coi/`) to the published web root so it is reachable at
   `https://<user>.github.io/<repo>/coi-serviceworker.js`. In this repo that means
   placing it under `assets/` (or wherever `dx`/`Dioxus.toml` emits static assets
   to the published root) so it lands next to `index.html` with **the same scope
   as the app**. Verify the deployed scope covers the app path — on a
   project-pages subpath (`/<repo>/`) the SW must be served from that subpath, not
   the user-root.
2. **Register it first, before anything that needs `SharedArrayBuffer`.** Add
   `<script src="coi-serviceworker.js"></script>` as the **first** script in the
   document `<head>`, ahead of the Dioxus/WASM bootstrap. For `dx`, inject it via
   the index template / `Dioxus.toml` head config so it survives the build.
3. **Gate the boot path on isolation (ordering invariant).** ASKK must not start
   any run, and must not load container2wasm / `@wasmer/sdk`, until
   `crossOriginIsolated === true`. On first visit the SW reload happens during
   this pre-boot window, so the reload cannot interrupt a run. Make this an
   explicit check in the startup sequence, not an implicit hope.
4. **Feature-detect and degrade.** If after SW settle the page is still not
   isolated (Safari/older browsers, private mode, http), surface the Tier-1
   OPFS-only experience and hide/disable heavy-execution features — do not error.
5. **Treat the SW file as immutable.** Changing its bytes triggers an update +
   reload for returning users. Re-vendor from upstream only deliberately; pin the
   version (currently 0.1.7).
6. **Validate provider fetch under COEP.** Once isolated, re-run a real BYOK LLM
   call against each provider to confirm the COEP mode in effect
   (`credentialless` vs `require-corp`) does not block cross-origin provider
   responses. This is the most likely production surprise.

## Residual risks

- **Safari unverified here** and historically flaky for this exact workaround;
  the heavy-execution tier may simply be unavailable on Safari. Must be tested on
  real Safari before claiming support.
- **Provider fetch × COEP interaction** (caveat 4) is unproven against live
  providers; a misconfigured COEP mode could break BYOK calls *only after*
  isolation turns on — a subtle, isolation-conditional failure.
- **First-load reload** remains a UX wrinkle for brand-new visitors; acceptable
  given the boot-ordering invariant and IndexedDB resume, but it is a real,
  user-visible flash.
- **Dependence on an unaffiliated MIT one-file SW.** It is tiny and vendored
  (auditable, frozen), so supply-chain exposure is low, but it is third-party
  code in the most privileged position (a fetch-intercepting service worker).
  Keep it pinned and read every diff if we ever re-vendor.
- **Private browsing modes** (Firefox at least) disable service workers → no
  isolation → Tier-1 only. Expected and handled by feature-detection.

## See also

- [`docs/EXECUTION_MODEL.md`](../EXECUTION_MODEL.md) — where this gate sits in the
  overall execution-tier decision.
- [`docs/spikes/container2wasm.md`](./container2wasm.md) — heavy substrate that
  needs the isolation this spike proves.
- [`docs/spikes/wasix.md`](./wasix.md) — `@wasmer/sdk` / WASIX path, same
  `SharedArrayBuffer` dependency.
