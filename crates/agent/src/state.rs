//! AgentState — plain data (§11: snapshot/restore, pause-and-resume across
//! refreshes all depend on this being serializable, which async-fn futures
//! could never be — ARCHITECTURE §1c).

use serde::{Deserialize, Serialize};

use context::State;
use kernel::PhaseId;

use crate::toolbox::Toolbox;

/// One planned step with its own success criteria — Verify judges against
/// these, not vibes (ADR-010: "the judge reads the spec").
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanStep {
    pub description: String,
    pub success_criteria: String,
}

/// The whole agent between events. Everything `step` may consult is a field
/// here; everything not here does not exist to the agent (I7). Serializable
/// because `Persist`ing this IS pause-and-resume (I11).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentState {
    pub phase: PhaseId,
    /// This agent's `model:` frontmatter key — a MODEL CATALOGUE key, never a
    /// URL (increment 04). It rides out on `Effect::CallModel` so the adapter
    /// can resolve it; empty means "the catalogue's default entry".
    #[serde(default)]
    pub model: String,
    /// What is being attempted; `None` = idle, awaiting a task.
    pub task: Option<String>,
    /// The current plan; empty in Work-first flows (RESEARCH phase-cut:
    /// Plan-on-demand, not mandatory).
    pub plan: Vec<PlanStep>,
    /// Which plan step Work is on — the LOOP advances this, never the model
    /// (ADR-010: one step per call).
    pub cursor: usize,
    /// Consecutive-retry guard counter; a looping model terminates
    /// deterministically because these live here, not in prose (ADR-010).
    pub retries: u8,
    pub replans: u8,
    /// Tool results still outstanding from the batch the model just wrote.
    /// The model sees none of them until this reaches zero — that is what
    /// makes one line of calls one observation (Python `core/tools.py`).
    #[serde(default)]
    pub pending_tools: usize,
    /// How many times this turn has already gone round the tool loop. A
    /// looping model terminates on this counter, never on prose.
    #[serde(default)]
    pub tool_rounds: u8,
    /// What THIS agent may call: its `agent.md` `tools:` list resolved
    /// against the built-ins and its peers (`subagent::toolbox_for`). In
    /// state, not in the phase table, because it is the agent's property and
    /// not the machine's — the phase only decides whether this phase may act.
    #[serde(default)]
    pub toolbox: Toolbox,
    /// The paper's assembly inputs — gathered section sources, refreshed by
    /// `core` (affordances from the registry, observations from effects)
    /// before each step. Inside AgentState so one snapshot restores the
    /// whole thinking context.
    pub paper: State,
}

impl AgentState {
    /// A fresh idle agent — the boot and the tests start here. Work is the
    /// resting phase (Plan-on-demand, RESEARCH phase-cut); the paper is the
    /// seeded §8.2 starter set.
    pub fn new() -> AgentState {
        AgentState {
            phase: PhaseId::Work,
            model: String::new(),
            task: None,
            plan: Vec::new(),
            cursor: 0,
            retries: 0,
            replans: 0,
            pending_tools: 0,
            tool_rounds: 0,
            // No agent file adopted yet: an agent with no spec has no tools,
            // which is the honest default (nothing is attached that an agent
            // did not ask for).
            toolbox: Toolbox::default(),
            paper: crate::paper::seed(),
        }
    }
}

impl Default for AgentState {
    fn default() -> AgentState {
        AgentState::new()
    }
}
