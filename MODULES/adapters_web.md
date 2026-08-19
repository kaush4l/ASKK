# Module: adapters_web

**One-sentence purpose:** The only browser-aware crate: wasm-bindgen port implementations plus the
composition root that boots `core` and exposes the seam to `ui` in-process
(`crates/adapters_web/src/seam.rs`).

**Invariants upheld:** I1/I2 (fetch only to configured endpoints; storage is the browser's),
I5 (the JS side stays a dumb transport because this crate answers it in full), I6 (credentials
attach HERE, the last stop before the network), I15 (missing APIs surface as absent capability).

**Routes served / fragments rendered / sections provided:** None — it moves bytes between the
browser and the seam.

**Capabilities required:** The real ones: IndexedDB, fetch, `Date.now`, `crypto.getRandomValues`,
Worker messaging. Each is wrapped once, behind a kernel port.

**Public surface:**
- `WebApp` + `WebApp::boot()` — the composition root (ARCHITECTURE §4's fixed straw-man bug:
  the driving adapter wires the app); async because IndexedDB open and migrations are.
- `WebApp::handle_request(&mut self, &str) -> String` — the seam over postMessage, JSON both ways
  (the channel already speaks it; no second wire format).
- `IdbStore` (+ `open`) — `StorePort` over one DB, two object stores (ADR-005); hand-rolled
  web-sys (spike-idb: wrapper crate = 52-crate tree + pin conflict).
- `FetchModel`, `FetchNet` — brokered model/net; endpoint-name resolution and allowlist
  enforcement live here, where the fetch happens.
- `BrowserClock`, `BrowserRng` — the ONE place wall time and entropy enter; everything downstream
  gets data (I7).
- `WebError` — the residue browser failures that fit no kernel port error.

**Depends on / Depended on by:** `kernel`, `core`, wasm-bindgen (=0.2.121), js-sys, web-sys —
the layering check asserts these three appear in THIS crate's closure only. `ui` drives it by
calling `WebApp::handle` (`crates/adapters_web/src/seam.rs`) directly — there is no JS transport.

**Owns:** browser API translation, the Wasm entry, credential attachment, allowlist enforcement,
persistence requests (`navigator.storage.persist()`).

**Explicitly does not own:** domain types beyond kernel's, any logic that could run on the host,
migration content (core's), caching/updates (`web/sw.js`, ADR-007).

**Failure modes:** quota → typed `StoreError::QuotaExceeded` event, never silent (ADR-005);
missing API (private-mode) → `MissingApi`, capability un-advertised; provider CORS refusal →
`ModelError::Transport` with the message preserved for the log.

**Test contract:** (1) crate compiles under `cargo check --workspace` on the host (rlib);
(2) wasm-bindgen headless: JSON request → `handle_request` → JSON response round-trip;
(3) IdbStore put/get/delete/list_prefix round-trip (spike-idb pattern); (4) FetchNet denies an
unlisted endpoint without touching the network.

**Rejected alternatives:** `indexed_db_futures` and friends (measured cost, spike-idb); core on
the main thread (ARCHITECTURE §1d — a runaway forged module would freeze the abort button).

**Blast radius:** confined by design — this crate can be rewritten (new storage substrate, COI,
SW transport) with zero pure-crate changes; that containment is its reason to exist.

**G4 status:** core runs on the MAIN thread — ARCHITECTURE §1d's explicitly reserved
Spike-A fallback; the Worker move is transport-only and waits for the first runaway
module risk (forge, G5). Implemented: IdbStore (kv+blob object stores, spike-idb
plumbing), FetchModel against the same-origin `/v1` proxy with PROVISIONAL model-id
discovery via `/v1/models` (no settings module yet; the adapter attaches the model
name exactly like it would a credential), BrowserClock/BrowserRng, WebApp
boot/handle_request (+ background `core::drive` after every request). Headless
wasm-bindgen tests deferred; verified live in the browser instead.
