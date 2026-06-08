# Spike: container2wasm — Alpine Linux in a browser tab

**Batch:** 05 (in-browser code-execution feasibility)
**Substrate:** [container2wasm](https://github.com/container2wasm/container2wasm) (Apache-2.0), WASI-on-browser path
**Demo:** [`experiments/container2wasm/`](../../experiments/container2wasm/)
**Status:** ✅ **Working.** Real `alpine:3.18` (x86_64) boots and runs arbitrary commands inside one browser tab, no server-side execution.
**Related:** [`docs/EXECUTION_MODEL.md`](../EXECUTION_MODEL.md) · [`docs/spikes/coi-serviceworker.md`](./coi-serviceworker.md)

---

## 1. Substrate summary

container2wasm (a.k.a. `c2w`) converts an OCI/Docker image into a WebAssembly
artifact that bundles a **CPU emulator + Linux kernel + the container's root
filesystem**. In the browser it runs the emulated machine inside a Web Worker; the
emulator executes a real Linux kernel, which runs the real container userland. This
is *full-system emulation*, not a syscall shim — so **every binary in the image
runs**, exactly as the ASKK owner wants ("general execution, every binary, not just
Python"), with no gateway and no native host involvement.

Two browser back-ends exist:

| Back-end | Emulator | Arch | Notes |
|---|---|---|---|
| **WASI-on-browser** (used here) | Bochs (x86_64) / TinyEMU (riscv64) compiled to WASI, run via `browser_wasi_shim` | x86_64, riscv64 | What the published demo and this spike use. |
| Emscripten-on-browser | QEMU-Wasm (JIT) | broader | Heavier; not needed for this spike. |

**How it runs (this spike):**

```
index.html ─ loads ─► xterm.js + xterm-pty (terminal/PTY)
                      coi-serviceworker.js (COOP/COEP for SharedArrayBuffer)
spike.js   ─ spawns ─► Web Worker (src/worker.js)
                         └─ fetches the container .wasm chunks
                         └─ browser_wasi_shim provides WASI imports
                         └─ WebAssembly.instantiate → emulated CPU boots Linux
                         └─ container stdout ──► SharedArrayBuffer ──► xterm
```

The TTY bridge between the Worker and the main thread uses a `SharedArrayBuffer`
with `Atomics.wait` (synchronous reads inside the emulator), which is **why
cross-origin isolation is mandatory** (see §4).

---

## 2. What got working

A self-contained demo under `experiments/container2wasm/` that:

- boots `alpine:3.18` (x86_64) in a Web Worker via the container2wasm WASI path,
- runs a real shell command and shows live stdout in an xterm terminal,
- measures bytes / cold-boot / command time and surfaces the COOP/COEP status,
- works **offline** (`net=none`) — no out-of-browser anything.

**Verified command output (x86_64 alpine:3.18):**

```
$ uname -a
Linux localhost 6.1.0 #1 PREEMPT_DYNAMIC Tue Sep 12 04:39:51 UTC 2023 x86_64 Linux

$ echo hello from alpine
hello from alpine

$ ls /
bin  dev  etc  home  lib  media  mnt  opt  proc  root  run  sbin  srv  sys  tmp  usr  var
```

Evidence screenshot: [`experiments/container2wasm/evidence/uname-output.png`](../../experiments/container2wasm/evidence/uname-output.png)
(real `uname -a` line, the metrics panel, and the green cross-origin-isolation pill).

This is a genuine Linux kernel (6.1.0) running x86_64 userland inside the tab — not a
WASI-compiled subset. Installing/running any binary present in the image works.

---

## 3. Measurements

Host: Apple M-series (arm64), Chromium via the preview harness. Served locally by
`server.js` with COOP/COEP headers. `net=none`. Numbers are representative of a warm
HTTP cache after `fetch-assets.sh`; the dominant variable is the one-time image
download.

| Image | Emulator | Bytes to tab | Cold boot → 1st byte | Run 1 cmd | Total (click→done) |
|---|---|---:|---:|---:|---:|
| **x86_64 alpine:3.18** (`amd64-vim-wasi`, 3 chunks) | Bochs | **123.8 MB** | **2.79 s** | 0.13 s | **2.92 s** |
| riscv64 alpine:3.18 (`riscv64-vim-wasi`, 2 chunks) | TinyEMU | **74.4 MB** | **2.45 s** | 0.80 s | **3.25 s** |

Both verified end-to-end: each booted a real Linux 6.1.0 kernel and produced correct
`uname -a` (`x86_64 Linux` / `riscv64 Linux`), `echo`, and `ls /` output.

Notes:
- "Bytes to tab" is the sum of the container `.wasm` chunks (authoritative, measured
  by HEAD). It excludes the small JS glue (~80 KB) and the CDN xterm/bootstrap
  (~250 KB), and excludes `c2w-net-proxy.wasm` (~18 MB) which is **only** needed if
  networking is enabled — this spike runs `net=none`.
- The x86_64 Bochs path booted Alpine to first stdout in **~2.8 s** on this host and
  ran the command in **~0.1 s**. That is fast because Bochs-in-WASI emulating x86_64
  is well-optimized in container2wasm's build.
- The riscv64 TinyEMU image is **40% smaller** (74 MB) and booted in **~2.5 s**;
  command execution was a bit slower (~0.8 s) since it emulates a foreign ISA. It is
  the right pick when transfer size dominates.
- Full published images for reference (not vendored): x86_64 `python:3.11-alpine`
  ≈ 139 MB, x86_64 `debian:sid-slim` ≈ 191 MB. Image size scales with the userland.

**Cost profile:** a large *one-time* download (74–191 MB) per image, then **fast
boot and near-instant command execution**. The image can be cached (HTTP cache /
Cache Storage / OPFS) so the download is paid once per image, not per command.

---

## 4. COOP/COEP / SharedArrayBuffer requirement

**Required — non-negotiable.** container2wasm's TTY/socket bridge uses
`SharedArrayBuffer` + `Atomics.wait`. Browsers only expose `SharedArrayBuffer` when
the page is **cross-origin isolated**, which requires two response headers on the
top-level document:

```
Cross-Origin-Opener-Policy:   same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Confirmed in the spike: with these headers set (`server.js`), `crossOriginIsolated`
is `true`, `SharedArrayBuffer` is present, and boot succeeds. Without them, boot
cannot start (the spike detects this and aborts with an explicit message rather than
hanging).

Consequence for ASKK: **the whole app must run cross-origin isolated.** That is a
global constraint, not a per-feature one — it changes how *all* third-party
subresources load (every cross-origin subresource needs CORP/CORS, or must be
`crossorigin` + COEP-credentialless). This interacts with the BYOK `fetch` calls to
LLM providers and any CDN assets the app uses, and must be designed for, not bolted
on.

---

## 5. gh-pages deployability

GitHub Pages **cannot set response headers**, so it cannot natively make the page
cross-origin isolated. The standard workaround (which the upstream demo uses, and
which this spike vendors) is **`coi-serviceworker.js`**: a service worker that
intercepts navigations and re-serves them with COOP/COEP synthesized client-side.
After the SW installs, the page reloads once and becomes cross-origin isolated.

This works but has sharp edges (one forced reload on first load; the SW must control
the scope; cache interactions). It is its own spike:
see [`docs/spikes/coi-serviceworker.md`](./coi-serviceworker.md). For ASKK's
gh-pages deploy, container2wasm is shippable **only** via that service-worker path.

Additional gh-pages concern specific to this substrate: the container images are
74–191 MB. They are fine to host as static assets but are a heavy first-load and a
real bandwidth/quota consideration on Pages.

---

## 6. Verdict vs. the owner's "simple solution" preference

container2wasm is the **heavy, fully-general end** of the design space, and it
genuinely delivers the owner's stated ideal: a real Linux sandbox in the tab where
*every* binary runs, no gateway, no server.

**Pros**
- True generality: real kernel + real userland; any binary in the image runs.
- No server-side execution; matches ASKK's "runs entirely in the tab" property.
- Strong isolation: it's an emulated machine inside the WASM sandbox inside the tab.
- Prebuilt images exist; no Docker/`c2w` build needed to ship a demo.

**Cons**
- **Big download:** 74–191 MB per image (one-time, cacheable, but real).
- **Cross-origin isolation is mandatory** → app-wide COOP/COEP constraint, and on
  gh-pages it needs `coi-serviceworker` (a moving part with sharp edges).
- **Custom images need a build pipeline:** running an *arbitrary* user image (not
  the prebuilt demos) means `c2w` (Docker-based) converts the image to `.wasm` —
  that build is **not** something the browser can do; it happens ahead of time.
- Heaviest of the batch substrates by far in bytes and conceptual weight.

**Recommendation.** container2wasm is **feasible and the right tool *if* ASKK truly
needs arbitrary-binary, full-Linux execution.** It is the opposite of "simple": it
imposes an app-wide cross-origin-isolation requirement, a multi-MB per-image
download, and an out-of-band image-build step for anything beyond the prebuilt
demos. If the actual need is "run code" in the common 80% sense (Python / a single
language toolchain), a lighter WASI-component or single-runtime substrate (see the
sibling spikes and `docs/EXECUTION_MODEL.md`) will be far simpler to ship and
operate, while container2wasm stays on the table as the "general escape hatch" for
the cases that genuinely require a whole Linux box.

---

## 7. Reproduce

```bash
cd experiments/container2wasm
./fetch-assets.sh amd64-vim-wasi    # x86_64 alpine:3.18 (~124 MB); or riscv64-vim-wasi (~74 MB)
node server.js                      # serves http://localhost:8105/ with COOP/COEP
# open http://localhost:8105/, click "Boot & run command"
```

See [`experiments/container2wasm/README.md`](../../experiments/container2wasm/README.md)
for layout, vendoring/licensing, and why the `.wasm` chunks are not committed.
