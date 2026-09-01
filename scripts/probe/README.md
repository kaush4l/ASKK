# scripts/probe

The measurements `CAPABILITIES.md` cites, as code somebody else can run.

This directory exists because of a specific failure. The C1 refutation and the
pty spike were both run in a scratch directory outside this repository, and
`CAPABILITIES.md` cited them anyway. **A measurement nobody can re-run is an
assertion with extra steps**, and a scratch directory is deleted. Everything
here is the working rig from those two experiments, moved in — not rewritten
from memory. Three of the gaps its refuters named are closed here (the page
reload, the cost of a resident guest, and what the surviving filesystem actually
is); the fourth is not, and is named below: nothing in this directory loads the
tree's own application.

```
bun scripts/probe/run.js               # every probe this machine can run
bun scripts/probe/run.js --list        # what each one establishes, and cannot
bun scripts/probe/run.js pty --stages=session,reload
bun scripts/probe/run.js model --engines=chromium --modes=require-corp
```

Each run writes a dated pair into `results/`: a `.md` with every line the
drivers printed, and a `.json` with the structured cells. Those files are what
an evidence cell in `CAPABILITIES.md` points at.

## It cannot reach a build

`bun run build` is `bun scripts/agents.js && rm -rf .next out && next build`.
Nothing in it reads this directory, `next build` copies only `public/` into the
static export, and `run.js` is invoked by hand. The check is one command:

```
bun run build && grep -ri "scripts/probe\|coi-serviceworker\|pty-backend" out/ | head
```

which returns nothing. Repeat it after touching this directory.

`playwright` is deliberately **not** a dependency of this repo. The app does not
use it, a 300 MB browser download does not belong in `bun install`, and a
dependency the build can see is a dependency the build can ship. Install it when
you want to run a probe:

```
bun add -d playwright && bunx playwright install chromium webkit
# and remove it from package.json afterwards, or keep it only locally
```

## Layout

| | |
|---|---|
| `run.js` | the one entry point: starts both servers, drives the browsers, writes the artifact |
| `lib/servers.js` | the header-free static host, and the CORP-less recording SSE endpoint |
| `drivers/isolation.mjs` | probe 1 — cross-origin isolation and its price |
| `drivers/model.mjs` | probe 2 — the app's real model call under COEP |
| `drivers/pty.mjs` | probe 3 — a pty in the guest, and what it costs |
| `page/` | everything the browser loads. Not linted or formatted: it holds vendored upstream code — see `page/PROVENANCE.md` |
| `fixtures/` | `tree-2.2.1-r0.apk`, the package the install stage hands to the guest |
| `results/` | dated run artifacts, committed |

`page/` serves from two roots, `page/` first and then `public/sandbox/`. That is
deliberate: the pty probe loads **the tree's own** `vm-worker.js`,
`wasi-util.js`, `browser_wasi_shim/` and `sandbox.wasm`, so those cannot drift
away from what the app ships. Only `sandbox-pty.js` is a variant, and it is
`vm-worker.js` with exactly one substitution — `patchStdio` replaced by upstream
container2wasm's `wasiHack` driven by upstream xterm-pty's vendored `TtyClient`
(`page/workerTools.js`, byte-for-byte as published). That substitution is the
experiment's declared variable.

## What each probe establishes — and what it cannot

### `isolation`

**Establishes.** That a page served by a host sending no `Cross-Origin-Opener-Policy`,
no `Cross-Origin-Embedder-Policy` and no `Cross-Origin-Resource-Policy` reaches
`crossOriginIsolated === true` by installing a service worker that synthesises
those headers on itself; that `SharedArrayBuffer` then exists; that
`Atomics.wait` with **no timeout** genuinely blocks in a worker and in a nested
worker (`page → worker → worker`, the shape `AgentWorkerPool.js:38` and
`C2wSandbox.js` already produce); and the price — one forced extra navigation on
a first visit, and which cross-origin subresources die under `require-corp`.

**Cannot establish.** Anything about the real deploy. Every pass runs on
`127.0.0.1`, which is a secure-context exemption, against a probe page and not
this tree's Next static export. It says nothing about
`https://kaush4l.github.io/ASKK/`, Safari.app, iOS, Firefox, or a service-worker
update cycle behind GitHub Pages' cache headers. It also does not test
`COOP: same-origin` against a popup or an OAuth flow.

### `model`

**Establishes.** Whether the requests `src/core/inference/` actually issues
arrive under each COEP mode: the preflighted streaming
`POST https://api.anthropic.com/v1/messages` carrying `x-api-key`,
`anthropic-version` and `anthropic-dangerous-direct-browser-access`; an
OpenAI-compatible POST with and without a key; and a long local stream read to
the last byte with every chunk, SSE frame and byte counted. It runs the same
call from a nested worker, and it asks a recording server, **server-side**,
whether the CORS preflight reached the network at all.

**Two controls run on every pass, and a cell without both is void:** a
browser-executed 404 against our own host, printing the isolation headers on the
wire; and an *enforcement* control — a cross-origin no-CORP `<img>` which under a
real `require-corp` must fail. If that image loads, isolation is not being
enforced and every "arrived" in the cell would be an artefact of nothing being
switched on.

**Cannot establish.** Anything about a valid API key. Every key here is
deliberately invalid, so what is measured is whether the request *arrives*, not
whether it is answered. It speaks only for the hosts it calls.

One trap is baked in as a warning: an early version of this probe failed in
*every* cell, including the un-isolated baseline, and looked exactly like a COEP
block. It was a bug in the probe — an argument passed into the wrong parameter
slot aborted the fetch at 0 ms. The baseline cell is what caught it. **A COEP
experiment without a matched no-isolation control would have shipped that as a
finding**, which is why `off` is always in the mode list.

### `pty`

**Establishes.** Whether one guest boot survives many commands with genuinely
blocking stdin; whether the guest filesystem carries state *between* those
commands; what a resident guest costs in host RSS at the prompt, after commands,
and after idling; what the store that survives actually is and how big; where
the input-line boundary sits, to the byte; and whether any of it survives
`page.reload()`.

It also asks whether a running page can add a binary to its own guest — a
30 KB `.apk` handed over the tty and installed with `apk add --allow-untrusted` —
and how much slower the guest is than the identical busybox running natively,
with `docker run --rm alpine:3.21` as the control in the same artifact.

The memory, the overlay and the reload are the gaps this rig's refuters named and
the original spike did not measure: `drive.mjs` had no `page.reload()` anywhere,
its RSS sampler ran only in the one-shot stage so no pty session was ever
weighed, and nobody had characterised the overlay the surviving file lives in.
All three are stages here.

Stages: `oneshot`, `session`, `bench`, `speed`, `install`, `reload`. Select with
`--stages=`.

**Cannot establish.** Anything about `src/backend/sandbox/C2wSandbox.js`,
`Kernel.js`, or the built app in `out/`. This is a standalone page that
reimplements the host half of the worker protocol; the tree's own sandbox class
is never loaded, and no run of this probe has ever set `SANDBOX_IMAGE`, rebuilt,
and watched `C2wSandbox.available` become `true`. It also cannot speak for a
phone: every pass is headless desktop Chromium (`deviceMemory: 8`,
`hardwareConcurrency: 16`) pulling ~107 MB over loopback, so no mobile RAM
ceiling, cellular transfer, tab discard or OOM behaviour is tested.

## Prerequisites, and what happens without them

- **`playwright` + browsers.** Without them `run.js` exits 2 and prints the
  install line. Nothing is written.
- **`public/sandbox/sandbox.wasm`** (~107 MB, built by `scripts/wasm/build.sh`,
  never committed). Without it the `pty` probe prints `SKIPPED` into the
  artifact and measures nothing — it does not quietly pass.
- **A local OpenAI-compatible endpoint** for the `model` probe's long-stream
  rows, `http://127.0.0.1:8873` by default, overridable with `--local=<url>`.
  Without one those rows record the failure rather than being omitted.
- **Docker**, for the `speed` stage's native control. Without it that stage
  records `NATIVE CONTROL UNAVAILABLE` and prints the guest's times alone, which
  is a number with nothing to divide by. Note the control runs on the host's own
  architecture: on Apple silicon that is `aarch64` against an `x86_64` guest, and
  the artifact prints both so the mismatch is on the record.
- **Ports.** 8811 and 8814 by default; `--port` and `--echo-port` move them.

## Reading a result

Two things to check before believing any cell:

1. The `404 CONTROL` line says `coep=(absent) coop=(absent) corp=(absent)` and
   `server=askk-probe/1`. If it does not, the page was talking to something
   other than this process, or a host was adding headers, and the pass proves
   nothing about a header-free host.
2. In a `require-corp` cell, `ENFORCEMENT CONTROL … {"loaded":false}`. If the
   no-CORP image loaded, COEP was not being enforced.

And one result in `results/` is a **failure**, kept on purpose.
`2026-09-01T07-28-08-pty.md` shows the install stage producing
`base64: truncated input`, a wrong md5 and `ERROR: tree-2.2.1-r0: BAD archive`.
The cause was the probe's own: it sent the package as one unbroken 40,424-byte
base64 line, and the stage two sections above it had just measured a line of
2,048 bytes vanishing silently. Wrapped at 76 columns it installs
(`2026-09-01-pty.md`). A rig that only keeps its successes cannot show you
that.
