# container2wasm spike — Alpine Linux in a browser tab

ASKK feasibility batch 05. A **self-contained** demo that boots a real OCI container
image (`alpine:3.18`) inside a CPU emulator compiled to WebAssembly
([container2wasm](https://github.com/container2wasm/container2wasm), the
WASI-on-browser path), runs it in a Web Worker, and executes a shell command, all
inside one browser tab with no server-side execution.

Findings + verdict: [`docs/spikes/container2wasm.md`](../../docs/spikes/container2wasm.md).

## What's here

```
experiments/container2wasm/
├── README.md            ← this file
├── fetch-assets.sh      ← downloads the large container .wasm chunks (gitignored)
├── server.js            ← zero-dep static server that sets COOP/COEP headers (port 8105)
├── .gitignore           ← excludes the multi-MB *.wasm blobs
├── UPSTREAM-LICENSE     ← Apache-2.0 license of the vendored glue (container2wasm-demo)
└── htdocs/
    ├── index.html       ← the demo page (our own)
    ├── spike.js         ← our driver: boot + timing + output capture (our own)
    ├── coi-serviceworker.js        ← vendored (MIT) — adds COOP/COEP via a SW for gh-pages
    ├── containers/      ← container .wasm chunks (downloaded, NOT in git)
    └── src/             ← vendored container2wasm WASI-on-browser glue (Apache-2.0)
        ├── worker.js, worker-util.js, wasi-util.js, stack.js, stack-worker.js
        └── browser_wasi_shim/      ← bjorn3/browser_wasi_shim (Apache-2.0/MIT)
```

The small JS glue under `htdocs/src/` is vendored from
[ktock/container2wasm-demo](https://github.com/ktock/container2wasm-demo) (Apache-2.0),
with one change: the hard-coded `/container2wasm-demo` GitHub-Pages subpath in the
worker `importScripts` calls is rewritten to the server root so the demo is
self-contained. `index.html` and `spike.js` are written for this spike.

## Run it

```bash
# 1. Download a prebuilt Alpine container image (no Docker / c2w build needed).
./fetch-assets.sh amd64-vim-wasi      # x86_64 alpine:3.18, ~124 MB  (default)
# or, smaller:
./fetch-assets.sh riscv64-vim-wasi    # riscv64 alpine:3.18, ~74 MB

# 2. Serve with cross-origin-isolation headers (required for SharedArrayBuffer).
node server.js                        # http://localhost:8105/

# 3. Open http://localhost:8105/, pick an image, click "Boot & run command".
```

The page shows live container stdout in an xterm terminal and reports measured
metrics (bytes downloaded, cold-boot time, command time). Output is also mirrored to
`window.__c2wOutput` for automated capture.

## Why the .wasm chunks are not in git

The prebuilt images are 74-191 MB (split into ≤50 MB `.wasm` chunks). That exceeds
the repo's 50 MB blob limit, so `fetch-assets.sh` downloads them on demand and
`.gitignore` excludes them. Sizes are documented in the findings doc.

## Cross-origin isolation requirement

container2wasm uses `SharedArrayBuffer` (for the synchronous TTY/socket bridge via
`Atomics.wait`), which browsers only expose when the page is **cross-origin
isolated**. That needs two response headers on the top-level document:

```
Cross-Origin-Opener-Policy:   same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`server.js` sets them directly. For static hosts that cannot set headers (e.g.
GitHub Pages), `coi-serviceworker.js` installs a service worker that re-fetches and
re-serves the page with these headers — see the coi-serviceworker spike doc.
