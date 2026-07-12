//! Phases and routing — ADR-008 gate semantics: only a gate (verifier)
//! phase's Done ends a run as success; back-edges are bounded.

use serde::{Deserialize, Serialize};

/// Maximum times a strategy may route backwards before the run is Unverified.
pub const MAX_BACK_EDGES: u32 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LoopMode {
    OneShot,
    Loop { max_turns: u32 },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Phase {
    pub name: String,
    /// Named contract this phase runs under.
    pub contract: String,
    /// None = the agent's full toolset; Some = narrowed allowlist.
    pub tool_filter: Option<Vec<String>>,
    /// None = the agent's full skill set; Some = only these skills render.
    #[serde(default)]
    pub skill_filter: Option<Vec<String>>,
    pub loop_mode: LoopMode,
    /// Gate (verifier) phase: the only phase whose pass ends a run as success.
    pub gate: bool,
    /// Phase name to route back to when a gate fails.
    pub on_fail: Option<String>,
    /// Prompt frame header rendered into the PhaseFrame element.
    pub header: String,
    /// Declared fan-out: delegate tool called once per `parts` item on entry.
    #[serde(default)]
    pub fan_out: Option<String>,
    /// List field of the PREVIOUS phase's contract that supplies the items.
    #[serde(default)]
    pub parts: Option<String>,
}

/// What a phase proposes when it stops.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Routing {
    Next,
    /// Route back `i` phases (a failed gate's revise edge).
    Back(usize),
    Done,
}

/// What the harness actually does with the proposal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RouteOutcome {
    Advance,
    Rewind(usize),
    /// Run ends as `Answered` — only reachable from a gate phase.
    Success,
    /// Run ends as `Unverified` — no false success (ADR-008).
    Unverified,
}

/// ADR-008 routing: non-gate Done downgrades to Next; back-edges beyond
/// [`MAX_BACK_EDGES`] terminate the run as Unverified.
pub fn route(phase: &Phase, proposed: Routing, back_edges_used: u32) -> RouteOutcome {
    match proposed {
        Routing::Done if phase.gate => RouteOutcome::Success,
        Routing::Done | Routing::Next => RouteOutcome::Advance,
        Routing::Back(_) if back_edges_used >= MAX_BACK_EDGES => RouteOutcome::Unverified,
        Routing::Back(i) => RouteOutcome::Rewind(i),
    }
}

/// Current phase header + artifacts carried from prior phases.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct PhaseFrame {
    pub name: String,
    pub header: String,
    /// (artifact name, content) pairs from earlier phases.
    pub artifacts: Vec<(String, String)>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn phase(gate: bool) -> Phase {
        Phase {
            name: "verify".into(),
            contract: "critique".into(),
            tool_filter: None,
            skill_filter: None,
            loop_mode: LoopMode::OneShot,
            gate,
            on_fail: Some("plan".into()),
            header: "Verify the work.".into(),
            fan_out: None,
            parts: None,
        }
    }

    #[test]
    fn gate_done_is_the_only_success() {
        assert_eq!(route(&phase(true), Routing::Done, 0), RouteOutcome::Success);
    }

    #[test]
    fn non_gate_done_downgrades_to_next() {
        assert_eq!(
            route(&phase(false), Routing::Done, 0),
            RouteOutcome::Advance
        );
        assert_eq!(
            route(&phase(false), Routing::Next, 0),
            RouteOutcome::Advance
        );
    }

    #[test]
    fn back_edges_are_capped() {
        assert_eq!(
            route(&phase(true), Routing::Back(2), 0),
            RouteOutcome::Rewind(2)
        );
        assert_eq!(
            route(&phase(true), Routing::Back(1), 1),
            RouteOutcome::Rewind(1)
        );
        assert_eq!(
            route(&phase(true), Routing::Back(1), MAX_BACK_EDGES),
            RouteOutcome::Unverified
        );
        assert_eq!(
            route(&phase(true), Routing::Back(1), MAX_BACK_EDGES + 1),
            RouteOutcome::Unverified
        );
    }
}
