# Spike: WASI tiny-shim (`@bjorn3/browser_wasi_shim`)

> One of a batch of feasibility spikes for **general in-browser code execution**
> in ASKK with **no gateway / server** and **as simple as possible**.
> This unit explores the simplest open-source, no-special-headers path:
> running a real WASM-compiled binary under a minimal WASI Preview-1 shim.
>
> Siblings: [`wasix.md`](./wasix.md) (threaded `@wasmer/sdk`),
> [`container2wasm.md`](./container2wasm.md) (full Linux-in-wasm).
> Cross-cut: [`../EXECUTION_MODEL.md`](../EXECUTION_MODEL.md).
>
> Demo lives in [`experiments/wasi-shim/`](../../experiments/wasi-shim/) and is
> self-contained — it is **not** wired into the app or `register_builtin_tools`.

## Verdict (read this first)

**`@bjorn3/browser_wasi_shim` is the right substrate for the "keep it simple"
path, and it works exactly as advertised** — a ~10 KiB-gzipped pure-JS WASI
Preview-1 implementation that runs a single `wasm32-wasip1` binary in a plain
browser tab, **with no COOP/COEP headers**, backed by an in-memory virtual
filesystem we control from JS.

But it is **not "general enough" for the owner's literal "every binary" goal**,
because of *what counts as a runnable binary*, not because of the shim:

- It runs **one `wasm32-wasip1` module per call**. No subprocesses, no `fork`/
  `exec`, no threads, no real sockets, no `bun`/`node`/a package manager *as such*.
- A program only runs here if **it (or its language toolchain) has a
  `wasm32-wasip1` build** — e.g. Rust, C/C++ via wasi-sdk, Zig, Go (TinyGo), and a
  handful of shipped `.wasm` CLIs. "Run `ls`, then `grep`, then `git`" is **not**
  one binary; you would need each as its own `.wasm` and you would orchestrate the
  pipeline in JS yourself.

So the honest framing for the owner:

| You want | This shim gives you |
| --- | --- |
| "compile + run *this* program safely, headers-free" | **yes, today, ~10 KiB** |
| "a sandboxed dev env with a virtual FS" | **yes** (in-mem or OPFS-backed) |
| "literally every Linux binary / a real shell / pipelines" | **no** — that is the [container2wasm](./container2wasm.md) tier |
| "threads / subprocess-ish parallelism" | **no** — that needs COOP/COEP; see [wasix](./wasix.md) |

Recommendation: adopt this as the **Tier-1.5 "run one compiled WASI binary"
capability** (the cheapest possible execution substrate, and the only one that
survives gh-pages with zero header control). Reach for `wasix`/container2wasm
*only* when a concrete need for threads or a full POSIX userland appears. Most of
"compile or sandboxed env should be good" is satisfied here.

## Substrate summary

- **Package**: `@bjorn3/browser_wasi_shim@0.4.2`, license **MIT OR Apache-2.0**.
- **What it is**: a pure-JavaScript implementation of the WASI **Preview-1**
  (`wasi_snapshot_preview1`) syscall surface. You hand it `args`, `env`, and an
  array of file descriptors (stdin/stdout/stderr + preopened dirs), then call
  `wasi.start(instance)` on a `WebAssembly.Instance` whose imports you wired to
  `wasi.wasiImport`. It implements `fd_*` / `path_*` / `args_*` / `environ_*` /
  `clock_*` / `random_get` etc. against JS-side data structures.
- **No native deps, no build step**: ships as ES modules under `dist/`. We
  vendored those `.js` files directly into `experiments/wasi-shim/vendor/` and
  `import` them — no npm install, no bundler required at runtime.
- **Filesystem**: `PreopenDirectory(name, Map<string, Inode>)` with `File` /
  `Directory` inodes (in-memory), or `SyncOPFSFile` to back files with OPFS. We
  used the in-memory variant for the demo; OPFS backing is the path to a
  persistent sandbox that lines up with ASKK's existing OPFS Tier-1 FS.

## What actually ran (end-to-end)

A tiny Rust program ([`guest/main.rs`](../../experiments/wasi-shim/guest/main.rs))
compiled to `wasm32-wasip1` with stock `rustc` (no extra crates), then executed in
Chrome via the shim. It exercises every capability the spike cares about:

1. **argv** — host passes `["demo.wasm","--greet","askk","tier-1"]`; guest prints all 4.
2. **env** — host sets `ASKK_GREETING=in-browser-wasi`; guest reads it back.
3. **virtual FS read** — host preopens `/sandbox` seeded with `input.txt`; guest
   reads it (`std::fs::read_to_string`).
4. **virtual FS write** — guest writes `/sandbox/output.txt`; **the host reads
   that file back out of the JS-side `Directory` map** after the run — proving a
   full read/write round-trip through the shim's FS.
5. **readdir** — guest lists `/sandbox` and sees both `input.txt` and `output.txt`.
6. **clean exit** — `main` returns 0; `wasi.start` surfaces exit code `0`.

Observed page output (see screenshot
[`docs/spikes/wasi-shim-demo.png`](./wasi-shim-demo.png)):

```
=== ASKK wasi-shim guest ===
argc = 4
  argv[0] = demo.wasm
  argv[1] = --greet
  argv[2] = askk
  argv[3] = tier-1
env ASKK_GREETING = in-browser-wasi
read /sandbox/input.txt (49 bytes):
  > hello from the host-seeded virtual file
  > line two
wrote /sandbox/output.txt (33 bytes)
listing /sandbox:
  - input.txt
  - output.txt
=== guest done (exit 0) ===
```

Host then read `/sandbox/output.txt` back: `written by guest wasm / saw 4 args`.

## Measurements

Measured on the demo page (Chrome, Apple Silicon), served by a plain
`python3 -m http.server` on port 8106 with **no special headers**.

| Metric | Value |
| --- | --- |
| `self.crossOriginIsolated` | **`false`** (running WITHOUT COOP/COEP) |
| Shim payload (8 ESM files) | **42.9 KiB raw / ~10.1 KiB gzipped** |
| Guest binary `demo.wasm` | **88.5 KiB raw / 35.5 KiB gzipped** |
| `.wasm` fetch + `WebAssembly.compile` | ~2.5 ms |
| instantiate + `wasi.start` (run to exit) | ~0.7 ms |
| **total fetch → exit** | **~3.2 ms** |
| Exit code | 0 |
| Toolchain to build guest | `rustc --target wasm32-wasip1 -O`, single file |

Notes:
- The `~3.2 ms total` is a **warm** interactive run (assets already in cache),
  read live from the page's metrics panel. The committed cold-load screenshot
  shows a larger "fetch+compile" number because that capture forced the very first
  uncached fetch of the `.wasm`; that figure is network latency, not engine cost.
- Startup is dominated by network fetch of the `.wasm`, not by the shim. The shim
  has no warm-up cost (it is just JS objects); there is no engine to boot, unlike
  container2wasm (which boots a Linux kernel) or `@wasmer/sdk` (which spins
  workers). Sub-5ms cold-to-exit for a small binary is representative.
- The 88.5 KiB guest is mostly the Rust `std`/`println!` formatting machinery; a
  `no_std` or C binary would be far smaller. Size scales with the program, as
  expected for "compile your binary, ship the `.wasm`".

## The key advantage: no headers, gh-pages-friendly

This is the differentiator versus the threaded options:

- **Threads in wasm require `SharedArrayBuffer`**, which the browser only enables
  when the page is **cross-origin isolated** — i.e. served with
  `Cross-Origin-Opener-Policy: same-origin` **and**
  `Cross-Origin-Embedder-Policy: require-corp`. `@wasmer/sdk` (wasix) and
  container2wasm's threaded modes need this.
- **GitHub Pages does not let you set arbitrary response headers**, so COOP/COEP
  are off the table for ASKK's actual deploy target. The known workarounds
  (`coi-serviceworker`, a hosting move) are exactly the complexity the owner
  asked to avoid.
- **This shim needs none of that.** It is single-threaded, uses only plain
  `ArrayBuffer`, and the demo confirms `crossOriginIsolated === false` while still
  running the binary correctly. **It works on gh-pages as-is.**

The CLAUDE.md async invariant ("Assume no threads; real threads need
`SharedArrayBuffer` + COOP/COEP headers we may not control") points at exactly
this constraint — and this substrate respects it. Long runs still belong in a Web
Worker (the shim runs fine inside a Worker; pass the same fds), but that is for
not blocking the Dioxus render loop, not for in-wasm threading.

## Limitations (be explicit)

1. **Single binary, single thread.** One `wasm32-wasip1` module per `start()`.
   No `fork`/`exec`/`posix_spawn`, no subprocesses, no in-wasm threads.
2. **No real network.** WASI Preview-1 has no usable sockets in this shim; a guest
   cannot open a TCP/HTTP connection. (ASKK already brokers all `fetch` through
   the host with an approval gate — outbound network should stay host-side anyway,
   per invariant 7.)
3. **You can only run things that have a WASI Preview-1 build.** Rust, C/C++
   (wasi-sdk), Zig, TinyGo, and shipped `.wasm` CLIs work. A stock x86/ARM ELF
   does **not** run — there is no syscall emulation for a general Linux ABI here.
   "Run any binary the user has" is *not* what this is.
4. **No shell / no pipeline orchestration for free.** There is no `/bin/sh`. To
   chain tools you load and run each `.wasm` yourself and shuttle bytes between
   their virtual FDs in JS. Doable, but it is *you* building the pipeline.
5. **Preview-1 only.** No WASI Preview-2 / Component Model. Fine for CLI-style
   programs; not for component-based modules.
6. **Resource limits are manual.** No built-in CPU/time/memory cap; a runaway
   guest loops forever. Run in a Worker and terminate it on timeout.

## Is per-binary WASI "general enough" vs container2wasm?

- **container2wasm** gets you a *real* Linux userland (a shell, coreutils, a
  package manager, pipelines, "every binary" in the apt sense) by running an
  emulated CPU + kernel in wasm. That is genuinely "every binary," but it is the
  **opposite of simple**: a large image to download, slow boot, and its
  performant/threaded mode wants COOP/COEP that gh-pages can't provide. See
  [`container2wasm.md`](./container2wasm.md).
- **This WASI shim** gets you "every binary **that has been compiled to
  `wasm32-wasip1`**," one at a time, with a tiny footprint and zero header
  requirements. It is "general" in the sense that *any language that targets WASI
  compiles and runs here* — which, given ASKK already has the Rust→wasm toolchain,
  covers the most likely real use ("write code, compile it, run it sandboxed")
  very cheaply.

For ASKK's stated priorities — **no gateway, as simple as possible, even a
compile-and-run sandbox is good, and a gh-pages deploy** — the WASI shim is the
best fit and should be the default execution substrate. container2wasm remains
the answer only if "an actual Linux shell with arbitrary prebuilt binaries"
becomes a hard requirement, and the team accepts its size/header costs.

## How to reproduce

```bash
# 1. (one-time) ensure the WASI target is installed
rustup target add wasm32-wasip1

# 2. build the guest binary (writes experiments/wasi-shim/demo.wasm)
experiments/wasi-shim/build.sh

# 3. serve with a PLAIN static server, NO special headers — this is the point
python3 -m http.server 8106 --directory experiments/wasi-shim
#   or: npx http-server experiments/wasi-shim -p 8106 -c-1

# 4. open http://localhost:8106/ — it auto-runs and prints stdout on the page
```

The vendored shim (`experiments/wasi-shim/vendor/`) is the unmodified `dist/`
output of `@bjorn3/browser_wasi_shim@0.4.2`, with its MIT/Apache license files.
