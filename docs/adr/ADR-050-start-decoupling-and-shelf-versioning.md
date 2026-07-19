# ADR-050 — Start decoupling, shelf versioning, and the honest memory budget

- **Status:** accepted, 2026-07-19
- **Amends:** ADR-048/049 (shelf mechanism: adds content versioning and
  full client-side caching); ADR-047 (records 1024 MB as the canonical
  guest RAM, not a downgrade from 2048).

## Context

Three real-world reports against the shipped page, one root cause each:

1. **"Hermes fails to start."** `rootfs/startup.sh` gated the entire
   backgrounded bringup on `NET_OK=1` — the boot-time probe of the
   *user's LLM endpoint*. No reachable LLM (the common case for a fresh
   visitor) meant no shelf pull, no dashboard, ever. The app's
   availability was hostage to a backend it only needs at chat time.
2. **Repeat visits re-downloaded shelf assets.** Image chunks were
   already content-versioned (`?g=<gz_total>` URL keys in the
   `askk-image` cache) and `.tar.gz` bundles already revalidated via
   ETag/304 — but `.part-*` pieces, `.parts` indexes, and bare binaries
   bypassed the cache entirely, and even the ETag path costs one
   conditional round trip per asset per boot.
3. **"Why is this tab using 600 MB?"** Nothing documented the memory
   model, so a correct number read as a leak.

Separately, Safari and phones hit a stuck spinner instead of an answer:
no SharedArrayBuffer under the default COEP mode, or simply not enough
memory for a ~1 GB guest.

## Decision

1. **Bringup is decoupled from the LLM probe.** `startup.sh` runs the
   shelf bringup unconditionally; a failed LLM probe prints a warning
   and skips nothing. App availability ≠ LLM availability: the guest,
   the dashboard, and the terminal come up with zero backends
   configured — the LLM is consulted when a prompt is submitted, not at
   boot. `@ASKK:NET@` remains a probe *report*, not a gate.
2. **`docs/bin/BUNDLES.json` is the shelf's content-version manifest.**
   `emit_artifact` (image/bundles.d/lib.sh) writes, per artifact:
   `{"artifacts":{"<basename>":{"bytes":N,"sha256":"<hex64>","parts":["<basename>.part-aa","..."]}}}`
   — sha256 of the logical *joined* artifact; `parts` present only for
   split artifacts. Gitignored, deploys to gh-pages (same rule as the
   artifacts themselves). Schema pinned in `CONTRACTS.md`.
3. **Shelf cache v2: every `bin/*` asset is cached, sha-gated.** The SW
   caches tarballs, `.part-*` pieces, `.parts` indexes, and bare
   binaries in the `askk-image` Cache API store. Serve path: fetch
   `BUNDLES.json` no-store; cached copy's sha matches → serve with
   **zero network** for the asset itself. Manifest or entry absent →
   fall back to the v1 ETag/If-Modified-Since revalidation. Network
   failure → serve the cache. Download happens only when content
   actually changed; a warm repeat visit moves no shelf bytes.
4. **GUEST_RAM_MB=1024 is canonical.** `image/build.sh` defaults to
   1024 (was 2048 — wizer traps there anyway; the shipped image has
   been 1024 all along, live `free -m` shows 993 total). The build
   prints a memory-budget table at the end. The bundle diet
   (pyc/tests/doc strip in the hermes and python311 recipes) targets
   hermes ≤~60 MB compressed / ≤~300 MB extracted and python311
   ≤~40 MB / ≤~120 MB — exact numbers in the integration commit.
5. **Mobile/Safari get honest failures, not a spinner.** After the
   one-shot SW reload, a page without SharedArrayBuffer shows an
   "unsupported browser/device" overlay: Safari is pointed at the
   `?coep=require-corp` query (flips the SW's COEP mode off
   `credentialless`); mobile is told the VM needs ~1 GB and that a
   phone companion is roadmap, not this page. The VM targets
   desktop-class browsers; phone home-screen access is the standalone
   PWA track designed in
   `docs/reviews/boop-agent/07-target-architecture.md` (§5 — a pure-JS
   agent PWA borrowing ASKK patterns, no VM). `__askkMetrics.memory`
   samples page heap so the budget below is observable, not folklore.

## The tab-memory budget (the 600 MB question, answered)

The guest rootfs is tmpfs — every extracted bundle is guest RAM. The
tab's footprint ≈ **guest RAM actually committed** (wasm memory pages
are committed as the guest touches them, up to the 1024 MB cap) **+ a
~122 MB decompressed image buffer during boot** + page/JS overhead. So
~600 MB mid-boot is the system working as designed: touched guest pages
(base OS + python ~150 MB + hermes ~400 MB pre-diet) plus the boot
buffer. The diet in decision 4 lowers the extraction share; the ceiling
stays ≈ guest RAM + overhead.

## Consequences

- A fresh visitor with no LLM configured reaches a live dashboard;
  chat errors at prompt time with a settable backend, which is the
  honest failure.
- Changing a shelf artifact = rebuild its recipe; `BUNDLES.json`
  regenerates, publish ships both, and every client re-downloads
  exactly that artifact — nothing else. No cache-bust ritual.
- `rust.sh`'s fetch-skip path does not yet upsert its `BUNDLES.json`
  entry — deferred, tracked in the backlog.
- Safari support is an escape hatch (`?coep=require-corp`), not a
  tested tier; the overlay says so.
