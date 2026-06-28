# wasi-runner — source for `assets/wasi_runner_worker.js`

This directory is the bun-built source of the in-browser WASI execution worker.
The committed asset `assets/wasi_runner_worker.js` is a classic-worker IIFE
bundle vendoring [`@bjorn3/browser_wasi_shim@0.4.2`](https://www.npmjs.com/package/@bjorn3/browser_wasi_shim)
(MIT OR Apache-2.0) — pure JS, no COOP/COEP headers required, gh-pages friendly.

The Rust side of the substrate is `src/engine/wasi_exec.rs`
(`WasiShimExecutor`), reached through the workspace shell's `run <file.wasm>`
built-in and reused by the `run_python` runtime.

## Rebuilding the asset

```bash
cd scripts/wasi-runner
bun install
bun run build       # writes ../../assets/wasi_runner_worker.js — commit it
```

`node_modules/` is never committed; `bun.lock` is.

## Worker protocol

Request (`postMessage` an object; `wasm_bytes` should travel as a transferable):

```jsonc
{
  "wasm_bytes": ArrayBuffer,            // the wasm32-wasip1 binary, OR
  "wasm_url": "https://…/tool.wasm",    //   a URL the worker fetches itself
  "argv": ["tool.wasm", "--flag"],      // argv[0] = program name
  "env": { "KEY": "value" },
  "stdin": "piped text",
  "files": [{ "path": "input.txt", "text": "…" }]   // or base64 / bytes
}
```

The worker seeds an in-memory preopened `/workspace` with `files`, runs the
binary to completion, and replies with a JSON string:

```jsonc
{
  "ok": true,                 // exit_code === 0
  "exit_code": 0,             // 127 = could not run, 134 = runtime trap
  "stdout": "…",              // clamped to 60_000 chars
  "stderr": "…",              // clamped to 60_000 chars
  "files_out": [              // files created or changed under /workspace
    { "path": "out/result.txt", "text": "…" }      // or { path, base64 }
  ]
}
```

Copy-in/copy-out is the deliberate v1 design (sync OPFS access handles only
work in dedicated workers; the Rust side owns the canonical store). Timeouts
are enforced by the *host* (`WasiShimExecutor` races the reply against
`timeout_ms` and terminates the worker), not by the worker itself. Everything
the guest prints or writes is untrusted data for the agent.

## Hosted binaries — the `BinaryEnv` descriptor

A WASI binary is compiled *to an environment*: it expects a filesystem layout,
env vars, and sometimes a slow first-fetch of a multi-MB runtime. Rather than
hand-build each one (as the bespoke Python runtime does), the host describes it
declaratively with a `BinaryEnv` (`src/engine/exec_capability.rs`) and the
runner consumes it. Adding a hosted binary is a new descriptor in
`binary_registry()` (`src/engine/wasi_exec.rs`) — DATA, not a new worker code
path. The worker request grows these *additive, all-optional* fields:

```jsonc
{
  // …the base fields above, plus:
  "name": "wc",                              // descriptor name (diagnostics)
  "mounts": [{ "at": "lib/x.zip",            // extra files mounted before the
               "mount_url": "/assets/…" }],  //   run; the `at` top segment is
                                             //   reserved (never copied out,
                                             //   user seed files can't clobber)
  "env": [{ "key": "PYTHONHOME", "value": "/" }],  // pair form (merged with the
                                                   //   legacy object form)
  "ready_protocol": true,                    // post {"phase":"ready"} after the
                                             //   fetch+compile, before running,
                                             //   so a cold download doesn't eat
                                             //   the run timeout
  "cache_key": "askk-runtimes"               // Cache-Storage name → cache-first
                                             //   fetch of wasm_url + mount_urls
}
```

The first shipped hosted binary beyond Python is `wc` (a tiny
`wasm32-wasip1` util built from `scripts/coreutils-wc/`, hosted at
`assets/runtimes/coreutils/wc.wasm`), invoked as `run wc <file>`. It proves the
descriptor path is not Python-specific.

The Python runtime (`src/engine/python_runtime.rs`) is the proof-of-concept
this generalizes — a `python` binary with a stdlib-zip mount, `PYTHONHOME=/`,
the ready protocol, and an `askk-runtimes` cache — and could later be folded
into a descriptor; it stays on its own path for now.

## Standalone test harnesses (`test/`)

Two harnesses drive the **committed** worker asset end to end:

**Headless (CI-friendly, drives both binaries):**

```bash
# 1. (one-time) rustup target add wasm32-wasip1
# 2. build the two guests (committed; tiny):
scripts/wasi-runner/test/build-guest.sh        # writes test/guest.wasm
scripts/coreutils-wc/build.sh                  # writes assets/runtimes/coreutils/wc.wasm
# 3. run the headless harness under Bun (Worker + WebAssembly; no Cache Storage,
#    which the worker tolerates):
bun scripts/wasi-runner/test/run-headless.mjs
#    → guest.wasm: argv/env/stdin/seed/copy-out; wc.wasm: descriptor path counts
```

**Browser (`test/index.html`)** drives `guest.wasm` with argv, env, stdin, a
seeded `/workspace` read, and a copy-out write:

```bash
# serve the REPO ROOT with any plain static server (no special headers)
python3 -m http.server 8202
# open http://localhost:8202/scripts/wasi-runner/test/index.html
#    → expect exit code 0, guest stdout, and the round-tripped out/result.txt
```

If a rebuilt guest ever exceeds 1 MB, do not commit it — the browser harness
reports a clear "run build-guest.sh first" error when `guest.wasm` is absent, so
building on demand is always a supported path.
