//! Shared run-card presentation helpers (ADR-043): the one copy of the
//! status dot/label classes, the `run started:` header parse, the latest
//! named activity, the streaming-draft tail, and the `DashRun` wall datum.
//! Promoted from `dashboard.rs`/`agents.rs`/`fleet.rs` duplicates; imported
//! by `app.rs` and the dashboard/fleet/agents features.

use askk_core::{RunId, RunProjection, RunStatus, SignalKind};

/// One run's wall data: the fold plus its live streaming tail.
#[derive(Clone, PartialEq)]
pub struct DashRun {
    pub id: RunId,
    pub proj: RunProjection,
    pub draft: String,
}

pub(crate) fn status_class(status: RunStatus) -> &'static str {
    match status {
        RunStatus::Running => "a-dot s-running",
        RunStatus::Answered => "a-dot s-done",
        RunStatus::Failed => "a-dot s-error",
        RunStatus::Interrupted => "a-dot s-aborted",
        RunStatus::Unverified | RunStatus::BudgetExhausted => "a-dot",
    }
}

pub(crate) fn status_label(status: RunStatus) -> &'static str {
    match status {
        RunStatus::Running => "running",
        RunStatus::Answered => "answered",
        RunStatus::Unverified => "unverified",
        RunStatus::BudgetExhausted => "budget exhausted",
        RunStatus::Interrupted => "interrupted",
        RunStatus::Failed => "failed",
    }
}

/// `"run started: coder — fix the bug"` → `("coder", "fix the bug")`;
/// `None` when the fold has no `RunStarted` line (callers pick a fallback).
pub(crate) fn agent_and_goal(proj: &RunProjection) -> Option<(String, String)> {
    proj.timeline
        .iter()
        .find_map(|line| line.strip_prefix("run started: "))
        .and_then(|rest| rest.split_once(" — "))
        .map(|(agent, goal)| (agent.to_string(), goal.to_string()))
}

/// The latest named activity: the newest `phase:` or `tool requested:`
/// timeline entry, whichever happened last.
pub(crate) fn run_phase(proj: &RunProjection) -> String {
    proj.timeline
        .iter()
        .rev()
        .find_map(|line| {
            line.strip_prefix("phase: ")
                .map(str::to_string)
                .or_else(|| {
                    line.strip_prefix("tool requested: ")
                        .map(|rest| rest.split(" (").next().unwrap_or(rest).to_string())
                })
        })
        .unwrap_or_default()
}

/// Last `max` chars of the streaming draft — cards show the tail, not the
/// whole answer.
pub(crate) fn draft_tail(draft: &str, max: usize) -> String {
    let trimmed = draft.trim_end();
    let count = trimmed.chars().count();
    if count <= max {
        return trimmed.to_string();
    }
    let tail: String = trimmed.chars().skip(count - max).collect();
    format!("…{tail}")
}

/// Latest loop signal → the plain-language phase label; the bool marks
/// external (tool) work — the warm accent, kiln-style.
pub(crate) fn phase_label(kind: Option<SignalKind>) -> (String, bool) {
    match kind {
        Some(SignalKind::LlmRequest) => ("thinking".into(), false),
        Some(SignalKind::ParseOutcome { .. }) => ("parsing".into(), false),
        Some(SignalKind::ToolRequested { name, .. }) => (format!("acting: {name}"), true),
        Some(SignalKind::ToolCompleted { .. }) => ("observing".into(), true),
        _ => ("working".into(), false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_phase_names_the_latest_activity() {
        let proj = RunProjection {
            timeline: vec![
                "run started: coder — fix".into(),
                "phase: plan".into(),
                "tool requested: shell (c1)".into(),
                "tool completed (c1): ok=true".into(),
            ],
            ..Default::default()
        };
        assert_eq!(run_phase(&proj), "shell"); // the tool came after the phase
        let planning = RunProjection {
            timeline: vec!["phase: plan".into()],
            ..Default::default()
        };
        assert_eq!(run_phase(&planning), "plan");
        assert_eq!(run_phase(&RunProjection::default()), "");
    }

    #[test]
    fn draft_tail_keeps_the_end() {
        assert_eq!(draft_tail("short", 10), "short");
        assert_eq!(draft_tail("abcdefghij", 4), "…ghij");
        assert_eq!(draft_tail("trailing ws  \n", 20), "trailing ws");
    }

    #[test]
    fn phase_label_maps_loop_signals() {
        assert_eq!(phase_label(Some(SignalKind::LlmRequest)).0, "thinking");
        let (label, warm) = phase_label(Some(SignalKind::ToolRequested {
            name: "echo".into(),
            call_id: "c1".into(),
            args: serde_json::Value::Null,
        }));
        assert_eq!(label, "acting: echo");
        assert!(warm);
        assert_eq!(phase_label(None).0, "working");
    }
}
