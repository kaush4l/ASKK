//! The strategy layer: a [`Strategy`] is an ordered sequence of [`Phase`]s with a
//! routing function, run above the unchanged base turn (construct prompt → call
//! LLM → parse → act). The base ReAct loop is the degenerate single-phase case.

// Most types here are now consumed by the engine (Task 5). A few items
// (`StrategyRegistry::catalog`, the `Strategy::artifact` default override, and the
// `Plan`/`Critique`/etc. multi-phase machinery) only go live in later tasks; keep a
// scoped dead-code allow until then rather than per-item attributes.
#![allow(dead_code)]

mod orchestrate;
mod plan_act_review;
mod react;
mod registry;
mod skills_work_critique;

pub use orchestrate::OrchestrateStrategy;
pub use plan_act_review::PlanActReviewStrategy;
pub use react::ReactStrategy;
pub use skills_work_critique::SkillsWorkCritiqueStrategy;
// `DEFAULT_STRATEGY_ID` is public API (the canonical "react" id) used by the agent
// config + UI picker in Task 6; nothing imports it yet, so scope an allow here rather
// than dropping the re-export.
#[allow(unused_imports)]
pub use registry::DEFAULT_STRATEGY_ID;
pub use registry::{StrategyRegistry, fallback_strategy, resolve_strategy_id};

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
    /// `Some(empty)` falls back to the agent's full set (selection narrows, never zeroes).
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
