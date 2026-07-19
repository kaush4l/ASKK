# docs/bin — the public binary shelf (toolchain catalog)

Static x86_64 (musl-friendly) binaries and tarballs the running guest can
pull over the fetch-proxy network. Inside the guest:

```sh
askk-get hello-askk           # binary  -> /usr/local/bin/hello-askk, chmod +x
askk-get python314.tar.gz /opt # tarball -> stream-extracted into /opt
```

`bin.askk.internal/<name>` remaps browser-side to `./bin/<name>` (see
CONTRACTS.md). This is the ADR-047 inversion applied to tooling: the wasm
image stays minimal Alpine; runtimes are injected at runtime (ADR-048) from
a **menu** of precompiled toolchains (ADR-049) that startup scripts compose
per app.

Each artifact is built by its recipe `image/bundles.d/<name>.sh` (run via
`image/bundles.sh [name…]`); byte sizes land in `docs/bin/SIZES.txt` and
sha256 content versions in `docs/bin/BUNDLES.json` (both gitignored build
metadata; schema in CONTRACTS.md). The page's service worker caches
**every** shelf asset (tarballs, `.part-*`, `.parts`, bare binaries)
client-side and re-downloads one only when its `BUNDLES.json` sha256
changes — a warm repeat visit pulls zero shelf bytes (ADR-050). Sizes
below marked `≈` are estimates.

## Catalog

| Artifact | Source + pin | Compressed | Extracted | Guest dest → path | Verify in-guest |
|---|---|---|---|---|---|
| `hello-askk` | committed demo binary | tiny | — | `/usr/local/bin/hello-askk` | `askk-get hello-askk && hello-askk` |
| `curl` | moparisthebest/static-curl v8.11.0 amd64 | see SIZES.txt | — | `/usr/local/bin/curl` | `askk-get curl && curl --version` |
| `python311.tar.gz` | python-build-standalone cpython-3.11.15+20260623 musl `install_only`, dieted (pyc/tests/doc strip — ADR-050) | see SIZES.txt (≈40 MB) | ≈120 MB | `/opt` → `/opt/python` | `askk-get python311.tar.gz /opt && /opt/python/bin/python3 --version` |
| `hermes.tar.gz` | `pip install "hermes-agent[web,pty]"` overlay on python311 + prewarmed dashboard + config tmpl, dieted (ADR-050) | see SIZES.txt (≈60 MB) | ≈300 MB | `/` → `/opt/python/…` + `/root/.hermes` | after python311: `/opt/python/bin/hermes --version` |
| `python314.tar.gz` | python-build-standalone cpython-3.14.6+20260623 musl `install_only_stripped`, repacked root `python314/` (branch `shelf/python314`) | ≈29 MB | ≈110 MB | `/opt` → `/opt/python314` | `askk-get python314.tar.gz /opt && /opt/python314/bin/python3 --version` |
| `rust.tar.gz` | Alpine apk repack (rustc 1.96.0 + cargo + ld.lld + crt objects, triple `x86_64-alpine-linux-musl`) | 162,940,654 B → 2 parts + `.parts` | ≈540 MB | `/opt` → `/opt/rust` | gcc-free compile: `export PATH=/opt/rust/bin:$PATH LD_LIBRARY_PATH=/opt/rust/lib; rustc -C linker=/opt/rust/bin/ld.lld -C target-feature=+crt-static -C link-arg=/opt/rust/lib/rustlib/x86_64-alpine-linux-musl/lib/rcrt1.o hello.rs && ./hello` |
| `bun.tar.gz` | bun 1.3.14 musl **-baseline** build — lands with `shelf/bun` | ≈33 MB | ≈90 MB | `/opt` (layout per `shelf/bun`) | `bun --version` |

Notes:

- **hermes ordering:** `hermes.tar.gz` is an overlay on `/opt/python` —
  extract it AFTER `python311.tar.gz` (startup.sh owns the ordering).
- **rust is multi-part:** over the 90 MiB cap it ships as
  `rust.tar.gz.part-*` + a `rust.tar.gz.parts` index; `askk-get` fetches
  the index and streams the concatenation through one tar. Schema pinned
  in CONTRACTS.md.
- **JVM: consciously absent.** GraalVM CE 25.1 skipped (no musl build;
  gcompat rejected under emulation) — decision + revisit path in ADR-049.

## Rules

- Committed to main: only small demo/test binaries (like `hello-askk`).
- Large runtime tarballs: staged locally and shipped via gh-pages only —
  never committed to main (same rule as `docs/wasm/`).
- Everything must be linux/amd64 and either fully static or
  self-contained — the guest is stock Alpine (musl, no shared-lib zoo).
- **Baseline x86-64 only** — Bochs emulates no AVX2; pick `-baseline`
  builds where a project offers them (bun does).
- Not all tools fit at once: guest rootfs is RAM-backed (1024 MB shipped) —
  see the RAM budget table in ADR-049.
