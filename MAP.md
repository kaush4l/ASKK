# MAP

One run, hop by hop → where the code lives. Structure tests guard this table: every listed
path must exist once implemented (planned rows marked ⏳).

| # | Lifecycle hop | Location |
|---|---|---|
| 1 | Command submitted (SUBMIT/STEER/CANCEL/CONFIRM) | `crates/engine/src/run/` |
| 2 | Agent config loaded + validated | `crates/features/src/config/` |
| 3 | Sheet assembled from elements | `crates/engine/src/assemble.rs` |
| 4 | Sheet rendered → InferenceRequest | `crates/core/src/sheet.rs` |
| 5 | Provider infers (adapter maps request) | `crates/inference/src/<provider>.rs` |
| 6 | Reply parsed against contract | `crates/core/src/contract.rs` |
| 7 | Tool calls gated (allowlist) + dispatched | `crates/features/src/tools/` |
| 8 | Mutating calls → action gate → audit | `crates/engine/src/actions/` |
| 9 | Effects absorbed, signals emitted | `crates/core/src/sheet.rs` + `signal.rs` |
| 10 | Signals appended to log (single writer) | `crates/state/src/log.rs` |
| 11 | Phase routing (gate semantics) | `crates/core/src/phase.rs` |
| 12 | UI = fold(signals) → Dioxus surfaces | `crates/core/src/signal.rs` (fold) + `crates/frontend/src/` |

## Import rules (one-way, structure-tested)

```
core ← inference ← state ← features ← engine ← browser ← frontend
```

A DAG, not a chain — the true allowed-imports table:

| Crate | May import (workspace) |
|---|---|
| `askk-core` | nothing |
| `askk-inference` | core |
| `askk-state` | core |
| `askk-features` | core, state, inference |
| `askk-engine` | core, inference, state, features |
| `askk-browser` | core, inference, state, features, engine |
| `askk-frontend` | core, browser **only** |

- `core` imports no workspace crate. The wire: pure data + pure logic.
- `features` (config + tools) never imports the engine or browser; delegation
  (incl. `spawn`) lives in `askk-engine` under `run/delegation/`.
- Frontend UI components import **core + browser only** (projections, signals,
  commands through the `askk_browser` facade). Kiln rule: the app imports only
  the contracts.
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
| web_search tool (SearXNG primary → DDG → Wikipedia; `news: true` lane) | `crates/features/src/tools/search/engines.rs` |
| web_search news lane sources (Wikinews → GDELT) | `crates/features/src/tools/search/news.rs` |
| OKF knowledge bundle tools (ADR-024) | `crates/features/src/tools/knowledge/mod.rs` |
| Loop management tools (spawn/check/wait/steer/cancel, ADR-022) | `crates/engine/src/run/delegation/loops.rs` |
| Kanban card model + stage rules (ADR-026) | `crates/core/src/board.rs` |
| Board persistence over KvStore | `crates/state/src/board.rs` |
| Board tools (add/list/move/check) | `crates/features/src/tools/board/mod.rs` |
| Board UI tab (5-column live view) | `crates/frontend/src/ui/board.rs` |
| Dashboard stage (wall display) | `crates/frontend/src/ui/dashboard.rs` |
| Cross-tab signal bus (BroadcastChannel mirror, ADR-031) | `crates/browser/src/bus.rs` |
| Team config (folder team.md, ADR-032) | `crates/features/src/config/team.rs` |
| Team delegation boundary (TeamTool, principles injection) | `crates/engine/src/run/delegation/delegate.rs` |
| Per-agent budgets (`budget.*` frontmatter) | `crates/features/src/config/agent.rs` |
| Board digest (director reorientation) | `crates/state/src/board.rs` |
| Live artifact blocks — latest-state refresh per call (ADR-033) | `crates/engine/src/run/turn.rs` + `crates/core/src/element.rs` |
| spawn_agent — runtime sub-agent specialization (ADR-034) | `crates/engine/src/run/delegation/spawn.rs` + `AgentConfig::specialize` in `crates/features/src/config/agent.rs` |
| Skill discovery tools (skill_list/skill_read) | `crates/features/src/tools/skills.rs` |
| Stall guard — repeat-identical-mutating-call refusal | `crates/engine/src/run/dispatch.rs` |
| Agents-folder config reference | `crates/frontend/assets/agents/README.md` |
| artifact_publish tool (html/markdown/url blobs) | `crates/features/src/tools/artifacts/mod.rs` |
| Artifact read side (blob docs → UI) | `crates/browser/src/artifacts.rs` |
| Artifacts stage (gallery + sandboxed viewer) | `crates/frontend/src/ui/artifacts.rs` |
| Markdown subset renderer (chat + artifacts) | `crates/frontend/src/ui/markdown.rs` |
| MCP feature (config + client + registration, ADR-028/036) | `crates/features/src/tools/mcp/` |
| Memory tools (remember/recall/forget) | `crates/features/src/tools/memory/mod.rs` |
| Env presets (`env:` frontmatter, ADR-027) | `crates/features/src/config/env.rs` |
| Handoff + delegation seam (ADR-030) | `crates/engine/src/run/delegation/delegate.rs` |
| Cancel token (races in-flight inference) | `crates/engine/src/run/cancel.rs` |
| Local LLM provider (transformers.js, ADR-029) | `crates/browser/src/local_llm.rs` + `scripts/llm/` |
| shell tool (exec over VM serial) | `crates/features/src/tools/vm/shell.rs` |
| shell executor (browser serial bridge) | `crates/browser/src/vm.rs` |
| Agents/skills/tools loader (baked + live fetch) | `crates/browser/src/config.rs` |
| Custom JS tool wrapper (MCP card) | `crates/browser/src/jstool.rs` |
| Agents + custom tools (served config) | `crates/frontend/assets/agents/` |
| Agents-folder config bake (glob + manifest order) | `crates/browser/build.rs` |
| VM stage (container2wasm Alpine serial console) | `crates/frontend/src/ui/vm.rs` |
| VM bundle source (c2w + xterm-pty) | `scripts/vm-c2w/entry.js` + `build.mjs` |
| Speech seam (STT/TTS, HF model ids) | `crates/browser/src/speech.rs` |
| Speech engine bundles (source) | `scripts/speech/{stt,tts}-entry.js` + `build.sh` |
| Actions + policy | `crates/core/src/action.rs` |
| Signals + fold | `crates/core/src/signal.rs` |
| Statuses, budgets, snapshots | `crates/core/src/state.rs` |
| Phases + routing | `crates/core/src/phase.rs` |
| Transport seam | `crates/inference/src/transport.rs` |
| Provider adapters | `crates/inference/src/{openai_compat,anthropic,mock}.rs` |
| Provider registry | `crates/inference/src/registry.rs` |
| Fast-lane JS eval (Worker sandbox, ADR-021) | `crates/frontend/assets/agents/js_eval.js` |
| Acceptance rows — v0 termination (ADR-020) | `bench/acceptance/ROWS.md` → `crates/engine/tests/acceptance.rs` |
| ScriptedLlm fixtures | `crates/engine/tests/fixtures/` (loader: `MockProvider::from_script`) |
| Bench status generator (writes STATUS.md) | `scripts/bench-status.sh` |
| What the LLM sees each turn (prompt assembly, code-cited) | `docs/PROMPT.md` |
| Docs | `docs/` (GOAL, ARCHITECTURE, GLOSSARY, MODELS, TESTING, ROADMAP, adr/ADRS) |
| Merge gate (fmt, clippy, wasm32 check, tests, bench) | `scripts/gate.sh` |
