# wasi-shim spike

Self-contained demo: run a real `wasm32-wasip1` binary in the browser under
[`@bjorn3/browser_wasi_shim`](https://github.com/bjorn3/browser_wasi_shim)
(MIT/Apache, ~10 KiB gzipped, **no COOP/COEP headers needed**).

**Not wired into the ASKK app.** Findings + verdict live in
[`../../docs/spikes/wasi-shim.md`](../../docs/spikes/wasi-shim.md).

## Layout

| Path | What |
| --- | --- |
| `guest/main.rs` | tiny Rust guest: prints argv/env, reads a preopened file, writes one back, lists the dir |
| `build.sh` | compiles `guest/main.rs` → `demo.wasm` with `rustc --target wasm32-wasip1 -O` |
| `demo.wasm` | committed build output (~88 KiB) |
| `index.html` / `demo.js` | host page: builds an in-memory virtual FS, runs the binary, shows stdout + measurements |
| `vendor/` | unmodified `dist/` of `@bjorn3/browser_wasi_shim@0.4.2` + its licenses |

## Run it

```bash
rustup target add wasm32-wasip1   # one-time
./build.sh                         # rebuild demo.wasm (optional; it is committed)

# PLAIN static server, NO special headers — that is the whole point:
python3 -m http.server 8106 --directory .
#   or: npx http-server . -p 8106 -c-1

open http://localhost:8106/        # auto-runs and prints binary stdout on the page
```

`self.crossOriginIsolated` shows `false` on the page, confirming it runs without
cross-origin isolation (i.e. it works on GitHub Pages as-is).
