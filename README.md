# ASKK

A browser-only personal agent OS. The **smallest possible Alpine Linux**
(amd64) is compiled into one wasm binary with
[container2wasm](https://github.com/ktock/container2wasm) (Bochs/WASI path —
the pattern proven in [Eliza](https://github.com/kaush4l/Eliza) and the
sibling `c2w-alpine` bench). The browser is the client: the page boots the
VM in a worker and gives you an xterm.js terminal in a resizable pane.

The hermes agent (python + hermes) is **baked into the image** — it ships
inside the one wasm, so the page needs no runtime download and there is no
build/assemble step (ADR-051). The dashboard iframe lights up once hermes
answers; until then the terminal is the whole show. *Optional* extra tools
(rust, bun, other runtimes) still live on the **public binary shelf**
(`docs/bin/`) and can be pulled into the running guest on demand with
`askk-get <name>` (ADR-048/049) — that path is dormant unless a startup
script uses it.

No server-side compute. The published page runs entirely in your browser.

**Honest expectations:** the VM runs under Bochs *emulation*, not
virtualization. The minimal Alpine boots to a usable shell in seconds
(~3 s measured in the sibling bench), but sustained guest CPU is ~5x slower
than a JIT — see [ADR-047](docs/adr/ADR-047-rewrite-c2w-base.md) for the
trade and the recorded upgrade path (QEMU-wasm `--to-js`).

## Quickstart (clean clone)

Prerequisites:

- **docker** — builds the Alpine+hermes image.
- **container2wasm CLI** (`c2w`) — converts the image to wasm.
- **c2w-alpine sibling checkout** — `image/build.sh` expects
  `~/Downloads/Dev/c2w-alpine/container2wasm`; adjust the path in the script
  if yours lives elsewhere.
- **A local OpenAI-compatible LLM** — default `http://localhost:8873/v1`
  (only needed when you actually chat: boot, shelf bringup, and the
  dashboard all come up without one — an unreachable LLM is a boot
  warning, not a failure; ADR-050).

Build and run:

```sh
git clone https://github.com/kaush4l/ASKK && cd ASKK
image/build.sh        # docker build → c2w (GUEST_RAM_MB default 1024 —
                      # canonical; wizer traps at 2048) → gzip
                      # → 90 MiB chunks + manifest.json → docs/wasm/
                      # --dev adds LINUX_LOGLEVEL=7 INIT_DEBUG=true (verbose
                      # boot for understanding); default build is the small one
python3 serve.py      # COOP/COEP headers + /v1 proxy to your LLM
```

Open <http://localhost:8901>. **Load the page twice** the first time: load
one registers the service worker, load two runs under its control (the SW is
the ingress relay and dashboard origin — nothing works without it). Then
wait out the boot; the topbar tracks progress via the guest's boot markers
until `READY`, when the dashboard iframe goes live.

`docs/wasm/` is gitignored build output — a clean clone has no image until
you run `image/build.sh` (or you visit the published page, which ships its
own chunks).

## Deploy

```sh
publish.sh            # docs/ + docs/wasm/ chunks → gh-pages
```

Publishes to <https://kaush4l.github.io/ASKK/>. Only `gh-pages` carries the
wasm chunks; they are never committed to `main`. Note the published page
talks to your LLM directly from the browser, so the endpoint must allow
CORS — locally, `serve.py`'s `/v1` proxy covers this for you.

## Layout

| Path | What it is |
|---|---|
| `image/` | `Dockerfile` + `build.sh` — minimal Alpine image → wasm chunks |
| `rootfs/` | Files baked into the guest: `askk-boot`, `askk-session`, `startup.sh`, `askk-get`, `askk-ingressd` |
| `docs/bin/` | Public binary shelf — static amd64 tools the guest pulls in with `askk-get` |
| `docs/` | The published page: boot (`boot.js`, `worker.js`), net stack (`stack.js`, `stack-worker.js`), SW (`askk-sw.js`), chrome (`index.html`, `style.css`), vendored bundles, ADRs, backlog |
| `docs/wasm/` | Build output (gitignored; gh-pages only) |
| `serve.py` | Local dev server: COOP/COEP headers + `/v1` LLM proxy |
| `publish.sh` | Deploys `docs/` + chunks to gh-pages |
| `CONTRACTS.md` | The seam registry — every cross-file name that is law |
| `MAP.md` | Files → flow → blast radius |

## Toolchain shelf

The shelf is a **menu** of precompiled musl/static amd64 toolchains —
python 3.11 + hermes, python 3.14, rust, bun — that startup scripts compose
per app. The catalog (per-artifact source, sizes, dest, verify command)
lives in [docs/bin/README.md](docs/bin/README.md); the decision record is
[ADR-049](docs/adr/ADR-049-toolchain-shelf.md).

- Build artifacts with `image/bundles.sh [name…]` — no names builds every
  recipe in `image/bundles.d/`; names build a subset (`image/bundles.sh
  rust bun`).
- Build knobs on `image/build.sh`: `WASMOPT=1` runs a wasm-opt pass on the
  converted image; `GZIP_LEVEL` tunes chunk compression.
- Shelf assets are cached client-side by the service worker and
  re-downloaded only when their sha256 in `docs/bin/BUNDLES.json`
  changes — a warm repeat visit pulls zero shelf bytes (ADR-050).
- Boot timing is observable on two surfaces: the page logs a wall-clock
  timeline via `window.__askkMetrics` (`console.table` at `READY`), and
  the guest prints `@ASKK:T:<phase>=<s>@` phase lines to the terminal
  (guest clock — skewed vs real time; see CONTRACTS.md).

## The startup script

The guest launches `/etc/askk/startup.sh` at boot — it probes the network,
starts the ingress relay, and prints the boot markers. It is **yours to
edit**: change it in-guest
from the terminal pane, or persist an override through the SW blob store
(`http://persist.askk.internal/__persist/startup.sh` from inside the guest)
so your version survives reloads and wins over the baked-in copy. Add
daemons, swap the agent, run your own services — the VM is your machine.

## Why this shape

The full decision record — context, alternatives rejected, accepted
ceilings (Bochs speed, no WebSockets over the polling relay, CORS for the
published page), and deferred items (GraalVM, CodeMirror) — lives in
[ADR-047](docs/adr/ADR-047-rewrite-c2w-base.md).

The pre-rewrite Rust harness lives at tag `pre-rewrite-rust`.
