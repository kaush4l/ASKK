# G0 research: IndexedDB from Rust — ergonomics, cost, quota, eviction

Spike D deliverable (PROMPT §18). Evidence for ADR-005 (`StorePort` backend);
ADR-005 stays Proposed until this is weighed. Probe code: `spikes/idb/`
(`put` / `get` / `list_prefix` over one object store, no trait — §13).

Reproduce: `cd spikes/idb && wasm-pack test --headless --chrome`.
Environment measured: Chrome 150.0.7871.187, headless, M-series macOS,
`wasm-bindgen =0.2.121` / `web-sys 0.3.98`, `wasm-pack 0.15.0`.

Trap hit and fix: wasm-pack's cached chromedriver was 151 vs Chrome 150 →
opaque `Error: http status: 404` after "ChromeDriver was started successfully".
Fix: download the matching-major driver from chrome-for-testing and pass
`--chromedriver <path>`. Timing output needs `-- --test kv -- --nocapture`
(a single `-- --nocapture` breaks wasm-pack's build phase).

## 1. Ergonomics: what the callback→future plumbing costs

- **True.** The whole probe is 177 lines of Rust (`spikes/idb/src/lib.rs`).
  The IDB-specific plumbing is ~70 of them: `await_request` (24 lines,
  IDBRequest → `Promise` → `JsFuture`), `await_txn` (25 lines, same for
  transaction commit), plus a `JsValue` → error extractor. The KV logic
  itself (open/put/get/list) is ~85 lines. One bridge is written once and
  every operation reuses it.
- **True — the ugliest parts, concretely:**
  1. Closure lifetime management. Every event handler is a
     `Closure::once` that must be either `.forget()` (leaks the closure on
     whichever of onsuccess/onerror does not fire — ~2 small allocations
     per op) or kept alive across the `await` (the `onupgradeneeded`
     handler). This is invisible-until-it-bites territory.
  2. Error/abort double-fire: an IDB failure can fire both `onerror` and
     `onabort` on the transaction; a `Closure::once` invoked twice throws,
     so the two handlers need separate closures sharing a cloned `reject`.
  3. Everything is `JsValue` + `unchecked_into` casts; the type system
     stops helping at the FFI line.
- **True.** `indexed_db_futures` v0.6.4 does not earn its dependency for a
  KV shape: measured with `cargo tree --target wasm32-unknown-unknown` on a
  scratch crate, it pulls **52 crates** including `tokio`, `thiserror`,
  `derive_more`, `smallvec`, `sealed`, and six proc-macro crates — and it
  pins `wasm-bindgen 0.2.126`, which **conflicts outright with this repo's
  `=0.2.121` pin** (PROMPT §13: "prefer thirty of your own lines over a
  forty-crate tree"). Our own bridge is ~70 lines.
- **Uncertain.** A cursor-heavy or multi-index usage pattern would multiply
  the hand-rolled surface (cursor iteration is the worst of the callback
  API). If HARNESS ever needs secondary indexes or streaming iteration,
  re-price the crate question then — not before.
- **Constrains ADR-005:** hand-rolled web-sys plumbing is the right call
  for a KV-shaped `StorePort`; budget ~1 file. Do not adopt
  `indexed_db_futures` while the wasm-bindgen pin stands.

## 2. Measured indicative latencies

100 sequential ops, ~230-byte JSON payload, one op per transaction, fresh
store, single run. **Indicative, not a benchmark** — no warmup discipline,
no variance across runs/machines, headless Chrome only.

| op | min | p50 | p90 | max | mean |
|---|---|---|---|---|---|
| `put` (awaiting txn commit) | 0.08 ms | 0.11 ms | 0.21 ms | 0.97 ms | 0.14 ms |
| `get` | 0.04 ms | 0.07 ms | 0.14 ms | 0.75 ms | 0.09 ms |

- **True.** Per-op cost at this scale is sub-millisecond; even the naive
  one-transaction-per-op shape sustains ~7k puts/s sequentially. For
  HARNESS's event-log write rate (per agent step, not per token), IDB
  latency is a non-issue.
- **True.** "Commit" here is Chrome's default `relaxed` durability (the
  default since Chrome 121; Firefox and Safari were already relaxed): the
  `complete` event fires when the write reaches the OS buffer, **not**
  after fsync. Strict durability is roughly an order of magnitude slower
  per Chrome's own numbers. These timings are API latency, not
  crash-durability latency.
- **Uncertain.** Large values (multi-MB blobs), populated stores, spinning
  disks, and mobile Safari were not measured. Batching many puts into one
  transaction would be faster still (unmeasured here).
- **Constrains:** no need for write-batching machinery in v1; if
  crash-durability ever matters (it shouldn't for a replayable event log —
  the log IS the recovery mechanism), that's `durability: "strict"` per
  transaction, not an architecture change.

## 3. Quota model (researched)

- **True (per MDN, current):** quotas are computed from **total disk size,
  not free space** (anti-fingerprinting). Per origin:
  - **Chrome/Chromium:** up to **60% of total disk**, same for best-effort
    and persistent.
  - **Firefox:** best-effort = min(10% of disk, **10 GiB** group limit);
    persistent = up to 50% of disk, capped 8 TiB, exempt from group limit.
  - **Safari (macOS 14+/iOS 17+):** ~**60% of disk** in the browser and for
    Home-Screen web apps; ~**15%** inside WKWebView (non-browser apps);
    cross-origin frames ~1/10 of parent.
  - `navigator.storage.estimate()` reports `{usage, quota}` (padded /
    approximate by design).
- **Uncertain:** exact Safari behavior below macOS 14 and inside
  third-party iOS browsers (all WebKit) — quotas there have historically
  been smaller and shifted between releases.
- **Constrains:** quota is effectively a non-problem on desktop for agent
  transcripts and module state (tens of GiB headroom). The binding
  constraint is not size but **eviction class** (§4). HARNESS should still
  surface `estimate()` in a status view — it is one call.

## 4. Eviction and `persist()` (researched)

- **True:** storage lives in two buckets. **Best-effort** (the default) is
  evicted under storage pressure, **LRU by whole origin** — IndexedDB,
  Cache API, and OPFS for the origin are deleted **together**; there is no
  partial eviction. **Persistent** (granted via
  `navigator.storage.persist()`) is only cleared by explicit user action.
- **True:** `persist()` is browser-decided: Firefox shows a permission
  prompt; Chrome/Edge auto-grant on engagement heuristics (no prompt);
  Safari auto-decides, generally granting for installed/Home-Screen apps.
- **True (the sharp edge):** Safari ITP **proactively deletes all
  script-writable storage — IndexedDB included — after 7 days of browser
  use without user interaction with the site**. Persist/installed-PWA
  status is the practical mitigation.
- **Uncertain:** whether Safari honors `persist()` against the 7-day ITP
  wipe for a *non-installed* site is not clearly documented; treat the
  answer as "no" until measured on a real device.
- **Constrains ADR-005 and I2/I10:** for a hosted browser-only agent whose
  *only* copy of user data is origin storage, eviction is an
  architecture-level risk, not a corner case. HARNESS must (a) call
  `persist()` at first meaningful use and display the grant state, (b)
  treat "denied/best-effort" as a visible degraded mode (I15), and (c) make
  export/backup a first-class module early — Safari users who don't
  install to Home Screen can lose everything by not visiting for a week.
  Note: choosing OPFS over IDB **does not escape any of this** — same
  buckets, same LRU, same whole-origin wipe.

## 5. IndexedDB vs OPFS (vs the old seam)

Prior art read: `git show pre-rewrite-rust:crates/browser/src/opfs.rs`
(331 lines: OPFS-backed `KvStore` + `BlobStore`, keys percent-encoded into
file names) and `pre-rewrite-rust:crates/state/src/store.rs` (the trait
seam: `KvStore` = key→JSON with `list_prefix`, `BlobStore` = path→bytes).

- **True:** plumbing cost is a wash — the OPFS impl needed the same
  JsFuture/cast/error boilerplate (331 lines for two stores ≈ this spike's
  177 for one). Neither backend wins on ergonomics.
- **True — IDB beats OPFS when:** records are small and structured
  (key-ordered store gives `list_prefix` as *one* `getAllKeys` over a key
  range vs OPFS directory iteration + name decoding); multiple records
  need one transaction; access must work on the **main thread** (OPFS
  `createSyncAccessHandle` — the fast path — is worker-only, and the async
  OPFS write path costs handle+stream+close per write); keys need range
  semantics at all. The old OPFS impl had to percent-encode `/` into file
  names just to fake flat keys — IDB keys are just strings.
- **True — OPFS beats IDB when:** values are large opaque blobs (files,
  model weights, wasm chunks); a worker can hold a sync access handle
  (near-native random-access read/write — this is why SQLite-wasm targets
  OPFS); append-heavy byte streams matter. IDB structured-clones or copies
  whole values per op; there is no partial read/update of a value.
- **True:** eviction class and quota are **identical** — both sit under the
  same Storage API bucket and die together (§4). Durability defaults favor
  neither. Choosing between them is about access shape only.
- **Constrains ADR-005:** the old two-trait split was the right instinct
  and the evidence says keep it: **`StorePort` KV (small structured
  records, event log, module state) → IndexedDB; large-blob storage (if
  and when a consumer exists) → OPFS.** Do not build the blob half until
  something needs it (§13).

## Sources

- [MDN — Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- [Chrome for Developers — IndexedDB durability now defaults to relaxed](https://developer.chrome.com/blog/indexeddb-durability-mode-now-defaults-to-relaxed)
- [Chrome Platform Status — relaxed durability default](https://chromestatus.com/feature/5084460341264384)
- [Nolan Lawson — Speeding up IndexedDB reads and writes](https://nolanlawson.com/2021/08/22/speeding-up-indexeddb-reads-and-writes/)
- Measured locally: `spikes/idb` test log; `cargo tree` on `indexed_db_futures` v0.6.4.
