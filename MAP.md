# MAP.md — files → flow → blast radius

The traceability artifact. When a change's blast radius is unclear, this map
is wrong — fix it first. Seam names referenced here are pinned in
`CONTRACTS.md`.

## Boot chain (the one flow everything hangs off)

```
index.html ──registers──▶ askk-sw.js (SW: /__hermes/ rewrite, /__ingress
    │                     queue, /__persist blob store)
    └─loads──▶ boot.js (AskkBoot.start: pty, chunk fetch+gunzip, VM worker)
                  ├──▶ worker.js (runs the c2w wasm, injects guest env)
                  │       └─ timer-worker.js / browser_wasi_shim/*
                  └──▶ stack.js → stack-worker.js + c2w-net-proxy.wasm
                          (AskkNet.attach: SAB channels, sentinel remap)
                                │  guest outbound only
                                ▼
guest: askk-boot (env snapshot → @ASKK:BOOT@) ──▶ /etc/askk/startup.sh
    ├──▶ net probe → @ASKK:NET@ → @ASKK:READY@ (shell live immediately;
    │    a failed LLM probe is a warning, never a gate — ADR-050)
    ├──▶ backgrounded bringup (always runs): python+hermes are BAKED into
    │    the image (ADR-051), so no download — render ~/.hermes/config.yaml
    │    from tmpl (ASKK_MODEL_*) → hermes dashboard :9119 → gateway restart
    │    → wsbridge → @ASKK:HERMES@ (phases timed with @ASKK:T:<phase>=<s>@)
    ├──▶ askk-get <name> (OPTIONAL, dormant for hermes — ADR-049 tools only):
    │    wget bin.askk.internal/<name> → /usr/local/bin;
    │    *.tar.gz stream-extracts to a dest dir
    │    (browser-side remap → same-origin ./bin/<name>, the public shelf)
    └──▶ askk-ingressd: long-poll SW /__ingress/poll → hit :9119 →
         POST /__ingress/resp/<id>
                                ▼
#dashboard iframe src="./__hermes/" (SW answers from the ingress queue)
```

## File table

| File(s) | Role in the flow | Blast radius when changed |
|---|---|---|
| `docs/index.html`, `docs/style.css`, `docs/assets/*` | Page chrome: `#topbar`, `#dashboard` iframe, `#terminal`, `#divider`; registers SW; backend/model settings → `window.__backend` + `localStorage["askk-llm"]`; startup-script editor panel (PUT/DELETE `/__persist/startup.sh`, default from build-copied `docs/startup.default.sh`) | Everything visual; settings feed the net stack live via `getBackend()` |
| `docs/askk-sw.js` | Service worker: serves `/__hermes/` (SPA path rewrite), `/__ingress` poll/resp queue, `/__persist` Cache-API store; shelf cache v2 (ADR-050): ALL `bin/*` assets in the `askk-image` store, sha-gated against `BUNDLES.json` (match → zero network; absent → ETag revalidation; net fail → cache); `?coep=require-corp` COEP-mode knob; injects the WS shim into relayed HTML | Dashboard iframe, guest relay, persist overrides, shelf download cost — page needs two loads after any SW change (update + claim) |
| `docs/boot.js` | `window.AskkBoot.start(...)`: pty, chunk fetch per `manifest.json`, VM worker spawn, marker watch, calls `AskkNet.attach` | Whole boot; topbar progress; consumer of the manifest schema and boot markers |
| `docs/worker.js` | Runs the wasm VM; injects guest env (`ASKK_*`, proxy, certs); console → marker stream | Guest environment; any env name change also touches `rootfs/askk-boot` + CONTRACTS |
| `docs/timer-worker.js`, `docs/browser_wasi_shim/*` | WASI plumbing for the VM worker | Boot only; no seam exposure |
| `docs/stack.js`, `docs/stack-worker.js`, `docs/worker-util.js`, `docs/wasi-util.js`, `docs/vendor/c2w-net-proxy.wasm` | `window.AskkNet.attach`: SAB channels, guest TCP, sentinel-host remap (`llm./persist./ingress.askk.internal`) | All guest networking: LLM calls, persistence, ingress relay |
| `rootfs/askk-boot` | Guest PID-1-adjacent init: snapshot env to `/etc/askk/env`, print `@ASKK:BOOT@`/`@ASKK:NET@`, exec startup.sh | Every boot; marker strings are load-bearing (boot.js watches exact literals) |
| `rootfs/startup.sh` | User-editable launcher: net probe → markers (probe failure = warning only), `askk-ingressd` guard, backgrounded shelf bringup — **unconditional** (ADR-050; not gated on the LLM probe), parallel pulls + `@ASKK:T:` phase markers; persist-overridable | Boot markers + relay availability + agent bringup; `command -v` guards keep partial images booting |
| `rootfs/askk-get`, `docs/bin/*` | Runtime binary injection: shelf fetch via `bin.askk.internal`; tarballs stream-extract (ADR-048); multi-part `.parts` artifacts streamed as one tar + fetch retries (this batch; schema in CONTRACTS.md). Shelf catalog: `docs/bin/README.md` (ADR-049) | Guest tooling; shelf artifacts must be static amd64 (musl), baseline CPU (no AVX2) |
| `image/bundles.sh`, `image/bundles.d/*` | Shelf dispatcher: runs per-artifact recipes `bundles.d/<name>.sh` with the `lib.sh` helpers (`fetch_cached`/`bundle_container`/`emit_artifact`); subset builds via `image/bundles.sh [name…]`; `emit_artifact` enforces the 90 MiB `.parts` split + `SIZES.txt` + `BUNDLES.json` (sha256 manifest, ADR-050; artifacts gitignored, gh-pages only); hermes/python311 recipes carry the bundle diet (pyc/tests strip) | Shelf contents; artifact names consumed by `startup.sh`; `.parts` + `BUNDLES.json` schemas shared with `askk-get`/`askk-sw.js` (CONTRACTS.md); config.yaml.tmpl schema (hermes recipe) |
| `rootfs/askk-ingressd` | busybox sh + curl relay: 4 long-pollers, SW queue ↔ `127.0.0.1:9119`; `/__ws/*` routed to the wsbridge (`:9219`) | Dashboard iframe traffic (not the terminal); schema shared with `askk-sw.js` |
| `docs/askk-ws.js`, `rootfs/askk-wsbridge` | WS-over-relay tunnel (CONTRACTS): SW-injected WebSocket polyfill in the iframe ↔ python/uvicorn bridge holding real WS to `:9119` | Dashboard chat + events/tool feed; without it every dashboard WebSocket dies (SWs can't intercept WS) |
| `rootfs/askk-session` | Terminal session setup on the pty | Terminal pane only |
| `image/Dockerfile` | Minimal Alpine + rootfs staging install (`/tmp/rootfs/` → `install`), zero apk | Image content; guest tool availability |
| `image/build.sh` | docker → c2w (sibling checkout, `GUEST_RAM_MB` default 1024 — canonical, ADR-050; wizer traps at 2048, `WIZER=0` for big RAM) → gzip → 90 MiB chunks + `manifest.json` → `docs/wasm/`; prints an end-of-build memory-budget table; knobs: `WASMOPT=1` wasm-opt pass, `GZIP_LEVEL`; `--skip-c2w` = docker smoke; `--dev` = verbose boot flags | The artifact itself; manifest schema shared with `boot.js` and `publish.sh` |
| `serve.py` | Local dev: COOP/COEP headers + `/v1` LLM proxy on :8901 | Local dev loop only; published page unaffected |
| `publish.sh` | `docs/` + `docs/wasm/` → gh-pages | Deployment only; never touches main |
| `README.md`, `CLAUDE.md`, `MAP.md`, `CONTRACTS.md`, `docs/adr/*`, `docs/BACKLOG.md` | Durable docs | Zero runtime; drift = lying docs, fix in the same change |

## Change X → touch Y

| If you change… | You must also touch… |
|---|---|
| A sentinel host name | `CONTRACTS.md` (renegotiate), `docs/stack-worker.js`, `docs/worker.js` env, `rootfs/askk-boot`, `rootfs/askk-ingressd` — cross-unit, coordinator call |
| Boot marker strings | `rootfs/askk-boot` + `rootfs/startup.sh` (printers), `docs/boot.js` (watcher), `CONTRACTS.md` |
| Guest env var names/defaults | `docs/worker.js` (injector), `rootfs/askk-boot` (snapshot), `CONTRACTS.md` |
| Chunk size or `manifest.json` schema | `image/build.sh` (producer), `docs/boot.js` (consumer), `publish.sh` (deployer), `CONTRACTS.md` |
| Dashboard port `:9119` | `rootfs/startup.sh`, `rootfs/askk-ingressd`, `CONTRACTS.md` |
| Ingress relay schema | `rootfs/askk-ingressd` ↔ `docs/askk-sw.js` (the two ends), `CONTRACTS.md` |
| Default LLM URL/model | `docs/index.html` settings, `docs/worker.js` env defaults, `README.md`, `CONTRACTS.md` |
| The `/__hermes/` virtual prefix | `docs/askk-sw.js`, `docs/index.html` (iframe src), `CONTRACTS.md` |
| A shelf artifact name/layout | `image/bundles.d/<name>.sh` (producer), `rootfs/startup.sh` (consumer), `docs/bin/README.md` (catalog) |
| A shelf artifact's *content* | `image/bundles.d/<name>.sh` only — `BUNDLES.json` regenerates and the SW serves the new hash automatically (clients re-download just that artifact) |
| Anything under `rootfs/` | Rebuild the image (`image/build.sh`) before browser verification — or persist-override in a running guest for a fast check |
