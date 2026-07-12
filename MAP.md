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
| web_search tool (SearXNG primary → DDG → Wikipedia; `news: true` lane) | `crates/runtime/src/tools/search.rs` |
| web_search news lane sources (Wikinews → GDELT) | `crates/runtime/src/tools/news.rs` |
| OKF knowledge bundle tools (ADR-024) | `crates/runtime/src/tools/knowledge.rs` |
| Loop management tools (spawn/check/wait/steer/cancel, ADR-022) | `crates/runtime/src/loops.rs` |
| Kanban card model + stage rules (ADR-026) | `crates/core/src/board.rs` |
| Board persistence over KvStore | `crates/runtime/src/state/board.rs` |
| Board tools (add/list/move/check) | `crates/runtime/src/tools/board.rs` |
| Board UI tab (5-column live view) | `crates/web/src/ui/board.rs` |
| Dashboard stage (wall display) | `crates/web/src/ui/dashboard.rs` |
| Cross-tab signal bus (BroadcastChannel mirror, ADR-031) | `crates/web/src/host/bus.rs` |
| Team config (folder team.md, ADR-032) | `crates/runtime/src/config/team.rs` |
| Team delegation boundary (TeamTool, principles injection) | `crates/runtime/src/delegate.rs` |
| Per-agent budgets (`budget.*` frontmatter) | `crates/runtime/src/config/agent.rs` |
| Board digest (director reorientation) | `crates/runtime/src/state/board.rs` |
| Live artifact blocks — latest-state refresh per call (ADR-033) | `crates/runtime/src/run/turn.rs` + `crates/core/src/element.rs` |
| spawn_agent — runtime sub-agent specialization (ADR-034) | `crates/runtime/src/tools/spawn.rs` + `AgentConfig::specialize` in `crates/runtime/src/config/agent.rs` |
| Skill discovery tools (skill_list/skill_read) | `crates/runtime/src/tools/skills.rs` |
| Stall guard — repeat-identical-mutating-call refusal | `crates/runtime/src/run/dispatch.rs` |
| Agents-folder config reference | `crates/web/assets/agents/README.md` |
| artifact_publish tool (html/markdown/url blobs) | `crates/runtime/src/tools/artifact.rs` |
| Artifact read side (blob docs → UI) | `crates/web/src/host/artifacts.rs` |
| Artifacts stage (gallery + sandboxed viewer) | `crates/web/src/ui/artifacts.rs` |
| Markdown subset renderer (chat + artifacts) | `crates/web/src/ui/markdown.rs` |
| MCP client (browser-direct, ADR-028) | `crates/runtime/src/tools/mcp.rs` |
| Memory tools (remember/recall/forget) | `crates/runtime/src/tools/memory_tools.rs` |
| Env presets (`env:` frontmatter, ADR-027) | `crates/runtime/src/config/env.rs` |
| Handoff + delegation seam (ADR-030) | `crates/runtime/src/delegate.rs` |
| Cancel token (races in-flight inference) | `crates/runtime/src/run/cancel.rs` |
| Local LLM provider (transformers.js, ADR-029) | `crates/web/src/host/local_llm.rs` + `scripts/llm/` |
| shell tool (exec over VM serial) | `crates/runtime/src/tools/shell.rs` |
| shell executor (browser serial bridge) | `crates/web/src/host/vm.rs` |
| Agents/skills/tools loader (baked + live fetch) | `crates/web/src/host/config.rs` |
| Custom JS tool wrapper (MCP card) | `crates/web/src/host/jstool.rs` |
| Agents + custom tools (served config) | `crates/web/assets/agents/` |
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
| Fast-lane JS eval (Worker sandbox, ADR-021) | `crates/web/assets/agents/js_eval.js` |
| Acceptance rows — v0 termination (ADR-020) | `bench/acceptance/ROWS.md` → `crates/runtime/tests/acceptance.rs` |
| ScriptedLlm fixtures | `crates/runtime/tests/fixtures/` (loader: `MockProvider::from_script`) |
| Bench status generator (writes STATUS.md) | `scripts/bench-status.sh` |
| What the LLM sees each turn (prompt assembly, code-cited) | `docs/PROMPT.md` |
| Docs | `docs/` (GOAL, ARCHITECTURE, GLOSSARY, MODELS, TESTING, ROADMAP, adr/ADRS) |
| Merge gate (fmt, clippy, wasm32 check, tests, bench) | `scripts/gate.sh` |
