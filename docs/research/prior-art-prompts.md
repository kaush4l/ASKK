# R4 — Prior-art prompt sectioning: ElizaOS, OpenClaw, Hermes, Ada-SI, ASKK

G0 research unit for `docs/PROMPT.md` §4, §8, §18 ("how each sections their prompts — a concrete
comparison table, not impressions — and what each does at budget exhaustion").

All claims below are from source read on **2026-07-29** unless marked otherwise. Sources:

- **ElizaOS** — `github.com/elizaOS/eliza`: `packages/core/src/prompts.ts` (re-exports
  `@elizaos/prompts`), `packages/prompts/src/index.ts`; `docs.elizaos.ai/agents/memory-and-state`.
- **OpenClaw** — `github.com/openclaw/openclaw`: `src/agents/system-prompt.ts`
  (`buildAgentSystemPrompt`, `sortContextFilesForPrompt`); `docs.openclaw.ai/concepts/compaction`,
  `docs.openclaw.ai/concepts/agent-workspace`, `docs.openclaw.ai/plugins/tool-plugins`.
- **Hermes** — `github.com/NousResearch/hermes-agent`: `agent/prompt_builder.py`
  (`AIAgent._build_system_prompt`), `agent/context_compressor.py`, `tools/` (80+ tool modules).
- **Ada-SI** — `github.com/nazirlouis/Ada-SI` (**public**, contrary to the "if private" contingency
  in my brief): README, `chat/scout_persona.py` (`build_scout_system_instruction`),
  `chat/prompts_config.py`, `chat/build_pipeline.py`.
- **ASKK (this repo's predecessor)** — `git show pre-rewrite-rust:crates/engine/src/assemble.rs`
  and `pre-rewrite-rust:docs/MODELS.md`.

Note on names: "Hermes" here is NousResearch's `hermes-agent` (the OpenClaw sibling/successor —
it ships `hermes claw migrate` for OpenClaw workspaces), not the guest binary ASKK bakes into its
c2w image.

---

## 1. Comparison table

| | Named sections & order | Static vs dynamic split | Tool/affordance injection | Budget exhaustion | Multimodal |
|---|---|---|---|---|---|
| **ElizaOS** | Not a section list — a set of **XML-tagged templates** (`messageHandlerTemplate`, `shouldRespondTemplate`, `plannerTemplate`, fact/memory-extraction templates) with tags like `<task>`, `available_contexts`, rules, `return`. Runtime `composeState()` fills `{{providers}}`, `{{agentName}}`, `{{recentMessages}}`, `{{availableContexts}}` by concatenating provider outputs into the template's middle. Character file (bio/style/knowledge) is one provider among many. | None. The template skeleton is static but `{{providers}}` interpolates all dynamic state **mid-document**; no ordering rule by volatility, no cache-prefix concept. | Actions/providers/evaluators are plugin-registered; action names and provider text are interpolated into the template; v2 `plannerTemplate` targets native tool calls and explicitly warns against claiming "saved/sent/scheduled" without tool proof. | **No document-level policy.** Fixed-count history (`conversationLength = 32` default), memory pruning to a ~4000-token budget (docs), and per-template caps inside summarization prompts ("keep summary under 2500 tokens"). Nothing declares priority or degradation order — exhaustion behavior is whatever the provider happens to truncate. | Not handled at the template layer; templates are pure text. |
| **OpenClaw** | `buildAgentSystemPrompt` concatenates, in order: model identity → **provider stable prefix** → `## Authorized Senders` → `## Current Date & Time` → **Project Context files** under `## <filepath>` headings, sorted by fixed priority (`agents.md` 10, `soul.md` 20, `identity.md` 30, `user.md` 40, `tools.md` 50, `bootstrap.md` 60, `memory.md` 70) → bootstrap context → tool listing with summaries → `## Skills` (`<available_skills>`) → heartbeat, memory, docs refs → `## Messaging`, `## Assistant Output Directives` → `## Execution Bias` → **provider dynamic suffix**. | **Explicit and engineered**: stable-prefix / dynamic-suffix override points exist per provider, plus a 64-entry hash-keyed cache of built prompt strings. But `## Current Date & Time` sits near the top, inside the would-be-stable region. `promptMode: full \| minimal \| none` shrinks the set for subagents. | Tools listed in a defined order (read, write, edit, exec, …), each with a summary; skills advertised via `<available_skills>` with "read exact `<location>`" instructions; tool result envelope is `AgentToolResult { content, details }` (docs), CLI `--json` envelope uses `ok`/`status`/`error{message,kind}`. | **Richest policy of the five.** Auto-compaction triggers on provider overflow errors (`request_too_large`, "context length exceeded") → compact and retry. Before compacting, the agent is **reminded to flush notes to memory files**. Older turns are summarized into the session record; recent messages untouched; tool calls kept paired with their `toolResult`. Manual `/compact [guidance]`; `keepRecentTokens` default 20 000. Lighter alternative: session **pruning** (trim tool output, no summarizing, in-memory only). | Not evidenced in the prompt-assembly source read; treated at the provider-message layer. |
| **Hermes** | `AIAgent._build_system_prompt` assembles ~18 ordered blocks: agent identity (`SOUL.md` or `DEFAULT_AGENT_IDENTITY`) → platform hints (per channel) → environment hints (OS, cwd, backend) → help guidance → memory guidance → session-search guidance → **skills index** (categorized, cached) → subscription status → **per-model steering blocks** (GPT/Gemini/Grok tool-use enforcement, execution discipline) → task-completion + parallel-tool-call guidance → computer-use guidance → out-of-band steering marker → **context files** (`.hermes.md` > `AGENTS.md` > `CLAUDE.md` > `.cursorrules`, first type found wins) → kanban protocol (conditional) → tools schema. | **Deliberate**: guidance blocks are kept short *because* they live in the cached prefix ("cost is amortised across all sessions"); skills index has a two-layer cache (8-entry LRU + disk snapshot keyed by mtime/size); dynamic material (env probes, memory, context files) comes later. | Native tool schemas (80+ tools in `tools/`), plus a skills index that tells the model to lazily `skill_view` full definitions — affordance-summary-first, detail-on-demand. No single common result envelope found in `tools/__init__.py`; per-tool shapes. | **Most engineered degradation.** `context_compressor.py`: trigger at 50% of context (75% floor for models < 512K). Phase 1: proactive pruning of completed tool results into one-line summaries (`"[terminal] ran npm test -> exit 0, 47 lines output"`). Phase 2: protect head (system + first 3 messages) and tail (last 20 messages or tail token budget). Phase 3: auxiliary-LLM summarization of the middle window, summary capped at `min(5% of context, 10 000)` tokens, ended with an explicit marker ("END OF CONTEXT SUMMARY — respond to the message below, not the summary above"). Pruned-skill markers re-injected so the model knows to reload. | Images exist in history but are the **first casualty**: compression replaces them with `"[screenshot removed to save context]"`. |
| **Ada-SI** | `build_scout_system_instruction` (`chat/scout_persona.py`) concatenates with `\n\n`: `SCOUT_ROUTING` stub (dispatch rules) → `AGENTS.md` → `TOOLS.md` → `SOUL.md` → `IDENTITY.md` → `USER.md` → `MEMORY.md` → recent daily-log tail → persona-tool editing rules → soul-rewrite guide → memory-tool guidance → `BOOTSTRAP.md` (optional) → TTS (conditional). Forge master has a separate prompt (`chat/prompts_config.py`, runtime-overridable via `staging/prompts_config.json`). | None stated. Persona files are re-read and re-concatenated; the daily-log tail (dynamic) sits mid-document between static persona and static guidance. | Routing is **prompt prose**: five numbered rules naming dispatch tools (`generate_new_tool`, `propose_tool_batch`, `open_skill_app`, `edit_existing_tool`); forged skills surface via `chat/tools_engine.py`; `TOOLS.md` is a hand-maintained notes file, not generated. | **Crude caps, no summarization.** `MEMORY.md` injected only up to `MEMORY_INJECT_MAX_CHARS` = 12 000 chars, keeping the **last** 12K with a note "[... earlier MEMORY.md truncated for context limit ...]"; persona files capped at 128 KB; log tail 24 000 bytes, lines 8 000 chars. No priority, no degradation ladder, no compaction of chat history found. | None in prompt assembly (the 3D avatar is UI, not model input). |
| **ASKK (predecessor)** | Fixed closed-enum order in `assemble()` (`crates/engine/src/assemble.rs`, golden-tested): `Identity` (soul + name + role) → `Directive` → `Clock` (unix ms) → `Skills` → `ToolManifest` → `Contract` → `StateSnapshot` → `Memory` → `History` → `UserInput` → `Multimodal` (only when parts exist) → `InferenceConfig` → `ActionPolicy` → `OutputMode` → `PhaseFrame` (opt). Pure function, no I/O, per-turn overrides applied **at** assembly (no post-assembly patching). | Order is fixed but **not volatility-sorted**: `Clock` is the third element, so the cacheable prefix dies two sections in, every turn. No stability classes. | `ToolManifest` = typed `ToolSpec { name, description, input_schema (JSON Schema), effect: Pure\|Mutating }`; what the model is **shown** is declared ⊆ the dispatch allowlist; `Contract` carries the response schema; providers "consume sections; they never re-template". | **No token-budget policy at assembly — absence is the finding.** `budget.*` in agent frontmatter is run budgets (`max_turns`, `deadline_s`, delegation `depth`), not tokens. History compaction lived elsewhere and ad hoc (seg-archives, scaffold-stripped fallbacks), not in `assemble`. | First-class: `Multimodal(Vec<Part>)` element; "provider maps or drops with a signal" — the drop is *reported*, not silent. |

---

## 2. Ada-SI forge pipeline, reduced to the browser

Ada-SI's actual pipeline (`chat/build_pipeline.py`): `generate_code → validate_code → sandbox_test
→ validate_ui → contract_test → preview_review → ui_preview (gate) → pip_review (gate) →
runtime_verify → install_tool`, fronted by propose/plan-approval in chat. What each phase becomes
when there is no venv, no pip, no OS process — modules are data in browser storage executed by a
sandboxed interpreter (PROMPT §7):

| Ada-SI phase | Browser edition | Verdict |
|---|---|---|
| propose | A conversation turn producing a manifest draft | **Survives** (it's intent, not machinery) |
| plan approval | Same human gate, rendered as a fragment | **Survives** |
| generate_code | One model call emitting script + view template + declared tests + manifest | **Survives**, smaller (no Python scaffolding, no imports to guess) |
| validate_code (inspect module structure) | Interpreter compile/AST check in-core | **Collapses to trivial** — synchronous, milliseconds |
| sandbox_test (trial in a test venv) | Dry run with **all capabilities denied** | **Collapses — and improves.** The venv≠prod gap that makes Ada-SI's trial unreliable disappears: dry-run and production are the *same* interpreter, differing only in grants |
| validate_ui (app UI schema) | Render the fragment; check it is well-formed HTML | **Collapses to trivial** |
| contract_test | Declared cases run against `handle(request, ctx)` — pure, native-testable | **Survives nearly unchanged**; gets faster and deterministic |
| preview_review / ui_preview | Sandboxed-iframe preview; human gate | **Survives** (the gate is the value, not the plumbing) |
| pip_review | **Vanishes.** No packages exist. Its *seat* is taken by **capability review** — what host calls the module asks for, and why — which is the real security gate in the browser edition (§4.1) | **Vanishes / replaced** |
| runtime_verify | Call the module's route once through the registry | **Collapses to trivial** |
| install_tool | A storage write + registry insert; uninstall = delete; rollback = keep every version | **Collapses to trivial and becomes total** — Ada-SI's README admits its uninstall/containment is not a boundary; ours is deletion of data |

Net: **every human gate survives; almost all machinery collapses.** The only phase that truly
vanishes is dependency review, and its slot is where capability review belongs. The pipeline stops
being a build system and becomes a *ceremony over data* — which is why it can itself be a module.

---

## 3. Steal vs reject, per system

- **ElizaOS** — steal *agents-as-data* (character defs) and the planner's "no success claims
  without tool proof" rule; **reject** template-with-holes assembly — `{{providers}}` interpolated
  mid-document is exactly the "paper becomes a string" failure §19 warns about, and it forfeits
  caching by construction.
- **OpenClaw** — steal the **fixed-priority file ordering** (a hardcoded sort *is* a stability
  declaration), `promptMode` minimal-for-subagents (= phase-scoped section sets, §9), and the
  **memory-flush-before-compaction** move; **reject** compaction-as-error-recovery — reacting to
  provider overflow strings means the budget is discovered, not owned (§8.5 assembles *against* a
  budget instead).
- **Hermes** — steal the three-phase degradation ladder (prune tool results → protect head/tail →
  summarize middle), the explicit end-of-summary marker (its "the agent is told what was
  compacted", §8.5), and skills-index-summary-with-lazy-detail (= generated affordances, §6);
  **reject** per-model steering blocks in the prompt body — that is `render`'s job (§8.1), not a
  section's.
- **Ada-SI** — steal the persona file *set* (maps ~1:1 onto §8.2's section table) and the gated
  pipeline shape (§2 above); **reject** keep-last-12K-chars truncation (silent, arbitrary, and the
  model is only told via an inline note) and prompt-prose tool routing that drifts from the real
  tool registry.
- **ASKK** — steal the pure golden-tested `assemble` with a closed element enum and
  shown-⊆-allowed tool manifests; **reject** the fixed order *as ordered*: `Clock` at position 3
  busts the cache prefix every turn, and the absence of any token-budget policy in assembly is the
  gap §8.5 exists to fill.

---

## 4. Findings

**true**
- None of the five has §8's full model (declared `intent` + stability class + priority + declared
  compaction per section). Closest partials: OpenClaw (stable-prefix concept + numeric file
  priority), Hermes (degradation ladder), ASKK (pure ordered assembly). HARNESS's §8 is a synthesis,
  not a copy — each piece has prior art, the combination does not.
- Budget exhaustion is a maturity spectrum: Ada-SI truncates by chars, ElizaOS caps counts,
  OpenClaw compacts reactively on provider errors, Hermes degrades proactively at 50% with
  protected regions. Only Hermes and OpenClaw *tell the model* what was removed — validating
  §8.5's "degradation is recorded" as the discriminating feature.
- The persona-file convention (SOUL/IDENTITY/USER/AGENTS/TOOLS/MEMORY/BOOTSTRAP) is now a shared
  lineage across OpenClaw → Hermes → Ada-SI, with OpenClaw's sort order making the sequence
  explicit. §8.2's starting section set is this lineage plus `affordances`/`response_contract`.
- Everyone violates stable-first somewhere: OpenClaw puts date/time near the top; ASKK puts
  `Clock` third; Ada-SI wedges a daily-log tail mid-document; ElizaOS interpolates everything
  mid-template. §8.3's cache argument is real and *nobody in this cohort fully cashes it*.
- Ada-SI's sandbox gap (venv trial ≠ prod runtime; README is candid that gates are not a security
  boundary) structurally disappears in the browser edition — dry-run and production share the
  interpreter, differing only in capability grants (§4.1 confirmed from primary source).

**uncertain**
- The `{ success, data }` tool envelope PROMPT §4 attributes to Hermes/OpenClaw was **not found
  verbatim**: OpenClaw's documented envelope is `AgentToolResult { content, details }` (CLI JSON
  uses `ok`/`status`/`error`), and Hermes has no single base envelope in `tools/__init__.py` —
  per-tool shapes. Treat §4's row as a paraphrase of "disciplined structured results", not a
  schema to copy; pick HARNESS's envelope in its own ADR.
- ElizaOS provider *ordering* semantics (position numbers) not confirmed from source in this pass —
  docs only show `providers` as an unordered record; the ~4000-token memory budget figure is from
  docs, not code.
- Hermes/OpenClaw section descriptions come from one pass over large files via fetch summaries;
  heading strings are faithful but sub-ordering within blocks may be approximate.

**constrains**
- Reactive compaction (OpenClaw) and mid-stream compression (Hermes) both *mutate history between
  turns* — incompatible with I7/I14 determinism unless compaction is itself a pure, recorded
  assembly decision. HARNESS must compact **inside** `assemble(state, phase, budget)`, never as a
  side effect of a provider error.
- Hermes's per-model steering blocks show real pressure to specialize prompts per provider; HARNESS
  has committed that this lives in `render`, not in sections (§8.1). Expect this pressure; resist
  it in the document.
- Multimodal is marginal across all four externals (text-only templates, or images dropped first
  under pressure). ASKK's part-model with signaled drops is the strongest prior; §8.6's
  design-for-parts-from-day-one gets no free ride from this cohort.

---

## 5. Summary for RESEARCH.md

- R4 (prior-art prompts): compared ElizaOS / OpenClaw / Hermes / Ada-SI / ASKK from source;
  full table in `docs/research/prior-art-prompts.md`.
- No system has §8's declared-section model; closest are OpenClaw (numeric file priority,
  stable-prefix cache) and Hermes (3-phase degradation: prune tool results → protect head/tail →
  LLM-summarize middle at 50% of context, with an explicit summary marker).
- Budget exhaustion spectrum: Ada-SI keep-last-12K-chars, ElizaOS fixed counts, OpenClaw
  compact-on-provider-overflow (+memory-flush reminder, `/compact`, keepRecentTokens 20K),
  Hermes proactive; only OpenClaw/Hermes tell the model what was cut — adopt that.
- Every system violates stable-first somewhere (OpenClaw's date/time early, ASKK's `Clock` third);
  §8.3 is validated but must be enforced, not assumed. The `{success,data}` envelope of §4 is a
  paraphrase (real: `AgentToolResult{content,details}`) — settle HARNESS's envelope by ADR.
- Ada-SI is public (`nazirlouis/Ada-SI`); its forge pipeline reduces in-browser to: human gates
  survive verbatim, venv/pip/runtime-verify machinery collapses to interpreter checks and storage
  writes, and pip_review's seat becomes capability review.
