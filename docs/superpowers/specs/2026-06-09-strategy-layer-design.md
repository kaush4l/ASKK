# Strategy layer + unified object model — design spec

**Date:** 2026-06-09
**Status:** Approved design, pending implementation plan
**Scope:** First of a sequence of sub-projects. Later specs (not covered here):
multimodal inference, terax-style workspace UI with CodeMirror, data-driven
custom strategies, semantic long-term memory.

## Context

askk already ships the LocalAgents-style object model translated to Rust:
`AgentLoop` (init → run → step, three-phase turn) in `src/engine/mod.rs`,
`InferenceProvider` + id-keyed registry in `src/inference/`, `StructuredResponse`
+ `FormatNegotiator` (TOON→JSON) in `src/responses/`, `ToolRegistry` descriptors
in `src/tools/`, and `call_agent` (agent-as-a-tool) with a recursion guard.

This spec adds the genuinely new layer: **strategies** — phase sequences that
define the shape of a loop above the base turn — plus per-object memory with
compaction, a declarative macro for response types, and the replacement of the
bespoke `Orchestrator` machinery with an orchestrator *agent*.

Per `EXECUTION_MODEL.md`, the loop remains a ReAct harness, intentionally not a
typed FSM; this spec follows that execution model, not the parent CLAUDE.md
invariant 1 (documented divergence).

## Goals

1. A `Strategy` abstraction: an ordered sequence of `Phase`s with routing,
   running above the unchanged base turn (construct prompt → call LLM → parse →
   act).
2. Built-in strategies: `react`, `plan-act-review`, `skills-work-critique`,
   `orchestrate` — code-defined, registered in a `StrategyRegistry`,
   data-selected per agent.
3. Strategy as a first-class parameter at every loop construction site: the
   top-level entry, the worker dispatch, and `call_agent` handoffs.
4. The orchestrator becomes a normal agent running the `orchestrate` strategy;
   `src/orchestrator.rs` is deleted after parity.
5. Per-object memory: working memory owned by each `AgentLoop`, compaction at
   100 messages or a context-length check, and a persisted rolling summary per
   agent identity injected on the next invocation.
6. `define_response!` declarative macro so new response types declare only
   fields + descriptions; parsing, format instructions (JSON/TOON), and
   negotiation come from the base trait.
7. One documented extension skeleton across responses, strategies, tools, and
   inference: descriptor + trait + id-keyed registry + one-line registration.

## Non-goals

- No multimodal payloads, no new providers.
- No UI overhaul beyond: strategy picker on the Agents page, phase status in
  chat, phase events in the event log.
- No user-authored (data-driven) strategies yet. Strategies are code; selection
  is data.
- No semantic/vector memory. Rolling summary is plain text.

## Architecture

### Phase

```rust
pub struct Phase {
    pub name: &'static str,            // "plan", "act", "review", ...
    pub response_kind: ResponseKind,   // which schema this phase parses into
    pub prompt_frame: &'static str,    // phase framing prepended to the goal
    pub tool_policy: ToolPolicy,       // NoTools | Inherit | Subset(&'static [&'static str])
    pub loop_mode: LoopMode,           // OneShot | Loop { max_turns: u32 }
}
```

- `OneShot`: one base turn; the parsed response is the phase outcome.
- `Loop { max_turns }`: repeat base turns until the response's action says
  answer/done or the budget is exhausted (current ReAct behavior).
- `ToolPolicy::NoTools` phases (plan, review, summarize) skip tool dispatch
  entirely; the response is pure structured output.
- `prompt_frame` is injected into the rendered prompt's dynamic section,
  together with artifacts from earlier phases (see StrategyContext). The
  compiled static prompt body is unchanged.

### Strategy

```rust
pub enum Routing { Next, Back(usize), Done }

pub struct PhaseOutcome {
    pub phase: &'static str,
    pub response: ParsedResponse,   // enum over the built-in response types
    pub turns_used: u32,
}

pub trait Strategy {
    fn id(&self) -> &'static str;
    fn description(&self) -> &'static str;
    fn phases(&self) -> &[Phase];
    fn route(&self, from: usize, outcome: &PhaseOutcome) -> Routing;
}
```

- `AgentLoop::run` iterates phases: run phase → collect `PhaseOutcome` → ask
  `route` → `Next` / `Back(i)` / `Done`.
- **Back-edge budget:** at most 2 `Back` routings per strategy run (global
  counter). On exhaustion the loop finishes with the best answer so far and the
  final event flags it as budget-exhausted. This bounds critique cycles.
- **Working memory spans phases** within one invocation: later phases see the
  full message history of earlier ones. Additionally each completed phase
  stores a named artifact in `StrategyContext` (e.g. the plan text, the
  critique feedback), and subsequent phases get those artifacts injected into
  their prompt frame explicitly. History gives continuity; artifacts give
  salience.

### StrategyContext

```rust
pub struct StrategyContext {
    pub artifacts: Vec<(String, String)>, // (phase name, distilled outcome)
    pub back_edges_used: u32,
}
```

Artifacts are distilled from `PhaseOutcome` by the strategy (e.g. the
`plan-act-review` strategy stores `PlanResponse.plan` joined as the "plan"
artifact, and `CritiqueResponse.feedback` as the "feedback" artifact when
routing back).

### Built-in strategies

| id | phases | routing |
|---|---|---|
| `react` | act: ReAct, `Loop { max_turns }`, Inherit tools | always `Done` after act |
| `plan-act-review` | plan: `PlanResponse`, OneShot, NoTools → act: ReAct loop, Inherit → review: `CritiqueResponse`, OneShot, NoTools | review verdict `revise` → `Back(act)` with feedback artifact (≤2), else `Done` |
| `skills-work-critique` | skills: `SkillSelectionResponse`, OneShot, NoTools (full skill library listed in frame; output selects relevant ones) → work: ReAct loop, Inherit, selected skills injected → critique: `CritiqueResponse`, OneShot, NoTools | same back-edge rule as review |
| `orchestrate` | decompose: `TaskBreakdownResponse`, OneShot, NoTools → delegate: ReAct loop, `Subset(["call_agent", "file_read", "file_write", "file_list"])` → synthesize: `ReActResponse` with the prompt frame demanding `action: answer`, OneShot, NoTools | always forward; `Done` after synthesize |

`react` must reproduce current `AgentLoop` behavior exactly — it is the parity
baseline and the default for every existing agent.

### StrategyRegistry and selection

- `StrategyRegistry` mirrors the inference registry: built-ins registered at
  startup, looked up by id, one line per strategy. Strategies are stateless
  (`&'static dyn Strategy`).
- `Agent` config gains `strategy_id: Option<String>`; the Agents page gains a
  picker listing registry ids + descriptions.
- **Resolution order (one function, used everywhere):** explicit
  `LoopParams.strategy` → agent's `strategy_id` → `"react"`.
- Unknown strategy id at resolution time inside `call_agent` is a normal tool
  error fed back as an observation (the model can correct). Unknown id at the
  top-level entry surfaces as a user-visible run error before any turn.

### LoopParams — strategy in the handoff

```rust
pub struct LoopParams {
    pub agent_id: Option<String>,
    pub goal: String,
    pub strategy: Option<String>,
    pub max_turns: Option<u32>,
}
```

- `AgentLoop::new(snapshot, params, …)` replaces the current ad-hoc argument
  list. The chat entry point, `ReActEngine::run_goal_with_observer`, the worker
  dispatch protocol (`WorkerDispatch` gains the optional fields), and
  `call_agent` all build the same struct.
- `call_agent` tool schema gains optional `strategy: string` and
  `max_turns: integer` arguments. The orchestrator delegating work passes
  `(agent, query, strategy)` per call — strategy travels with the work.
- Overrides apply to the invocation they are attached to. If a sub-agent
  delegates further, it passes a strategy in its own `call_agent` calls.
  No implicit deep inheritance; explicit at every hop.
- The authoritative (task, agent, strategy) assignment lives in `call_agent`
  arguments (already JSON), not in `TaskBreakdownResponse` — the decompose
  output stays a flat plan, structure lives where JSON parsing already works.

### Orchestrator as an agent

- A bundled "orchestrator" agent manifest (Markdown + frontmatter, like
  existing agents) with `strategy_id: "orchestrate"` and a tool allowlist of
  `call_agent` + VFS file tools for notes.
- Parallel fan-out reuses the existing parallel tool-call dispatch: the model
  emitting N `call_agent` calls in one delegate turn runs them concurrently via
  `join_all` — this replaces wave scheduling.
- The `call_agent` recursion-depth guard and the untrusted-output boundary
  (sub-agent results are observations, never instructions) are unchanged.
- `WorkflowGate` re-targets from `OrchestrationPhase` to phase-boundary events:
  gates match phase names. Approval gating semantics are otherwise unchanged.
- `src/orchestrator.rs` is deleted only after `orchestrate` reaches parity for
  the UI paths that currently use it; the UI "run with orchestrator" path
  becomes "run the orchestrator agent".

### Memory

Owned per `AgentLoop`; nothing global.

```rust
pub struct MemoryPolicy {
    pub compact_after_messages: usize, // default 100
    pub context_fraction: f32,         // default 0.7
    pub keep_recent: usize,            // default 10
}
```

- **Working memory** is the per-invocation message list (today's
  `run.messages`). Fresh per call; spans phases within the call; dies when the
  call returns.
- **Compaction trigger**, checked each turn before prompt construction: message
  count ≥ `compact_after_messages`, OR estimated tokens (total chars ÷ 4) >
  `context_fraction × provider context_window`. Whichever fires first.
- **Compaction mechanism:** an internal OneShot summary phase (same phase
  machinery, `SummaryResponse`, NoTools) summarizes all but the last
  `keep_recent` messages; those messages are replaced by a single summary
  message. Compaction is invisible to the strategy — it happens inside the
  base turn's prompt-construction step.
- **Summarizer failure is non-fatal:** log an `AgentEvent`, keep the
  unsummarized history, retry at the next trigger. If context overflows anyway,
  the existing pause-resumable behavior applies.
- **Rolling summary per agent identity:**

```rust
pub struct AgentMemory {
    pub agent_id: String,
    pub rolling_summary: String, // capped ~2000 chars by prompt instruction
    pub updated_at: String,
}
```

  Stored as `AppSnapshot.agent_memories`, persisted to IndexedDB with the rest
  of the snapshot. On invocation end, a OneShot merge call folds (old summary +
  final answer + key observations) into a new summary. On invocation start, a
  non-empty rolling summary is injected into the rendered prompt's dynamic
  context as a "prior work" section. This gives sub-agents continuity across
  calls without transcript pollution.
- The orchestrator's session thread is its own working memory across the
  session (existing prior-conversation loading), compacted by the same policy.
  No special case.

### define_response! and response types

A `macro_rules!` macro (zero new dependencies) in `src/responses/`:

```rust
define_response! {
    /// Output of a planning phase.
    PlanResponse {
        observation: text   => "What is known about the task",
        plan:        list   => "Ordered steps, 3 to 7 items",
        risks:       list   => "What could go wrong",
    }
}
```

Field kinds supported in v1: `text` (String), `list` (Vec<String>), and
`choice(a, b, …)` (the macro generates a Rust enum with the listed variants and
a parse that rejects anything else — covers `ReActResponse.action`). The
expansion produces:

1. The struct with serde `Deserialize`.
2. A `FieldSpec` table (name, kind, description).
3. The `StructuredResponse` impl whose behavior comes from base trait default
   methods reading the table: `get_instructions(format)` for JSON and TOON,
   `from_raw` (JSON → TOON → fallback), and the validation hook.

`FormatNegotiator` is unchanged and applies to every macro-declared type.

Response types after this spec: `ReActResponse` (migrated onto the macro,
bit-for-bit identical instructions/parsing verified by tests), `PlanResponse`,
`CritiqueResponse { verdict: choice(pass, revise), feedback: text }`,
`SkillSelectionResponse { selected_skills: list, reason: text }`,
`TaskBreakdownResponse { observation: text, tasks: list }`,
`SummaryResponse { summary: text, open_threads: list }`.

`ResponseKind` is an enum over these types; parse dispatch is a single match in
the responses module. Adding a response type = one macro invocation + one enum
variant + one match arm (no engine edits).

### The unified skeleton

All four extensible subsystems follow the same contract, documented in
`docs/extensibility.md` as canonical:

| subsystem | descriptor | trait | registry | registration |
|---|---|---|---|---|
| tools | `ToolSpec` | handler fn | `ToolRegistry` | one line in `register_builtin_tools` |
| inference | `ProviderConfig`/model id | `InferenceProvider` | inference registry | id-keyed `get_or_create` |
| responses | `FieldSpec` table (macro) | `StructuredResponse` | `ResponseKind` dispatch | macro + enum variant |
| strategies | `Phase` list | `Strategy` | `StrategyRegistry` | one line in `register_builtin_strategies` |

### Observability

- New `AgentEvent` variants: `PhaseStarted { name }`,
  `PhaseCompleted { name, routing }`, `MemoryCompacted { dropped, kept }`,
  `RollingSummaryUpdated { agent_id }`.
- Chat panel shows the live phase name ("Planning… / Acting… / Reviewing…").
- Event log renders routing decisions and compactions.

## Error handling

- Unrecoverable provider error mid-phase: pause the run, resumable — unchanged.
- Back-edge budget exhaustion: finish with best-effort answer, flagged in the
  completion event.
- Tool errors (including bad strategy id in `call_agent`): observations, never
  terminal — unchanged.
- Summarizer/merge failure: non-fatal, logged, retried at next trigger.
- No `unwrap`/`expect`/`panic!` on loop-reachable paths; `AppResult`
  propagation throughout (existing convention).

## Testing (host-side, `cargo test`)

1. **Parity:** `react` strategy reproduces current single-loop behavior against
   a mock provider with scripted responses.
2. **Routing:** `plan-act-review` with a scripted `revise` critique routes back
   exactly once with the feedback artifact injected; budget exhaustion at 2.
3. **Macro:** each macro-declared response type round-trips JSON and TOON;
   migrated `ReActResponse` emits identical format instructions to the
   hand-written version (golden test).
4. **Memory:** compaction fires on message-count trigger and on token-estimate
   trigger; keeps `keep_recent` verbatim; summarizer failure leaves history
   intact. Rolling summary persists through snapshot serialization and is
   injected on the next invocation.
5. **Resolution:** params override beats agent config beats default; bad id in
   `call_agent` yields an error observation.
6. **Seam:** registering a new strategy requires no engine edits (mirror of the
   existing tool-registry seam test).
7. **Orchestrate:** scripted decompose → two parallel `call_agent` calls →
   synthesize, with recursion guard still enforced.

Existing in-crate wasm-bindgen browser tests continue to run per the documented
local chromedriver workflow.

## Migration plan (one milestone per step; verification gate after each)

1. `define_response!` + migrate `ReActResponse` (no behavior change).
2. `Phase`/`Strategy`/`StrategyRegistry`; `AgentLoop` runs the `react` strategy
   (parity gate).
3. `LoopParams` everywhere; `call_agent` strategy/max_turns args; worker
   transport fields; agent config `strategy_id` + Agents page picker.
4. Memory: compaction + rolling summary + events.
5. `plan-act-review` and `skills-work-critique` strategies.
6. `orchestrate` strategy + bundled orchestrator agent; `WorkflowGate`
   re-target; delete `src/orchestrator.rs` after parity.
7. UI polish: phase status line, event log rendering.

Each step passes: `cargo fmt --check`, `cargo clippy -D warnings`,
`cargo test`, `dx build --platform web`.

## Expected evolution

The strategy set and `LoopParams` shape are expected to grow ("updating as we
go"). The stable seams are: the `Strategy` trait, the registry, the resolution
order, and strategy-as-a-parameter at every construction site. Data-driven
user-authored strategies are a candidate later spec and must not require
redesign of these seams — they would compile config into the same `Phase`
structures.

## Implementation note

When this spec is planned, subsystems that are independent (macro/responses,
memory, strategies/engine, UI) should be parallelized across implementation
subagents where the plan allows ("pan out parallel agents for each").
