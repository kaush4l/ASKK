# Architecture

## Overview

Four Cargo crates, one-way dependency edges, enforced by the workspace graph:

```
askk-core  ←  askk-inference  ←─┐
   ↑                            │
   └────────  askk-runtime  ←── askk-web
```

- **`crates/core`** — the domain. Sheet, Element, Contract, Tool trait, Action, Signal, State
  categories, the pure turn loop. No I/O, no wasm, no HTTP, no UI. Everything here is unit-testable
  on the host with mocks.
- **`crates/inference`** — provider adapters. The `Provider` trait lives in core (it is domain);
  adapters here build wire bodies and parse responses as **pure functions** over an injected
  `Transport` (HTTP/SSE seam). OpenAI-compatible, Anthropic, Mock. Local (transformers.js) implements
  the same trait in `web` because it needs JS interop.
- **`crates/runtime`** — the harness. Config loading (soul.md / agent.md / skills), sheet assembly,
  run orchestration, tool registry + dispatch, action gate + audit, signal log, state stores behind
  traits (memory impl here; OPFS impl in web).
- **`crates/web`** — Dioxus web app. UI surfaces (fold over signal log), web workers hosting runs,
  OPFS persistence, fetch/SSE transport, local model provider, vendored JS where a widget is heavy.

`agents/` (repo root) holds configuration: `soul.md`, `<name>.md` agent files, `skills/`. Not code.

## Dependency rules

1. `core` imports nothing from this workspace. Std + serde-level deps only.
2. `inference` imports `core` only. No UI, no storage.
3. `runtime` imports `core` and `inference`. No Dioxus, no web-sys.
4. `web` imports all three. Only `web` may touch the DOM, OPFS, fetch, workers, JS.
5. Configuration (`agents/`) is data. Code never hardcodes an agent.
6. Providers **map** a rendered `InferenceRequest`; they never compose prompt text.
7. UI reads projections (folds of signals); it never mutates run state directly — commands go
   through the harness.
8. Max ~500 lines per file, test-enforced. A file that outgrows it is two concepts.

## Execution lifecycle (one run)

```
command SUBMIT(agent_id, input)
  → runtime loads AgentConfig (validated at load; unknown refs = hard error)
  → Sheet assembled: [Identity, Directive, Skills, ToolManifest, Contract,
                      StateSnapshot, Memory, UserInput, Multimodal?, InferenceConfig,
                      ActionPolicy, OutputMode, PhaseFrame?]
  → loop (per phase; per turn):
      1. deadline/budget/interrupt check        (every wait has an owner + terminal)
      2. sheet.render() → InferenceRequest      (pure; providers map it)
      3. provider.infer(request)                (retries w/ backoff; injected sleeper)
      4. contract.parse(raw)                    (native structured output → JSON → TOON → repair)
      5. absorb: elements accept the parsed effect (history, state deltas, artifacts)
      6. tool calls?  → ToolSet gate (membership = allowlist)
                      → effectful tools route through the Action gate
                        (validate → policy: auto | confirm | deny → execute → audit)
                      → observations appended; loop
      7. answer?      → phase routing (gate phase verdict; Back(i) ≤ MAX_BACK_EDGES)
  → terminal: Answered | Unverified | BudgetExhausted | Interrupted | Error
  every step emits Signal{seq, run_id, kind} → JSONL log (append-only, single writer)
  UI = fold(signals) ∪ transient deltas
```

Key invariants (inherited, hard-won):

- **One writer** to the signal log; commit = flushed bytes; replay from 0 reproduces state.
- **Gate phases**: only the verifier phase's pass ends a run as success; anything else that stops
  is `Unverified`. No false success.
- **Tool execution never throws** into the loop; failures become observations the model can act on.
  Rejected results still record raw output + feedback (anti-loop).
- **Authority narrows**: a sub-agent's toolset = parent ∩ own. Delegation is one seam
  (agent-as-tool), depth-capped.
- **Final-step nudge**: on the last budgeted turn the sheet injects "answer now".

## Where things live (navigation)

| Question | Answer |
|---|---|
| Where is an agent defined? | `agents/<name>.md` (frontmatter + body); parsing in `runtime/src/config/` |
| Where is a provider added? | `crates/inference/src/<name>.rs` (one adapter file) |
| Where is a tool registered? | `crates/runtime/src/tools/` (one module per tool, registered in `registry.rs`) |
| Where is a contract defined? | `crates/core/src/contract.rs` (+ named contracts in `contracts.rs`) |
| Where is state read/written? | `crates/core/src/state.rs` (types) + `crates/runtime/src/state/` (stores) |
| Where are actions validated? | `crates/runtime/src/actions/gate.rs` |
| Where is execution orchestrated? | `crates/runtime/src/run.rs` |
| Where are tests? | Inline `#[cfg(test)]` per module + `crates/runtime/tests/` workflows |
| Where is UI connected? | `crates/web/src/` (projections + command channel) |
| Where are decisions documented? | `docs/adr/ADRS.md` |
