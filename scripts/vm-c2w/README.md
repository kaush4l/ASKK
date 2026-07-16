# vm-c2w — container2wasm 64-bit Alpine VM bundle

Builds `crates/browser/assets/vm/c2w.js` (main-thread engine, `window.AskkC2W`)
and stages the classic-script worker files into `crates/browser/assets/vm/c2w/`.

```sh
bun install && bun run build   # then commit the regenerated assets
```

## The VM image (NOT in git)

`crates/browser/assets/vm/alpine64.wasm` (~105 MB) exceeds GitHub's 100 MB
per-file limit, so it is gitignored. `dx build` fails without it (`asset!`).
Produce it with the sibling build project:

```sh
# see /Users/kaush/Downloads/Dev/c2w-alpine/README.md for prerequisites
cd ../../../c2w-alpine
c2w --dockerfile container2wasm/Dockerfile --assets container2wasm \
    alpine:latest out/alpine-amd64.wasm
cp out/alpine-amd64.wasm ../ASKK/crates/browser/assets/vm/alpine64.wasm
```

The bochsrc in that clone is patched to `cpu: ips=1000000000` +
`clock: sync=none` (upstream's `ips=40000000` + `sync=slowdown` hard-caps
the guest at 40 MIPS — the 100k-loop bench went 29 s → 18.5 s unthrottled).

## Serving constraints

- **SharedArrayBuffer required** (xterm-pty blocks the worker on
  `Atomics.wait`). Dev: `dx serve --cross-origin-policy` (the
  `askk-frontend-coi` launch config). Pages: publish.sh injects
  `coi-serviceworker.min.js` (COEP credentialless) at the site root.
- **GitHub Pages 100 MB cap**: publish.sh splits the hashed wasm into 50 MB
  `<name>.wasmNN.wasm` chunks; the worker falls back to chunked fetch on 404
  and re-concatenates.
