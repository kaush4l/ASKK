# Spike: substituting Agent Zero's Docker execution with a browser sandbox

A feature-by-feature mapping of [Agent Zero](https://github.com/agent0ai/agent-zero)'s
Docker-based execution model onto an in-browser (WASM) substitute, against ASKK's
actual execution surface. The owner wants to keep what is good about Agent Zero's
*design* — the agent gets a real sandbox, a terminal-like loop, and a persistent
filesystem — and replace its *substrate* (Docker on a real host) with a browser tab.
This note is honest about where that swap is clean and where it cannot be.

Related reading:

- [`../EXECUTION_MODEL.md`](../EXECUTION_MODEL.md) — ASKK's own execution surface
  (the `run_js` browser worker, the `run_command` bridge, and where the line sits).
- [`./wasi-substrate.md`](./wasi-substrate.md) — single-binary WASI options
  (`@bjorn3/browser_wasi_shim`, `@wasmer/sdk`).
- [`./container2wasm-substrate.md`](./container2wasm-substrate.md) — real Alpine in
  the tab via CPU emulation, and its cost.

> These three siblings may not all exist yet; the links are the intended layout.

## What Agent Zero actually gives the agent

Agent Zero runs the *framework itself* inside a Docker container, and that same
container (or a remote one it reaches over SSH) is also the **execution runtime**.
The framework distinguishes a **Framework Runtime** (the backend logic in
`run_ui.py` — LLM calls, orchestration, the web server) from an **Execution
Runtime** (where the agent's code actually runs).
[[deepwiki]](https://deepwiki.com/agent0ai/agent-zero) The standard deployment is a
dual-layer image: an `agent-zero-base` image with OS dependencies and language
runtimes (Python 3.12/3.13, Node, `uv`, Playwright, SearXNG), and an `agent-zero`
run image with the application code. [[search]](https://github.com/agent0ai/agent-zero)

Concretely, the agent is handed:

| Capability | How Agent Zero provides it |
| --- | --- |
| **Run shell command** | The `code_execution_tool` exposes runtime options `terminal`, `python`, `nodejs`, plus `output` and `reset`. [[deepwiki/6.2]](https://deepwiki.com/agent0ai/agent-zero/6.2-code-execution-tool) The `terminal` runtime is a real Linux shell. |
| **Persistent shell sessions** | The tool keeps numbered shell sessions alive so working directory, environment variables, and installed packages survive across tool calls — built for multi-step workflows. Local execution uses a host **PTY**; remote execution uses **SSH**; both converge on one output-polling loop. [[deepwiki/6.2]](https://deepwiki.com/agent0ai/agent-zero/6.2-code-execution-tool) |
| **Install any package** | `pip`, `npm`, and `apt-get` all work inside the `terminal` runtime — arbitrary OS-level packages, not a curated list. [[deepwiki/6.2]](https://deepwiki.com/agent0ai/agent-zero/6.2-code-execution-tool) |
| **Multi-language tooling** | First-class `python` and `nodejs` runtimes; anything else installable is reachable through `terminal`. |
| **Filesystem** | A persistent volume at `/a0/usr/` (volume-mounted in Docker) holds installed libraries, knowledge bases, and task artifacts across container recreations. [[deepwiki]](https://deepwiki.com/agent0ai/agent-zero) |
| **Persistent memory** | A FAISS vector store of fragments/solutions plus markdown knowledge files, persisted on the `./memory` mount. [[deepwiki]](https://deepwiki.com/agent0ai/agent-zero) |
| **Terminal / desktop UI** | "A full Linux system with a desktop" the agent can drive — open a terminal window, manage files visually, run GUI software (e.g. Blender) that has no API. [[search]](https://github.com/agent0ai/agent-zero) |
| **Networking** | Real host networking: outbound HTTP, package registries, an SSH server on port 22, a web UI on port 80, SearXNG for search, an API tunnel. [[search]](https://github.com/agent0ai/agent-zero) |
| **Isolation** | The main process spawns *child* containers for code execution (needs the Docker socket); nested containers keep executed code off the host. [[search]](https://github.com/agent0ai/agent-zero) Isolation is provided by **Docker on a real host kernel**. |
| **Reach back to the host** | The `a0` CLI connector bridges the container to the host's real files and shell, so the same agent (with its memory/projects/skills) can work outside the container. [[search]](https://github.com/agent0ai/agent-zero) |

The load-bearing fact: Agent Zero's sandbox is a **real Linux kernel running native
code at native speed**, fenced by Docker. Every capability above is downstream of
that single substrate choice.

## ASKK's actual execution surface (what we are substituting *into*)

ASKK is a Rust→WASM/Dioxus agent in a browser tab. It already has two execution
backends, sitting at opposite ends of the trade-off:

1. **`run_js` — browser-native, no install, no host.** `src/tools/run_js.rs` calls
   `engine::browser_exec::run_js_in_browser`, which spawns a disposable classic Web
   Worker (`assets/exec_worker.js`). The snippet runs as the body of an async
   function via `new Function(...)`; `console.*` is captured into `stdout`/`stderr`;
   the returned value becomes `result`; a hard `timeout_ms` (100–60000) is enforced
   by *terminating* the worker. This is genuinely in-tab — JS only, no filesystem,
   no network setup. The same trust model backs the shellized MCP workers.

2. **`run_command` — the local bridge escape hatch.** `src/tools/run_command.rs`
   POSTs to the optional dev bridge (`scripts/askk-local-bridge.mjs`,
   `http://127.0.0.1:8874/askk/tools`). With `--allow-exec` the bridge `spawn`s a
   real process (`shell: true`) in a sandboxed **run root**, gated by an
   `ALLOWED_EXEC_BINARIES` allow-list (`bun`, `node`, `npm`, `git`, `ls`, … — the
   first whitespace token must match). It is explicitly "a guardrail, not a sandbox":
   enabling exec runs real processes on the bridge machine. Returns
   `{ exit_code, ok, stdout, stderr }`, with output capped at `MAX_EXEC_OUTPUT_CHARS`.

So ASKK already mirrors Agent Zero's two execution paths in miniature: an in-sandbox
path (`run_js` ≈ the in-container runtime) and a reach-out-to-the-host path
(`run_command` over the bridge ≈ the `a0` CLI connector / SSH-to-host). The
substitution question is whether the *in-sandbox* path can grow from "JS only" toward
"a real shell with arbitrary binaries" without leaving the tab.

## Substitution mapping table

For each Agent Zero capability: the closest in-browser equivalent, and the honest gap.
In-browser substrate options referenced below:

- **WASI single binaries** — run one precompiled `wasm32-wasi` binary
  (`@bjorn3/browser_wasi_shim`, no special headers; or `@wasmer/sdk`, which uses
  threads and therefore needs cross-origin isolation). Fast, light, one binary at a
  time.
- **container2wasm** — a real Alpine userland on an *emulated* CPU (Bochs for x86_64,
  TinyEMU for RISC-V) compiled to WASM. Real Linux, but slow (~16s for a Node
  hello-world on a 4-core/4 GB box) and heavy, and it needs `coi-serviceworker` to
  fake cross-origin isolation for `SharedArrayBuffer`.
  [[c2w/issue-75]](https://github.com/container2wasm/container2wasm/issues/75)
  [[c2w]](https://github.com/container2wasm/container2wasm)
- **`run_js`** — ASKK's existing JS-only in-tab worker.
- **the bridge** — ASKK's existing `run_command` host escape hatch.

| Agent Zero capability | Closest in-browser substitute | Honest gap |
| --- | --- | --- |
| **Run shell command** (`terminal`) | container2wasm: a real Alpine `sh` in the tab, fed commands and polled for output. | ~16s cold start and emulated-CPU speed; large WASM payload; needs `coi-serviceworker`. A real interactive shell, but a slow one. No host kernel — anything depending on host devices/syscalls outside the emulator's support is gone. |
| **Run Python** (`python`) | WASI single binary (a `python.wasm`) or container2wasm's `python3`; `run_js` covers only JS. | WASI Python is fast but a *snapshot* — installing wheels with native extensions in-tab is not solved. container2wasm Python is general but slow. Neither matches a host `pip install scipy && run`. |
| **Run Node** (`nodejs`) | container2wasm Node (slow), or shift Node-shaped work to `run_js` (native V8 speed, but plain JS — no `fs`, no npm, no Node built-ins). | `run_js` is *faster* than Agent Zero for pure compute (native browser JS), but it is not Node: no module system, no filesystem, no native addons. container2wasm Node is real but ~16s/invocation. |
| **Install any package** (`pip`/`npm`/`apt-get`) | container2wasm's Alpine `apk`/`pip`/`npm` *if* the image carries them and has network; otherwise prebake packages into the WASM image at build time. | The browser cannot `apt-get` from arbitrary repos over a normal `fetch` (CORS, no real network stack outside the emulator). Practically: packages are **baked in ahead of time**, not installed on demand. This is the sharpest loss vs. Agent Zero's open `apt-get install anything`. |
| **Multi-language tooling** | One WASI binary per language (Python, Ruby, etc., where a `.wasm` exists) or container2wasm for the long tail. | Generality is bounded by "does a WASM build of this toolchain exist / fit." Agent Zero's "anything `apt` can install" is open-ended; the browser's is a curated set unless you pay the container2wasm tax. |
| **Filesystem** | OPFS-backed VFS exposed to WASI (`@bjorn3/browser_wasi_shim` maps a virtual FS; OPFS persists it). Maps onto ASKK's existing `fs_*` model. | Persists per-origin, survives reloads — a genuinely good match for `/a0/usr/`. Gap: it is a *virtual* FS, not a host mount; no shared volume with a host process, and quota is browser-governed. |
| **Persistent shell session** (env, cwd, installed pkgs survive across calls) | Keep one long-lived container2wasm instance (or a WASI runtime with a persisted OPFS root) alive across tool calls instead of spawning per call. | Doable, but ASKK's current workers are *disposable per call* (terminate-on-timeout). A persistent session means holding kernel/FS state in a long-lived worker — more memory, and the "terminate to enforce timeout" safety trick has to be redesigned. |
| **Persistent memory** (FAISS + knowledge files) | Vectors + knowledge files in OPFS/IndexedDB; embeddings computed via the BYOK LLM or a WASM embedder. | No substrate gap — this is data, not execution. Already aligned with ASKK's client-side, origin-scoped storage model. |
| **Terminal / desktop UI** | A terminal emulator widget (xterm.js-style) wired to a container2wasm or WASI stdin/stdout — ASKK's Workspace page already has a terminal pane over the bridge. | A *text terminal* is fully reproducible in-tab. The **desktop** (driving Blender, GUI apps) is not: there is no X server, no native GUI process. That capability is simply out of scope for a tab. |
| **Networking** | `fetch`-backed HTTP from the agent (ASKK's `web_fetch`/`web_search`, already bridge-routed for CORS); no raw sockets from inside the sandbox. | The browser has no general outbound socket layer. CORS gates cross-origin `fetch`. container2wasm's emulated network is limited. Agent Zero's "real host networking + SSH server" has no faithful in-tab equivalent. |
| **Isolation** | The browser tab/worker origin sandbox itself — the same property CLAUDE.md leans on (no shell, no process spawn, no native FS by default). | This is a *win*, not a gap: the browser sandbox is the safety story, and it is stronger by default than "Docker socket + nested containers" (which can be escaped via the mounted socket). We are trading capability for a tighter blast radius. |
| **Reach back to the host** (`a0` CLI) | ASKK's `run_command` bridge with `--allow-exec`. | Direct analogue. This is the escape hatch when in-tab execution is too slow or too narrow — opt-in, off by default, allow-listed, run-root-scoped. The honest framing: native-speed arbitrary binaries live *here*, outside the tab, exactly as Agent Zero's host-side `a0` connector does. |

## The fundamental trade-off

Docker gives Agent Zero two things at once that are physically hard to combine in a
browser:

1. a **real kernel** (every syscall, every binary, `apt-get` anything, real network,
   SSH), and
2. **native execution speed** (the host CPU runs the code directly).

A browser tab cannot give you both. The tab has no kernel and no native process
model — only WASM, Web Workers, OPFS, and `fetch`. Every in-browser execution
substrate buys back *some* of Docker's capability by spending one of the others:

- **WASI single binaries** keep **native-ish speed** and a small footprint, but give
  up **generality**: one precompiled binary at a time, no `apt-get`, no arbitrary
  toolchain, package set frozen at build time.
- **container2wasm** keeps **multi-language generality** (a real Alpine userland), but
  gives up **speed** (CPU emulation, ~16s Node hello-world) and **lightness** (heavy
  payload, `coi-serviceworker` requirement).
- **`run_js`** keeps **native speed** for one language (V8 in the tab), but gives up
  **generality** entirely (JS only, no FS, no packages, no other runtimes).
- **The bridge** keeps **both speed and generality** — but gives up **the open,
  install-free, in-tab self-hosting property**, because it runs real processes on a
  real host you must set up and trust.

So the honest statement of the trade-off is: **a browser sandbox forces giving up at
least one of {native speed, multi-language generality, open install-free
self-hosting}.** Docker declines to choose because it *is* a real host. The tab must
choose. There is no configuration that recovers all three.

## Recommendation

**Keep from Agent Zero's design (and these are approximable in-tab):**

- **The agent gets a real sandbox it can run code in.** Substitute: container2wasm for
  the "I need a real shell / a real `python3`" cases, WASI single binaries for the hot
  paths where a `.wasm` exists, and `run_js` for pure JS compute. Surface them behind
  one tool the way Agent Zero surfaces `terminal`/`python`/`nodejs` behind one
  `code_execution_tool`, so the agent picks a runtime, not a transport.
- **A terminal-like, session-shaped loop.** Substitute: a long-lived in-tab runtime
  (one container2wasm/WASI instance held across tool calls) with `output`/`reset`
  semantics mirroring Agent Zero's persistent sessions. Note the redesign of the
  current terminate-on-timeout safety trick (see the persistent-session row above).
- **A persistent filesystem the agent owns.** Substitute: OPFS-backed VFS mapped into
  WASI and exposed through ASKK's existing `fs_*` tools and Workspace page — a clean
  analogue to `/a0/usr/`, origin-scoped and surviving reloads.
- **Persistent memory.** No substrate change needed; it is data in OPFS/IndexedDB.

**What realistically cannot be matched in-tab, and where the bridge stays the escape
hatch:**

- **Native-speed arbitrary binaries** and **on-demand `apt-get`/`pip`/`npm` of
  anything.** The in-tab answer is either slow (container2wasm) or pre-baked (WASI
  images frozen at build time). When the task genuinely needs a native toolchain at
  native speed, that is the **`run_command` bridge with `--allow-exec`** — ASKK's
  direct analogue of Agent Zero's host-side `a0` CLI connector. It stays opt-in, off
  by default, allow-listed, and run-root-scoped. We do not pretend the tab matches it;
  we route to it deliberately.
- **A real desktop / GUI automation** (Blender et al.) and **raw networking / an SSH
  server.** These have no faithful in-tab substitute and are out of scope for the
  browser tier. They are not gaps to close; they are the price of the tab's stronger
  default isolation.

The net: ASKK can reproduce Agent Zero's *shape* — sandbox + terminal loop +
persistent FS + memory + a host escape hatch — but the in-tab sandbox is a
**deliberately weaker, safer execution substrate**. The browser's isolation is the
feature; the bridge is the pressure-release valve for the rare case that needs a real
host. Pick the runtime per task; never pretend the tab is a kernel.

## Sources

- [Agent Zero — repository](https://github.com/agent0ai/agent-zero)
- [Agent Zero — DeepWiki (architecture overview)](https://deepwiki.com/agent0ai/agent-zero)
- [Agent Zero — Code Execution Tool (DeepWiki 6.2)](https://deepwiki.com/agent0ai/agent-zero/6.2-code-execution-tool)
- [agent0ai/code-execution-mcp — the tool as an MCP server](https://github.com/agent0ai/code-execution-mcp)
- [container2wasm — repository](https://github.com/container2wasm/container2wasm)
- [container2wasm — performance discussion (issue #75, ~16s Node hello-world)](https://github.com/container2wasm/container2wasm/issues/75)
- ASKK source: `src/tools/run_command.rs`, `src/tools/run_js.rs`,
  `src/engine/browser_exec.rs`, `assets/exec_worker.js`,
  `scripts/askk-local-bridge.mjs`.
