# wasi-runner — source for `assets/wasi_runner_worker.js`

This directory is the bun-built source of the in-browser WASI execution worker.
The committed asset `assets/wasi_runner_worker.js` is a classic-worker IIFE
bundle vendoring [`@bjorn3/browser_wasi_shim@0.4.2`](https://www.npmjs.com/package/@bjorn3/browser_wasi_shim)
(MIT OR Apache-2.0) — pure JS, no COOP/COEP headers required, gh-pages friendly.

The Rust side of the substrate is `src/engine/wasi_exec.rs`
(`WasiShimExecutor`), reached by the agent through the `run_in_sandbox` tool.

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

## Standalone test harness (`test/`)

`test/index.html` drives the committed worker asset end to end with a real
`wasm32-wasip1` guest that exercises argv, env, stdin, a seeded `/workspace`
read, and a copy-out write.

```bash
# 1. (one-time) rustup target add wasm32-wasip1
# 2. build the guest (writes test/guest.wasm; ~90 KiB, committed because it is
#    well under 1 MB — rebuild on demand if it is ever missing or stale)
scripts/wasi-runner/test/build-guest.sh

# 3. serve the REPO ROOT with any plain static server (no special headers)
python3 -m http.server 8202

# 4. open http://localhost:8202/scripts/wasi-runner/test/index.html
#    → expect exit code 0, guest stdout, and the round-tripped out/result.txt
```

If a rebuilt guest ever exceeds 1 MB, do not commit it — the harness reports a
clear "run build-guest.sh first" error when `guest.wasm` is absent, so building
on demand is always a supported path.
