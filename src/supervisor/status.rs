//! Per-agent lifecycle status. Every agent the supervisor manages carries one of
//! these; the orchestrator (and, later, the UI) reads it to see, at a glance, what
//! each member of a team is doing right now. This is a plain data enum with no
//! browser or async dependency, so the whole status surface is host-testable.

use serde::{Deserialize, Serialize};

/// What a managed agent instance is doing right now. The supervisor advances an
/// instance through these as it drives a team pipeline; `progress_of` returns the
/// current value and the UI renders it as a per-agent badge.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum AgentStatus {
    /// Instantiated but not yet scheduled to run.
    #[default]
    Idle,
    /// Waiting its turn in the pipeline (an earlier member is running, or a
    /// bounce reset it to wait for a re-run).
    Queued,
    /// Actively running its own loop. `turn` is the latest loop turn observed and
    /// `phase` the pipeline phase label (e.g. the member role) for display.
    Running { turn: u32, phase: String },
    /// Stopped, waiting on something it cannot resolve itself (e.g. an unmet gate).
    Blocked { reason: String },
    /// Finished successfully with a final answer.
    Done { answer: String },
    /// Finished with an error (its run failed, never a panic).
    Failed { error: String },
}

impl AgentStatus {
    /// A terminal status no longer changes without a fresh dispatch.
    #[allow(dead_code)]
    pub fn is_terminal(&self) -> bool {
        matches!(self, AgentStatus::Done { .. } | AgentStatus::Failed { .. })
    }

    /// Whether the instance is actively running.
    #[allow(dead_code)]
    pub fn is_running(&self) -> bool {
        matches!(self, AgentStatus::Running { .. })
    }

    /// A short, stable label for the variant (for logs / UI badges).
    pub fn label(&self) -> &'static str {
        match self {
            AgentStatus::Idle => "idle",
            AgentStatus::Queued => "queued",
            AgentStatus::Running { .. } => "running",
            AgentStatus::Blocked { .. } => "blocked",
            AgentStatus::Done { .. } => "done",
            AgentStatus::Failed { .. } => "failed",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_and_running_predicates() {
        assert!(AgentStatus::Done { answer: "ok".into() }.is_terminal());
        assert!(AgentStatus::Failed { error: "x".into() }.is_terminal());
        assert!(!AgentStatus::Idle.is_terminal());
        assert!(
            AgentStatus::Running {
                turn: 1,
                phase: "plan".into()
            }
            .is_running()
        );
        assert!(!AgentStatus::Queued.is_running());
    }

    #[test]
    fn labels_are_stable() {
        assert_eq!(AgentStatus::Idle.label(), "idle");
        assert_eq!(AgentStatus::Queued.label(), "queued");
        assert_eq!(
            AgentStatus::Running {
                turn: 0,
                phase: String::new()
            }
            .label(),
            "running"
        );
        assert_eq!(AgentStatus::default().label(), "idle");
    }
}
