# WASM spike: the ASKK kernel as a WebAssembly component

2026-10-26 owner: "kernel-as-component with componentize-js, a small askk:host WIT, run under wasmtime and jco."
Findings and what comes next: `docs/portability.md` §5. `./run.sh` does it all.

- `wit/world.wit` — `askk:spike`: `host` (fs-read, fs-write, complete, log: the kernel's only doors out) and `team.ask`.
- `kernel/entry.js` — the real kernel (`backend/kernel/index.js`): one `Agent` with fs.read/fs.write tools over the
  host import, its model = `host.complete`. Bundled by `bun build --target=browser`, componentized by `build.mjs`
  (componentize-js 0.23 / StarlingMonkey; wasi:http and fetch-event disabled: no network inside).
- `jco/` — the JS host (granted folder `/desk` → `lane/`, refuses the rest) and a scripted model; `jco transpile` turns
  the component into JS + core wasm that Node or a browser runs.
- `host-rs/` — the same host as a Rust component (`wasm32-wasip2`, std::fs = wasi:filesystem), plugged in with `wac`;
  under wasmtime the grant is `--dir lane::/desk` — nothing else exists.
- `probe/` — the first check: an async export (`Agent.ask` is async) resolves before the call returns.
