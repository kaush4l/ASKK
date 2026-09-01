# Vendored files in this directory

Copied verbatim from container2wasm at commit
`6ed3d98882a2b22eafc1334f574c364a5b2b8c47` (tag v0.8.4), path
`examples/wasi-browser/htdocs/`:

- `browser_wasi_shim/index.js`, `browser_wasi_shim/wasi_defs.js` — bundled
  builds of `bjorn3/browser_wasi_shim`. UMD; they attach `WASI`, `Ciovec`,
  `Iovec` and friends to `self`.
- `wasi-util.js` — the `Subscription` / `Event` / `EventType` classes
  `poll_oneoff` needs to read and write its argument structs.

`index.html` and `probe-worker.js` are written here, not copied. The upstream
`worker.js` they replace pulls in `xterm-pty` for interactive stdin and a
`SharedArrayBuffer` for networking; the probe deliberately uses neither, so
that a measurement taken here is taken under this architecture's real
constraint (no COOP/COEP, no cross-origin isolation).

container2wasm is Apache-2.0. browser_wasi_shim is MIT/Apache-2.0.
