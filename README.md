# ASKK

> New here? Start with [docs/NAVIGATION.md](docs/NAVIGATION.md) — what runs where, and where new code goes.

A browser-only agent workspace. Rust compiled to WebAssembly (Dioxus); everything runs
client-side — the only network traffic is to the LLM endpoint you configure.

What is inside:

- **ReAct agent loop** with typed contracts (TOON/JSON, repair cascade) and true SSE streaming.
- **Multi-agent delegation** — every enabled agent is a tool for its callers — plus managed
  parallel loops (`spawn_run` / `check_run` / `wait_run` / `steer_run` / `cancel_run`).
- **A real x86 Linux VM in the browser** (v86, serial console) as the execution substrate:
  agents run shell commands and read/write files in the guest; a `js_eval` Web Worker fast
  lane covers quick JavaScript without touching the VM.
- **Kanban work board**: a goal becomes cards; agents push cards through stages until the
  acceptance criteria on each card pass (ADR-026).
- **Web and news search**, key-free by default (SearXNG → DuckDuckGo → Wikipedia;
  Wikinews → GDELT).
- **Persistent agent knowledge** as an OKF (Open Knowledge Format) v0.1 bundle.
- **Speech**: Whisper STT and Kokoro TTS, running in the browser.
- **Signal-log state model**: an append-only signal log is the sole run-state truth;
  the UI is a fold over it, and replay reproduces state.

## Try it

Live instance: **https://kaush4l.github.io/ASKK/**

1. Open the page.
2. Settings → add a provider profile pointing at any OpenAI-compatible endpoint (an
   Anthropic adapter exists too) with your own key. BYOK: profiles and keys are stored in
   your browser's OPFS and never leave it except toward the endpoint you named.
3. Local models work from the hosted page: Chrome allows an https page to call
   `http://127.0.0.1`, so a local server (llama.cpp, LM Studio, mlx, ollama, …) is fine —
   the endpoint must send permissive CORS headers.

## Agents are files

The `crates/frontend/assets/agents/` folder IS the roster: one markdown file per agent —
frontmatter (id, tools, skills, provider, contract, `phase.N.*` workflow) plus a directive
body. Subfolders are teams (`coding/` = dev-lead + programmer + reviewer). The deployed
site fetches this folder at load, so on a static host you can drop a new `.md` into the
served `assets/agents/` folder, list it in `manifest.json`, and reload — no rebuild.

## Architecture in six lines

- Crates layer one way, structure-tested: `core ← inference ← runtime ← web`.
- The signal log is the sole run-state truth; UI = fold(signals); replay from 0 reproduces state.
- One `Tool` trait, one registry; ToolSet membership is the allowlist; mutating calls pass an action gate and are audited.
- Providers map a rendered request; they never compose prompts.
- Only a verifier gate phase can end a run as success — everything else is `Unverified`.
- An acceptance benchmark (`bench/acceptance/ROWS.md`) gates CI through a scripted provider; live local models never gate.

[MAP.md](MAP.md) maps the run lifecycle hop by hop to files. Decisions live in
[docs/adr/ADRS.md](docs/adr/ADRS.md); the feature inventory in
[docs/CAPABILITIES.md](docs/CAPABILITIES.md).

## Develop

```sh
rustup target add wasm32-unknown-unknown
cargo install dioxus-cli        # dx 0.7
dx serve -p askk-frontend --platform web --port 8081
```

Test and gate with `./scripts/gate.sh` (fmt, clippy `-D warnings`, wasm32 check, workspace
tests, bench status). Green or no merge.

## Deploy

`scripts/publish.sh` — release build with base path `/ASKK/`, ships the served agents
folder verbatim, pushes to `gh-pages`.

## History

The previous generation of this codebase lives on branch `legacy`.
