# NAVIGATION — a junior engineer's map of ASKK

> Companion to `MAP.md` (the per-hop lifecycle index, structure-tested).
> This file answers: what runs where, where does each feature live, and
> where does *my* new code go.

## 1. The mental model, one paragraph

The browser hosts the entire full-stack app. All the Rust in `crates/` compiles
to WebAssembly and runs client-side inside a Dioxus page (`crates/frontend/src/main.rs`);
storage is the browser's OPFS (`crates/browser/src/opfs.rs`), the execution
sandbox is an x86 Linux VM emulated in a tab (v86, `crates/browser/src/vm.rs`).
The only thing outside the browser is the LLM itself: an OpenAI-compatible or
Anthropic endpoint you configure (`crates/inference/`), or an in-browser model
via transformers.js (`crates/browser/src/local_llm.rs`). There is no server of
ours anywhere — "backend" and "frontend" are just crates in one wasm binary.

## 2. Taxonomy → crate

Import rule (one-way DAG, structure-tested — see `MAP.md` for the full table):
`core ← inference ← state ← features ← engine ← browser ← frontend`.

| You are thinking about… | Crate | What lives there (from the crate banners) |
|---|---|---|
| Pure domain: Sheet, Element, Contract, Tool trait, Signal, Phase, Provider seam | `crates/core` | No I/O, no wasm, imports nothing from the workspace (`src/lib.rs`) |
| LLM adapters | `crates/inference` | Provider adapters over an injected `Transport`; body build + reply parse are pure fns (`src/lib.rs`) |
| What we store + how agents communicate | `crates/state` | `KvStore`/`BlobStore` seams, append-only `SignalLog` (THE run truth), session/memory/board stores (`src/lib.rs`) |
| Self-contained features: config parsing + the tool surface | `crates/features` | `src/config/` (agent/team/env/skill md parsing) + `src/tools/` (one folder per feature); never imports engine or browser |
| The agent loop: run/turn/dispatch/delegation/actions | `crates/engine` | Run orchestration, sheet assembly, action gating (`src/lib.rs`); delegation incl. `spawn` under `src/run/delegation/` |
| Browser adapters: OPFS, fetch, VM glue, speech, boot facade | `crates/browser` | The host seam — the ONLY crate above the engine allowed to import it; UI talks to `boot::HarnessHandle` only (`src/lib.rs`) |
| UI components and stages | `crates/frontend` | Dioxus shell; `src/ui/` imports core + browser only (`src/ui/mod.rs`) |

## 3. Feature verticals

Each feature is one folder in `crates/features/src/tools/`, plus (where needed)
a browser adapter and a frontend stage. Columns verified against the file tree.

| Feature | Tools | Browser adapter | Frontend stage | State it touches |
|---|---|---|---|---|
| VM shell + workspace files | `crates/features/src/tools/vm/` (`shell.rs`, `workspace.rs`) | `crates/browser/src/vm.rs` (serial bridge) | `crates/frontend/src/ui/vm.rs` (console) | none — guest is throwaway |
| Web + news search | `crates/features/src/tools/search/` (`engines.rs`, `news.rs`) | `crates/browser/src/fetch.rs` (Transport) | results land in chat | none (`Effect::Pure`) |
| Kanban board | `crates/features/src/tools/board/mod.rs` | — (KvStore via OPFS) | `crates/frontend/src/ui/board.rs` + `dashboard.rs` | `crates/state/src/board.rs` (`BoardStore`) |
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

## 4. Where do I put new code?

- **New tool** → new folder (or file) under `crates/features/src/tools/`, impl
  `askk_core::Tool`, add a `register_*` fn, wire it in `crates/browser/src/boot.rs`.
- **New UI stage** → `crates/frontend/src/ui/<stage>.rs`, mount it in the shell
  (`crates/frontend/src/ui/shell.rs`); import core + the `boot` facade only.
- **New persistent store** → `crates/state/src/<store>.rs` over the `KvStore`/
  `BlobStore` seams — never talk to OPFS directly from a feature.
- **New LLM provider** → `crates/inference/src/<provider>.rs` + register in
  `crates/inference/src/registry.rs`. Pure request/reply mapping only.
- **New MCP server** → config, not code: add it to the `mcp_servers` pref in
  Settings. The client (`crates/features/src/tools/mcp/`) handles any server.
- **New agent / team / skill** → markdown under `crates/frontend/assets/agents/`
  (data, not code — see the README there). No Rust changes.
- **New browser API** (a Web API, a JS bundle) → `crates/browser/src/`, exposed
  to features as an injected trait (like `ShellExec` in `tools/vm/shell.rs`).
- **New pure type or contract shape** → `crates/core`. If it needs I/O, it
  doesn't belong there.

## 5. Reading path for a first day

Read in order; each banner comment explains the file's role.

1. `MAP.md` — the 12 lifecycle hops, one table.
2. `crates/browser/src/boot.rs` — how a session boots: stores, registry,
   `HarnessHandle`, the one facade the UI sees.
3. `crates/engine/src/run/turn.rs` — the per-phase, per-turn loop:
   budgets → assemble → infer → parse → absorb → dispatch → route.
4. `crates/engine/src/run/dispatch.rs` — tool calls: allowlist check →
   action gate → execute/park/deny; failures become observations.
5. `crates/features/src/tools/vm/shell.rs` — a small complete tool: one
   trait seam (`ShellExec`), one register fn, `Effect` choice explained.
6. `crates/frontend/src/ui/mod.rs` — UI = fold(signals); persistent shell
   around one swappable stage.
7. Optional: `docs/PROMPT.md` — exactly what the LLM sees each turn.

## 6. How agents communicate

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
