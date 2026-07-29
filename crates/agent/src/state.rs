//! AgentState — plain data (§11: snapshot/restore, pause-and-resume across
//! refreshes all depend on this being serializable, which async-fn futures
//! could never be — ARCHITECTURE §1c).

use serde::{Deserialize, Serialize};

use context::State;
use kernel::PhaseId;

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
            task: None,
            plan: Vec::new(),
            cursor: 0,
            retries: 0,
            replans: 0,
            paper: crate::paper::seed(),
        }
    }
}

impl Default for AgentState {
    fn default() -> AgentState {
        AgentState::new()
    }
}
