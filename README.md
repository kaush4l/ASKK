# ASKK

A configuration-driven, browser-first AI harness. The execution model is a **sheet of paper**:
every agent invocation is an LLM call over a typed, serializable working surface — identity,
directive, tools, state, memory, contract, inference config, action policy — and nothing else.
Agents are markdown files, not code.

```
crates/core        the domain: Sheet, Element, Contract, Tool, Action, Signal, fold, phases
crates/inference   provider adapters (openai-compat, anthropic, mock) over a Transport seam
crates/runtime     the harness: config, assembly, run loop, tool registry, action gate, stores
crates/web         Dioxus shell: OPFS stores, fetch transport, UI surfaces
agents/            configuration: soul.md, <agent>.md, skills/
docs/              GOAL, ARCHITECTURE, GLOSSARY, MODELS, TESTING, ROADMAP, GAPS, adr/ADRS
```

Start with [MAP.md](MAP.md) — the run lifecycle mapped to files, guarded by structure tests.

## Quick start

```sh
./scripts/gate.sh          # fmt + clippy -D warnings + 196 tests — the merge gate
cargo run -p askk-web      # host smoke: scripted run, folded timeline, SMOKE GREEN
dx serve -p askk-web       # the real thing in a browser (dioxus-cli 0.7)
```

Point the settings drawer at any OpenAI-compatible endpoint (or Anthropic) with your own key;
keys persist locally in OPFS, never leave the browser except to your chosen endpoint.

## How to extend (each is one seam)

| Add a… | Do this |
|---|---|
| agent | drop `agents/<name>.md` (frontmatter + role body); CI validates it |
| tool | register one `dyn Tool` in `runtime/src/tools/` (spec + effect + call) |
| provider | one adapter file in `crates/inference/` (build body, parse reply) |
| contract | one field list in `core/src/contracts.rs` |
| workflow | `phase.N.*` keys in the agent file (gate phase = verifier) |
| state store | implement `KvStore`/`BlobStore` |
| UI surface | fold the signal log; commands via the facade |

## Invariants (the short list)

- Signal log is the sole run-state truth; UI = fold(signals); replay from 0 reproduces state.
- Providers map a rendered `InferenceRequest`; they never compose prompts.
- ToolSet membership is the allowlist; mutating calls pass the action gate and are audited.
- Only a gate (verifier) phase can end a run as success — everything else is `Unverified`.
- Every wait has an owner and a terminal.
- Tool output is untrusted data, framed as observation, never instructions.

Decisions live in [docs/adr/ADRS.md](docs/adr/ADRS.md); known accepted deviations in
[docs/GAPS.md](docs/GAPS.md).
