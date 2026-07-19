# CONTRACTS.md — cross-unit seams for the c2w rewrite (ADR-047)

Every rewrite worker reads this before writing code. These names are law; a unit
that needs a different name renegotiates through the coordinator, never
unilaterally. No two units touch the same file.

## Architecture in one line

Latest Alpine (amd64) + hermes-agent compiled to one wasm via container2wasm
(Bochs path, Eliza pattern); the browser page boots it in a worker, shows the
guest's `hermes dashboard` web UI in a viewport iframe through a service-worker
ingress relay, and an xterm.js terminal shares the page in a resizable pane.
Reference implementation: https://github.com/kaush4l/Eliza (raw files at
`https://raw.githubusercontent.com/kaush4l/Eliza/main/<path>`).

## Sentinel hosts (guest-side URLs, remapped browser-side by the net stack)

| Guest URL | Browser-side target |
|---|---|
| `http://llm.askk.internal/v1` | `window.__backend` (user's OpenAI-compatible LLM) |
| `http://persist.askk.internal/__persist/<name>` | SW Cache-API blob store |
| `http://ingress.askk.internal/__ingress/...` | SW ingress queue (dashboard relay) |
| `http://bin.askk.internal/<name>` | same-origin `./bin/<name>` — the public binary shelf (`docs/bin/`); `askk-get` pulls tools from it into the running guest (env override: `ASKK_BIN_URL`) |

Shelf multi-part artifacts (gh-pages caps files at 99MB): an artifact larger
than 94371840 bytes ships as `<name>.part-aa`, `<name>.part-ab`, … plus a
`<name>.parts` index — plain text, one part basename per line, in
concatenation order. `askk-get` fetches `<name>.parts` first (404 → single
file) and streams the concatenated parts through one tar. Producer:
`image/bundles.d/lib.sh emit_artifact`; consumer: `rootfs/askk-get`.
`docs/bin/SIZES.txt` records `<basename> <bytes>` per artifact (build
metadata, gitignored).

Shelf content versioning (ADR-050): `emit_artifact` also writes
`docs/bin/BUNDLES.json`:
`{"artifacts":{"<basename>":{"bytes":N,"sha256":"<hex64>","parts":["<basename>.part-aa","..."]}}}`
— sha256 of the logical joined artifact; `parts` present only for split
artifacts. Gitignored, deploys to gh-pages. Producer:
`image/bundles.d/lib.sh emit_artifact`; consumer: the `askk-sw.js` shelf
cache (all `bin/*` assets in the `askk-image` store — sha match against a
no-store `BUNDLES.json` fetch → served with zero network; manifest/entry
absent → consumer falls back to ETag/If-Modified-Since revalidation;
network failure → serve cache).

## Guest env (injected by worker.js; askk-boot snapshots to `/etc/askk/env`)

`SSL_CERT_FILE`, `https_proxy`, `ASKK_MODEL_URL`, `ASKK_MODEL_NAME`,
`ASKK_PERSIST_URL`, `ASKK_INGRESS_URL`.
Default model name: `gemma-4-12B-it-qat-mxfp8`.

## Boot markers (printed to the console by askk-boot/startup.sh)

`@ASKK:BOOT@` `@ASKK:NET@` `@ASKK:HERMES@` `@ASKK:READY@` `@ASKK:ERR:<msg>@`

The minimal-image profile emits only `BOOT`/`NET`/`READY` — `HERMES` is
optional (it appears once the hermes binary is injected and started); the
page must reach 100% on `READY` alone.

The page watches for these exact strings — no prompt scraping, no auto-typed
credentials, no `/bin/login`. Print them with a split literal in shell
(`printf '@ASKK:''READY@\n'`) so a command echo can never self-match.

Metric markers: `@ASKK:T:<phase>=<seconds>@` — guest-side phase timings
(guest clock, skewed vs real time; browser-side wall-clock lives in
`window.__askkMetrics`). The page does NOT act on these — they flow to the
terminal/console only. Same split-literal printing rule.

## Ingress relay schema (dashboard iframe ↔ guest hermes on 127.0.0.1:9119)

- Guest relay (`askk-ingressd`, busybox sh + curl, 4 concurrent pollers):
  long-poll `GET $ASKK_INGRESS_URL/__ingress/poll` → JSON
  `{id, method, path, headers, body_b64}` or HTTP 204 on timeout →
  execute against `http://127.0.0.1:9119` →
  `POST $ASKK_INGRESS_URL/__ingress/resp/<id>` with
  `{status, headers, body_b64}`.
- SW serves the dashboard at virtual same-origin prefix `/__hermes/`
  (rewrites the SPA's absolute paths into the prefix).
- **WS-over-relay tunnel**: SWs cannot intercept WebSocket upgrades, so the
  SW injects `docs/askk-ws.js` (served to the iframe as `/__askk-ws.js`)
  into every relayed dashboard HTML document; it replaces `window.WebSocket`
  with a shim tunneling frames as plain fetches through this relay:
  `POST /__ws/open {path}` → `{id}`; `GET /__ws/recv/<id>` long-poll →
  `{msgs:[{t:'txt'|'bin',d}|{t:'close',c}]}` or 204; `POST /__ws/send/<id>
  {t,d}`; `POST /__ws/close/<id> {c}`. Guest side: `askk-ingressd` routes
  `/__ws/*` to `askk-wsbridge` on `127.0.0.1:9219` (env override
  `ASKK_WSBRIDGE_URL`), which holds the real WS connections to `:9119`.
  CSP headers are dropped on injected documents. Latency ceiling: one relay
  round trip per recv cycle — seconds, not milliseconds; the terminal pane
  remains the fast path.

## DOM / JS globals

- `#topbar` (progress bar + status text + backend/model settings)
- `#dashboard` — iframe, `src="./__hermes/"`, occupies the viewport
- `#terminal` — xterm host, resizable via `#divider` drag
- `window.__backend` — current LLM base URL; persisted as
  `localStorage["askk-llm"] = {url, model}`; default `http://localhost:8873/v1`
- `window.AskkBoot.start({terminal, getBackend, onStatus(pct, msg), onMarker(name)})`
  — owned by boot.js (unit 2); creates the pty, VM worker, chunk fetch, and
  calls `window.AskkNet.attach(...)` internally.
- `window.AskkNet.attach(vmWorker, getBackend)` — owned by stack.js (unit 3);
  SAB channels + stack worker + sentinel remap. `getBackend()` is read per
  request so settings changes apply live.
- `globalThis.AskkGateCore.decide({sab, reloaded, coi})` → `{action, reason}`
  (`boot` | `reload-wait` | `unsupported`) — owned by boot.js; pure capability
  verdict consumed by index.html's auto-boot block (ADR-050). Node-testable
  like AskkIngressCore/AskkShelfCore/AskkMetricsCore.
- Vendored xterm/xterm-pty UMD bundles expose the same globals the Eliza page
  uses from CDN (`Terminal`, `FitAddon`, `openpty`/`TtyServer`/`TtyClient`).
  Match Eliza's proven version pair (xterm 4.17.0 + xterm-pty 0.9.4).
  `WebglAddon` (xterm-addon-webgl 0.11.4) adds GPU-accelerated terminal
  rendering; `window.__askkTermRenderer` reports `"webgl"` or `"canvas"`
  (diagnostic only — canvas is the silent fallback when a GL context fails).

## manifest.json (docs/wasm/, gitignored — build output)

`{"parts": [...], "sizes": [...], "gz_total": N, "raw_total": N}` — gzip -6,
split at 94371840 bytes (90 MiB), Eliza schema verbatim.

## Rules

- **All URLs in docs/ are relative** (`./x`, not `/x`) — the published site
  lives under `https://kaush4l.github.io/ASKK/`. SW registration included.
- rootfs install in the Dockerfile goes through a staging dir
  (`COPY rootfs/ /tmp/rootfs/` + `RUN install ...`) so a worktree missing a
  sibling unit's file still builds; startup.sh guards optional daemons with
  `command -v`.
- Shell in rootfs/ is busybox-ash-compatible POSIX sh — no bashisms.
- docs/ JS is plain ES2022, no frameworks, no build step (vendored bundles are
  prebuilt artifacts, committed).
- Image chunks are never committed to main; `docs/wasm/` is gitignored and
  deployed to gh-pages by publish.sh only.
- `?coep=require-corp` on the page URL is an SW-owned knob (ADR-050): it
  flips the SW's COEP mode from `credentialless` to `require-corp`
  (Safari escape hatch). Pinned here; consumed by `docs/askk-sw.js` only.

## File ownership matrix

| Unit | Files |
|---|---|
| 1 image | `image/Dockerfile`, `image/build.sh`, `rootfs/askk-boot`, `rootfs/askk-session`, `rootfs/startup.sh`, `rootfs/askk-get` |
| 2 boot | `docs/boot.js`, `docs/worker.js`, `docs/timer-worker.js`, `docs/browser_wasi_shim/*` |
| 3 net | `docs/stack.js`, `docs/stack-worker.js`, `docs/worker-util.js`, `docs/wasi-util.js`, `docs/vendor/c2w-net-proxy.wasm` |
| 4 sw+ingress | `docs/askk-sw.js`, `rootfs/askk-ingressd` |
| 5 chrome | `docs/index.html`, `docs/style.css`, `docs/assets/*`, `docs/vendor/*` (except c2w-net-proxy.wasm) |
| 6 host tooling | `serve.py`, `publish.sh` |
| 7 docs | `README.md`, `CLAUDE.md`, `MAP.md`, `docs/adr/ADR-047-rewrite-c2w-base.md`, `docs/BACKLOG.md` |
| coordinator | `docs/bin/*` (the public binary shelf: small demo binaries committed; large runtime tarballs — python, GraalVM, hermes — staged locally/gh-pages only) |
