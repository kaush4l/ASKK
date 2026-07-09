# MAP

One run, hop by hop → where the code lives. Structure tests guard this table: every listed
path must exist once implemented (planned rows marked ⏳).

| # | Lifecycle hop | Location |
|---|---|---|
| 1 | Command submitted (SUBMIT/STEER/CANCEL/CONFIRM) | `crates/runtime/src/run/` |
| 2 | Agent config loaded + validated | `crates/runtime/src/config/` |
| 3 | Sheet assembled from elements | `crates/runtime/src/assemble.rs` |
| 4 | Sheet rendered → InferenceRequest | `crates/core/src/sheet.rs` |
| 5 | Provider infers (adapter maps request) | `crates/inference/src/<provider>.rs` |
| 6 | Reply parsed against contract | `crates/core/src/contract.rs` |
| 7 | Tool calls gated (allowlist) + dispatched | `crates/runtime/src/tools/` |
| 8 | Mutating calls → action gate → audit | `crates/runtime/src/actions/` |
| 9 | Effects absorbed, signals emitted | `crates/core/src/sheet.rs` + `signal.rs` |
| 10 | Signals appended to log (single writer) | `crates/runtime/src/state/log.rs` |
| 11 | Phase routing (gate semantics) | `crates/core/src/phase.rs` |
| 12 | UI = fold(signals) → Dioxus surfaces | `crates/core/src/signal.rs` (fold) + `crates/web/src/` |

## Import rules (one-way, structure-tested)

```
core ← inference ← runtime ← web
```

- `core` imports no workspace crate. The wire: pure data + pure logic.
- UI components in `web` import **core only** (projections, signals, commands); `runtime` is
  touched solely by the worker/bootstrap glue (`crates/web/src/host/`). Kiln rule: the app
  imports only the contracts.
- Config (`agents/`) is data; nothing hardcodes an agent.

## Files

| Concern | File |
|---|---|
| Elements & payloads | `crates/core/src/element.rs` |
| Sheet render/absorb | `crates/core/src/sheet.rs` |
| Wire request/reply | `crates/core/src/request.rs` |
| Provider trait + errors | `crates/core/src/provider.rs` |
| Contract + parse cascade | `crates/core/src/contract.rs` |
| Named contracts | `crates/core/src/contracts.rs` |
| TOON | `crates/core/src/toon.rs` |
| Tool trait + ToolSet | `crates/core/src/tool.rs` |
| web_search tool (DDG + Wikipedia) | `crates/runtime/src/tools/search.rs` |
| Agents-folder config bake (glob + manifest order) | `crates/web/build.rs` |
| VM stage (v86 serial console) | `crates/web/src/ui/vm.rs` |
| VM bundle source (v86 + xterm) | `scripts/vm/entry.js` + `build.mjs` |
| Speech seam (STT/TTS, HF model ids) | `crates/web/src/host/speech.rs` |
| Speech engine bundles (source) | `scripts/speech/{stt,tts}-entry.js` + `build.sh` |
| Actions + policy | `crates/core/src/action.rs` |
| Signals + fold | `crates/core/src/signal.rs` |
| Statuses, budgets, snapshots | `crates/core/src/state.rs` |
| Phases + routing | `crates/core/src/phase.rs` |
| Transport seam | `crates/inference/src/transport.rs` |
| Provider adapters | `crates/inference/src/{openai_compat,anthropic,mock}.rs` |
| Provider registry | `crates/inference/src/registry.rs` |
| Docs | `docs/` (GOAL, ARCHITECTURE, GLOSSARY, MODELS, TESTING, ROADMAP, adr/ADRS) |
| Merge gate | `scripts/gate.sh` |
