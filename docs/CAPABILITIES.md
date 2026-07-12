# Capabilities — what this workspace can do, and what it grows next

The harness is a browser-only agent workspace: everything below runs client-side
(wasm + vendored JS), talking to whatever LLM the active provider profile names.
This file is the working inventory — features land here when live-verified, the
queue names what makes it more of a *workspace* (old ASKK is the feature
reference; kiln is the structure reference).

## Live (verified against a local model)

| Capability | Where | Proof |
|---|---|---|
| Chat + ReAct loop (TOON/JSON contracts, repair cascade) | `crates/core` contracts, `crates/runtime` turn loop | wave 7 e2e |
| True streaming (SSE, chunk-safe, UTF-8-safe) | `crates/inference/transport.rs`, `web/host/fetch.rs` | wave 7 e2e |
| Named provider profiles (BYOK, per-profile model/max_tokens) | `web/host/profile.rs`, settings UI | wave 7 e2e |
| web_search (DDG → Wikipedia fallback) | `runtime/tools/search.rs` | wave 7 e2e |
| Delegation: every enabled agent is a tool; authority narrows | `runtime/delegate.rs` | wave 7 e2e |
| **Parallel agents**: multi-call turns (`calls` list) join concurrently; UI drives N runs at once | `runtime/run/dispatch.rs`, `web/host/boot.rs` | wave 9 |
| **Folder-is-config agents**: `agents/` decides set + order (build.rs bake, manifest.json runtime override on static hosts) | `crates/web/build.rs`, `web/host/boot.rs` | wave 9 |
| **Orchestrator-managed loops**: plan → dispatch (loop) → verify (gate) declared phases | `agents/orchestrator.md` | wave 9 |
| Speech: STT (whisper) + TTS (kokoro) behind HF-model-id seam | `web/host/speech.rs`, `scripts/speech/` | wave 8 round-trip |
| **VM: real x86 Linux in the browser (v86)** — serial console, manifest-driven images | `web/ui/vm.rs`, `assets/vm/` | wave 9 |
| Signal-log persistence (OPFS, in-memory degrade), replay = projection | `runtime/state/log.rs` | workflows tests |
| Action gate: mutating tools park for confirmation | `runtime/actions/` | workflows tests |
| **Cross-tab mirror**: tabs broadcast signals; a second tab renders foreign runs live (ADR-031) | `web/host/bus.rs` | wave 15 |
| **Dashboard wall**: big-numeral tile stage, `#/Dashboard` deep link, pop-out button | `web/ui/dashboard.rs` | wave 15 |
| **Big artifacts**: `artifact_publish` (html/markdown/url) → gallery + sandboxed viewer; PDF via url kind | `runtime/tools/artifact.rs`, `web/ui/artifacts.rs` | wave 15 |
| Markdown rendering in chat answers + artifact docs (in-repo subset renderer) | `web/ui/markdown.rs` | wave 15 |

## Queue (what would make it more of a workspace)

Ordered by leverage; each is one increment.

1. **Workspace FS tools** — agent-visible OPFS folder (list/read/write/edit) as
   gated tools; the VM and the agents share artifacts. (Old ASKK: workspace-builtin.)
2. **VM as a tool** — `vm_exec(cmd)`: run a command in the booted guest over the
   serial line, return output. Turns the alpine VM into the exec substrate.
3. **Cancel = fetch abort** — AbortController through `send_stream` (GAPS 17).
4. **Worker offload** — engine + speech off the main thread (GAPS 18/22 refold
   saturation is the symptom).
5. **Memory tools** — `remember`/`recall` over the per-agent MemoryStore, so
   agents curate their own memory instead of only receiving it.
6. **MCP client** — browser-direct MCP servers as ToolRegistry entries.
7. **Skills folder auto-discovery UI** — settings surface for enabling/ordering
   what the folder provides.

## Configuration surface

What each knob renders into the prompt — element order, provider mapping, parse/repair —
is documented with file:line citations in `docs/PROMPT.md`.

- `agents/*.md` — one file per agent: frontmatter (id, tools, skills, provider,
  contract, format, `phase.N.*` strategy) + body directive. The folder IS the
  roster; `agents/manifest.json` fixes order and (on static hosts) overrides at
  runtime without a rebuild.
- `env:` frontmatter — environment presets, so an agent declares WHICH
  environment it lives in instead of enumerating every tool. Comma-separated
  preset names expanded into `tools` at load time (env tools first, then
  explicit `tools:` extras, deduplicated): `vm` (shell, write_file, read_file,
  list_files, edit_file), `web` (web_search, news_search, fetch_url,
  knowledge_search/read/write/list), `core` (echo, calc, now, js_eval), `board`
  (board_add/list/move/check). Unknown preset names are load errors, listed
  with the other config problems.
- `agents/soul.md` — shared identity prelude.
- `agents/skills/*.md` — reusable prompt fragments agents opt into.
- Provider profiles — saved in the browser (OPFS), switchable per run.

## Wave 10 additions (2026-07-09)

- **`shell` tool**: agents run real command lines in the in-browser Linux VM
  (v86 serial, auto-login, marker-captured output). VM now boots at app load
  into a persistent console so `shell` works from any stage.
- **react contract v2**: `observation`/`plan` string lists, `action` switch,
  `answer` = final text OR MCP-style call line `{"name","arguments"}` (ADR-017).
- **Agents + custom JS tools are served files** under `crates/web/assets/agents/`
  (baked + live-fetch). `fetch_url.js` is the sample custom tool — self-registers
  an MCP card, wrapped as a `dyn Tool` (ADR-019).

Queue item #2 (`vm_exec` over serial) is now DONE as the `shell` tool.

## Wave 11 — coding teams (2026-07-09)

- **Recursive agent folders**: a SUBFOLDER under `agents/` is a team. `agents/coding/`
  holds `dev-lead` + `programmer` + `reviewer`. build.rs discovers nested `*.md` and
  bakes/serves them like top-level agents.
- **Open-swe multi-agent coding team**: `dev-lead` plans → delegates to `programmer` →
  gates through `reviewer` (critic) in a loop until it passes. Orchestrator routes any
  "build me X" to `dev-lead`.
- **bolt.diy single-agent path**: `builder` — one agent, all tools, does the whole job.
- **Workspace file tools** (rust builtins over the VM shell): `write_file` (quoted-heredoc,
  byte-exact), `read_file`, `list_files`, `edit_file` (awk substring replace via env). The
  coders write/inspect/edit files with these and RUN via `shell`.

Two development models coexist: multi-agent (orchestrator → dev-lead → team) and
single-agent (builder). Both run on the sandboxed VM. Offline VM = POSIX/busybox
projects today; richer toolchains wait on guest networking (GAPS 25).

## Wave 12 — acceptance benchmark + fast lane (2026-07-11, brief v4)

- **The v0 termination condition is now machine-checkable**: `bench/acceptance/ROWS.md`
  (rows A1–A10, pass condition + budget + lane each) drives the REAL agent loop against
  fixture scripts in CI; `bench/acceptance/STATUS.md` is generated by the gate (ADR-020).
- **`js_eval` fast lane**: agents run short JavaScript in an isolated Web Worker —
  console capture, completion value, await support, terminate-on-timeout; live-verified
  at 6 ms round-trip. The VM never sees JS (ADR-021).
- **`MockProvider::from_script`**: the ScriptedLlm rig loads canned reply sequences from
  `crates/runtime/tests/fixtures/*.llm` (`---`-separated blocks, `!error:` for typed
  provider errors) via `include_str!` — no runtime I/O, wasm-safe.
- Gate now compiles wasm32 (`cargo check -p askk-web --target wasm32-unknown-unknown`)
  and regenerates the bench status on every run.

## Wave 13 — modularity: managed loops, open search, OKF knowledge (2026-07-11)

- **Managed parallel loops** (ADR-022): `spawn_run` / `check_run` / `wait_run` /
  `steer_run` / `cancel_run` — an orchestrator spawns one loop per independent part,
  watches status/digests, injects course corrections, cancels stragglers, and collects
  everything concurrently in one `wait_run`. Orchestrator + dev-lead carry the tools and
  directives.
- **Open-source search default** (ADR-023): `web_search` tries a configured SearXNG
  instance first (shipped default `search.rhscz.eu`; Settings row to point at your own;
  blank disables) and falls back DDG → Wikipedia. New `news_search` = Wikinews
  (newest-first) → GDELT best-effort.
- **OKF knowledge bundle** (ADR-024): agents keep persistent curated knowledge in
  Google's Open Knowledge Format v0.1 — `knowledge_write/read/list/search` over
  OPFS-backed storage, conformant concepts + update log; the researcher saves durable
  findings (news, facts, sources) as concepts.
- **First-boot default profile**: a fresh browser seeds the manual-smoke profile
  (`gemma-4-12B-it-qat-mxfp8` @ `http://127.0.0.1:8873/v1`, omlx) so the harness runs
  before Settings is ever opened; saving any profile retires the seed (ADR-020 lane —
  never CI-gated).
- **agents.md metadata for multi-loops + modular response formats**: custom per-agent
  contracts (`field.N.*` frontmatter — name/kind/required/desc), per-phase
  `phase.N.max_turns`, loop-exhaustion `on_fail` routing, and declared fan-out
  (`phase.N.fan_out` + `phase.N.parts`: one delegate call per item of the previous
  phase's list field, dispatched concurrently — deterministic parallelism that does not
  rely on the model emitting a multi-call turn).

## Wave 14 — the software team + everywhere-inference (2026-07-12)

All merged and gate-green; browser rows live-verified on https://kaush4l.github.io/ASKK/.

- **Kanban work model** (ADR-026): goal → cards with acceptance criteria → agents push
  through backlog/planning/doing/testing/done; Done is criteria-gated; testing→planning
  bounces are first-class. Four tools (board_add/list/move/check) + a live Board tab
  (5 columns over the persistent OPFS board) + a `tester` agent that records
  per-criterion verdicts; the orchestrator plans onto the board and bounces unmet cards.
- **Browser-direct MCP client**: remote Streamable-HTTP MCP servers become ordinary
  registry tools (`mcp_<server>_<tool>`, readOnlyHint→Pure); `mcp_servers` Settings
  textarea; dead servers degrade to boot warnings.
- **Memory tools**: `remember`/`recall`/`forget` over KvStore `notes/` — agents curate
  durable notes; assistant + researcher carry directives.
- **Env presets**: `env: vm|web|core|board` frontmatter expands into the tools allowlist
  at load; agents declare their environment instead of enumerating tools.
- **Handoff**: swarm-style full transfer — `handoff {agent, goal}` ends the caller's run
  with the target's answer verbatim (no rephrasing turn).
- **Cancel = abort** (GAPS 17 closed): wake-aware CancelToken races the in-flight
  inference; wasm fetch aborts via AbortController on stream drop.
- **In-browser LLM inference**: profile base_url `local` + a HF ONNX model id (e.g.
  `onnx-community/gemma-4-E2B-it-ONNX`) runs the whole loop client-side via a vendored
  transformers.js worker — WebGPU q4f16, wasm fallback, hub-streamed browser-cached
  weights, token streaming into the normal loop.
