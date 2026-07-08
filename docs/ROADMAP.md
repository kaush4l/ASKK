# Roadmap & risks

## Implementation order

Waves group the spec's 10 phases by dependency; each wave lands with tests + green gate before
the next.

| Wave | Contents (spec phases) | Crate(s) |
|---|---|---|
| 1 | Core domain: Sheet, Element, Contract (+react/plan/critique), Tool trait/ToolSet, Action types, Signal + fold, state types (1) | core |
| 2 | Inference: Provider trait, InferenceRequest/Reply, mock provider, openai-compat + anthropic adapters over Transport seam (2) | core, inference |
| 3 | Sheet assembly from config: soul/agent.md/skills parsing, load-time validation, contract parsing loop + format negotiation (3, 4) | runtime |
| 4 | Tools & actions: registry, gate, audit; state stores (KV/blob traits, memory impls); run orchestration incl. phases + gate semantics; delegation (5, 6, 7) | runtime |
| 5 | Web: Dioxus surfaces (run view, signal timeline, agent picker, config, action confirmations), worker-hosted runs, OPFS stores, fetch transport, local provider stub (8) | web |
| 6 | Hardening: failure-mode tests, review pass, docs polish (9, 10) | all |

Each wave = one or more worktree sub-agents with this docs/ set as spec; integration =
squash-merge to main after the gate.

## Risk register

| # | Risk | Mitigation (designed-in) |
|---|---|---|
| 1 | Malformed LLM output | parse cascade + repair prompt + bounded retries + format negotiation |
| 2 | Missing contract fields | required-field check → ParseFailure → repair observation |
| 3 | Provider failure/timeout | typed ProviderError, retries w/ backoff, every wait has deadline+terminal |
| 4 | Provider drift | adapters are pure body builders w/ golden tests; fixtures catch drift |
| 5 | Tool failure | never throws into loop; observation w/ error; rejected results keep raw output |
| 6 | Unauthorized tool | ToolSet membership = allowlist; structured rejection observation |
| 7 | Invalid action | schema+policy validation before execution; denial is first-class |
| 8 | Failed state update | writes emit signals first; stores are transactional per write; replay recovers |
| 9 | Stale state | epoch fence synthesizes terminals for stale runs |
| 10 | Concurrent runs conflict | single log writer; per-run scratch; explicit state slices per tool |
| 11 | Multimodal mismatch | provider maps-or-drops with a signal; never silent |
| 12 | Schema version mismatch | contract.version checked at parse; unknown → typed error |
| 13 | Config error | load-time validation, hard error listing all problems; CI parses every agent.md |
| 14 | Partial workflow failure | gate phases: anything not verifier-passed = Unverified |
| 15 | UI/runtime mismatch | UI = fold(signals); unknown signal kinds skipped (forward-compat) |
| 16 | Silent data corruption | append-only log, size-verified writes, replay-from-0 audit |
| 17 | Module coupling creep | cargo dep graph + structure tests enforce boundaries |
| 18 | God files | ~500-line cap, test-enforced |
| 19 | Docs outrun code | structure test: doc-listed modules must exist; planned-vs-built labels |
| 20 | Prompt injection via tool results | untrusted-data boundary in soul; tool output framed as observation, never system text |

## Deferred (explicitly out of scope now)

- Rust/Java exec substrates, container2wasm heavy tier
- multi-worker inference pooling
- native mobile shells
- server deployment
