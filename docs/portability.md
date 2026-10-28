# Portability: how ASKK builds, where its tools come from, what it takes to run elsewhere

2026-10-26 owner: "how the compilation runs, where the tools are supplied, and for the goal of making the application
portable or other environments friendly, what is required? … compile the application requirements into a container
where we can make this application for iOS or a way to actually easily port."

## 1. How it builds and runs today

| Mode | Command | What runs |
|---|---|---|
| Dev (the live server, launchd `askk.desks`, :1111) | `bun run dev` → `scripts/dev.js` | `Bun.serve` owns the port: `/__askk/*` → the desks' host API in-process; everything else proxied to `next({dev: true})` (Turbopack, HMR relayed over the same port). |
| Built | `bun run build:companion` | `next build` (`output: "export"` → static `out/`), then `scripts/build-companion.js` embeds `out/**` as file imports and runs `bun build --compile` on `companion/server/server.js` + `team-worker.js` → one executable `dist/askk` (UI inside). Accepts `--target` (e.g. `bun-linux-x64`, `bun-linux-arm64`), never used yet. |
| Hosted (GitHub Pages) | `.github/workflows/pages.yml` | The static UI alone; with no server the tab runs one kernel agent itself (`backend/browser/`) over an OpenAI-compatible endpoint, storage in localStorage. |

Compiled vs interpreted: the UI and the companion core are compiled; **desks are not** — `custom/<desk>/main.js`,
`tools/*.js` and the agents' `.md` files are dynamic-imported/read from disk at start and on `desks/load`. That is what
lets the dev desk change ASKK and reload it live, and it means any package must carry the desk folders (or mount them).

## 2. Where tools are supplied

One TOOLS list per agent, assembled at compose time (`companion/team/compose.js`):

1. **Kernel kit** (`backend/kernel/builtin/index.js`) — plain JS, no OS dependency; every machine access goes through
   `ctx.host` (HTTP to the host API). Tools `web.*`, `agent.*`, `desk.*`; artifacts files, terminal, preview, plan,
   dispatch, browse, talk, goal, dev, studio, audio, surgeon, workflow, practice.
2. **Desk tools** — `defineTool` in `<desk>/tools/<name>.js` and `<desk>/<agent>/tools.js` (the desk wins a clash).
3. **MCP** — `.mcp.json` + a desk's `mcp.json` (stdio via `Bun.spawn`, or Streamable HTTP), through host `mcp/call`.
4. **Integrations** — `integrations/<name>/` (Telegram), exposed like MCP tools.
5. **Host API** (`companion/server/host-api.js`) — the only place that touches the machine:

| Capability | Needs | Portable? |
|---|---|---|
| fs, web, mcp (HTTP), team, models registry | node:fs, fetch | yes |
| term (terminal, dev checks, bound visuals) | `Bun.Terminal` PTY + **`/usr/bin/sandbox-exec`** | macOS only, **no fallback, not self-detected** |
| browser (preview pages, screenshots) | `Bun.WebView` (WKWebView / Chrome) + `Bun.Image` | macOS, or Linux with Chrome |
| projects restart / rollback | git; restart needs launchd | restart self-detects (`XPC_SERVICE_NAME`) |
| speech, audio | `say`, swiftc, SpeechAnalyzer (macOS 26), `afconvert` | macOS; mlx-audio models Apple Silicon |
| images | mflux (MLX) | Apple Silicon |
| apple, sanitize, models.local apple | osascript, Shortcuts, Apple Foundation Models | macOS |
| models.local CLIs, models.research | claude / codex / gemini CLIs on PATH | anywhere they install |

Hardware features already detect themselves and drop out; the terminal does not.

## 3. What blocks a container / another OS

1. **Terminal sandbox** — was hard-coded to `sandbox-exec`; now `sandboxRunner` (section 6, step 1). Still open: a sandbox
   adapter (macOS sandbox-exec | Linux bubblewrap or landlock | none inside a container — the container is the sandbox)
   and `term` advertised only when one works.
2. **Supervisor** — self-restart is launchd only (`capabilities/restart.js`). Needed: a supervisor adapter (launchd |
   systemd | the container's restart policy + the health check `scripts/restart.js` already runs before rollback).
3. **Model access** — the default model is the Claude CLI (needs a logged-in CLI). A container wants the Anthropic API
   or an OpenAI-compatible endpoint from env (`backend/kernel/model/llm.js` already speaks both wires).
4. **Paths** — `/opt/homebrew`, `~/.sdkman` in `toolchains.js`; `memory/`, `models/`, `custom/` at the repo root
   (already movable: `ASKK_MEMORY`, `ASKK_MODELS`).
5. **Desk folders at runtime** — mount `custom/` (and `memory/`) as volumes.

A Linux container is close: `bun build --compile --target=bun-linux-x64` already exists for the server; with (1)–(3)
done it is one image — `dist/askk` + volumes `custom/`, `memory/`, `models/` + env for the model — with fs, web, MCP,
team, dev checks and a Chrome-backed preview working, and the macOS-only features (speech, Apple model, mflux,
Shortcuts) absent, as they already detect.

## 4. iOS

iOS forbids what the desk server is: spawning processes (terminal, MCP stdio, CLIs), JIT for Bun, long background
servers. So on iOS ASKK is not "the server in a container" — it is the **client and a light agent**:

- **Now**: the static UI is already phone-first. A web manifest + service worker → an installable PWA that talks to the
  Mac's desk server (over Tailscale or a tunnel); voice in Safari already works (Apple dictation).
- **Native shell** (Capacitor, or a small SwiftUI `WKWebView` app) around the same static export: adds on-device speech
  (SpeechAnalyzer), Apple Foundation Models for sanitize and short answers, push notifications for `talk.ask`,
  Shortcuts. The kernel runs in the WebView exactly as the hosted mode does today (`backend/browser/`), with an iOS host
  answering `fs/*` from app storage and `speech/*`, `llm/apple` through a native bridge instead of 501.
- The heavy desk (terminal, checks, browser, mflux) stays on the Mac; the phone steers it.

The pattern that makes this cheap is already in the kernel: **one kernel, many hosts**. `ctx.host` is an HTTP-shaped
interface with two implementations today (companion server, browser tab). Porting = a third host (Linux container,
iOS bridge) that answers the routes it can and 501s the rest, with `HOST_CAPABILITIES` telling the UI what is missing.

## 5. A WebAssembly sandbox

2026-10-26 owner: "compile the code such that it can run in a wasm sandbox. If I want to upgrade hardware or changes,
I want to understand the portability efforts."

### What compiles to WASM, layer by layer

| Layer | Bun/OS ties today | WASM path | Effort |
|---|---|---|---|
| Kernel (`backend/kernel/`) | none — one guarded `globalThis.Bun?.YAML` (workflow.js). `bun build backend/kernel/index.js --target=browser` → 0.42 MB ESM (140 KB gzip), no `node:` import, no `process`, no `require`; uses only fetch, AbortController, setTimeout, URL, structuredClone, queueMicrotask | JS → WASM component with a JS engine inside: **ComponentizeJS / StarlingMonkey** (SpiderMonkey on WASI 0.2, Bytecode Alliance; WinterCG globals built in) or Javy (QuickJS). Every machine access is already one interface, `ctx.host` → a WIT world `askk:host` | small: a bundle, a WIT file, a host adapter |
| Desk code (`custom/<desk>/`: roles, workflows, `tools/*.js`) | desks import `companion/team/compose.js` at start; tools reach the machine only through `ctx.host` | compose at **build** time (`composeDesk` → a plain spec), bundle the desk's tools into the same component; the `.md` files ride as data | medium: the live `desks/load` becomes "rebuild the component" |
| Host (`companion/`) | 231 `Bun.*` uses in 31 files: serve, spawn, file, Terminal, WebView, Image | stays **native** — it is the embedder that grants (or refuses) each `askk:host` import. Alternative: port Bun.* to Node APIs and run it under Wasmer **Edge.js `--safe`** (Node 24 API, syscalls through WASIX; ~30% slower sandboxed, vendor numbers) | the embedder: medium; a Node port: large |
| Terminal programs (git, bun test, python) | sandbox-exec, now with a container fallback (`sandboxRunner`) | WASIX builds of bash/python/git (Wasmer registry), container2wasm (emulated, slow), BrowserPod (bash + git in WASM) — or keep them in the OS sandbox / container | per program |
| UI (`app/`, `components/`) | static export already | already portable: any browser, WKWebView, Capacitor | none |
| Models (mlx, Apple FM, GPU) | native | never inside the sandbox — the host serves `llm/*`, the component calls it (wasi:http or an `askk:host/llm` import) | none |

### The shape: kernel-as-component

```
             askk-kernel.wasm  (WASI 0.2 component: StarlingMonkey + kernel + composed desk)
   exports   askk:desk/team   — ask, send, guide, stop, chat, twin, stream events
   imports   askk:host/fs, /web, /term, /browser, /mcp, /llm, /speech …   (one per HOST_CAPABILITIES entry)
             wasi:http (the model's wire), wasi:clocks, wasi:random       — nothing else: no files, no processes
                 ▲ granted per desk by the embedder
   ┌─────────────┼───────────────────────┬────────────────────────────┐
   wasmtime (Mac / Linux / ARM / x86)    jco in a browser tab          an iOS app (WKWebView + jco)
   + companion's routes as imports       + backend/browser/host.js     + a Swift bridge for speech, Apple FM
```

What the sandbox buys: an agent, a desk tool or a prompt-injected run can touch exactly the imports its desk was given —
the lanes, the never-written files, the port blocks become *capabilities that are absent*, not profile rules that must
be right. The same `.wasm` runs on any CPU (upgrade the Mac, move to a Linux GPU box, run on a phone): only the host and
the model change.

### What it costs / what to watch

- StarlingMonkey's specialised (fast-start) build supports HTTP-server components only; a general component evaluates the
  JS at start (slower cold start). componentize-js is being rewritten in Rust (wasmCloud, March 2026) — pin a version.
- WASI 0.3 (released June 2026) puts async in the component model; wasmtime ≥ 44 serves it. The kernel's long runs,
  streams and AbortSignals map onto 0.3's async better than 0.2's pollables.
- `desks/load` hot reload and the dev desk changing ASKK live become "edit → rebuild component → swap": the embedder
  keeps the old component until the new one loads (as desks/load keeps the previous version today).
- The terminal is the hard part: arbitrary programs do not run in WASM without WASIX builds or emulation. Keep them in
  the OS sandbox/container and expose them as the `askk:host/term` import.
- iOS forbids JIT: the component runs interpreted (jco's JS output in WKWebView, or an interpreter build of the engine).

### The spike — done 2026-10-26 (`spikes/wasm-kernel/`, `./run.sh`)

The real kernel (`backend/kernel/index.js`, unmodified API) as a WASI 0.2 component: one `Agent` with fs.read/fs.write
tools, its model a host import. WIT `askk:spike` (`wit/world.wit`): `host` {fs-read, fs-write, complete, log} imported,
`team.ask` exported. A scripted model drives three steps: write a note in the granted folder, try `/etc/…` and read the
note back (two calls in one step), answer.

| | jco (Node; same JS for a browser tab) | wasmtime 48 |
|---|---|---|
| Host | `jco/host.js`: JS, grants `/desk` → `lane/`, refuses the rest (a policy, like `backend/browser/host.js`) | `host-rs/`: Rust component (std::fs = wasi:filesystem) plugged in with `wac`; grant = `--dir lane::/desk` (a capability: nothing else exists) |
| Result | 3 steps, note written and read, `/etc` refused, answer — 28 ms | same; `/etc` → ENOENT, `/desk/../../x` → EPERM — 0.70 s cold (Cranelift compiles 18.6 MB), **0.07 s** precompiled (`wasmtime compile`) |

Numbers: kernel bundle 0.54 MB JS → component 18.6 MB (StarlingMonkey ≈ 18 MB of it), componentize 2.2 s; Rust host
component built in seconds. Built with wasi:http and fetch-event **disabled** — the kernel has no network; the model is
reachable only through `host.complete`.

What the spike found:
- An async export works: `Agent.ask` (promises all the way down) resolves before `team.ask` returns — StarlingMonkey
  drains the job queue. Long runs, stops and streaming events need WASI 0.3 async (streams/futures) next.
- One kernel line did not parse: `/[\p{L}\p{N}']+/u` (StarlingMonkey's SpiderMonkey has no Unicode property escapes).
  Fixed in `backend/kernel/builtin/audio.js` (built at run time, Latin + non-ASCII fallback); the rest of the kernel
  parsed and ran unchanged.
- Toolchain snag: `@bytecodealliance/preview2-shim` 0.30 grants no preopens by default, so componentize-js's CLI cannot
  read its own inputs; `build.mjs` calls `_setPreopens({"/": "/"})` first.
- StarlingMonkey itself imports wasi:filesystem, so in wasmtime the kernel and the host share the `--dir` grant. The
  next step gives the kernel none (only `askk:host`) — either deny it at plug time or a WASI virtualization layer
  (WASI-Virt) on the kernel side.

Next: the real model over `host.complete` (the host's `llm/*`), more of `ctx.host` in the WIT (web, term, browser as
imports), run events exported as a stream (WASI 0.3), and a desk composed at build time inside the component.

Sources: [StarlingMonkey](https://github.com/bytecodealliance/StarlingMonkey),
[ComponentizeJS](https://github.com/bytecodealliance/ComponentizeJS),
[wasmCloud community notes 2026-03-18](https://wasmcloud.com/community/2026-03-18-community-meeting/),
[WASI 0.3](https://wasi.dev/releases/wasi-p3),
[Wasmer Edge.js](https://wasmer.io/posts/edgejs-safe-nodejs-using-wasm-sandbox),
[WinterJS](https://wasmer.io/posts/winterjs-v1), [container2wasm](https://www.cncf.io/projects/container2wasm/),
[BrowserPod 2.0](https://labs.leaningtech.com/blog/browserpod-20).

## 6. Suggested order

1. Done 2026-10-26: `term` sandbox adapter + capability self-detection — `sandbox.js` `sandboxRunner()` (macOS
   sandbox-exec | `ASKK_SANDBOX=container` inside a container | `off`); no sandbox → no `term` capability, term/* 501
   with the reason, whoami `sandbox` (tests `sandbox-runner.test.js`).
2. Done 2026-10-26: the WASM spike (section 5) — the kernel as a component under jco and wasmtime. Next: real model,
   more host imports, WASI 0.3 events.
3. Supervisor adapter (launchd | systemd | container) behind `projects/restart`.
4. Done 2026-10-26: `Dockerfile` (section 7) — the source tree under Bun (not `--compile`: desks import companion by
   path), volumes, the model from env (`ASKK_LLM_*`). Chromium for the preview still open.
5. PWA manifest + service worker; a remote desk-server URL in the browser settings.
6. The Pixel avatar (section 8, researched 2026-10-26 for the Pixel 11 Pro XL): decided — a Kotlin shell around the
   browser-mode kernel (Nano v4, ML Kit speech, Android actions as MCP tools), the Mac as the deep path, the container
   in the Linux Terminal later. Not built: the owner chose research first.
7. iOS shell (Capacitor or SwiftUI WKWebView) with a native host bridge for speech, the Apple model, notifications.

## 7. The container — done 2026-10-26

2026-10-26 owner: "It can compiled as a process but I want container for portability. What capabilities do we pack and by
using any particular method, where can we run the application?"

**Method.** One OCI image (`Dockerfile`, `.dockerignore`), multi-arch (linux/amd64, linux/arm64). Stage 1 builds the
static UI (`next build` → `out/`) inside the image — never on the host while the dev server runs. Stage 2 is
`oven/bun:<v>-slim` + git + tini with `backend/ companion/ desks/ scripts/ lib/ out/`, run as `bun
companion/server/server.js --desks custom`. Not the compiled `dist/askk`: a desk's main.js imports
`companion/team/compose.js` by relative path and `desks/load` re-imports desks live, so the source tree must be on disk
(the binary stays the bare-machine option). Everything the owner owns is a volume, never in the image: `custom/` (desks),
`memory/`, `models/`; `.env*`, `.mcp.json`, `integrations/`, `vendor/` are dockerignored — secrets come in as `-e`.

Three changes made it run (each tested):
- **Model from env** — `compose.js` `envModel()`: `ASKK_LLM_PROVIDER` openai | anthropic, `ASKK_LLM_ID`,
  `ASKK_LLM_BASE_URL` (openai: any OpenAI-compatible server — llama.cpp, Ollama, vLLM, a phone's on-device bridge),
  key `ASKK_LLM_API_KEY` else `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`, `ASKK_LLM_CONTEXT`. Set, it answers for every model
  key of every convention desk (`forcedModels`: `model: sonnet` stays valid, the wire is this one), fallbacks dropped; a
  bad one throws at start, never a silent fall back to a CLI that is not there (`env-model.test.js`). Named `ASKK_LLM_*`
  because an old `.env` still carries `ASKK_MODEL_*` lines from the retired engine.
- **Listen inside the container** — `server.js`: `ASKK_BIND` is honoured only when `/.dockerenv` or
  `/run/.containerenv` exists; elsewhere the server stays on 127.0.0.1 whatever the env says. The Host-header guard is
  unchanged, so publish the same port on the host's loopback: `-p 127.0.0.1:7717:7717` (Host stays `localhost:7717`).
- **The terminal's sandbox** — `ASKK_SANDBOX=container` (section 6 step 1): term/* runs, the container is the boundary.

**What the image packs** (capabilities as `whoami` reports them; everything else detects itself and drops out):

| Packed and working | Absent in the image (why) | Bring it in by |
|---|---|---|
| team (agents, runs, stream), the whole kernel kit, workflows (phases), goal runner, practice, spawn, dispatch | apple, sanitize (Apple FM), Shortcuts — macOS only | the Android/iOS bridge (section 8) answering the same routes |
| fs/* + watch, projects, checkpoints | speech (`say`, SpeechAnalyzer) | an stt/tts model in `models/` with engine `openai`/`command` (Kokoro, Whisper on CPU) |
| web search/read/page, browse | images (mflux = MLX, Apple Silicon) | an image model with an OpenAI-compatible server on a GPU box |
| mcp (stdio servers that install in the image, Streamable HTTP anywhere) | browser/preview pages in the default image (`Bun.WebView` needs Chrome) | `--build-arg CHROMIUM=1`: Debian chromium behind `askk-chromium` (`--no-sandbox`: Chrome's sandbox needs user namespaces a container lacks; the container is the boundary) |
| term (container sandbox), dev checks | models.local CLIs (claude/codex/gemini need logins) | `ASKK_LLM_*` instead, or a derived image with a CLI and a mounted login |
| the model over the API (`ASKK_LLM_*`) | supervised restart (launchd) | the container's restart policy + the HEALTHCHECK (it calls `/__askk/desks`) |
| Telegram (with `integrations/` mounted and its env) | | |

**Where it runs.** Anything that runs Linux containers — the same image:

| Where | How | Notes |
|---|---|---|
| This Mac | colima / Docker Desktop / OrbStack (arm64 VM) | a second, isolated ASKK beside the launchd one; Apple features stay with the native server |
| A Linux box, NAS, home server | docker / podman, systemd unit or `--restart unless-stopped` | the "always on" server without a Mac |
| Raspberry Pi 5, Jetson | the arm64 image | a small always-on avatar host; a model on the network or a small local one |
| Cloud VM / Fly / Railway / any k8s | the image + a volume | still bind the Host guard: reach it over Tailscale/SSH tunnel, never a public port (no auth layer yet) |
| Windows | Docker Desktop on WSL2 | the same as Linux |
| Pixel (Android 15+ Linux Terminal, a Debian VM on AVF) | podman/docker inside the VM, or bun directly | section 8; the VM has no GPU, so the model lives outside it |

Verified 2026-10-26 on colima (linux/arm64, Docker 29.5): image 1.01 GB (2.01 GB with Chromium); the core desk starts
("1 agents ready"); `whoami` → platform linux, sandbox container, capabilities fs.read, fs.write, web, team, wakes, term,
browser, models; the UI answers 200, a foreign Host 421; `term/start git --version` → exit 0; a lead run reaches the
`ASKK_LLM_*` endpoint (a dead stub: "Could not reach …", no CLI fallback); with Chromium, `browser/open` of an app on
:3000 inside the container → a page with its screenshot.

```bash
docker build -t askk .
docker run -d --restart unless-stopped -p 127.0.0.1:7717:7717 -e ASKK_LLM_PROVIDER=openai -e ASKK_LLM_ID=<model> -e ASKK_LLM_BASE_URL=http://host.docker.internal:8080/v1 -v askk-memory:/askk/memory -v "$PWD/custom:/askk/custom" askk
```

## 8. The Pixel avatar

2026-10-26 owner: "compile this desk as my digital avatar … an application in pixel that will run using a local model.
The user would talk and the on device model will translate it into actions. Like the siri on device. Any automations
should be possible. Like the shortcuts application in apple, the desk has the capability building its own workflows."

### What ASKK already has for it

| Avatar need | ASKK piece today |
|---|---|
| talk → text | the speech pipeline (`backend/hardware/speech/pipeline.js`: wake word, once, direct), recognizers pluggable |
| messy words → a clear request | sanitize (`capabilities/sanitize.js`: one small-model call, guarded, never in the way) |
| request → actions | the lead's ReAct loop over TOOLS; `goal.frame` routes direct / helpers / workflow / goal / desk |
| "Shortcuts" | workflows as one markdown file (`docs/phases.md`: steps, vars, `### Output`), editable live, owner-run |
| builds its own automations | `desk.create`, `agent.spawn keep: desk`, `desk.propose` (tool code), practice edits — all held for the owner when the run read the outside world |
| a phone-sized UI, the owner can stop anything | the static UI (phone-first), every element's twin, Stop everywhere |
| one kernel, many hosts | `ctx.host`: the companion server, the browser tab — a phone is a third host |

### The shape: three layers, two processes

```
 Pixel ───────────────────────────────────────────────────────────────────────────────────────────────────
 │ ASKK app (Kotlin, one APK)                                                                             │
 │  ├─ WebView: the static UI + the kernel in browser mode (backend/browser/: one lead, kit artifacts)    │
 │  ├─ host bridge (answers ctx.host routes the WebView calls; the rest 501):                             │
 │  │    speech/*   SpeechRecognizer (on-device) + TextToSpeech            ← "talk"                       │
 │  │    llm/*      on-device model as an OpenAI-compatible endpoint      ← "the local model"              │
 │  │                 Gemini Nano v4 (ML Kit Prompt API, Pixel 11)                       │
 │  │                 or Gemma 3n / 4 on LiteRT-LM (GPU/NPU) for any Android                              │
 │  │    mcp/*      android.* tools: intents, alarms, calendar, contacts, notifications, settings panels,  │
 │  │               share, open app/deep link, AppFunctions of other apps, Accessibility (UI steps)       │
 │  │    fs/*       app storage                                                                          │
 │  └─ foreground service: wake word, the goal runner's ticks, notifications for talk.ask                 │
 │                                                                                                        │
 │ Linux Terminal (Debian VM on AVF) — optional, the heavy desk                                           │
 │  └─ the container (section 7) or bun: terminal, dev checks, MCP stdio servers, desks/load              │
 │     its llm/* → the app's on-device endpoint (VM → host port), or the Mac / cloud                      │
 └────────────────────────────────────────────────────────────────────────────────────────────────────────┘
        └── over Tailscale: the Mac's desk server (big models, mflux, Apple FM) when reachable
```

Why two processes and not "the container on the phone": Android apps cannot run OCI containers; the Linux Terminal VM
can, but it has no GPU and no access to Android's APIs (no mic, no intents, no AICore). The model and every action live
on the Android side; the VM adds only what Android forbids an app (arbitrary programs). Phase 1 needs no VM at all.

### The target: Pixel 11 Pro XL (owner 2026-10-26: research only, no build on this Mac yet)

| What it has | Why it matters for the avatar |
|---|---|
| Tensor G6, TPU ~50% faster than G5 (Google's claim) | the on-device model's speed |
| 12 GB (256 GB model) or **16 GB** RAM (512 GB / 1 TB) | Android 17's own local agent features need ≥ 12 GB; 16 GB leaves room for a 4 B model + the WebView + a Linux VM |
| Gemini Nano **nano-v4** via ML Kit GenAI **Prompt API** (listed for Pixel 11 / 11 Pro / 11 Pro XL / Fold) | a shared on-device model any app can call — no download, no weights in the APK |
| ML Kit GenAI speech recognition "Advanced" mode (Pixel 10 and 11) | on-device dictation as good as the system's |
| Android 17 + "Gemini Intelligence" (May 2026): cross-app tasks through AppFunctions and UI automation in a controlled virtual window, visible indicators, confirmation for payments and big changes | the OS already does the "Siri" part for Google's own agent — the bar the avatar is measured against, and APIs it may borrow |
| Linux Terminal (Debian VM on AVF); GPU rendering arrived on Pixel 10 in Android 16 QPR2 (buggy); GPU *compute* for a model inside the VM: not found | the heavy desk can run on the phone; the model should not run inside the VM |

### Build paths compared — the decision

| Path | What runs where | Unlocks | Costs / limits | Verdict |
|---|---|---|---|---|
| **A. Native shell** (Kotlin app: WebView with the static UI + the browser-mode kernel, a Kotlin host bridge) | kernel in the WebView; Nano v4 through the Prompt API; speech, intents, notifications, Accessibility in Kotlin | offline voice → actions; the kernel unchanged (`backend/browser/` is already the third host's template); one APK | no terminal, no MCP stdio (Android forbids arbitrary programs); Play policy on Accessibility; Prompt API is beta | **Build this first.** |
| B. A + the container in the Linux Terminal | A, plus the section 7 image (or bun) in the Debian VM; the VM's `llm/*` → the app's Nano endpoint over the VM's forwarded port | the full desk on the phone: terminal, dev checks, MCP stdio servers, `desks/load` — no Mac needed | developer-option feature; the VM can be killed in the background; no model on the VM's GPU; a second process to keep alive | Phase 2, when the phone should be its own server |
| C. A + the Mac desk server over Tailscale | the phone is the voice and the hands; big runs on the Mac (Opus, mflux, Apple FM) | everything ASKK does today, steered by voice from anywhere | needs the Mac on and reachable | the deep path of A from day one |
| D. Capacitor / PWA instead of a Kotlin shell | the same WebView, plugins for native calls | less Kotlin | every AICore / ML Kit / Accessibility call still needs a native plugin — the Kotlin is written anyway | no |
| E. Termux + bun + llama.cpp | bun and the server in Termux, a GGUF model on the CPU | the server as-is, no app | no Android APIs (no mic, intents, AICore) without Termux:API hacks; CPU-only model; not shippable | no — B does this properly |
| F. Kernel as a WASM component (section 5) | the kernel inside a wasm runtime in the app | capability-tight sandbox, one binary across platforms | the spike works, but WASI 0.3 events and the host imports are still to do; no gain over A on Android today | later, for the sandbox, not the first build |

**Decision for the Pixel 11 Pro XL: A, with C as the deep path, then B.** One Kotlin app hosts the kernel the way the
browser tab does today. Nano v4 is the local model, the Android APIs are the hands, the Mac is the big brain when it is
reachable, and the container in the Linux Terminal makes the phone a full server later. Buy the 16 GB model.

### Voice → action on Nano v4

A small on-device model is good at one-shot intent + slots and poor at long ReAct runs over 40 tools, so there are two
tiers:

1. **Fast path (on device, ~1 s, offline):** speech (ML Kit Advanced) → sanitize (Nano, the same guard as
   `capabilities/sanitize.js`) → router: Nano picks ONE workflow from `phases/*.md` or ONE `android.*` tool and fills its
   `vars:` as constrained JSON. "Set an alarm for 6", "text Mom I'm late", "run my morning brief".
2. **Deep path:** no match, low confidence or a goal ("plan my week from my calendar and email") → the full lead loop
   — on the Mac (Tailscale) or an API model (`ASKK_LLM_*`); on the phone alone, Nano runs it with a short tool list.
   Every answer says which model answered.

Building automations is the deep path's job: the lead writes a new `phases/<flow>.md` (a "shortcut"), the router learns
it from the list, and the next time the fast path runs it. A workflow or kept helper from a run that read the outside
world waits for the owner (the practice / desk hold) — the avatar never gives itself a standing order from a web page
or a message.

### Actions and their limits (Android 17)

| Route | Reach | For a third-party app | Use |
|---|---|---|---|
| Intents, deep links, `AlarmClock`, `CalendarContract`, share, dial, maps, open app, settings panels | most "Siri" actions | free | first |
| Notification listener; usage stats; location / time triggers (WorkManager, geofences) | the wake sources — Shortcuts' automations | runtime permissions the owner grants | the goal runner's and runners' wakes |
| **AppFunctions** (Android 16+): apps expose typed functions, the on-device MCP | other apps' own actions | callers need `EXECUTE_APP_FUNCTIONS`; community samples and blogs report it is privileged on most builds (check on the device: `adb shell pm list permissions -f`), plus a higher `EXECUTE_APP_FUNCTIONS_TRUSTED` | expose ASKK's own functions *to* Gemini first; call others only if granted |
| **Accessibility service**: read the screen, tap, type in any app | the universal fallback, like Shortcuts' UI scripting | allowed; Play restricts it to accessibility use — side-load or a private track | the "do it in the app" step, every side effect confirm-gated |
| Gemini Intelligence's virtual-window UI automation | cross-app tasks | the OS agent's own, not an API (found nothing public) | hand a task to Gemini via an intent, if exposed |

Every action with a side effect (send, call, pay, delete, post, book) goes through `talk.ask` with buttons first — a
tap from the owner, never the model's word — and each action is a row in the Live feed, as on the Mac.

### What it unlocks — and what Gemini Intelligence does not

- **One avatar, every surface:** the same kernel, desks and workflows on the Mac, in a container, in a browser tab and on
  the phone; the phone carries its own desk and steers the Mac's.
- **Workflows you own:** each "shortcut" is a markdown file you read, edit, diff and version (`phases/*.md`), written
  by the desk and checked at load. Not a cloud recipe you can't see.
- **Watched, stoppable work:** every step, tool call and model call has its UI twin and a Stop. The OS agent shows an
  indicator; ASKK shows the whole run.
- **Self-improvement under your hold:** practice retros, kept helpers and new desks, each held for you when the run read
  outside text.
- **Private by default:** fast-path requests never leave the phone (Nano v4 + on-device speech); the deep path is your
  own Mac before any cloud.
- **Long-running goals:** the goal artifact and its resume loop keep working toward a goal across days, with phone wakes
  (a notification, a place, a time) as triggers.
- **Your own tools:** desk tools, MCP servers on the Mac or in the phone's Linux VM, Telegram — none of which the OS agent
  can reach.

### Order (when the build starts)

1. Android Studio + a Pixel 11 Pro XL (16 GB) over adb.
2. The shell: WebView + `backend/browser/` kernel + bridge `llm/*` (Prompt API, nano-v4) and `speech/*` (ML Kit Advanced,
   TextToSpeech). Check: airplane mode, a spoken question answered on device, the run's rows in the UI.
3. `android.*` tools as an MCP server inside the app (Streamable HTTP on localhost) → the kernel's existing `mcp` path;
   intents first, every side effect confirm-gated; check the AppFunctions permission level on the device.
4. The router (fast path) over the desk's workflows; `phases/*.md` synced from the Mac desk; Tailscale to the Mac for the
   deep path.
5. A foreground service: wake word, goal ticks, `talk.ask` as notifications with action buttons.
6. The container in the Linux Terminal (path B), its `llm/*` pointed at the app.

Sources: [Pixel 11 series (Android Authority)](https://www.androidauthority.com/google-pixel-11-series-3693865/),
[Pixel 11 Pro XL specs (GSMArena)](https://m.gsmarena.com/google_pixel_11_pro_xl_5g-14800.php),
[Pixel 11 RAM by storage (Jetstream)](https://jetstream.blog/en/google-pixel-11-pro/),
[Tensor G6 TPU (Basic Tutorials)](https://basic-tutorials.com/news/google-pixel-11-pro-xl-unveiled-tensor-g6-new-camera-and-hilight-led/),
[ML Kit GenAI device support](https://developers.google.com/ml-kit/genai),
[ML Kit GenAI speech recognition](https://developers.google.com/ml-kit/genai/speech-recognition/android),
[Prompt API alpha](https://android-developers.googleblog.com/2025/10/ml-kit-genai-prompt-api-alpha-release.html),
[Android 17 Gemini Intelligence (TechSpot)](https://www.techspot.com/news/112388-google-gemini-intelligence-shows-off-agentic-android-17.html),
[Android 17 agentic layer (Approov)](https://approov.io/blog/android-17-android-is-becoming-an-agent-are-you-ready),
[AppFunctions](https://developer.android.com/ai/appfunctions),
[AppFunctionsPilot (permission level)](https://github.com/FilipFan/AppFunctionsPilot),
[LiteRT-LM](https://developers.googleblog.com/en/blazing-fast-on-device-genai-with-litert-lm/),
[Linux Terminal on Pixel](https://www.androidauthority.com/android-linux-terminal-app-available-3532999),
[Linux Terminal GPU on Pixel 10](https://www.androidauthority.com/pixel-10-linux-apps-gpu-acceleration-3608754),
[AVF docs](https://source.android.com/docs/core/virtualization).
