# Strategy Layer + Unified Object Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Strategy layer (phase sequences with routing) above askk's base ReAct turn, unify response declaration behind a `define_response!` macro, make strategy a parameter of every loop construction site, add per-object memory (compaction + rolling summary), and replace the bespoke `Orchestrator` with an orchestrator agent.

**Architecture:** A `Strategy` is an ordered list of `Phase`s (`OneShot` or `Loop`) with a `route()` back-edge function. `AgentLoop` keeps its init→run→step lifecycle but `run` drives the strategy's phases instead of one hardcoded loop. Each phase parses its own response type; the wire call stays `invoke_react` (raw text comes back; phase-specific schemas are parsed engine-side and instructions are passed via a new `InferenceRequest.format_instructions` field). Memory is owned per `AgentLoop`: working messages compact via a one-shot summary call; a rolling summary per agent identity persists in the snapshot.

**Tech Stack:** Rust 2024, Dioxus 0.7.9 (web/WASM), serde/serde_json, no new dependencies. Spec: `docs/superpowers/specs/2026-06-09-strategy-layer-design.md`.

**Verification gate after every task:** `cargo fmt --all -- --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test` and, at tasks 5, 6, 10, 11: `dx build --platform web`.

**Branch:** all work happens on `feat/strategy-layer` (created by the worktree/branch setup at execution start), never on `main`.

---

## Conventions used by every task

- File paths are relative to the repo root `/Users/kaush/Downloads/Dev/askk` (single crate, all code under `src/`).
- Tests are host-side `#[cfg(test)] mod tests` in the same file, run with `cargo test <name>`.
- No `unwrap()`/`expect()`/`panic!()` in non-test code paths reachable from the loop.
- A `PostToolUse` hook auto-runs `cargo fmt` after Rust edits — never hand-format.
- Existing code referenced below was verified at plan time; if a line number drifted, locate by the quoted code, not the number.

---

### Task 0: Branch setup

**Files:** none (git only)

- [ ] **Step 0.1:** Verify clean tree and create the branch:

```bash
git status --short   # expect empty
git checkout -b feat/strategy-layer
```

Expected: `Switched to a new branch 'feat/strategy-layer'`.

---

### Task 1: `define_response!` macro + migrate `ReActResponse`

**Files:**
- Create: `src/responses/macros.rs`
- Modify: `src/responses/mod.rs` (helper visibility + module decl)
- Modify: `src/responses/react.rs` (migrate onto macro)

Background you need: `src/responses/mod.rs` already has `StructuredResponse` (with default-method `instructions`/`from_raw`/`parsed_format` driven by a `fields()` table), `ResponseField { name, type_name, description }`, and private helpers `string_field`/`list_field` (lines ~341–365). `ReActResponse` in `src/responses/react.rs` hand-writes `fields()` and `from_fields()` with two custom hooks: `normalize_invalid_action(&mut fields)` (pre-parse BTreeMap fix-up) and `.with_raw_fallback(raw)` (post-parse). The macro must reproduce that exactly.

- [ ] **Step 1.1: Write the golden test first** (in `src/responses/react.rs`, append to the existing `mod tests`):

```rust
    #[test]
    fn react_fields_table_is_unchanged_by_macro_migration() {
        // Golden pin: the macro migration must keep the field table — and therefore
        // the generated JSON/TOON instructions — bit-for-bit identical.
        let fields = ReActResponse::fields();
        let expected: &[(&str, &str)] = &[
            ("observation", "string"),
            ("thinking", "string"),
            ("plan", "list"),
            ("action", "tool | answer"),
            ("response", "string"),
        ];
        let actual: Vec<(&str, &str)> = fields
            .iter()
            .map(|field| (field.name, field.type_name))
            .collect();
        assert_eq!(actual, expected);
        assert!(
            fields[3]
                .description
                .contains("'tool' to invoke a compiled tool")
        );
    }
```

- [ ] **Step 1.2: Run it to confirm it passes against the CURRENT hand-written impl** (this pins the baseline before migrating):

```bash
cargo test react_fields_table_is_unchanged_by_macro_migration
```

Expected: PASS. Commit the pin: `git add -A && git commit -m "test: pin ReActResponse field table before macro migration"`

- [ ] **Step 1.3: Make the field helpers reachable by the macro.** In `src/responses/mod.rs`, change the two helper signatures (lines ~341 and ~351):

```rust
// before
fn string_field(fields: &BTreeMap<String, Value>, key: &str) -> String {
fn list_field(fields: &BTreeMap<String, Value>, key: &str) -> Vec<String> {
// after
pub(crate) fn string_field(fields: &BTreeMap<String, Value>, key: &str) -> String {
pub(crate) fn list_field(fields: &BTreeMap<String, Value>, key: &str) -> Vec<String> {
```

- [ ] **Step 1.4: Create `src/responses/macros.rs`** with this complete content:

```rust
//! `define_response!` — declare a structured response type as fields +
//! descriptions only. The macro expands to the struct, any `choice` enums, and the
//! [`StructuredResponse`](super::StructuredResponse) impl; parsing, JSON/TOON
//! instruction generation, and format negotiation all come from the base trait's
//! default methods reading the generated field table.
//!
//! Field kinds:
//! - `text`  → `String`, extracted with [`super::string_field`], trimmed.
//! - `list`  → `Vec<String>`, extracted with [`super::list_field`].
//! - `(choice EnumName { Variant = "literal", ... } default Variant, "type name")`
//!   → generates `EnumName` with a `from_value` that maps each literal to its
//!   variant and anything else to the default.
//!
//! Optional trailing hooks (both used by `ReActResponse`):
//! - `normalize: path,` — `fn(&mut BTreeMap<String, Value>)`, runs before extraction.
//! - `finish: method,` — `fn(self, raw: &str) -> Self` inherent method, runs after.

macro_rules! define_response {
    (
        $(#[$struct_meta:meta])*
        pub struct $name:ident {
            $( $field:ident : $kind:tt => $desc:expr ),+ $(,)?
        }
        $( normalize: $normalize:path, )?
        $( finish: $finish:ident, )?
    ) => {
        $( define_response!(@enum_def $kind); )+

        $(#[$struct_meta])*
        #[derive(Clone, Debug, serde::Serialize, serde::Deserialize, PartialEq)]
        pub struct $name {
            $( pub $field: define_response!(@ty $kind), )+
        }

        impl crate::responses::StructuredResponse for $name {
            fn fields() -> &'static [crate::responses::ResponseField] {
                &[
                    $( crate::responses::ResponseField {
                        name: stringify!($field),
                        type_name: define_response!(@type_name $kind),
                        description: $desc,
                    }, )+
                ]
            }

            fn from_fields(
                #[allow(unused_mut)] mut fields: std::collections::BTreeMap<
                    String,
                    serde_json::Value,
                >,
                raw: &str,
            ) -> Self {
                let _ = raw;
                $( $normalize(&mut fields); )?
                let parsed = Self {
                    $( $field: define_response!(@extract $kind, &fields, stringify!($field)), )+
                };
                $( let parsed = parsed.$finish(raw); )?
                parsed
            }
        }
    };

    (@ty text) => { String };
    (@ty list) => { Vec<String> };
    (@ty (choice $enum_name:ident { $($variant:ident = $lit:literal),+ $(,)? } default $default:ident, $type_name:literal)) => { $enum_name };

    (@type_name text) => { "string" };
    (@type_name list) => { "list" };
    (@type_name (choice $enum_name:ident { $($variant:ident = $lit:literal),+ $(,)? } default $default:ident, $type_name:literal)) => { $type_name };

    (@extract text, $fields:expr, $key:expr) => {
        crate::responses::string_field($fields, $key).trim().to_string()
    };
    (@extract list, $fields:expr, $key:expr) => {
        crate::responses::list_field($fields, $key)
    };
    (@extract (choice $enum_name:ident { $($variant:ident = $lit:literal),+ $(,)? } default $default:ident, $type_name:literal), $fields:expr, $key:expr) => {
        $enum_name::from_value($fields.get($key))
    };

    (@enum_def text) => {};
    (@enum_def list) => {};
    (@enum_def (choice $enum_name:ident { $($variant:ident = $lit:literal),+ $(,)? } default $default:ident, $type_name:literal)) => {
        #[derive(Clone, Debug, serde::Serialize, serde::Deserialize, PartialEq)]
        pub enum $enum_name {
            $( $variant, )+
        }

        impl $enum_name {
            pub(crate) fn from_value(value: Option<&serde_json::Value>) -> Self {
                match value
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .trim()
                {
                    $( $lit => Self::$variant, )+
                    _ => Self::$default,
                }
            }
        }
    };
}

pub(crate) use define_response;
```

- [ ] **Step 1.5: Register the module.** In `src/responses/mod.rs`, near the other module decls (top of file, alongside `mod react;` etc.) add:

```rust
#[macro_use]
mod macros;
pub(crate) use macros::define_response;
```

(If `#[macro_use]` + `pub(crate) use` double-export trips clippy, keep only the `pub(crate) use macros::define_response;` line — the macro is invoked via the import.)

- [ ] **Step 1.6: Migrate `src/responses/react.rs`.** Replace the hand-written `pub enum ReActAction {...}`, `impl ReActAction {...}`, `pub struct ReActResponse {...}`, and `impl StructuredResponse for ReActResponse {...}` blocks with:

```rust
use super::define_response;

define_response! {
    /// One turn of the ReAct loop — observation, thinking, plan, and either a tool
    /// action or a final answer.
    pub struct ReActResponse {
        observation: text => "One short sentence about current context, key facts, or constraints.",
        thinking: text => "Concise reasoning that is safe to show in the run timeline.",
        plan: list => "0-3 short, concrete next steps. Use [] when obvious.",
        action: (choice ReActAction { Tool = "tool", Answer = "answer" } default Answer, "tool | answer") => "'tool' to invoke a compiled tool, 'answer' for final response text.",
        response: text => "If action='tool': tool_name({\"key\":\"value\"}). If action='answer': final answer.",
    }
    normalize: normalize_invalid_action,
    finish: with_raw_fallback,
}
```

KEEP unchanged in the file: the inherent `impl ReActResponse { pub fn final_text(...) ... fn with_raw_fallback(...) }` block, the free fns `normalize_invalid_action` and `first_non_empty`, and all tests. Remove the now-unused `use super::{ResponseField, StructuredResponse, list_field, string_field};` import (the macro references them by path) — keep whatever the compiler still needs.

Note one deliberate behavior detail: the macro trims `text` fields (the old code only trimmed `response`). The existing tests assert already-trimmed values, so they still pass; this is the only permitted delta.

- [ ] **Step 1.7: Run the full responses test suite:**

```bash
cargo test --lib responses
```

Expected: all pass, including `react_fields_table_is_unchanged_by_macro_migration`, `react_response_prefers_toon_over_inner_tool_json_args`, `react_response_still_parses_json_with_known_fields`, and the four `parsed_format_*` tests.

- [ ] **Step 1.8: Full gate + commit:**

```bash
cargo fmt --all -- --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test
git add -A && git commit -m "feat(responses): define_response! macro; migrate ReActResponse onto it"
```

---

### Task 2: New response types + `ResponseKind`/`ParsedResponse`

**Files:**
- Create: `src/responses/phase_responses.rs`
- Create: `src/responses/kind.rs`
- Modify: `src/responses/mod.rs` (module decls + re-exports)

- [ ] **Step 2.1: Write failing tests.** Create `src/responses/phase_responses.rs` starting with ONLY the test module (types come next step):

```rust
//! Response contracts for strategy phases: plan, critique, skill selection, task
//! breakdown, and history summarization. All declared via [`define_response!`];
//! the base trait supplies parsing and JSON/TOON instructions.

use super::define_response;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::responses::StructuredResponse;

    #[test]
    fn plan_response_parses_toon() {
        let parsed = PlanResponse::from_raw(
            "observation: small task\nplan:\n1. read the file\n2. edit it\nrisks: []",
        );
        assert_eq!(parsed.observation, "small task");
        assert_eq!(parsed.plan.len(), 2);
        assert!(parsed.risks.is_empty());
    }

    #[test]
    fn critique_response_parses_json_and_choice_defaults_to_pass() {
        let parsed = CritiqueResponse::from_raw(
            r#"{"verdict":"revise","feedback":"missing tests"}"#,
        );
        assert_eq!(parsed.verdict, CritiqueVerdict::Revise);
        assert_eq!(parsed.feedback, "missing tests");

        let fallback = CritiqueResponse::from_raw(r#"{"verdict":"??","feedback":""}"#);
        assert_eq!(fallback.verdict, CritiqueVerdict::Pass);
    }

    #[test]
    fn summary_and_breakdown_and_skills_parse() {
        let summary =
            SummaryResponse::from_raw("summary: did things\nopen_threads: [verify output]");
        assert_eq!(summary.summary, "did things");
        assert_eq!(summary.open_threads, vec!["verify output".to_string()]);

        let breakdown = TaskBreakdownResponse::from_raw(
            "observation: two independent parts\ntasks:\n1. research X (researcher, react)\n2. build Y (coder, plan-act-review)",
        );
        assert_eq!(breakdown.tasks.len(), 2);

        let skills = SkillSelectionResponse::from_raw(
            "selected_skills: [research]\nreason: goal needs sources",
        );
        assert_eq!(skills.selected_skills, vec!["research".to_string()]);
    }
}
```

- [ ] **Step 2.2: Run to verify failure** (types don't exist yet):

```bash
cargo test --lib phase_responses 2>&1 | head -20
```

Expected: COMPILE ERROR `cannot find ... PlanResponse`.

- [ ] **Step 2.3: Add the five declarations** above the test module in `src/responses/phase_responses.rs`:

```rust
define_response! {
    /// Output of a planning phase.
    pub struct PlanResponse {
        observation: text => "What is known about the task and its constraints.",
        plan: list => "Ordered, concrete steps (3 to 7 items).",
        risks: list => "What could go wrong or needs verification. Use [] when none.",
    }
}

define_response! {
    /// Verdict from a review/critique phase.
    pub struct CritiqueResponse {
        verdict: (choice CritiqueVerdict { Pass = "pass", Revise = "revise" } default Pass, "pass | revise") => "'pass' when the work meets the goal, 'revise' to send it back with feedback.",
        feedback: text => "If verdict='revise': specific, actionable feedback. Empty when passing.",
    }
}

define_response! {
    /// Skills chosen for the work phase.
    pub struct SkillSelectionResponse {
        selected_skills: list => "Names of the skills relevant to this goal. Use [] when none fit.",
        reason: text => "One sentence on why these skills fit the goal.",
    }
}

define_response! {
    /// Task decomposition from the orchestrator's decompose phase.
    pub struct TaskBreakdownResponse {
        observation: text => "What the goal needs and which specialists fit.",
        tasks: list => "Self-contained sub-tasks, each naming a suggested agent and strategy in parentheses.",
    }
}

define_response! {
    /// Compaction summary of older conversation history.
    pub struct SummaryResponse {
        summary: text => "Dense summary of the earlier conversation: decisions, key facts, file paths, tool results.",
        open_threads: list => "Unresolved questions or pending work items. Use [] when none.",
    }
}
```

- [ ] **Step 2.4: Create `src/responses/kind.rs`** (complete file):

```rust
//! [`ResponseKind`] — the id-keyed dispatch for structured response schemas. A
//! [`crate::strategy::Phase`] names its schema by kind; the engine asks the kind for
//! format instructions and for parsing. Adding a response type = one
//! `define_response!` invocation + one variant here + one arm in each match.

use serde::{Deserialize, Serialize};

use super::phase_responses::{
    CritiqueResponse, PlanResponse, SkillSelectionResponse, SummaryResponse,
    TaskBreakdownResponse,
};
use super::react::ReActResponse;
use super::{ParseOutcome, ResponseFormat, StructuredResponse};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResponseKind {
    ReAct,
    Plan,
    Critique,
    SkillSelection,
    TaskBreakdown,
    Summary,
}

/// A parsed phase response, tagged by kind. Strategies route on this.
#[derive(Clone, Debug, PartialEq)]
pub enum ParsedResponse {
    ReAct(ReActResponse),
    Plan(PlanResponse),
    Critique(CritiqueResponse),
    SkillSelection(SkillSelectionResponse),
    TaskBreakdown(TaskBreakdownResponse),
    Summary(SummaryResponse),
}

impl ResponseKind {
    /// The format-instruction block for this schema (always appended last in the
    /// rendered prompt).
    pub fn instructions(self, format: ResponseFormat) -> String {
        match self {
            Self::ReAct => ReActResponse::instructions(format),
            Self::Plan => PlanResponse::instructions(format),
            Self::Critique => CritiqueResponse::instructions(format),
            Self::SkillSelection => SkillSelectionResponse::instructions(format),
            Self::TaskBreakdown => TaskBreakdownResponse::instructions(format),
            Self::Summary => SummaryResponse::instructions(format),
        }
    }

    /// Parse raw model text into this kind's schema (JSON → TOON → fallback).
    pub fn parse(self, raw: &str) -> ParsedResponse {
        match self {
            Self::ReAct => ParsedResponse::ReAct(ReActResponse::from_raw(raw)),
            Self::Plan => ParsedResponse::Plan(PlanResponse::from_raw(raw)),
            Self::Critique => ParsedResponse::Critique(CritiqueResponse::from_raw(raw)),
            Self::SkillSelection => {
                ParsedResponse::SkillSelection(SkillSelectionResponse::from_raw(raw))
            }
            Self::TaskBreakdown => {
                ParsedResponse::TaskBreakdown(TaskBreakdownResponse::from_raw(raw))
            }
            Self::Summary => ParsedResponse::Summary(SummaryResponse::from_raw(raw)),
        }
    }

    /// Which format the raw reply actually parsed as, for negotiation scoring.
    pub fn parsed_format(self, raw: &str) -> ParseOutcome {
        match self {
            Self::ReAct => ReActResponse::parsed_format(raw),
            Self::Plan => PlanResponse::parsed_format(raw),
            Self::Critique => CritiqueResponse::parsed_format(raw),
            Self::SkillSelection => SkillSelectionResponse::parsed_format(raw),
            Self::TaskBreakdown => TaskBreakdownResponse::parsed_format(raw),
            Self::Summary => SummaryResponse::parsed_format(raw),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_parse_round_trips_each_variant_tag() {
        assert!(matches!(
            ResponseKind::Plan.parse("plan: [a]"),
            ParsedResponse::Plan(_)
        ));
        assert!(matches!(
            ResponseKind::ReAct.parse("action: answer\nresponse: hi"),
            ParsedResponse::ReAct(_)
        ));
        assert!(matches!(
            ResponseKind::Summary.parse("summary: s"),
            ParsedResponse::Summary(_)
        ));
    }

    #[test]
    fn kind_instructions_name_the_kinds_fields() {
        let text = ResponseKind::Critique.instructions(ResponseFormat::Toon);
        assert!(text.contains("verdict"));
        assert!(text.contains("feedback"));
        assert!(!text.contains("observation"));
    }
}
```

- [ ] **Step 2.5: Wire modules.** In `src/responses/mod.rs` add alongside existing decls/re-exports:

```rust
mod kind;
mod phase_responses;

pub use kind::{ParsedResponse, ResponseKind};
pub use phase_responses::{
    CritiqueResponse, CritiqueVerdict, PlanResponse, SkillSelectionResponse, SummaryResponse,
    TaskBreakdownResponse,
};
```

- [ ] **Step 2.6: Run tests, gate, commit:**

```bash
cargo test --lib responses
cargo fmt --all -- --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test
git add -A && git commit -m "feat(responses): phase response types + ResponseKind dispatch"
```

---

### Task 3: `InferenceRequest.format_instructions` seam

**Files:**
- Modify: `src/inference/mod.rs` (InferenceRequest struct, lines ~45–62)
- Modify: `src/inference/openai.rs` (line ~122)
- Modify: `src/agent_prompt.rs` (render, line ~137–150)
- Modify: `src/engine/mod.rs` (request construction inside `step`)

Today the provider hardcodes `ReActResponse::instructions(request.response_format)`. Phases need schema-specific instructions, so the ENGINE computes the string and the provider/prompt just place it.

- [ ] **Step 3.1: Add the field.** In `src/inference/mod.rs`, add to `InferenceRequest` after `response_format`:

```rust
    /// The fully rendered response-format instruction block (schema-specific).
    /// Computed by the engine from the active phase's `ResponseKind` +
    /// negotiated `ResponseFormat`; providers place it last, never compute it.
    pub format_instructions: String,
```

- [ ] **Step 3.2: Use it in the provider.** In `src/inference/openai.rs` line ~122 replace:

```rust
// before
content: ReActResponse::instructions(request.response_format),
// after
content: request.format_instructions.clone(),
```

Remove the now-unused `ReActResponse` import only if the compiler flags it (it is still used for the parsed output type — check before removing).

- [ ] **Step 3.3: Use it in the prompt renderer.** In `src/agent_prompt.rs` change `render` (line ~137):

```rust
// before
        response_format: ResponseFormat,
    ) -> RenderedPrompt {
        RenderedPrompt {
            system_prompt: self.render_system(now),
            goal: goal.to_string(),
            history: history.to_vec(),
            response_format: ReActResponse::instructions(response_format),
        }
    }
// after
        response_format: ResponseFormat,
        response_kind: ResponseKind,
    ) -> RenderedPrompt {
        RenderedPrompt {
            system_prompt: self.render_system(now),
            goal: goal.to_string(),
            history: history.to_vec(),
            response_format: response_kind.instructions(response_format),
        }
    }
```

Add `use crate::responses::ResponseKind;` and update every `render(` call site (find them: `grep -rn "\.render(" src/ | grep -v render_system`) to pass `ResponseKind::ReAct` — including the tests in `agent_prompt.rs` and `src/components/compiled_prompt_panel.rs` if it calls render.

- [ ] **Step 3.4: Fill the field at every `InferenceRequest {` construction site.** Find them:

```bash
grep -rn "InferenceRequest {" src/
```

In `src/engine/mod.rs` (inside `step`) set:

```rust
format_instructions: ResponseKind::ReAct.instructions(requested_format),
```

(import `ResponseKind` from `crate::responses`). In `src/inference/openai.rs` tests and any other constructors, set `format_instructions: ResponseKind::ReAct.instructions(<the format that test uses>)` so behavior is unchanged.

- [ ] **Step 3.5: Gate + commit.** The three openai tests (`agent_calls_include_soul_prompt_before_role`, `tool_history_is_sent_as_user_context`, `empty_history_falls_back_to_goal_message`) and the nine agent_prompt tests must pass UNCHANGED (only call-site signatures updated):

```bash
cargo fmt --all -- --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test
git add -A && git commit -m "refactor(inference): engine-computed format_instructions seam"
```

---

### Task 4: Strategy module — `Phase`, `Strategy`, registry, `react` built-in

**Files:**
- Create: `src/strategy/mod.rs`
- Create: `src/strategy/registry.rs`
- Create: `src/strategy/react.rs`
- Modify: `src/main.rs` (module decl: add `mod strategy;` alongside the existing `mod engine;` etc.)

- [ ] **Step 4.1: Create `src/strategy/mod.rs`** (complete file):

```rust
//! The strategy layer: a [`Strategy`] is an ordered sequence of [`Phase`]s with a
//! routing function, run above the unchanged base turn (construct prompt → call
//! LLM → parse → act). The base ReAct loop is the degenerate single-phase case.

mod react;
mod registry;

pub use react::ReactStrategy;
pub use registry::{
    DEFAULT_STRATEGY_ID, StrategyRegistry, fallback_strategy, resolve_strategy_id,
};

use crate::responses::{ParsedResponse, ResponseKind};

/// How a phase consumes turns.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoopMode {
    /// One base turn; the parsed response is the phase outcome.
    OneShot,
    /// Repeat base turns until the response answers or the budget is exhausted.
    /// `max_turns: 0` means "use the loop's global step budget".
    Loop { max_turns: u32 },
}

/// Which tools a phase exposes to the model.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolPolicy {
    /// No tool dispatch at all (pure structured output phases).
    NoTools,
    /// The agent's full enabled-tool allowlist.
    Inherit,
    /// Only the named tools, intersected with the agent's allowlist.
    Subset(&'static [&'static str]),
}

/// One stretch of work inside a strategy.
#[derive(Clone, Copy, Debug)]
pub struct Phase {
    pub name: &'static str,
    pub response_kind: ResponseKind,
    /// Phase framing prepended to the goal in this phase's requests. Empty = none.
    pub prompt_frame: &'static str,
    pub tool_policy: ToolPolicy,
    pub loop_mode: LoopMode,
    /// When true the engine appends the enabled skill library (names + first
    /// lines) to this phase's goal so the model can select from it.
    pub list_skill_library: bool,
}

/// Where the strategy sends control after a phase completes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Routing {
    Next,
    Back(usize),
    Done,
}

/// What a finished phase produced.
#[derive(Clone, Debug)]
pub struct PhaseOutcome {
    pub phase: &'static str,
    pub response: ParsedResponse,
    pub turns_used: u32,
}

/// Carry-forward state across phases of one strategy run.
#[derive(Clone, Debug, Default)]
pub struct StrategyContext {
    /// (phase name, distilled outcome) — injected into later phases' frames.
    pub artifacts: Vec<(String, String)>,
    pub back_edges_used: u32,
    /// Skills chosen by a `SkillSelection` phase; `None` = agent default set.
    pub selected_skills: Option<Vec<String>>,
}

/// Hard cap on `Routing::Back` edges per strategy run, so critique cycles are
/// bounded by construction.
pub const MAX_BACK_EDGES: u32 = 2;

/// A phase sequence with routing. Implementations are stateless statics held by
/// the [`StrategyRegistry`].
pub trait Strategy {
    fn id(&self) -> &'static str;
    fn description(&self) -> &'static str;
    fn phases(&self) -> &'static [Phase];
    /// Decide where to go after phase `from` finished with `outcome`.
    fn route(&self, from: usize, outcome: &PhaseOutcome) -> Routing;
    /// Distill a finished phase into a named artifact for later phases. `None`
    /// records nothing.
    fn artifact(&self, outcome: &PhaseOutcome) -> Option<(String, String)> {
        let _ = outcome;
        None
    }
}
```

- [ ] **Step 4.2: Create `src/strategy/react.rs`** (complete file):

```rust
//! `react` — the degenerate single-phase strategy reproducing the original
//! ReAct loop exactly. The parity baseline and the default for every agent.

use crate::responses::ResponseKind;

use super::{LoopMode, Phase, PhaseOutcome, Routing, Strategy, ToolPolicy};

pub struct ReactStrategy;

static REACT_PHASES: [Phase; 1] = [Phase {
    name: "act",
    response_kind: ResponseKind::ReAct,
    prompt_frame: "",
    tool_policy: ToolPolicy::Inherit,
    loop_mode: LoopMode::Loop { max_turns: 0 },
    list_skill_library: false,
}];

impl Strategy for ReactStrategy {
    fn id(&self) -> &'static str {
        "react"
    }

    fn description(&self) -> &'static str {
        "Single ReAct loop: observe, think, act with tools, answer."
    }

    fn phases(&self) -> &'static [Phase] {
        &REACT_PHASES
    }

    fn route(&self, _from: usize, _outcome: &PhaseOutcome) -> Routing {
        Routing::Done
    }
}
```

- [ ] **Step 4.3: Create `src/strategy/registry.rs`** (complete file):

```rust
//! Id-keyed strategy lookup, mirroring the tool and inference registries: built-ins
//! registered at construction, one line per strategy, no engine edits to extend.

use super::{ReactStrategy, Strategy};

pub const DEFAULT_STRATEGY_ID: &str = "react";

static REACT: ReactStrategy = ReactStrategy;

/// Infallible default used when an id (even "react") fails to resolve.
pub fn fallback_strategy() -> &'static dyn Strategy {
    &REACT
}

pub struct StrategyRegistry {
    strategies: Vec<&'static dyn Strategy>,
}

impl Default for StrategyRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl StrategyRegistry {
    pub fn new() -> Self {
        let mut registry = Self {
            strategies: Vec::new(),
        };
        register_builtin_strategies(&mut registry);
        registry
    }

    pub fn register(&mut self, strategy: &'static dyn Strategy) {
        self.strategies
            .retain(|existing| existing.id() != strategy.id());
        self.strategies.push(strategy);
    }

    pub fn get(&self, id: &str) -> Option<&'static dyn Strategy> {
        self.strategies
            .iter()
            .copied()
            .find(|strategy| strategy.id() == id.trim())
    }

    /// (id, description) pairs for UI pickers.
    pub fn catalog(&self) -> Vec<(&'static str, &'static str)> {
        self.strategies
            .iter()
            .map(|strategy| (strategy.id(), strategy.description()))
            .collect()
    }
}

fn register_builtin_strategies(registry: &mut StrategyRegistry) {
    registry.register(&REACT);
}

/// One resolution order everywhere: explicit param → agent config → default.
pub fn resolve_strategy_id(param: Option<&str>, agent_config: Option<&str>) -> String {
    let pick = |value: Option<&str>| {
        value
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    pick(param)
        .or_else(|| pick(agent_config))
        .unwrap_or_else(|| DEFAULT_STRATEGY_ID.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_resolves_react_and_rejects_unknown() {
        let registry = StrategyRegistry::new();
        assert!(registry.get("react").is_some());
        assert!(registry.get(" react ").is_some());
        assert!(registry.get("nope").is_none());
    }

    #[test]
    fn registering_a_new_strategy_needs_no_engine_edits() {
        // Seam test: a fresh strategy is registered and resolvable through the same
        // registry API the engine uses — no match arms anywhere to extend.
        struct Custom;
        static CUSTOM_PHASES: [crate::strategy::Phase; 1] = [crate::strategy::Phase {
            name: "only",
            response_kind: crate::responses::ResponseKind::ReAct,
            prompt_frame: "",
            tool_policy: crate::strategy::ToolPolicy::Inherit,
            loop_mode: crate::strategy::LoopMode::OneShot,
            list_skill_library: false,
        }];
        impl crate::strategy::Strategy for Custom {
            fn id(&self) -> &'static str {
                "custom"
            }
            fn description(&self) -> &'static str {
                "test-only"
            }
            fn phases(&self) -> &'static [crate::strategy::Phase] {
                &CUSTOM_PHASES
            }
            fn route(
                &self,
                _from: usize,
                _outcome: &crate::strategy::PhaseOutcome,
            ) -> crate::strategy::Routing {
                crate::strategy::Routing::Done
            }
        }
        static CUSTOM: Custom = Custom;
        let mut registry = StrategyRegistry::new();
        registry.register(&CUSTOM);
        assert!(registry.get("custom").is_some());
    }

    #[test]
    fn resolution_order_param_beats_agent_beats_default() {
        assert_eq!(resolve_strategy_id(Some("a"), Some("b")), "a");
        assert_eq!(resolve_strategy_id(None, Some("b")), "b");
        assert_eq!(resolve_strategy_id(Some("  "), None), "react");
        assert_eq!(resolve_strategy_id(None, None), "react");
    }
}
```

- [ ] **Step 4.4:** Add `mod strategy;` to `src/main.rs` next to the other top-level module declarations.

- [ ] **Step 4.5: Gate + commit:**

```bash
cargo fmt --all -- --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test
git add -A && git commit -m "feat(strategy): Phase/Strategy/Routing types, registry, react built-in"
```

---

### Task 5: Engine runs strategies (react parity)

**Files:**
- Modify: `src/engine/mod.rs` — `AgentLoop` fields/`new`/`run`/`step`
- Modify: `src/state/event.rs` — new event kinds

This is the spine change. The current `run` (lines ~566–654) has ONE loop `for step in 0..self.max_steps { self.step(...) }`. After this task `run` drives `strategy.phases()`; the existing for-loop body becomes the `Loop`-mode phase runner, and a new OneShot runner handles single-call phases. With strategy = `react` the behavior must be identical except two new timeline events.

- [ ] **Step 5.1: Add event kinds.** In `src/state/event.rs` `AgentEventKind`, after `Workflow` add:

```rust
    /// A strategy phase began.
    PhaseStarted,
    /// A strategy phase completed (body carries the routing decision).
    PhaseCompleted,
```

Then `grep -rn "AgentEventKind::" src/components/` — if any component matches exhaustively on the enum, add arms rendering these like `Workflow` events. (`cargo clippy -- -D warnings` will catch misses.)

- [ ] **Step 5.2: Extend `AgentLoop`.** In `src/engine/mod.rs`:

Add a field to `struct AgentLoop` (after `lane`):

```rust
    /// The strategy driving this run's phase sequence.
    strategy: &'static dyn Strategy,
```

Add imports: `use crate::responses::{ParsedResponse, ResponseKind};` and `use crate::strategy::{LoopMode, MAX_BACK_EDGES, Phase, PhaseOutcome, Routing, Strategy, StrategyContext, StrategyRegistry, ToolPolicy, fallback_strategy, resolve_strategy_id};`

In `AgentLoop::new`, before `Self {`, resolve the strategy:

```rust
        // Strategy resolution: explicit param → agent config → default. Task 6
        // threads the params/agent config; until then both are None (= react).
        let registry = StrategyRegistry::new();
        let strategy_id = resolve_strategy_id(None, None);
        let strategy = registry.get(&strategy_id).unwrap_or_else(fallback_strategy);
```

and add `strategy,` to the `Self { ... }` literal.

- [ ] **Step 5.3: Restructure `run`.** Keep everything up to and including the `let specs = ...` line and the `let mut format_negotiator = ...` line. Replace the `for step in 0..self.max_steps { ... }` block (and only it) with the strategy driver:

```rust
        let phases = self.strategy.phases();
        let mut context = StrategyContext::default();
        let mut steps_used: u32 = 0;
        let mut last_answer: Option<String> = None;
        let mut phase_idx = 0usize;

        while phase_idx < phases.len() {
            let phase = &phases[phase_idx];
            push_phase_event(
                &mut run,
                &self.agent_id,
                AgentEventKind::PhaseStarted,
                phase.name,
                format!("Strategy `{}`, phase `{}`.", self.strategy.id(), phase.name),
            );
            run.scratchpad.workflow.current_step = phase.name.to_string();
            run.scratchpad.workflow.history.push(phase.name.to_string());
            observer(run.clone());

            let outcome = match phase.loop_mode {
                LoopMode::OneShot => {
                    self.run_one_shot_phase(
                        phase,
                        &context,
                        &mut snapshot,
                        &mut run,
                        &specs,
                        &mut steps_used,
                        &mut format_negotiator,
                        &mut observer,
                    )
                    .await
                }
                LoopMode::Loop { max_turns } => {
                    self.run_loop_phase(
                        phase,
                        max_turns,
                        &context,
                        &mut snapshot,
                        &mut run,
                        &specs,
                        &enabled_tools,
                        &mut steps_used,
                        &mut format_negotiator,
                        &mut last_answer,
                        &mut observer,
                    )
                    .await
                }
            };

            let Some(outcome) = outcome else {
                // Interrupted, paused, or errored inside the phase: the phase runner
                // already updated run status/events. Stop the strategy.
                break;
            };

            // A OneShot ReAct phase (e.g. orchestrate's synthesize) produces the
            // final answer directly.
            if let (LoopMode::OneShot, ParsedResponse::ReAct(react)) =
                (phase.loop_mode, &outcome.response)
            {
                let final_text = react.final_text();
                if try_finalize_answer(
                    &self.validators,
                    &mut run,
                    &self.agent_id,
                    &final_text,
                    "Final answer",
                ) {
                    last_answer = Some(final_text);
                }
                observer(run.clone());
            }

            if let Some(artifact) = self.strategy.artifact(&outcome) {
                context.artifacts.retain(|(name, _)| name != &artifact.0);
                context.artifacts.push(artifact);
            }
            if let ParsedResponse::SkillSelection(selection) = &outcome.response {
                context.selected_skills = Some(selection.selected_skills.clone());
            }

            let routing = apply_back_edge_budget(
                self.strategy.route(phase_idx, &outcome),
                &mut context.back_edges_used,
            );
            push_phase_event(
                &mut run,
                &self.agent_id,
                AgentEventKind::PhaseCompleted,
                phase.name,
                format!(
                    "Routing: {routing:?} (back edges used: {}).",
                    context.back_edges_used
                ),
            );
            observer(run.clone());

            match routing {
                Routing::Next => phase_idx += 1,
                Routing::Back(target) => phase_idx = target.min(phases.len() - 1),
                Routing::Done => break,
            }
        }

        let answered = last_answer.is_some();
```

with two free helpers (near `push_observation`):

```rust
fn push_phase_event(
    run: &mut AgentRun,
    agent_id: &str,
    kind: AgentEventKind,
    phase_name: &str,
    body: String,
) {
    run.events.push(event(
        &run.id,
        Some(agent_id.to_string()),
        kind,
        format!("Phase: {phase_name}"),
        body,
    ));
}

/// Enforce the back-edge cap: a Back beyond the budget becomes Done.
fn apply_back_edge_budget(routing: Routing, back_edges_used: &mut u32) -> Routing {
    match routing {
        Routing::Back(target) if *back_edges_used < MAX_BACK_EDGES => {
            *back_edges_used += 1;
            Routing::Back(target)
        }
        Routing::Back(_) => Routing::Done,
        other => other,
    }
}
```

- [ ] **Step 5.4: Extract the loop-phase runner.** Add method `run_loop_phase` to `AgentLoop` whose body IS the old `for step in 0..self.max_steps` loop with these mechanical substitutions:

```rust
    /// Run a Loop-mode phase: the original per-turn ReAct loop, bounded by the
    /// phase budget (`max_turns`, 0 = global) and the remaining global budget.
    /// Returns the phase outcome, or None when the run stopped (interrupt, pause,
    /// error) — in which case run status/events already say why. A validated final
    /// answer is recorded into `last_answer` and produces a ReAct outcome.
    #[allow(clippy::too_many_arguments)]
    async fn run_loop_phase<F>(
        &self,
        phase: &Phase,
        max_turns: u32,
        context: &StrategyContext,
        snapshot: &mut AppSnapshot,
        run: &mut AgentRun,
        specs: &[ToolSpec],
        enabled_tools: &[String],
        steps_used: &mut u32,
        format_negotiator: &mut FormatNegotiator,
        last_answer: &mut Option<String>,
        observer: &mut F,
    ) -> Option<PhaseOutcome>
    where
        F: FnMut(AgentRun),
    {
        let phase_budget = if max_turns == 0 { self.max_steps } else { max_turns };
        let mut turns_this_phase: u32 = 0;
        let mut final_response: Option<ReActResponse> = None;

        while turns_this_phase < phase_budget && *steps_used < self.max_steps {
            if interrupt_requested() {
                mark_interrupted(run, "Run interrupted before the next model call.");
                observer(run.clone());
                return None;
            }
            self.maybe_compact(run, observer).await;
            *steps_used += 1;
            turns_this_phase += 1;

            match self
                .step(
                    *steps_used,
                    phase,
                    context,
                    snapshot,
                    run,
                    specs,
                    enabled_tools,
                    format_negotiator,
                    last_answer,
                    &mut final_response,
                    observer,
                )
                .await
            {
                StepOutcome::Continue => {}
                StepOutcome::Stop { answered } => {
                    if !answered {
                        return None;
                    }
                    break;
                }
            }
        }

        Some(PhaseOutcome {
            phase: phase.name,
            response: ParsedResponse::ReAct(final_response.unwrap_or_else(|| {
                ReActResponse::from_raw("phase budget exhausted without an answer")
            })),
            turns_used: turns_this_phase,
        })
    }
```

(`maybe_compact` does not exist until Task 7 — for THIS task omit that line; Task 7 adds it.)

- [ ] **Step 5.5: Adapt `step`.** Change its signature to take `phase: &Phase, context: &StrategyContext, last_answer: &mut Option<String>, final_response: &mut Option<ReActResponse>` (keep the rest). Inside, three edits:

  1. Goal framing — where history is built (`history.push(Message { role: "user", content: run.goal.clone() })`), replace `run.goal.clone()` with `phase_goal(phase, context, &run.goal, &self.skill_library)` — `skill_library` arrives in Task 9; until then pass `""` and add the parameter then. For THIS task define:

```rust
/// Compose the per-phase goal text: frame, then carried artifacts, then the goal.
/// The react strategy's bare phase returns the goal untouched for byte parity.
fn phase_goal(phase: &Phase, context: &StrategyContext, goal: &str) -> String {
    if phase.prompt_frame.trim().is_empty() && context.artifacts.is_empty() {
        return goal.to_string();
    }
    let mut parts: Vec<String> = Vec::new();
    if !phase.prompt_frame.trim().is_empty() {
        parts.push(phase.prompt_frame.trim().to_string());
    }
    for (name, content) in &context.artifacts {
        parts.push(format!(
            "## {} (from an earlier phase)\n{}",
            name.to_uppercase(),
            content
        ));
    }
    parts.push(format!("The goal: {goal}"));
    parts.join("\n\n")
}
```

  2. Format instructions — extract the `InferenceRequest { ... }` literal currently inline in `step` into a method used by both runners:

```rust
    /// Build one phase-aware model request. ToolPolicy filters the tool manifest;
    /// a SkillSelection outcome filters the skill set.
    fn build_request(
        &self,
        phase: &Phase,
        context: &StrategyContext,
        history: Vec<Message>,
        requested_format: ResponseFormat,
        specs: &[ToolSpec],
    ) -> InferenceRequest {
        let tools = match phase.tool_policy {
            ToolPolicy::NoTools => Vec::new(),
            ToolPolicy::Inherit => specs.to_vec(),
            ToolPolicy::Subset(names) => specs
                .iter()
                .filter(|spec| names.contains(&spec.name.as_str()))
                .cloned()
                .collect(),
        };
        // Body: CUT the existing `InferenceRequest { ... }` struct literal out of
        // `step` (it sets agent_name, agent_role, soul, skills, goal, history,
        // tools, sub_agents, now, response_format, format_instructions) and PASTE
        // it as this method's return expression, then make exactly three changes:
        //   1. `tools` field uses the `tools` binding computed above.
        //   2. `skills` field uses the filtered `skills` binding below.
        //   3. `format_instructions: phase.response_kind.instructions(requested_format),`
        // `history` comes from this method's parameter; every other field keeps the
        // exact expression it has today. `step` then calls this method instead.
    }
```

  (Apply the skills filter as:)

```rust
        let skills = match &context.selected_skills {
            Some(selected) => base_skills
                .iter()
                .filter(|skill| {
                    selected
                        .iter()
                        .any(|name| name.eq_ignore_ascii_case(&skill.name))
                })
                .cloned()
                .collect(),
            None => base_skills,
        };
```

  where `base_skills` is whatever expression the current literal uses for `skills:`.

  3. Parse scoring + answer capture — `ReActResponse::parsed_format(&output.raw_text)` becomes `phase.response_kind.parsed_format(&output.raw_text)`. Right after `let parsed = output.parsed;` add `*final_response = Some(parsed.clone());`. In the `ReActAction::Answer` arm and the empty-tool-calls arm, after `try_finalize_answer(...)` returns true, add `*last_answer = Some(final_text.clone());` before `return StepOutcome::Stop { answered: true };`.

- [ ] **Step 5.6: Add the OneShot runner** (used by later tasks; `react` never calls it, but build + test it now):

```rust
    /// Run a OneShot phase: one model call, no tool dispatch, parsed by the
    /// phase's response kind. Returns None on unrecoverable model error (run is
    /// already paused by call_model_with_retry) or interrupt.
    #[allow(clippy::too_many_arguments)]
    async fn run_one_shot_phase<F>(
        &self,
        phase: &Phase,
        context: &StrategyContext,
        snapshot: &mut AppSnapshot,
        run: &mut AgentRun,
        specs: &[ToolSpec],
        steps_used: &mut u32,
        format_negotiator: &mut FormatNegotiator,
        observer: &mut F,
    ) -> Option<PhaseOutcome>
    where
        F: FnMut(AgentRun),
    {
        let _ = snapshot;
        if interrupt_requested() {
            mark_interrupted(run, "Run interrupted before the next model call.");
            observer(run.clone());
            return None;
        }
        *steps_used += 1;

        let mut history = self.conversation.clone();
        history.push(Message {
            role: "user".to_string(),
            content: phase_goal(phase, context, &run.goal),
        });
        history.extend(run.messages.iter().cloned());

        let requested_format = format_negotiator.format();
        let request = self.build_request(phase, context, history, requested_format, specs);
        let output = call_model_with_retry(
            &self.inference,
            &self.provider,
            request,
            run,
            &self.agent_id,
            observer,
        )
        .await?;

        let parse_outcome = phase.response_kind.parsed_format(&output.raw_text);
        format_negotiator.record(parse_outcome.honors(requested_format));
        run.messages.push(Message {
            role: "assistant".to_string(),
            content: output.raw_text.clone(),
        });
        observer(run.clone());

        Some(PhaseOutcome {
            phase: phase.name,
            response: phase.response_kind.parse(&output.raw_text),
            turns_used: 1,
        })
    }
```

(Check `call_model_with_retry`'s actual return shape — the existing `step` uses `let Some(output) = ... else { return StepOutcome::Stop { answered: false } }`; mirror that with `?`/`else` accordingly.)

- [ ] **Step 5.7: Parity check — run the FULL existing engine test suite plus everything else:**

```bash
cargo test
```

Expected: ALL existing tests pass — especially `rejects_tool_not_in_agent_allowlist_before_execution`, `final_answer_validation_reenters_loop_on_failure`, `final_answer_validation_accepts_grounded_answer`, `finalize_status_preserves_paused_run`. These exercise the loop through the public entry, so they prove react parity. If any fails, the refactor changed behavior — fix the engine, not the test.

- [ ] **Step 5.8: Add a strategy-driver test** in `src/engine/mod.rs` tests: copy the harness from `final_answer_validation_accepts_grounded_answer` verbatim (same snapshot + scripted inference setup), keep its run-to-completion driving, and change only the assertions to:

```rust
        assert!(run.events.iter().any(|event| {
            event.kind == AgentEventKind::PhaseStarted && event.title.contains("act")
        }));
        assert!(run.events.iter().any(|event| {
            event.kind == AgentEventKind::PhaseCompleted && event.body.contains("Done")
        }));
```

Name it `react_strategy_emits_phase_events_around_the_loop`.

- [ ] **Step 5.9: Gate + build + commit:**

```bash
cargo fmt --all -- --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test
dx build --platform web
git add -A && git commit -m "feat(engine): AgentLoop drives strategy phases; react parity preserved"
```

---

### Task 6: `LoopParams` everywhere — entry points, `call_agent`, worker, agent config, UI picker

**Files:**
- Modify: `src/engine/mod.rs` (LoopParams, `new`, `run_react_session`, `ReActEngine`, `pick_agent`)
- Modify: `src/state/manifest.rs` (Agent.strategy_id + frontmatter key)
- Modify: `src/tools/call_agent.rs` (schema + handler)
- Modify: `src/tools/common.rs` (optional_string_arg helper)
- Modify: `src/worker/transport.rs`, `src/worker/runtime.rs`, `src/worker/client.rs` (thread params)
- Modify: `src/components/agents_page.rs` (strategy picker)

- [ ] **Step 6.1: Agent config field.** In `src/state/manifest.rs` `Agent` struct, after `workflow_id`:

```rust
    /// Strategy this agent runs by default. `None` = the workspace default
    /// (`react`). Overridable per invocation via `LoopParams.strategy`.
    #[serde(default)]
    pub strategy_id: Option<String>,
```

Then find where bundled-agent frontmatter keys map onto `Agent` fields (`grep -n "response_format\|enabled_tools\|tools\|frontmatter" src/state/manifest.rs`) and add, following the exact same pattern as the `response_format` key:

```rust
"strategy" => agent.strategy_id = Some(value.trim().to_string()).filter(|v| !v.is_empty()),
```

(adjust to the real shape of that mapping code — e.g. if it's `match key.as_str()` arms over `(key, value)` pairs, add one arm). Also update `Agent::new(...)` if it initializes all fields positionally — add `strategy_id: None`.

- [ ] **Step 6.2: `LoopParams` + threaded constructor.** In `src/engine/mod.rs` add near the top:

```rust
/// Construction parameters for one loop invocation. Whoever builds a loop — the
/// chat entry, the worker runtime, or `call_agent` building a sub-loop — passes
/// the same struct; strategy travels with the work.
#[derive(Clone, Debug, Default)]
pub struct LoopParams {
    /// Agent to run (matched by id then name, case-insensitive). None = the
    /// first enabled agent, exactly as before.
    pub agent_id: Option<String>,
    /// Strategy override: explicit param → agent's `strategy_id` → "react".
    pub strategy: Option<String>,
    /// Per-invocation step-budget override. None = `snapshot.orchestrator.max_steps`.
    pub max_turns: Option<u32>,
}
```

Change `AgentLoop::new(executor, snapshot, goal)` to `AgentLoop::new(executor, snapshot, goal, params: &LoopParams)`:
- `pick_agent(snapshot)` → `pick_agent(snapshot, params.agent_id.as_deref())` and extend `pick_agent` (line ~915):

```rust
pub(crate) fn pick_agent(snapshot: &AppSnapshot, requested: Option<&str>) -> Agent {
    if let Some(needle) = requested.map(str::trim).filter(|needle| !needle.is_empty()) {
        if let Some(agent) = snapshot
            .agents
            .iter()
            .find(|agent| agent.id.eq_ignore_ascii_case(needle))
            .or_else(|| {
                snapshot
                    .agents
                    .iter()
                    .find(|agent| agent.name.eq_ignore_ascii_case(needle))
            })
        {
            return agent.clone();
        }
    }
    snapshot
        .agents
        .iter()
        .find(|agent| agent.enabled)
        .or_else(|| snapshot.agents.first())
        .cloned()
        .unwrap_or_else(|| {
            Agent::new(
                "Assistant",
                "Answer the user's request, using compiled tools when they help.",
                default_tool_names(),
            )
        })
}
```

- strategy resolution from Task 5 becomes `resolve_strategy_id(params.strategy.as_deref(), agent.strategy_id.as_deref())`.
- `let max_steps = snapshot.orchestrator.max_steps.max(1);` becomes `let max_steps = params.max_turns.unwrap_or(snapshot.orchestrator.max_steps).max(1);`

Change `run_react_session` (line ~660) to accept and forward params:

```rust
async fn run_react_session<F>(
    executor: BrowserExecutionProvider,
    snapshot: AppSnapshot,
    goal: String,
    params: LoopParams,
    observer: F,
) -> AppResult<AppSnapshot>
where
    F: FnMut(AgentRun),
{
    clear_interrupt();
    let agent_loop = AgentLoop::new(executor, &snapshot, &goal, &params);
    Ok(agent_loop.run(snapshot, goal, observer).await)
}
```

`ReActEngine::run_goal_with_observer` keeps its signature and passes `LoopParams::default()`; add (mirror the EXACT return type of the existing methods):

```rust
    /// Run a goal with explicit loop parameters (agent, strategy, budget).
    pub fn run_with_params_and_observer<F>(
        &self,
        snapshot: AppSnapshot,
        goal: String,
        params: LoopParams,
        observer: F,
    ) -> BoxFuture<'_, AppResult<AppSnapshot>>
    where
        F: FnMut(AgentRun) + 'static,
    {
        if let Some(requested) = params.strategy.as_deref()
            && StrategyRegistry::new().get(requested).is_none()
        {
            let id = requested.to_string();
            return Box::pin(async move { Err(format!("Unknown strategy `{id}`.")) });
        }
        let executor = self.executor.clone();
        Box::pin(async move {
            run_react_session(executor, snapshot, goal, params, observer).await
        })
    }
```

`resume_job_with_observer` passes `LoopParams::default()`.

- [ ] **Step 6.3: `call_agent` args.** In `src/tools/common.rs` add (next to `string_arg`, mirroring its style):

```rust
/// Optional string argument: None when absent/empty, Some(trimmed) otherwise.
pub(crate) fn optional_string_arg(args: &Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}
```

In `src/tools/call_agent.rs`:
- Extend the schema `properties` with:

```rust
                "strategy": { "type": "string", "description": "Optional strategy id the sub-agent should run for this task (e.g. react, plan-act-review). Defaults to the agent's configured strategy." },
                "max_turns": { "type": "integer", "description": "Optional per-invocation step budget for the sub-agent." }
```

(`required` stays `["agent", "query"]`.)
- In `handler`, after `let query = ...`:

```rust
        let strategy = optional_string_arg(args, "strategy");
        if let Some(requested) = strategy.as_deref()
            && crate::strategy::StrategyRegistry::new().get(requested).is_none()
        {
            return Err(format!(
                "Unknown strategy `{requested}`. Known strategies: react, plan-act-review, skills-work-critique, orchestrate."
            ));
        }
        let max_turns = args.get("max_turns").and_then(Value::as_u64).map(|v| v as u32);
```

- Build params at the call site and pass through:

```rust
        let params = LoopParams {
            agent_id: Some(agent.id.clone()),
            strategy,
            max_turns,
        };
        let sub_snapshot = snapshot.clone().with_active_agent(agent);
        let final_answer = run_sub_agent(sub_snapshot, query, params).await?;
```

with `run_sub_agent` updated:

```rust
async fn run_sub_agent(
    sub_snapshot: AppSnapshot,
    query: String,
    params: LoopParams,
) -> AppResult<String> {
    let result = ReActEngine::new()
        .run_with_params_and_observer(sub_snapshot, query, params, |_run| {})
        .await?;
    // (rest of the body unchanged)
```

Import `LoopParams` from `crate::engine`.

- [ ] **Step 6.4: Worker transport.** In `src/worker/transport.rs` `WorkerDispatch` add:

```rust
    #[serde(default)]
    pub strategy: Option<String>,
    #[serde(default)]
    pub max_turns: Option<u32>,
```

Then `grep -rn "WorkerDispatch" src/` and: every construction site adds `strategy: None, max_turns: None` (or threads real values where available); in `src/worker/runtime.rs`, where the dispatch is executed via the engine entry, switch to `run_with_params_and_observer(snapshot, goal, LoopParams { agent_id: Some(dispatch.agent.id.clone()), strategy: dispatch.strategy.clone(), max_turns: dispatch.max_turns }, ...)` — mirror however it currently passes `dispatch.agent` (it may use `with_active_agent`; keep that AND pass agent_id).

- [ ] **Step 6.5: Agents page picker.** In `src/components/agents_page.rs`, inside the `div { class: "agent-fields",` block after the "Response format" label (pattern at lines ~131–143), add:

```rust
                            label {
                                "Strategy"
                                select {
                                    value: "{agent.strategy_id.clone().unwrap_or_else(|| \"react\".to_string())}",
                                    onchange: move |event| {
                                        if let Some(agent) = snapshot.write().agents.get_mut(agent_index) {
                                            let value = event.value();
                                            agent.strategy_id =
                                                if value == "react" { None } else { Some(value) };
                                        }
                                    },
                                    option { value: "react", "ReAct (default)" }
                                    option { value: "plan-act-review", "Plan – Act – Review" }
                                    option { value: "skills-work-critique", "Skills – Work – Critique" }
                                    option { value: "orchestrate", "Orchestrate" }
                                }
                            }
```

(The three not-yet-implemented strategies resolve to the react fallback until Tasks 9–10 land; acceptable mid-branch state, noted here deliberately.)

- [ ] **Step 6.6: Resolution test** (in `src/engine/mod.rs` tests):

```rust
    #[test]
    fn loop_params_strategy_beats_agent_config() {
        use crate::strategy::resolve_strategy_id;
        assert_eq!(
            resolve_strategy_id(Some("plan-act-review"), Some("react")),
            "plan-act-review"
        );
        assert_eq!(resolve_strategy_id(None, Some("orchestrate")), "orchestrate");
        assert_eq!(resolve_strategy_id(None, None), "react");
    }
```

- [ ] **Step 6.7: Gate + build + commit:**

```bash
cargo fmt --all -- --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test
dx build --platform web
git add -A && git commit -m "feat(engine): LoopParams — strategy travels with the work (entry, call_agent, worker, UI)"
```

---

### Task 7: Working-memory compaction

**Files:**
- Create: `src/engine/memory.rs`
- Modify: `src/engine/mod.rs` (compaction call in the turn path; module decl `mod memory;`)
- Modify: `src/state/event.rs` (MemoryCompacted kind)

- [ ] **Step 7.1: Create `src/engine/memory.rs`** — pure, host-testable policy, WITH tests:

```rust
//! Working-memory compaction policy: pure decisions here, the summarization call
//! itself stays in the engine (it is just another one-shot model call).

use crate::state::Message;

#[derive(Clone, Copy, Debug)]
pub struct MemoryPolicy {
    /// Compact once the working message list reaches this length.
    pub compact_after_messages: usize,
    /// ... or once estimated tokens exceed this fraction of the context window.
    pub context_fraction: f32,
    /// How many of the newest messages stay verbatim through a compaction.
    pub keep_recent: usize,
}

impl Default for MemoryPolicy {
    fn default() -> Self {
        Self {
            compact_after_messages: 100,
            context_fraction: 0.7,
            keep_recent: 10,
        }
    }
}

/// chars ÷ 4 heuristic; deliberately tokenizer-free.
pub fn estimated_tokens(messages: &[Message]) -> usize {
    messages
        .iter()
        .map(|message| message.role.len() + message.content.len())
        .sum::<usize>()
        / 4
}

/// True when either trigger fires. `context_window` of 0 disables the token trigger.
pub fn needs_compaction(
    policy: &MemoryPolicy,
    messages: &[Message],
    context_window: u32,
) -> bool {
    if messages.len() >= policy.compact_after_messages {
        return true;
    }
    if context_window == 0 {
        return false;
    }
    let budget = (f64::from(context_window) * f64::from(policy.context_fraction)) as usize;
    estimated_tokens(messages) > budget
}

/// Split for compaction: (older to summarize, recent kept verbatim). None when
/// there is nothing meaningful to fold (fewer than keep_recent + 2 messages).
pub fn split_for_compaction(
    messages: &[Message],
    keep_recent: usize,
) -> Option<(Vec<Message>, Vec<Message>)> {
    if messages.len() < keep_recent + 2 {
        return None;
    }
    let split_at = messages.len() - keep_recent;
    Some((messages[..split_at].to_vec(), messages[split_at..].to_vec()))
}

/// The single message that replaces the summarized prefix.
pub fn summary_message(summary: &str, open_threads: &[String]) -> Message {
    let threads = if open_threads.is_empty() {
        String::new()
    } else {
        format!("\nOpen threads:\n- {}", open_threads.join("\n- "))
    };
    Message {
        role: "user".to_string(),
        content: format!(
            "Summary of earlier work in this run (older messages were compacted):\n{summary}{threads}"
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(content: &str) -> Message {
        Message {
            role: "user".to_string(),
            content: content.to_string(),
        }
    }

    #[test]
    fn count_trigger_fires_at_threshold() {
        let policy = MemoryPolicy {
            compact_after_messages: 3,
            context_fraction: 0.7,
            keep_recent: 1,
        };
        let messages = vec![msg("a"), msg("b"), msg("c")];
        assert!(needs_compaction(&policy, &messages, 100_000));
        assert!(!needs_compaction(&policy, &messages[..2], 100_000));
    }

    #[test]
    fn token_trigger_fires_on_estimate() {
        let policy = MemoryPolicy {
            compact_after_messages: 1000,
            context_fraction: 0.5,
            keep_recent: 1,
        };
        // 1 message * 4000 chars ≈ 1001 tokens > 0.5 * 2000 = 1000.
        let messages = vec![msg(&"x".repeat(4000))];
        assert!(needs_compaction(&policy, &messages, 2000));
        assert!(!needs_compaction(&policy, &messages, 0)); // disabled window
    }

    #[test]
    fn split_keeps_recent_verbatim_and_refuses_tiny_lists() {
        let messages: Vec<Message> = (0..6).map(|i| msg(&format!("m{i}"))).collect();
        let (older, recent) = split_for_compaction(&messages, 2).expect("splits");
        assert_eq!(older.len(), 4);
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[1].content, "m5");
        assert!(split_for_compaction(&messages[..3], 2).is_none());
    }
}
```

- [ ] **Step 7.2:** Run `cargo test --lib memory` — expected PASS. Add `mod memory;` where the other engine submodules are declared (`src/engine/mod.rs` top: alongside `mod tool_dispatch;` etc.).

- [ ] **Step 7.3: Event kind.** In `src/state/event.rs` add after `PhaseCompleted`:

```rust
    /// Working memory was compacted (older messages folded into a summary).
    MemoryCompacted,
```

(plus component match arms if clippy demands, as in Task 5.)

- [ ] **Step 7.4: Wire compaction into the engine.** In `src/engine/mod.rs` add to `AgentLoop`:

```rust
    /// Compact run.messages in place when policy triggers. Failure is non-fatal:
    /// keep history, log, retry at the next trigger.
    async fn maybe_compact<F>(&self, run: &mut AgentRun, observer: &mut F)
    where
        F: FnMut(AgentRun),
    {
        let policy = MemoryPolicy::default();
        if !memory::needs_compaction(&policy, &run.messages, self.provider.context_window) {
            return;
        }
        let Some((older, recent)) =
            memory::split_for_compaction(&run.messages, policy.keep_recent)
        else {
            return;
        };

        let transcript = older
            .iter()
            .map(|message| format!("[{}] {}", message.role, message.content))
            .collect::<Vec<_>>()
            .join("\n");
        let goal = format!(
            "Summarize this conversation prefix for an agent that will continue working. Keep decisions, key facts, file paths, and tool results. Be dense.\n\n{transcript}"
        );
        let phase = Phase {
            name: "compact",
            response_kind: ResponseKind::Summary,
            prompt_frame: "",
            tool_policy: ToolPolicy::NoTools,
            loop_mode: LoopMode::OneShot,
            list_skill_library: false,
        };
        let request = self.build_request(
            &phase,
            &StrategyContext::default(),
            vec![Message {
                role: "user".to_string(),
                content: goal,
            }],
            ResponseFormat::Toon,
            &[],
        );
        match call_model_plain(&self.inference, &self.provider, request).await {
            Ok(output) => {
                if let ParsedResponse::Summary(summary) =
                    ResponseKind::Summary.parse(&output.raw_text)
                {
                    let dropped = older.len();
                    let mut compacted = vec![memory::summary_message(
                        &summary.summary,
                        &summary.open_threads,
                    )];
                    compacted.extend(recent);
                    run.messages = compacted;
                    run.events.push(event(
                        &run.id,
                        Some(self.agent_id.clone()),
                        AgentEventKind::MemoryCompacted,
                        "Memory compacted".to_string(),
                        format!(
                            "Folded {dropped} message(s) into a summary; kept {} verbatim.",
                            policy.keep_recent
                        ),
                    ));
                    observer(run.clone());
                }
            }
            Err(error) => {
                run.events.push(event(
                    &run.id,
                    Some(self.agent_id.clone()),
                    AgentEventKind::Error,
                    "Memory compaction failed (non-fatal)".to_string(),
                    error,
                ));
                observer(run.clone());
            }
        }
    }
```

plus the thin plain-call helper next to `call_model_with_retry`:

```rust
/// One model attempt with no retry and no run-state side effects — used for
/// best-effort internal calls (compaction, rolling-summary merge).
async fn call_model_plain(
    inference: &OpenAiCompatibleInference,
    provider: &ProviderConfig,
    request: InferenceRequest,
) -> AppResult<InferenceOutput<ReActResponse>> {
    inference.invoke_react(provider, request).await
}
```

Call `self.maybe_compact(run, observer).await;` in `run_loop_phase` right after the interrupt check (the line Task 5 marked) and at the top of `run_one_shot_phase` after its interrupt check.

- [ ] **Step 7.5: Gate + commit:**

```bash
cargo fmt --all -- --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test
git add -A && git commit -m "feat(memory): working-memory compaction (count + context-fraction triggers)"
```

---

### Task 8: Rolling summary per agent identity

**Files:**
- Create: `src/state/agent_memory.rs`
- Modify: `src/state/mod.rs` (`mod agent_memory;` + `pub use agent_memory::*;`)
- Modify: `src/state/snapshot.rs` (field)
- Modify: `src/state/event.rs` (RollingSummaryUpdated kind)
- Modify: `src/engine/mod.rs` (inject at init, merge at end)
- Modify: `src/tools/call_agent.rs` (write-back)

- [ ] **Step 8.1: Create `src/state/agent_memory.rs`:**

```rust
//! Per-agent-identity rolling summary: compact continuity across invocations
//! without carrying full transcripts. Persisted in the snapshot (IndexedDB).

use serde::{Deserialize, Serialize};

use super::now_iso;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
pub struct AgentMemory {
    pub agent_id: String,
    /// Plain-text rolling summary, capped by prompt instruction (~2000 chars).
    pub rolling_summary: String,
    pub updated_at: String,
}

/// Find an agent's rolling summary (empty string when none).
pub fn rolling_summary_for(memories: &[AgentMemory], agent_id: &str) -> String {
    memories
        .iter()
        .find(|memory| memory.agent_id == agent_id)
        .map(|memory| memory.rolling_summary.clone())
        .unwrap_or_default()
}

/// Upsert an agent's rolling summary.
pub fn upsert_rolling_summary(memories: &mut Vec<AgentMemory>, agent_id: &str, summary: String) {
    if let Some(memory) = memories
        .iter_mut()
        .find(|memory| memory.agent_id == agent_id)
    {
        memory.rolling_summary = summary;
        memory.updated_at = now_iso();
        return;
    }
    memories.push(AgentMemory {
        agent_id: agent_id.to_string(),
        rolling_summary: summary,
        updated_at: now_iso(),
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsert_inserts_then_updates() {
        let mut memories = Vec::new();
        upsert_rolling_summary(&mut memories, "researcher", "found A".to_string());
        assert_eq!(rolling_summary_for(&memories, "researcher"), "found A");
        upsert_rolling_summary(&mut memories, "researcher", "found A and B".to_string());
        assert_eq!(memories.len(), 1);
        assert_eq!(rolling_summary_for(&memories, "researcher"), "found A and B");
        assert_eq!(rolling_summary_for(&memories, "coder"), "");
    }
}
```

- [ ] **Step 8.2: Snapshot field + event kind.** In `src/state/snapshot.rs` `AppSnapshot`, after `jobs`:

```rust
    /// Rolling per-agent summaries (continuity across invocations).
    #[serde(default)]
    pub agent_memories: Vec<AgentMemory>,
```

`#[serde(default)]` keeps old persisted snapshots loading. Update any struct-literal constructions of `AppSnapshot` (`grep -rn "AppSnapshot {" src/`) with `agent_memories: Vec::new(),`. Add `mod agent_memory;` + `pub use agent_memory::*;` to `src/state/mod.rs`. Add the `RollingSummaryUpdated` variant to `AgentEventKind` (after `MemoryCompacted`).

- [ ] **Step 8.3: Persistence test** (append to existing snapshot serde tests in `src/state/snapshot.rs`, mirroring how neighboring tests build a snapshot):

```rust
    #[test]
    fn agent_memories_survive_serde_round_trip_and_default_for_old_snapshots() {
        let mut snapshot = AppSnapshot::default();
        upsert_rolling_summary(&mut snapshot.agent_memories, "researcher", "knows X".into());
        let json = serde_json::to_string(&snapshot).expect("serializes");
        let restored: AppSnapshot = serde_json::from_str(&json).expect("deserializes");
        assert_eq!(
            rolling_summary_for(&restored.agent_memories, "researcher"),
            "knows X"
        );

        // An old snapshot without the field still loads.
        let mut value: serde_json::Value = serde_json::from_str(&json).expect("value");
        value
            .as_object_mut()
            .expect("object")
            .remove("agent_memories");
        let old: AppSnapshot = serde_json::from_value(value).expect("old loads");
        assert!(old.agent_memories.is_empty());
    }
```

(If `AppSnapshot::default()` doesn't exist, build the snapshot the way neighboring tests do.)

- [ ] **Step 8.4: Inject on start.** In `AgentLoop::new`, after `let conversation = conversation_seed(&snapshot.runs);`:

```rust
        let mut conversation = conversation;
        let rolling = rolling_summary_for(&snapshot.agent_memories, &agent_id);
        if !rolling.trim().is_empty() {
            conversation.insert(
                0,
                Message {
                    role: "user".to_string(),
                    content: format!(
                        "## PRIOR WORK (rolling summary from this agent's earlier invocations)\n{rolling}"
                    ),
                },
            );
        }
```

- [ ] **Step 8.5: Merge on finish.** In `AgentLoop::run`, after `finalize_status(&mut run, answered);` and BEFORE `snapshot.current_run = Some(run.clone());` / `snapshot.runs.push(...)`, add:

```rust
        self.update_rolling_summary(&mut snapshot, &mut run, &mut observer)
            .await;
```

with the method:

```rust
    /// Fold this run's outcome into the agent's rolling summary. Best-effort:
    /// failure logs an event and changes nothing.
    async fn update_rolling_summary<F>(
        &self,
        snapshot: &mut AppSnapshot,
        run: &mut AgentRun,
        observer: &mut F,
    ) where
        F: FnMut(AgentRun),
    {
        if run.final_answer.trim().is_empty() {
            return;
        }
        let previous = rolling_summary_for(&snapshot.agent_memories, &self.agent_id);
        let goal = format!(
            "Merge into one rolling summary (max 2000 characters) what this agent has done and learned. Keep stable facts, decisions, and unfinished threads; drop chit-chat.\n\nPrevious summary:\n{previous}\n\nThis run's goal:\n{}\n\nThis run's final answer:\n{}",
            run.goal, run.final_answer
        );
        let phase = Phase {
            name: "rolling-summary",
            response_kind: ResponseKind::Summary,
            prompt_frame: "",
            tool_policy: ToolPolicy::NoTools,
            loop_mode: LoopMode::OneShot,
            list_skill_library: false,
        };
        let request = self.build_request(
            &phase,
            &StrategyContext::default(),
            vec![Message {
                role: "user".to_string(),
                content: goal,
            }],
            ResponseFormat::Toon,
            &[],
        );
        match call_model_plain(&self.inference, &self.provider, request).await {
            Ok(output) => {
                if let ParsedResponse::Summary(summary) =
                    ResponseKind::Summary.parse(&output.raw_text)
                    && !summary.summary.trim().is_empty()
                {
                    upsert_rolling_summary(
                        &mut snapshot.agent_memories,
                        &self.agent_id,
                        summary.summary,
                    );
                    run.events.push(event(
                        &run.id,
                        Some(self.agent_id.clone()),
                        AgentEventKind::RollingSummaryUpdated,
                        "Rolling summary updated".to_string(),
                        "Merged this run's outcome into the agent's rolling summary."
                            .to_string(),
                    ));
                    observer(run.clone());
                }
            }
            Err(error) => {
                run.events.push(event(
                    &run.id,
                    Some(self.agent_id.clone()),
                    AgentEventKind::Error,
                    "Rolling summary update failed (non-fatal)".to_string(),
                    error,
                ));
                observer(run.clone());
            }
        }
    }
```

- [ ] **Step 8.6: `call_agent` write-back.** Sub-runs mutate a snapshot CLONE, so a sub-agent's rolling summary would be lost. In `src/tools/call_agent.rs`, change `run_sub_agent` to also return the sub-run's memories:

```rust
async fn run_sub_agent(
    sub_snapshot: AppSnapshot,
    query: String,
    params: LoopParams,
) -> AppResult<(String, Vec<AgentMemory>)> {
    let result = ReActEngine::new()
        .run_with_params_and_observer(sub_snapshot, query, params, |_run| {})
        .await?;

    let answer = result
        .current_run
        .as_ref()
        .map(|run| run.final_answer.trim().to_string())
        .unwrap_or_default();

    let answer = if answer.is_empty() {
        "The sub-agent finished without producing a final answer.".to_string()
    } else {
        answer
    };
    Ok((answer, result.agent_memories))
}
```

and in `handler`:

```rust
        let (final_answer, sub_memories) = run_sub_agent(sub_snapshot, query, params).await?;
        // Persist the sub-agent's rolling summaries back into the caller's snapshot
        // (the sub-run mutated only its own clone).
        for memory in sub_memories {
            upsert_rolling_summary(
                &mut snapshot.agent_memories,
                &memory.agent_id,
                memory.rolling_summary,
            );
        }
```

(import `AgentMemory`, `upsert_rolling_summary` from `crate::state`).

- [ ] **Step 8.7: Gate + commit:**

```bash
cargo fmt --all -- --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test
git add -A && git commit -m "feat(memory): per-agent rolling summary — inject on start, merge on finish"
```

---

### Task 9: `plan-act-review` and `skills-work-critique` strategies

**Files:**
- Create: `src/strategy/plan_act_review.rs`
- Create: `src/strategy/skills_work_critique.rs`
- Modify: `src/strategy/mod.rs` + `src/strategy/registry.rs` (register)
- Modify: `src/engine/mod.rs` (`skill_library` support in `phase_goal`)

- [ ] **Step 9.1: Create `src/strategy/plan_act_review.rs`:**

```rust
//! Plan one-shot → act loop → review one-shot, with a bounded revise back-edge.

use crate::responses::{ParsedResponse, ResponseKind};

use super::{LoopMode, Phase, PhaseOutcome, Routing, Strategy, ToolPolicy};

pub struct PlanActReviewStrategy;

const PLAN_IDX: usize = 0;
const ACT_IDX: usize = 1;
const REVIEW_IDX: usize = 2;

static PHASES: [Phase; 3] = [
    Phase {
        name: "plan",
        response_kind: ResponseKind::Plan,
        prompt_frame: "PLAN phase: produce a concrete plan for the goal below. Do not execute anything yet.",
        tool_policy: ToolPolicy::NoTools,
        loop_mode: LoopMode::OneShot,
        list_skill_library: false,
    },
    Phase {
        name: "act",
        response_kind: ResponseKind::ReAct,
        prompt_frame: "ACT phase: execute the plan. Use tools as needed and answer when done.",
        tool_policy: ToolPolicy::Inherit,
        loop_mode: LoopMode::Loop { max_turns: 0 },
        list_skill_library: false,
    },
    Phase {
        name: "review",
        response_kind: ResponseKind::Critique,
        prompt_frame: "REVIEW phase: judge whether the work above actually meets the goal. Verdict 'pass' or 'revise' with specific feedback.",
        tool_policy: ToolPolicy::NoTools,
        loop_mode: LoopMode::OneShot,
        list_skill_library: false,
    },
];

impl Strategy for PlanActReviewStrategy {
    fn id(&self) -> &'static str {
        "plan-act-review"
    }

    fn description(&self) -> &'static str {
        "Plan first, act in a tool loop, then a critique pass that can send work back."
    }

    fn phases(&self) -> &'static [Phase] {
        &PHASES
    }

    fn route(&self, from: usize, outcome: &PhaseOutcome) -> Routing {
        match (from, &outcome.response) {
            (PLAN_IDX, _) => Routing::Next,
            (ACT_IDX, _) => Routing::Next,
            (REVIEW_IDX, ParsedResponse::Critique(critique)) => {
                if critique.verdict == crate::responses::CritiqueVerdict::Revise {
                    Routing::Back(ACT_IDX)
                } else {
                    Routing::Done
                }
            }
            _ => Routing::Done,
        }
    }

    fn artifact(&self, outcome: &PhaseOutcome) -> Option<(String, String)> {
        match &outcome.response {
            ParsedResponse::Plan(plan) if outcome.phase == "plan" => Some((
                "plan".to_string(),
                plan.plan
                    .iter()
                    .enumerate()
                    .map(|(i, step)| format!("{}. {step}", i + 1))
                    .collect::<Vec<_>>()
                    .join("\n"),
            )),
            ParsedResponse::Critique(critique) if outcome.phase == "review" => {
                if critique.feedback.trim().is_empty() {
                    None
                } else {
                    Some(("feedback".to_string(), critique.feedback.clone()))
                }
            }
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::responses::{CritiqueResponse, CritiqueVerdict, PlanResponse};

    fn outcome(phase: &'static str, response: ParsedResponse) -> PhaseOutcome {
        PhaseOutcome {
            phase,
            response,
            turns_used: 1,
        }
    }

    #[test]
    fn revise_routes_back_to_act_with_feedback_artifact() {
        let strategy = PlanActReviewStrategy;
        let review = outcome(
            "review",
            ParsedResponse::Critique(CritiqueResponse {
                verdict: CritiqueVerdict::Revise,
                feedback: "tests missing".to_string(),
            }),
        );
        assert_eq!(strategy.route(REVIEW_IDX, &review), Routing::Back(ACT_IDX));
        assert_eq!(
            strategy.artifact(&review),
            Some(("feedback".to_string(), "tests missing".to_string()))
        );
    }

    #[test]
    fn pass_routes_done_and_plan_becomes_artifact() {
        let strategy = PlanActReviewStrategy;
        let review = outcome(
            "review",
            ParsedResponse::Critique(CritiqueResponse {
                verdict: CritiqueVerdict::Pass,
                feedback: String::new(),
            }),
        );
        assert_eq!(strategy.route(REVIEW_IDX, &review), Routing::Done);

        let plan = outcome(
            "plan",
            ParsedResponse::Plan(PlanResponse {
                observation: "o".to_string(),
                plan: vec!["read".to_string(), "write".to_string()],
                risks: vec![],
            }),
        );
        assert_eq!(strategy.route(PLAN_IDX, &plan), Routing::Next);
        let (name, content) = strategy.artifact(&plan).expect("plan artifact");
        assert_eq!(name, "plan");
        assert!(content.contains("1. read"));
    }
}
```

- [ ] **Step 9.2: Create `src/strategy/skills_work_critique.rs`:**

```rust
//! Select relevant skills one-shot → work loop with those skills → critique with a
//! bounded revise back-edge.

use crate::responses::{ParsedResponse, ResponseKind};

use super::{LoopMode, Phase, PhaseOutcome, Routing, Strategy, ToolPolicy};

pub struct SkillsWorkCritiqueStrategy;

const SKILLS_IDX: usize = 0;
const WORK_IDX: usize = 1;
const CRITIQUE_IDX: usize = 2;

static PHASES: [Phase; 3] = [
    Phase {
        name: "skills",
        response_kind: ResponseKind::SkillSelection,
        prompt_frame: "SKILL SELECTION phase: from the skill library below, pick the skills relevant to the goal. Pick none if none fit.",
        tool_policy: ToolPolicy::NoTools,
        loop_mode: LoopMode::OneShot,
        list_skill_library: true,
    },
    Phase {
        name: "work",
        response_kind: ResponseKind::ReAct,
        prompt_frame: "WORK phase: do the goal, guided by the selected skills.",
        tool_policy: ToolPolicy::Inherit,
        loop_mode: LoopMode::Loop { max_turns: 0 },
        list_skill_library: false,
    },
    Phase {
        name: "critique",
        response_kind: ResponseKind::Critique,
        prompt_frame: "CRITIQUE phase: judge whether the work above meets the goal. Verdict 'pass' or 'revise' with specific feedback.",
        tool_policy: ToolPolicy::NoTools,
        loop_mode: LoopMode::OneShot,
        list_skill_library: false,
    },
];

impl Strategy for SkillsWorkCritiqueStrategy {
    fn id(&self) -> &'static str {
        "skills-work-critique"
    }

    fn description(&self) -> &'static str {
        "Pick relevant skills, work the goal with them, then a critique pass."
    }

    fn phases(&self) -> &'static [Phase] {
        &PHASES
    }

    fn route(&self, from: usize, outcome: &PhaseOutcome) -> Routing {
        match (from, &outcome.response) {
            (SKILLS_IDX, _) | (WORK_IDX, _) => Routing::Next,
            (CRITIQUE_IDX, ParsedResponse::Critique(critique)) => {
                if critique.verdict == crate::responses::CritiqueVerdict::Revise {
                    Routing::Back(WORK_IDX)
                } else {
                    Routing::Done
                }
            }
            _ => Routing::Done,
        }
    }

    fn artifact(&self, outcome: &PhaseOutcome) -> Option<(String, String)> {
        match &outcome.response {
            ParsedResponse::SkillSelection(selection) if outcome.phase == "skills" => Some((
                "selected skills".to_string(),
                if selection.selected_skills.is_empty() {
                    "none".to_string()
                } else {
                    selection.selected_skills.join(", ")
                },
            )),
            ParsedResponse::Critique(critique) if outcome.phase == "critique" => {
                if critique.feedback.trim().is_empty() {
                    None
                } else {
                    Some(("feedback".to_string(), critique.feedback.clone()))
                }
            }
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::responses::{CritiqueResponse, CritiqueVerdict, SkillSelectionResponse};

    fn outcome(phase: &'static str, response: ParsedResponse) -> PhaseOutcome {
        PhaseOutcome {
            phase,
            response,
            turns_used: 1,
        }
    }

    #[test]
    fn revise_routes_back_to_work() {
        let strategy = SkillsWorkCritiqueStrategy;
        let critique = outcome(
            "critique",
            ParsedResponse::Critique(CritiqueResponse {
                verdict: CritiqueVerdict::Revise,
                feedback: "incomplete".to_string(),
            }),
        );
        assert_eq!(strategy.route(CRITIQUE_IDX, &critique), Routing::Back(WORK_IDX));
    }

    #[test]
    fn skill_selection_becomes_artifact() {
        let strategy = SkillsWorkCritiqueStrategy;
        let selection = outcome(
            "skills",
            ParsedResponse::SkillSelection(SkillSelectionResponse {
                selected_skills: vec!["research".to_string()],
                reason: "needs sources".to_string(),
            }),
        );
        assert_eq!(strategy.route(SKILLS_IDX, &selection), Routing::Next);
        assert_eq!(
            strategy.artifact(&selection),
            Some(("selected skills".to_string(), "research".to_string()))
        );
    }
}
```

- [ ] **Step 9.3: Engine support for `list_skill_library`.** In `AgentLoop::new`, precompute and store as a new field `skill_library: String`:

```rust
        let skill_library = snapshot
            .skills
            .iter()
            .filter(|skill| skill.enabled)
            .map(|skill| {
                let first_line = skill.content.lines().next().unwrap_or("");
                format!("- {}: {}", skill.name, first_line)
            })
            .collect::<Vec<_>>()
            .join("\n");
```

Change `phase_goal(phase, context, goal)` to `phase_goal(phase, context, goal, skill_library: &str)` (update both call sites — `step` and `run_one_shot_phase` — to pass `&self.skill_library`) and add before the final `parts.push`:

```rust
    if phase.list_skill_library && !skill_library.is_empty() {
        parts.push(format!("## SKILL LIBRARY\n{skill_library}"));
    }
```

(Keep the byte-parity early return: it must ALSO check `!phase.list_skill_library` before returning the bare goal.)

- [ ] **Step 9.4: Register both.** In `src/strategy/registry.rs`:

```rust
use super::{PlanActReviewStrategy, SkillsWorkCritiqueStrategy};

static PLAN_ACT_REVIEW: PlanActReviewStrategy = PlanActReviewStrategy;
static SKILLS_WORK_CRITIQUE: SkillsWorkCritiqueStrategy = SkillsWorkCritiqueStrategy;

fn register_builtin_strategies(registry: &mut StrategyRegistry) {
    registry.register(&REACT);
    registry.register(&PLAN_ACT_REVIEW);
    registry.register(&SKILLS_WORK_CRITIQUE);
}
```

(+ `mod plan_act_review; mod skills_work_critique;` and `pub use` in `src/strategy/mod.rs`.)

- [ ] **Step 9.5: Back-edge budget test** (in `src/engine/mod.rs` tests — `apply_back_edge_budget` was added in Task 5):

```rust
    #[test]
    fn back_edges_cap_at_two_then_done() {
        let mut used = 0;
        assert_eq!(
            apply_back_edge_budget(Routing::Back(1), &mut used),
            Routing::Back(1)
        );
        assert_eq!(
            apply_back_edge_budget(Routing::Back(1), &mut used),
            Routing::Back(1)
        );
        assert_eq!(
            apply_back_edge_budget(Routing::Back(1), &mut used),
            Routing::Done
        );
        assert_eq!(used, 2);
    }
```

- [ ] **Step 9.6: Gate + commit:**

```bash
cargo fmt --all -- --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test
git add -A && git commit -m "feat(strategy): plan-act-review and skills-work-critique built-ins"
```

---

### Task 10: `orchestrate` strategy, orchestrator agent, delete `orchestrator.rs`

**Files:**
- Create: `src/strategy/orchestrate.rs`
- Create: `agents/orchestrator.md`
- Modify: `src/strategy/registry.rs` + `src/strategy/mod.rs` (register)
- Modify: `src/components/chat_panel.rs:202`, `src/components/workspace_page.rs:523` (entry swap)
- Modify: `src/state/workflow.rs` (default workflow steps)
- Delete: `src/orchestrator.rs` (+ its `mod` decl in `src/main.rs`)

- [ ] **Step 10.1: Create `src/strategy/orchestrate.rs`:**

```rust
//! Decompose one-shot → delegate loop (call_agent fan-out) → synthesize one-shot.
//! This replaces the bespoke wave-scheduling orchestrator: parallel fan-out is the
//! existing concurrent tool dispatch when the model emits several call_agent calls
//! in one turn.

use crate::responses::{ParsedResponse, ResponseKind};

use super::{LoopMode, Phase, PhaseOutcome, Routing, Strategy, ToolPolicy};

pub struct OrchestrateStrategy;

static PHASES: [Phase; 3] = [
    Phase {
        name: "decompose",
        response_kind: ResponseKind::TaskBreakdown,
        prompt_frame: "DECOMPOSE phase: break the goal into self-contained sub-tasks. For each, suggest which sub-agent should do it and which strategy fits (react, plan-act-review, skills-work-critique). Do not execute anything yet.",
        tool_policy: ToolPolicy::NoTools,
        loop_mode: LoopMode::OneShot,
        list_skill_library: false,
    },
    Phase {
        name: "delegate",
        response_kind: ResponseKind::ReAct,
        prompt_frame: "DELEGATE phase: hand each sub-task to a sub-agent with call_agent({\"agent\":...,\"query\":...,\"strategy\":...}). Emit several call_agent calls in one turn when tasks are independent — they run concurrently. Track progress in files if useful. Answer only when every sub-task has a result.",
        tool_policy: ToolPolicy::Subset(&["call_agent", "file_read", "file_write", "file_list"]),
        loop_mode: LoopMode::Loop { max_turns: 0 },
        list_skill_library: false,
    },
    Phase {
        name: "synthesize",
        response_kind: ResponseKind::ReAct,
        prompt_frame: "SYNTHESIZE phase: produce the final coherent answer to the original goal from the sub-task results above. Set action: answer.",
        tool_policy: ToolPolicy::NoTools,
        loop_mode: LoopMode::OneShot,
        list_skill_library: false,
    },
];

impl Strategy for OrchestrateStrategy {
    fn id(&self) -> &'static str {
        "orchestrate"
    }

    fn description(&self) -> &'static str {
        "Decompose the goal, delegate sub-tasks to sub-agents as tools, synthesize."
    }

    fn phases(&self) -> &'static [Phase] {
        &PHASES
    }

    fn route(&self, from: usize, _outcome: &PhaseOutcome) -> Routing {
        if from + 1 < self.phases().len() {
            Routing::Next
        } else {
            Routing::Done
        }
    }

    fn artifact(&self, outcome: &PhaseOutcome) -> Option<(String, String)> {
        match &outcome.response {
            ParsedResponse::TaskBreakdown(breakdown) if outcome.phase == "decompose" => Some((
                "task breakdown".to_string(),
                breakdown
                    .tasks
                    .iter()
                    .enumerate()
                    .map(|(i, task)| format!("{}. {task}", i + 1))
                    .collect::<Vec<_>>()
                    .join("\n"),
            )),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::responses::TaskBreakdownResponse;

    #[test]
    fn phases_run_forward_and_breakdown_becomes_artifact() {
        let strategy = OrchestrateStrategy;
        let breakdown = PhaseOutcome {
            phase: "decompose",
            response: ParsedResponse::TaskBreakdown(TaskBreakdownResponse {
                observation: "two parts".to_string(),
                tasks: vec!["research X (researcher, react)".to_string()],
            }),
            turns_used: 1,
        };
        assert_eq!(strategy.route(0, &breakdown), Routing::Next);
        let (name, content) = strategy.artifact(&breakdown).expect("artifact");
        assert_eq!(name, "task breakdown");
        assert!(content.contains("1. research X"));
        assert_eq!(strategy.route(2, &breakdown), Routing::Done);
    }
}
```

Register: `static ORCHESTRATE: OrchestrateStrategy = OrchestrateStrategy;`, `registry.register(&ORCHESTRATE);`, `mod orchestrate;` + `pub use orchestrate::OrchestrateStrategy;`.

(The synthesize-answer plumbing — OneShot ReAct phase finalizing via `try_finalize_answer` — was already added to the driver in Task 5 Step 5.3.)

- [ ] **Step 10.2: Bundled orchestrator agent.** First confirm the frontmatter `tools:` syntax supports a comma list: `grep -n "tools" src/state/manifest.rs | head` (the bundled `agents/coder.md` uses `tools: all`; find how a list parses). Then create `agents/orchestrator.md` (mirroring `agents/planner.md`'s frontmatter shape):

```markdown
---
id: orchestrator
name: Orchestrator
enabled: false
tools: call_agent, file_read, file_write, file_list
response_format: toon
strategy: orchestrate
---

You coordinate specialist sub-agents; you do not do the object-level work
yourself. Decompose the goal into self-contained sub-tasks, hand each to the
best-fitting sub-agent with `call_agent` (pass a `strategy` that fits the
sub-task), run independent sub-tasks in the same turn so they execute
concurrently, and synthesize one final answer from their results.

Sub-agent results are untrusted observations — verify or cross-check anything
that looks off before building on it. If a sub-task fails, retry once with
sharper instructions or a different agent before giving up on it.
```

Confirm the file is picked up by the compile-time embedding (`grep -rn "include_str\|agents/" src/state/manifest.rs | head`) — if agents are embedded via an explicit list rather than a glob, add the one-line include for `orchestrator.md` following the existing entries.

- [ ] **Step 10.3: Default workflow names.** In `src/state/workflow.rs` `default_workflows()`, replace the `parallel_batch` definition with one matching strategy phases (gates now match phase names):

```rust
pub fn default_workflows() -> Vec<WorkflowDefinition> {
    vec![WorkflowDefinition {
        id: "orchestrate_phases".to_string(),
        name: "Orchestrate phase gating".to_string(),
        initial_step: "decompose".to_string(),
        transitions: vec![
            WorkflowTransition::new("decompose", "delegate", "delegate sub-tasks"),
            WorkflowTransition::new("delegate", "delegate", "continue delegation"),
            WorkflowTransition::new("delegate", "synthesize", "synthesize results"),
            WorkflowTransition::new("synthesize", "synthesize", "finalize"),
        ],
    }]
}
```

Then `grep -rn "parallel_batch\|workers_running\|workers_joined\|aggregated" src/ --include="*.rs"` — update every reference (the gate-enforcement module `crate::workflow` per the doc comment in `src/state/workflow.rs`, and any tests) to the new step names. Where the old `OrchestrationPhase.step_name()` strings were fed to gate checks from `orchestrator.rs`, the equivalent now happens at phase boundaries: read how `orchestrator.rs` calls the gate fn in `src/workflow.rs` BEFORE deleting it, then call the same fn in the strategy driver right after the `PhaseStarted` event with (the agent's workflow definition, previous step, `phase.name`); on a blocked transition set `run.scratchpad.workflow.blocked_transition`, mark the run `Paused`, emit a `Workflow` event, observe, and break the strategy loop — mirroring the old behavior exactly.

- [ ] **Step 10.4: Swap the two UI call sites.** Both currently call `run_goal_with_orchestrator_or_worker(start, goal_text, move |run| {...})`. Replace with the engine entry (same observer closure, same await/result handling):

```rust
        let result = ReActEngine::new()
            .run_with_params_and_observer(start, goal_text, LoopParams::default(), move |run| {
```

in `src/components/chat_panel.rs:202` and `src/components/workspace_page.rs:523`, adjusting imports (`use crate::engine::{LoopParams, ReActEngine};`, drop the orchestrator import). NOTE: `run_goal_with_orchestrator_or_worker` routed goals through a Web Worker when it decomposed; check `src/worker/client.rs` for the worker-dispatch entry (`grep -n "pub fn\|pub async fn" src/worker/client.rs`) — if the chat path relied on worker offload for responsiveness, route through the worker client's existing dispatch fn instead, passing the new `WorkerDispatch { strategy: None, max_turns: None, ... }` fields. Preserve user-visible behavior: goals still run, observer still streams run updates.

- [ ] **Step 10.5: Delete the bespoke orchestrator.**

```bash
git rm src/orchestrator.rs
```

Remove `mod orchestrator;` from `src/main.rs` and fix every leftover reference (`cargo check` drives the list): `OrchestratorConfig` lives in `src/state/run.rs` and STAYS (provider_settings.rs uses `max_steps`/`max_parallelism`/`verification_retries`); `OrchestrationPhase` and `ParentRunSink`/`WorkerPool` die with the file — confirm nothing else imports them first (`grep -rn "orchestrator::" src/`).

- [ ] **Step 10.6: Subset tool-policy test** (in `src/engine/mod.rs` tests, using the same snapshot fixture pattern as the neighboring tests): build an `AgentLoop` the way the existing tests do, call `build_request` with orchestrate's delegate phase and a spec list containing `web_search` + `call_agent` + `file_read`, and assert only the subset survives:

```rust
    #[test]
    fn delegate_phase_exposes_only_the_subset_tools() {
        // Construct loop + specs exactly like rejects_tool_not_in_agent_allowlist_
        // before_execution does, then:
        // let delegate = &OrchestrateStrategy.phases()[1];
        // let request = agent_loop.build_request(delegate, &StrategyContext::default(),
        //     Vec::new(), ResponseFormat::Toon, &specs);
        // assert!(request.tools.iter().all(|tool| {
        //     ["call_agent", "file_read", "file_write", "file_list"]
        //         .contains(&tool.name.as_str())
        // }));
        // assert!(!request.tools.iter().any(|tool| tool.name == "web_search"));
    }
```

(Make it a real test by copying that fixture; the commented lines are the exact body shape.)

- [ ] **Step 10.7: Gate + build + commit:**

```bash
cargo fmt --all -- --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test
dx build --platform web
git add -A && git commit -m "feat(strategy): orchestrate built-in + orchestrator agent; remove bespoke Orchestrator"
```

---

### Task 11: UI phase status, event log, docs

**Files:**
- Modify: `src/components/chat_panel.rs` (live phase line)
- Modify: `src/components/event_log.rs` (render new kinds)
- Modify: `docs/extensibility.md` (unified skeleton table)
- Modify: `docs/EXECUTION_MODEL.md` (strategy layer note)

- [ ] **Step 11.1: Live phase status.** In `src/components/chat_panel.rs`, where the live run renders (find the status/"thinking" indicator near the live `ConversationTurn`), derive the current phase from the newest event:

```rust
    let current_phase = live_run
        .events
        .iter()
        .rev()
        .find(|event| event.kind == AgentEventKind::PhaseStarted)
        .map(|event| event.title.clone());
```

and render it as a small status line when the run is `Running`:

```rust
    if let Some(phase) = current_phase.as_ref().filter(|_| live_run.status == RunStatus::Running) {
        span { class: "phase-status", "{phase}" }
    }
```

(adapt names to the component's actual locals; follow its existing conditional-render idioms.)

- [ ] **Step 11.2: Event log.** In `src/components/event_log.rs`, find where `AgentEventKind` maps to a label/icon/class and add arms for `PhaseStarted`, `PhaseCompleted`, `MemoryCompacted`, `RollingSummaryUpdated` following the `Workflow` arm's pattern (clippy already forced stub arms in Tasks 5/7/8 if matches were exhaustive — now give them proper labels: "Phase started", "Phase completed", "Memory compacted", "Rolling summary").

- [ ] **Step 11.3: Docs.** Append to `docs/extensibility.md`:

```markdown
## The unified extension skeleton

Every extensible subsystem follows: descriptor + trait + id-keyed registry +
one-line registration.

| subsystem | descriptor | trait | registry | registration |
|---|---|---|---|---|
| tools | `ToolSpec` | handler fn | `ToolRegistry` | one line in `register_builtin_tools` |
| inference | `ProviderConfig` / model id | `InferenceProvider` | inference registry | id-keyed `get_or_create` |
| responses | `ResponseField` table (`define_response!`) | `StructuredResponse` | `ResponseKind` dispatch | macro + enum variant + match arm |
| strategies | `Phase` list | `Strategy` | `StrategyRegistry` | one line in `register_builtin_strategies` |

Strategy selection resolves: `LoopParams.strategy` → agent `strategy_id` →
`react`. Strategy travels with the work: `call_agent({agent, query, strategy})`.
```

Append to `docs/EXECUTION_MODEL.md` a short section:

```markdown
## Strategy layer

A `Strategy` is an ordered sequence of `Phase`s with routing (`Next`/`Back`/
`Done`, back-edges capped at 2). Each phase runs the same base turn with its own
response schema, prompt frame, tool policy, and loop mode. `react` is the
single-phase degenerate case and the default. The orchestrator is a normal agent
running the `orchestrate` strategy; sub-agents are reached through `call_agent`,
and parallel fan-out is the existing concurrent tool dispatch. Memory is owned
per loop object: working messages compact at 100 messages or 70% of the context
window; each agent identity keeps a rolling summary in the snapshot.
```

- [ ] **Step 11.4: Final full gate:**

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
dx build --platform web
```

Expected: all green.

- [ ] **Step 11.5: Commit:**

```bash
git add -A && git commit -m "feat(ui+docs): phase status line, event log kinds, extensibility skeleton docs"
```

---

## Spec-coverage map (self-check)

| Spec section | Tasks |
|---|---|
| Phase / Strategy / routing / back-edge budget | 4, 5, 9 |
| StrategyContext artifacts + selected skills | 4, 5, 9 |
| Built-ins react / plan-act-review / skills-work-critique / orchestrate | 4, 9, 10 |
| StrategyRegistry + resolution order | 4, 6 |
| LoopParams at every construction site + call_agent strategy/max_turns + worker fields | 6 |
| Orchestrator-as-agent, delete orchestrator.rs, WorkflowGate retarget | 10 |
| MemoryPolicy, compaction triggers + mechanism, non-fatal failure | 7 |
| AgentMemory rolling summary (persist, merge, inject; call_agent write-back) | 8 |
| define_response! (text/list/choice, normalize/finish hooks), migrate ReActResponse, golden pin | 1 |
| Phase response types + ResponseKind dispatch | 2 |
| format_instructions provider seam | 3 |
| PhaseStarted/PhaseCompleted/MemoryCompacted/RollingSummaryUpdated events + UI | 5, 7, 8, 11 |
| Agents page strategy picker | 6 |
| Docs (extensibility skeleton, execution model) | 11 |
| Testing list from spec §Testing | parity 5.7; routing 9.1/9.5; macro 1.1/2.1; memory 7.1/8.3; resolution 4.3/6.6; seam 4.3; orchestrate 10.6 |
