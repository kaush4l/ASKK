//! The strategy layer: a [`Strategy`] is an ordered sequence of [`Phase`]s with a
//! routing function, run above the unchanged base turn (construct prompt → call
//! LLM → parse → act). The base ReAct loop is the degenerate single-phase case.

mod declared;
mod orchestrate;
mod plan_act_review;
mod react;
mod registry;
mod skills_work_critique;

pub use declared::{DeclaredPhase, DeclaredStrategy, response_kind_from_str};
pub use orchestrate::OrchestrateStrategy;
pub use plan_act_review::PlanActReviewStrategy;
pub use react::ReactStrategy;
pub use registry::{DEFAULT_STRATEGY_ID, StrategyRegistry, fallback_strategy, resolve_strategy_id};
pub use skills_work_critique::SkillsWorkCritiqueStrategy;

use std::rc::Rc;

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
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ToolPolicy {
    /// No tool dispatch at all (pure structured output phases).
    NoTools,
    /// The agent's full enabled-tool allowlist.
    Inherit,
    /// Only the named tools, intersected with the agent's allowlist.
    Subset(Vec<String>),
}

/// One stretch of work inside a strategy.
#[derive(Clone, Debug)]
pub struct Phase {
    pub name: String,
    pub response_kind: ResponseKind,
    /// Phase framing prepended to the goal in this phase's requests. Empty = none.
    pub prompt_frame: String,
    pub tool_policy: ToolPolicy,
    pub loop_mode: LoopMode,
    /// When true the engine appends the enabled skill library (names + first
    /// lines) to this phase's goal so the model can select from it.
    pub list_skill_library: bool,
}

impl Phase {
    /// The framing line rendered into the system prompt's `## CURRENT PHASE` block:
    /// `"{name}: {prompt_frame}"`. Returns an empty string when the phase declares no
    /// frame (e.g. the bare `react` phase), so the prompt stays byte-identical to the
    /// pre-phase form for unframed phases.
    pub fn context_line(&self) -> String {
        let frame = self.prompt_frame.trim();
        if frame.is_empty() {
            return String::new();
        }
        format!("{}: {frame}", self.name.trim())
    }
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
    pub phase: String,
    pub response: ParsedResponse,
    /// Turns the phase consumed. Recorded by every phase runner and surfaced in
    /// tests/diagnostics; the driver does not branch on it yet, so it is read only by
    /// constructors for now.
    #[allow(dead_code)]
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
    fn phases(&self) -> &[Phase];
    /// Decide where to go after phase `from` finished with `outcome`.
    fn route(&self, from: usize, outcome: &PhaseOutcome) -> Routing;
    /// The index of the success **gate** phase: only a [`Routing::Done`] emitted by
    /// this phase ends the run as `Complete`. A non-gate `Done` is downgraded to
    /// advance, a loop fall-off without the gate passing ends `Unverified`, and an
    /// exhausted back-edge budget on the gate ends `Unverified` (never a false
    /// success). `None` (the default) means the strategy has no gate — any `Done` or
    /// loop fall-off completes, preserving the legacy single-/linear-phase behavior.
    fn gate_phase(&self) -> Option<usize> {
        None
    }
    /// Distill a finished phase into a named artifact for later phases. `None`
    /// records nothing.
    fn artifact(&self, outcome: &PhaseOutcome) -> Option<(String, String)> {
        let _ = outcome;
        None
    }
}

/// A reference-counted strategy the engine drives. The built-ins are `&'static`
/// singletons (held by the [`StrategyRegistry`]); a [`DeclaredStrategy`] is heap-owned
/// (one per agent). Both flow through this single `Rc<dyn Strategy>` so the engine has
/// one strategy field and one set of call sites regardless of origin. This is the
/// single-threaded wasm idiom (`Rc`, not `Arc`), matching the rest of the app.
pub type StrategyHandle = Rc<dyn Strategy>;

/// Adapter wrapping a built-in `&'static dyn Strategy` so it can live behind an `Rc`
/// alongside owned [`DeclaredStrategy`] instances. Every method forwards to the inner
/// static; the wrapper holds no state, so the forward is a pointer copy.
struct StaticStrategy(&'static dyn Strategy);

impl Strategy for StaticStrategy {
    fn id(&self) -> &'static str {
        self.0.id()
    }
    fn description(&self) -> &'static str {
        self.0.description()
    }
    fn phases(&self) -> &[Phase] {
        self.0.phases()
    }
    fn route(&self, from: usize, outcome: &PhaseOutcome) -> Routing {
        self.0.route(from, outcome)
    }
    fn gate_phase(&self) -> Option<usize> {
        self.0.gate_phase()
    }
    fn artifact(&self, outcome: &PhaseOutcome) -> Option<(String, String)> {
        self.0.artifact(outcome)
    }
}

/// Wrap a built-in `&'static dyn Strategy` as a [`StrategyHandle`], so the engine can
/// treat built-in and declared strategies uniformly.
pub fn static_handle(strategy: &'static dyn Strategy) -> StrategyHandle {
    Rc::new(StaticStrategy(strategy))
}
