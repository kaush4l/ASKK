# Spike: WASIX in-browser via `@wasmer/sdk`

Status: prototype demonstrated and verified live in-browser (2026-06).
Scope: feasibility check for **general in-browser code execution** for ASKK,
exploring the richer WASI path. Self-contained under
[`experiments/wasix/`](../../experiments/wasix/); **not** wired into the app.

Cross-links:

- Execution-model overview: [`../EXECUTION_MODEL.md`](../EXECUTION_MODEL.md)
- The lighter alternative (single tiny WASI binary, no headers):
  [`./wasi-shim.md`](./wasi-shim.md)
- The header workaround for gh-pages: [`./coi-serviceworker.md`](./coi-serviceworker.md)

---

## 1. Substrate summary — what `@wasmer/sdk` actually is

[`@wasmer/sdk`](https://github.com/wasmerio/wasmer-js) (the open-source
`wasmer-js` project, MIT) is a JavaScript runtime that runs **WASIX** modules in
the browser. WASIX is Wasmer's superset of WASI preview-1 that adds the missing
POSIX-shaped capabilities a "real" Unix program expects:

- **Threads** (pthreads, atomics) — built on `SharedArrayBuffer` + a Web Worker
  thread pool.
- **Subprocesses** — `fork`/`exec`/`posix_spawn`, so a program can spawn other
  programs (this is what lets bash run a pipeline).
- **Pipes, signals, sockets** — including extended networking via a gateway.
- **A registry** — `Wasmer.fromRegistry("namespace/pkg")` pulls a prebuilt,
  versioned tool package (in WEBC format) straight from the Wasmer registry and
  caches it in the browser. No build step on our side.

The headline delta over a hand-built single-binary WASI shim is **process
spawning**: with WASIX you can run `bash` and have it fork `seq`, `head`, `wc`,
… and wire them together with OS pipes — entirely in a tab.

### Architecture, concretely

`init()` boots the SDK's own ~6.3 MiB control-plane `.wasm` and a Web Worker
thread pool. During a single run the SDK spins up **dozens of workers**
(observed in the network log: many `worker.mjs` fetches per run) and shares one
`SharedArrayBuffer` across them so WASIX threads see one address space. This is
why cross-origin isolation is mandatory even for "single-threaded" programs (see
§4).

---

## 2. What ran (verified live in Chrome via the preview MCP)

Served from [`experiments/wasix/server.mjs`](../../experiments/wasix/server.mjs)
on `http://localhost:8107/` with COOP/COEP headers. The page
([`index.html`](../../experiments/wasix/index.html) +
[`app.mjs`](../../experiments/wasix/app.mjs)) self-hosts the SDK from
`vendor/wasmer-sdk/` (no CDN, no bundler) and exposes two buttons.

`crossOriginIsolated === true` and `SharedArrayBuffer` present were confirmed in
the page before anything ran.

### Tool 1 — `sharrattj/coreutils` (direct, multicall package)

Pulled coreutils from the registry and ran several of its binaries by name. Each
is a separate command exposed by one multicall `.wasm`:

```
$ seq 1 8        -> 1 2 3 4 5 6 7 8            (exit 0)
$ base64         -> YXNrawo=    (stdin "askk\n", exit 0)
$ wc -c          -> 11          (stdin "hello world", exit 0)
$ arch           -> unknown                     (exit 0)
```

All exit 0, all correct.

### Tool 2 — `sharrattj/bash` spawning coreutils subprocesses (the headline)

Ran `bash -c <script>` with `uses: ["sharrattj/coreutils"]` so the coreutils
binaries are on `PATH`. The script runs real **multi-process pipelines**:

```
== bash subprocess + pipe demo ==
shell pid: 1  (a real spawned bash process)

-- pipe A: seq 1 100 | head -10 | wc -l  (3 processes, 2 pipes) --
10
-- pipe B: seq 1 5 | nl | head -3  (number lines, take first 3) --
     1	1
     2	2
     3	3
-- pipe C: even numbers in 1..50 = seq 2 2 50 | wc -l --
25
== done ==
```

Every command in each pipeline (`seq`, `head`, `nl`, `wc`) is a **distinct
WASIX process** that bash spawned and connected with OS pipes. That is the
capability a single `WebAssembly.instantiate()` shim cannot provide.

Screenshot of both panels succeeding is in the worker's report (also reproducible
by running the demo — see §7).

---

## 3. Measurements

Sizes are exact (from
[`experiments/wasix/scripts/measure.mjs`](../../experiments/wasix/scripts/measure.mjs)
and from `Content-Length` on the registry CDN). Timings are from a warm local
session (registry reachable, packages freshly cached); first-ever timings on a
cold network will be higher.

### Static SDK payload (what we self-host and ship)

| Asset (browser runtime)        | Size       |
| ------------------------------ | ---------- |
| `wasmer_js_bg.wasm` (SDK core) | 6.29 MiB   |
| `index.mjs` (SDK ESM glue)     | 47.6 KiB   |
| `worker.mjs` (thread-pool)     | 0.7 KiB    |
| **Browser runtime payload**    | **6.34 MiB** |
| Full npm `dist/` on disk       | 14.8 MiB   |

The `dist/` total is larger because it also ships `wasm-inlined.mjs` (8.6 MiB,
base64-inlined variant we do **not** use) and `.d.ts` types. The `@wasmer/sdk`
npm tarball unpacks to ~15.5 MiB.

### Registry tool packages (downloaded on demand, then cached by the SDK)

These are **not** part of the static payload — the SDK fetches them at runtime
from `cdn.wasmer.io` the first time a tool is used:

| Package                | WEBC size on the wire |
| ---------------------- | --------------------- |
| `sharrattj/coreutils`  | ~1.8 MiB              |
| `sharrattj/bash`       | ~4.6 MiB              |
| `python/python`        | **~42.6 MiB**         |

So a bash + coreutils session pulls ~6.4 MiB of tools once; a Python session
pulls ~43 MiB once.

### Startup / run timing (warm, local)

| Phase                                            | Time          |
| ------------------------------------------------ | ------------- |
| `init()` (SDK boot + thread pool), warm cache    | tens of ms\*  |
| coreutils: `fromRegistry` (cached)               | ~0.5 s        |
| coreutils: 4 binaries end-to-end (cold-ish)      | ~13.6 s       |
| bash: `fromRegistry` + pipeline end-to-end       | ~2.4 s\*\*    |

\* The very first page load also pays the 6.3 MiB SDK `.wasm` download +
compile; subsequent `init()`s reuse the browser/SDK cache and are fast.
\*\* Bash was fast in this run because the SDK module was already compiled and
coreutils was already cached from Tool 1; a truly cold bash run pays its ~4.6 MiB
download + compile first.

The dominant cost is **first-use download + compile of large WASM** (the SDK
core and each tool package), not steady-state execution.

---

## 4. The COOP/COEP requirement (confirmed)

`@wasmer/sdk` **requires cross-origin isolation**. Its thread pool shares one
`SharedArrayBuffer` across Web Workers, and browsers only expose
`SharedArrayBuffer` to a document that is *cross-origin isolated*. That demands
two response headers on the document (and workers):

```
Cross-Origin-Opener-Policy:   same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Confirmed empirically: with the spike's server setting these headers,
`self.crossOriginIsolated === true` and the SDK ran. Without them the SDK cannot
function (the demo disables its buttons and shows a red "DISABLED" banner). This
is a **hard dependency**, not a nice-to-have.

The local spike server
([`server.mjs`](../../experiments/wasix/server.mjs)) sets these headers
directly. It also sets `Cross-Origin-Resource-Policy: cross-origin` so
subresources load under `require-corp`.

### gh-pages deployability

GitHub Pages does **not** let us set response headers, so we cannot send
COOP/COEP from the server. The standard workaround is
[`coi-serviceworker`](https://github.com/gzuidhof/coi-serviceworker): a service
worker that reloads the page once and re-serves every response with the
isolation headers injected client-side. See
[`./coi-serviceworker.md`](./coi-serviceworker.md) for that spike. Net: WASIX
**can** ship on gh-pages, but only behind the coi-serviceworker shim, which adds
a one-time reload, a service-worker dependency, and the usual SW caveats
(first-load race, scope, update semantics).

This is the central trade-off vs. the tiny WASI shim, which needs **no headers
at all** and therefore deploys as plain static files with zero extra machinery.

---

## 5. Capability delta — `@wasmer/sdk` (WASIX) vs. the tiny WASI shim

| Capability / property                    | Tiny WASI shim                | `@wasmer/sdk` (WASIX)                         |
| ---------------------------------------- | ----------------------------- | --------------------------------------------- |
| Run a single prebuilt binary             | ✅ yes                        | ✅ yes                                         |
| **Subprocess spawn (`fork`/`exec`)**     | ❌ no                         | ✅ yes (demonstrated: bash → coreutils)       |
| **Pipes between processes**              | ❌ no                         | ✅ yes (demonstrated: `seq \| head \| wc`)    |
| **Threads** (pthreads/atomics)           | ❌ no                         | ✅ yes                                         |
| Signals                                  | ❌ no                         | ✅ yes                                         |
| Extended networking (TCP/UDP)            | ❌ no                         | ⚠️ only via a Wasmer network **gateway**      |
| Pull prebuilt tools from a registry      | ❌ (you ship each `.wasm`)    | ✅ `Wasmer.fromRegistry("ns/pkg")`            |
| **Needs COOP/COEP / SharedArrayBuffer**  | ✅ **no headers needed**      | ❌ **mandatory** (SAB)                         |
| Deploys to gh-pages as plain static      | ✅ yes, trivially             | ⚠️ only via coi-serviceworker                 |
| Static payload to ship                   | tiny (one small `.wasm`)      | ~6.3 MiB SDK core + per-tool downloads        |
| First-use download weight                | one binary                    | 6.3 MiB SDK + 1.8–42.6 MiB per tool           |
| Web Workers spawned                      | 0 (or 1)                      | **dozens** per run                            |
| Implementation effort in ASKK            | low (one `Tool` impl)         | moderate (headers, SW, runtime lifecycle)     |
| Moving parts / maintenance               | minimal                       | substantial (SDK + registry + SW + workers)   |

---

## 6. Caveats found while building this

These are real and would shape any productionization:

- **Python is flaky in-browser.** `python/python` (~42.6 MiB) sometimes exits
  with code 45 and **no stdout/stderr**, and sometimes hangs. The exact same
  invocation from the SDK README (`python -c "print(...)"`) reproduced the
  failure. We replaced the Python tile with coreutils for a reliable demo; the
  capability (running CPython) loads, but is not dependable here as-is.
- **coreutils is a quirky build.** `sharrattj/coreutils` rejects some standard
  flag forms (`tail -n N`, `tail -3`, `sort -r` all error with
  "function/utility not found"); `grep`/`rev`/`which` are absent. We restricted
  the demo to the flag forms it accepts (`head -N`).
- **SIGPIPE → non-zero exit.** A pipeline where `head` closes the pipe early
  makes upstream `seq` see SIGPIPE, and bash reports a non-zero exit (45) even
  though all output is correct. The demo judges success by output, not exit code.
- **The runtime serializes and can wedge.** Two overlapping
  `fromRegistry()`/`run()` calls deadlocked the SDK runtime in testing. The demo
  guards against this with a module-level busy lock.
- **`init({module: URL, ...})` logs a deprecation warning.** Self-hosting via
  explicit URLs works but trips a "deprecated parameters" warning; cosmetic.
- **Stdin blocks.** A coreutils command that reads stdin with no `stdin` option
  and no file arg blocks on EOF forever in the browser. Always pass `stdin`.

---

## 7. Reproduce

```sh
cd experiments/wasix
npm install        # pulls @wasmer/sdk (gitignored)
npm run vendor     # copies SDK assets into vendor/ (gitignored)
npm run serve      # serves on :8107 WITH COOP/COEP headers
# open http://localhost:8107/ and click both buttons
npm run measure    # prints SDK asset sizes
```

`node_modules/` and `vendor/` are gitignored (the SDK `.wasm` blobs are large);
regenerate with the two commands above.

---

## 8. Verdict — does `@wasmer/sdk` hit the owner's "every binary, simple" goal?

The owner wants **general in-browser code execution (every binary), no gateway,
simple.** Against that bar:

- **"Every binary"** — `@wasmer/sdk` is the **strongest** of the three options on
  raw capability. It genuinely runs real Unix tools, spawns subprocesses, pipes
  them, threads, and pulls a whole **registry** of prebuilt tools on demand. The
  tiny WASI shim can only run one self-contained binary at a time;
  container2wasm can boot a whole distro but is far heavier still. For
  "run arbitrary existing CLI tools," WASIX is the most complete answer here.
- **"No gateway"** — mostly satisfied: compute and the filesystem are fully
  local; **only extended networking (TCP/UDP) needs a Wasmer gateway.** If ASKK's
  exec tools don't need raw sockets, no gateway is required. That's a meaningful
  win over assuming a server.
- **"Simple"** — this is where it **loses**. It mandates cross-origin isolation
  (SharedArrayBuffer), which on gh-pages means the coi-serviceworker shim (extra
  reload + SW dependency); it ships a 6.3 MiB control-plane WASM plus large
  per-tool downloads; it spins up dozens of workers; and in practice it carries
  real rough edges (flaky Python, quirky coreutils, SIGPIPE exit codes,
  serialization wedges). It is decidedly **not** "drop one `.wasm` on a static
  host and go."

**Bottom line.** `@wasmer/sdk` hits the **capability** half of the goal better
than the tiny shim or container2wasm — it is the only option that demonstrably
runs multi-process Unix pipelines from a registry in a tab with no server. It
does **not** hit the **simplicity** half: COOP/COEP + coi-serviceworker, a
multi-megabyte runtime, a worker swarm, and a gateway-for-networking caveat are
exactly the kind of "moving parts as maintenance" ASKK tries to avoid.

Recommended framing for [`../EXECUTION_MODEL.md`](../EXECUTION_MODEL.md): treat
WASIX/`@wasmer/sdk` as the **"power tier"** — adopt it when the agent genuinely
needs subprocesses / a shell / registry tools, and accept the
cross-origin-isolation tax (already prototyped via coi-serviceworker). Keep the
**tiny WASI shim as the default** for the common single-binary case, where its
zero-header, zero-worker simplicity is the better fit for the "simple" half of
the owner's goal.
