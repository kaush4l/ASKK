# ADR-049 — Toolchain shelf: precompiled runtimes as a composable menu

- **Status:** accepted, 2026-07-18
- **Amends:** ADR-048 (the shelf mechanism). Supersedes ADR-047's GraalVM
  claim (see *Skipped: JVM* below).

## Context

ADR-048 made the image minimal and moved runtimes onto the public shelf
(`docs/bin/`), but the shelf held exactly one composition — python311 +
the hermes overlay — built by a monolithic `image/bundles.sh`. Every new
runtime meant editing that one script, and nothing over the gh-pages file
cap could ship at all. Apps beyond hermes (open-swe, pi-agent) will want
different tool sets, and the guest's RAM-backed rootfs cannot hold every
tool at once anyway.

## Decision

1. **Shelf = menu of precompiled toolchains.** `docs/bin/` carries static /
   musl amd64 artifacts: python311 + hermes (today's hermes profile),
   python314, rust, bun. Startup scripts compose tools **per app** — hermes
   today; open-swe and pi-agent later pick their own subsets. Catalog:
   `docs/bin/README.md`.
2. **Per-artifact recipes.** `image/bundles.sh` is a dispatcher; each
   artifact is a script `image/bundles.d/<name>.sh` run with the `lib.sh`
   helpers (`fetch_cached` / `bundle_container` / `emit_artifact`). Subset
   builds: `image/bundles.sh rust bun`.
3. **Artifacts are gitignored, gh-pages only** — the `docs/wasm/` rule
   applied to the shelf. The recipe is the committed, reproducible truth.
4. **Over-cap artifacts split.** Anything >90 MiB ships as `.part-*` files
   plus a `.parts` index per the schema pinned in `CONTRACTS.md`
   (producer `emit_artifact`, consumer `askk-get`). rust is the first user
   (≈90–110 MB compressed — lands with `shelf/rust`).
5. **Baseline-CPU constraint.** Bochs emulates a baseline x86-64 CPU — no
   AVX2. Shelf binaries must be baseline builds; concretely, bun must be
   the `-baseline` binary (musl-baseline 1.3.14 is the pin — lands with
   `shelf/bun`).
6. **Timing is observable.** Guest phases print `@ASKK:T:<phase>=<s>@`
   markers; the page keeps a wall-clock boot timeline in
   `window.__askkMetrics`. Both namespaces are pinned in `CONTRACTS.md`
   (guest clock is skewed vs real time — the two surfaces are complements,
   not duplicates).

## RAM budget (why a menu, not a buffet)

The guest rootfs is tmpfs — extraction eats guest RAM. Shipped guest RAM
is 1024 MB total. Extracted sizes: python311 ≈150 MB, hermes overlay
≈400 MB, python314 ≈110 MB, rust ≈230 MB, bun ≈90 MB. Everything at once
(≈980 MB) leaves nothing to run in — the startup script picks the subset
its app needs.

## Skipped: JVM (user decision, 2026-07-18)

**GraalVM CE 25.1 is skipped.** No musl build of GraalVM CE exists; the
`gcompat` glibc shim was rejected as unreliable under emulation. Revisit
path: **BellSoft Liberica NIK musl** (≈310 MB — needs >1024 MB guest RAM)
as a `bundles.d/` recipe when the RAM budget allows.

Correction on the record: ADR-047 ("image stage written but commented
out") and the pre-batch backlog §5 both claimed the Dockerfile carries a
commented GraalVM stage. **No such stage exists in `image/Dockerfile`** —
this ADR supersedes that claim; the backlog item is rewritten to the skip
decision above.

## Consequences

- Adding a runtime = one `bundles.d/<name>.sh` recipe + a catalog row in
  `docs/bin/README.md`. No image rebuild, no page change.
- Shelf pulls at boot run in parallel with per-phase `@ASKK:T:` timings
  (startup.sh — lands with this batch), so a slow multi-part artifact
  never serializes the whole bringup.
- `docs/bin/SIZES.txt` records `<basename> <bytes>` per artifact
  (gitignored build metadata, written by `emit_artifact`).
- The rust toolchain compiles without gcc in the guest via a shipped
  `ld.lld` + staged crt objects. Verified reality (differs from the
  original assumption): Alpine rust is 1.96.0, host triple
  `x86_64-alpine-linux-musl`, its rustc has no rust-lld and rejects
  `-C link-self-contained`, and static-PIE linking needs `rcrt1.o`.
  Working guest recipe:
  `export PATH=/opt/rust/bin:$PATH LD_LIBRARY_PATH=/opt/rust/lib` then
  `rustc -C linker=/opt/rust/bin/ld.lld -C target-feature=+crt-static -C link-arg=/opt/rust/lib/rustlib/x86_64-alpine-linux-musl/lib/rcrt1.o hello.rs`.
