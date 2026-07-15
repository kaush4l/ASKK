# NAVIGATION — a junior engineer's map of ASKK

> Companion to `MAP.md` (the per-hop lifecycle index, structure-tested).
> This file answers: what runs where, where does each feature live, and
> where does *my* new code go.

## 1. The mental model, one paragraph

The browser hosts the entire full-stack app. All the Rust in `crates/` compiles
to WebAssembly and runs client-side inside a Dioxus page (`crates/frontend/src/main.rs`);
storage is the browser's OPFS (`crates/browser/src/opfs.rs`), the execution
sandbox is a 64-bit Alpine Linux VM emulated in a tab (container2wasm,
`crates/browser/src/vm.rs`).
The only thing outside the browser is the LLM itself: an OpenAI-compatible or
Anthropic endpoint you configure (`crates/inference/`), or an in-browser model
via transformers.js (`crates/browser/src/local_llm.rs`). There is no server of
ours anywhere — "backend" and "frontend" are just crates in one wasm binary.

## 2. The three layers (the owner's framing)

The codebase reads as three stacked layers. They are not folders — they are a way
to see what each piece is *for*.

| Layer | What it does | Where it lives (code-cited) |
|---|---|---|
| **Structural / resilience** | Swallows errors so the app keeps moving — "keep the application moving" is meant literally. | Tool failures become observations, never exceptions (`crates/engine/src/run/dispatch.rs`); the signal log degrades to in-memory instead of dying and quarantines bad segments on load (`crates/state/src/log.rs`); the LLM call lands a terminal (Error/Interrupted) rather than throwing on a resolver miss, cancel, or exhausted retries (`crates/engine/src/run/infer.rs`, ADR-042 hardening); off-wasm capability fns return `Err("… requires the browser build")` so the host build/gate stays green (`crates/browser/src/capabilities/`). |
| **Abstract / object** | The pure domain vocabulary + the objects that carry a run. Host-testable, no I/O. | `crates/core`: `Phase`/`PhaseStep`, `Contract`, the `Tool` trait, `Signal` + `fold`, `Sheet`, `Action`/policy, `State` (imports nothing — `src/lib.rs`). The concrete lifecycle objects sit one crate up: `RunSession` / `Shared` / `RunState` (`crates/engine/src/run/session.rs`). |
| **Orchestration-by-md** | Agents are data: markdown files declare who does what and drive the engine. Nothing hardcodes an agent. | `crates/frontend/assets/agents/*.md` (frontmatter id/tools/skills/provider/contract + `phase.N.*` workflow + directive body) → parsed by `crates/features/src/config/` (`agent.rs`, `phases.rs`, `team.rs`, `env.rs`) → driven by `crates/engine/src/run/`. The boot default is `orchestrator.md`, a Jarvis director that delegates (ADR-042). |

## 3. Taxonomy → crate

Import rule (one-way DAG, structure-tested — see `MAP.md` for the full table):
`core ← inference ← state ← features ← engine ← browser ← frontend`.

| You are thinking about… | Crate | What lives there (from the crate banners) |
|---|---|---|
| Pure domain: Sheet, Element, Contract, Tool trait, Signal, Phase, Provider seam | `crates/core` | No I/O, no wasm, imports nothing from the workspace (`src/lib.rs`) |
| LLM adapters | `crates/inference` | Provider adapters over an injected `Transport`; body build + reply parse are pure fns (`src/lib.rs`) |
| What we store + how agents communicate | `crates/state` | `KvStore`/`BlobStore` seams, append-only `SignalLog` (THE run truth), session/memory stores (`src/lib.rs`) |
| Self-contained features: config parsing + the tool surface | `crates/features` | `src/config/` (agent/team/env/skill md parsing) + `src/tools/` (one folder per feature); never imports engine or browser |
| The agent loop: run/turn/dispatch/delegation/actions | `crates/engine` | Run orchestration, sheet assembly, action gating (`src/lib.rs`); delegation incl. `spawn` under `src/run/delegation/` |
| Browser adapters: OPFS, fetch, VM glue, speech, boot facade | `crates/browser` | The host seam — the ONLY crate above the engine allowed to import it; UI talks to `boot::HarnessHandle` only (`src/lib.rs`) |
| UI components and stages | `crates/frontend` | Dioxus shell; `src/ui/` imports core + browser only (`src/ui/mod.rs`) |

### ADR-042 surfaces — where the newest primitives live

| Surface | Lives in |
|---|---|
| **Workflow-path step** (a deterministic, no-LLM phase — "repeated paths become code") | `core::PhaseStep::{Llm, Tool{tool,args}}` (`crates/core/src/phase.rs`) runs in `crates/engine/src/run/scripted.rs`; authored as `phase.N.tool` / `phase.N.args` and parsed in `crates/features/src/config/phases.rs`. Scripted steps run **pure** tools only; a gate can't be scripted. |
| **LLM call split out of the turn** | `crates/engine/src/run/infer.rs` (one call, ≤3 retries, cancel race); the per-turn loop stays `assemble → infer → parse → act` in `turn.rs`. |
| **Fleet stage** (launch / monitor / cancel N agents as parallel loops) | `Stage::Fleet` (`crates/frontend/src/ui/manifest.rs`) + `crates/frontend/src/ui/fleet.rs`; reuses `submit` + per-run `drive_run` for backgrounding. |
| **Orchestrator = default agent** (Jarvis director, reverses ADR-039's single-agent default) | `crates/frontend/assets/agents/orchestrator.md` (lean single-phase react + delegation toolset); boot picks it in `crates/frontend/src/ui/app.rs` (falls back to the first card). |

## 4. Feature verticals

Each feature is one folder in `crates/features/src/tools/`, plus (where needed)
a browser adapter and a frontend stage. Columns verified against the file tree.

| Feature | Tools | Browser adapter | Frontend stage | State it touches |
|---|---|---|---|---|
| VM shell + workspace files | `crates/features/src/tools/vm/` (`shell.rs`, `workspace.rs`) | `crates/browser/src/vm.rs` (serial bridge) | `crates/frontend/src/ui/vm.rs` (console) | none — guest is throwaway |
| Web + news search | `crates/features/src/tools/search/` (`engines.rs`, `news.rs`) | `crates/browser/src/fetch.rs` (Transport) | results land in chat | none (`Effect::Pure`) |
| Artifacts | `crates/features/src/tools/artifacts/mod.rs` | `crates/browser/src/artifacts.rs` (read side) | `crates/frontend/src/ui/artifacts.rs` (gallery) | blob `artifact/<slug>` (`BlobStore`) |
| Knowledge (OKF) | `crates/features/src/tools/knowledge/mod.rs` | — | — | `KvStore` keys `okf/<id>` + `okf/log` |
| Memory notes | `crates/features/src/tools/memory/mod.rs` | — | — | `KvStore` keys `notes/<slug>` |
| Skills discovery | `crates/features/src/tools/skills.rs` | `crates/browser/src/config.rs` (loader) | — | pure reads over session config |
| MCP client | `crates/features/src/tools/mcp/` | `crates/browser/src/fetch.rs` (Transport) | `crates/frontend/src/ui/settings.rs` (server list) | `mcp_servers` pref (`crates/browser/src/boot.rs`) |
| Speech (STT/TTS) | — (UI-level, not a tool) | `crates/browser/src/speech.rs` | `crates/frontend/src/ui/shell.rs` + `app.rs` | none |
| Local LLM | — (a provider, not a tool) | `crates/browser/src/local_llm.rs` | picked in settings | profile prefs |
| Delegation / loops / spawn_agent | `crates/engine/src/run/delegation/` (`delegate.rs`, `loops.rs`, `spawn.rs`) | — | — | nested runs share `Shared` |

Delegation sits in `engine`, not `features`, because it spawns runs — features
may never import the engine (import rule above).

## 5. Where do I put new code?

- **New tool** → new folder (or file) under `crates/features/src/tools/`, impl
  `askk_core::Tool`, add a `register_*` fn, wire it in `crates/browser/src/boot.rs`.
- **New UI stage** → add a `Stage` variant + a `COMPONENTS` row in
  `crates/frontend/src/ui/manifest.rs`, a body module `crates/frontend/src/ui/<stage>.rs`,
  and a match arm in `app.rs`'s stage switch (the recipe is spelled out in the
  `manifest.rs` banner). Import core + the `boot` facade only.
- **New browser reach** (a Web API, sensor, or JS bundle) → a free fn in
  `crates/browser/src/`, exposed to features as an injected trait (like
  `ShellExec` in `tools/vm/shell.rs`). The frontend has **no** `web-sys` — every
  browser reach goes through a `crates/browser` free fn (ADR-041).
- **New agent / team / skill** → markdown under `crates/frontend/assets/agents/`
  (data, not code — see the README there). No Rust changes.
- **New deterministic step in an agent's flow** → don't write Rust; add a
  `phase.N.tool` (+ optional `phase.N.args`) line to the agent's md — that IS the
  workflow-path primitive (ADR-042). Rust only changes to add a brand-new tool.
- **New persistent store** → `crates/state/src/<store>.rs` over the `KvStore`/
  `BlobStore` seams — never talk to OPFS directly from a feature.
- **New LLM provider** → `crates/inference/src/<provider>.rs` + register in
  `crates/inference/src/registry.rs`. Pure request/reply mapping only.
- **New MCP server** → config, not code: add it to the `mcp_servers` pref in
  Settings. The client (`crates/features/src/tools/mcp/`) handles any server.
- **New pure type or contract shape** → `crates/core`. If it needs I/O, it
  doesn't belong there.

## 6. Reading path for a first day

Read in order; each banner comment explains the file's role. This is the boot →
loop → dispatch → UI-fold spine.

1. `MAP.md` — the 12 lifecycle hops, one table.
2. `crates/browser/src/boot.rs` — how a session boots: stores, registry,
   `HarnessHandle`, the one facade the UI sees.
3. `crates/engine/src/run/session.rs` — the run objects: `RunSession`, the
   shared `Shared`, and per-run `RunState` (`submit` / `drive` / `cancel`).
4. `crates/engine/src/run/turn.rs` — `drive_run` → `one_turn`, the per-phase
   loop: budgets → assemble → infer → parse → absorb → dispatch → route. The
   LLM call is split into `run/infer.rs`; a scripted phase runs `run/scripted.rs`.
5. `crates/engine/src/run/dispatch.rs` — tool calls: allowlist check →
   action gate → execute/park/deny; failures become observations.
6. `crates/features/src/tools/vm/shell.rs` — a small complete tool: one
   trait seam (`ShellExec`), one register fn, `Effect` choice explained.
7. `crates/frontend/src/ui/app.rs` — UI = fold(signals): the root component
   that reads projections and switches the stage (`mod.rs` states the rule).
8. Optional: `docs/PROMPT.md` — exactly what the LLM sees each turn.

## 7. How agents communicate

Cribbed from the `crates/state/src/lib.rs` banner — the authoritative statement:

- **No pub/sub between agents.** Nothing subscribes to anything.
- **Delegation = nested runs sharing one `Shared`** (`crates/engine/src/run/session.rs`)
  via the delegation/loops tools; a sub-agent is just another run the parent drives.
- **Signals are the single run-state truth**: every durable run fact is a signal
  appended to the log (`crates/state/src/log.rs`, single writer); the UI is
  `fold(signals)` (`crates/core/src/signal.rs`), and replay reproduces state.
- **The cross-tab bus is view-only**: `crates/browser/src/bus.rs` mirrors
  stamped signals across tabs over BroadcastChannel; a tab owns only the runs
  it submitted.
