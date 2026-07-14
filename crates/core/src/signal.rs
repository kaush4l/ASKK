//! The signal log is the sole run-state truth; UI = fold(signals) (ADR-003).
//! Unknown kinds are skipped, never panicked on — forward compatibility.
//!
//! Signals are the communication AND persistence spine: agents never
//! pub/sub each other — a run emits signals, the runtime's `SignalLog`
//! (`runtime/src/state/log.rs`) appends them to an epoch-segmented JSONL
//! blob, every view is a fold over them, and the web host's
//! BroadcastChannel bus (`web/src/host/bus.rs`) mirrors stamped signals to
//! other tabs, view-only.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::action::{ActionRecord, Verdict};
use crate::request::{Message, Role};
use crate::state::{RunId, RunStatus};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Signal {
    /// Per-run monotonic sequence, assigned by the single log writer.
    pub seq: u64,
    pub run_id: RunId,
    pub ts_ms: u64,
    #[serde(flatten)]
    pub kind: SignalKind,
}

impl Signal {
    /// A signal awaiting seq/run_id/ts from the log writer. `Sheet::absorb`
    /// emits these; the runtime stamps them before appending to the log.
    pub fn unstamped(kind: SignalKind) -> Self {
        Self {
            seq: 0,
            run_id: RunId::default(),
            ts_ms: 0,
            kind,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SignalKind {
    RunStarted {
        agent_id: String,
        goal: String,
    },
    PhaseEntered {
        name: String,
    },
    LlmRequest,
    LlmDelta {
        text: String,
    },
    LlmResponse {
        text: String,
    },
    ParseOutcome {
        ok: bool,
        format: String,
        honored: bool,
    },
    ToolRequested {
        call_id: String,
        name: String,
        args: Value,
    },
    ActionVerdict {
        record: ActionRecord,
    },
    ToolCompleted {
        call_id: String,
        ok: bool,
        content: String,
    },
    ObservationAppended {
        text: String,
    },
    HistoryAppended {
        role: Role,
        text: String,
    },
    StateWritten {
        key: String,
    },
    ArtifactAppended {
        name: String,
    },
    StatusSet {
        status: RunStatus,
    },
    Result {
        final_text: String,
    },
    Error {
        message: String,
    },
    Interrupted,
    /// Forward compatibility: kinds this build does not know deserialize
    /// here and fold as no-ops.
    #[serde(other)]
    Unknown,
}

/// Pure view state folded from the signal stream. Replay from seq 0
/// reproduces identical state.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct RunProjection {
    pub status: RunStatus,
    pub timeline: Vec<String>,
    pub messages: Vec<Message>,
    pub pending_actions: Vec<ActionRecord>,
    pub artifacts: Vec<String>,
    pub turns_used: u32,
}

/// The pure reducer. One signal in, the next projection out.
pub fn step(mut proj: RunProjection, signal: &Signal) -> RunProjection {
    match &signal.kind {
        SignalKind::RunStarted { agent_id, goal } => {
            proj.status = RunStatus::Running;
            proj.timeline
                .push(format!("run started: {agent_id} — {goal}"));
        }
        SignalKind::PhaseEntered { name } => {
            proj.timeline.push(format!("phase: {name}"));
        }
        SignalKind::LlmRequest => proj.turns_used += 1,
        SignalKind::LlmResponse { text } => {
            proj.messages
                .push(Message::new(Role::Assistant, text.clone()));
        }
        SignalKind::ToolRequested { call_id, name, .. } => {
            proj.timeline
                .push(format!("tool requested: {name} ({call_id})"));
        }
        SignalKind::ActionVerdict { record } => {
            if record.verdict == Verdict::NeedsConfirmation && record.result.is_none() {
                proj.pending_actions.push(record.clone());
            }
        }
        SignalKind::ToolCompleted { call_id, ok, .. } => {
            proj.pending_actions.retain(|r| r.proposal.id.0 != *call_id);
            proj.timeline
                .push(format!("tool completed ({call_id}): ok={ok}"));
        }
        SignalKind::ObservationAppended { text } => {
            proj.messages.push(Message::new(Role::Tool, text.clone()));
        }
        SignalKind::HistoryAppended { role, text } => {
            proj.messages.push(Message::new(*role, text.clone()));
        }
        SignalKind::ArtifactAppended { name } => proj.artifacts.push(name.clone()),
        SignalKind::StatusSet { status } => proj.status = *status,
        SignalKind::Result { .. } => {
            if proj.status == RunStatus::Running {
                proj.status = RunStatus::Answered;
            }
            proj.timeline.push("result".into());
        }
        SignalKind::Error { message } => {
            proj.status = RunStatus::Failed;
            proj.timeline.push(format!("error: {message}"));
        }
        SignalKind::Interrupted => proj.status = RunStatus::Interrupted,
        // Transient or view-irrelevant kinds are deliberate no-ops; unknown
        // kinds are skipped for forward compatibility.
        SignalKind::LlmDelta { .. }
        | SignalKind::ParseOutcome { .. }
        | SignalKind::StateWritten { .. }
        | SignalKind::Unknown => {}
    }
    proj
}

pub fn fold<'a, I>(signals: I) -> RunProjection
where
    I: IntoIterator<Item = &'a Signal>,
{
    signals.into_iter().fold(RunProjection::default(), step)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::action::{ActionId, ActionProposal};
    use crate::tool::Effect;
    use serde_json::json;

    fn sig(seq: u64, kind: SignalKind) -> Signal {
        Signal {
            seq,
            run_id: RunId::new("r1"),
            ts_ms: seq,
            kind,
        }
    }

    fn full_run_script() -> Vec<Signal> {
        let record = ActionRecord {
            proposal: ActionProposal {
                id: ActionId("c1".into()),
                tool: "write".into(),
                args: json!({}),
                effect: Effect::Mutating,
                rationale: "save".into(),
            },
            verdict: Verdict::NeedsConfirmation,
            result: None,
            ts: 5,
        };
        vec![
            sig(
                1,
                SignalKind::RunStarted {
                    agent_id: "coder".into(),
                    goal: "fix".into(),
                },
            ),
            sig(
                2,
                SignalKind::PhaseEntered {
                    name: "execute".into(),
                },
            ),
            sig(3, SignalKind::LlmRequest),
            sig(
                4,
                SignalKind::LlmResponse {
                    text: "calling tool".into(),
                },
            ),
            sig(
                5,
                SignalKind::ToolRequested {
                    call_id: "c1".into(),
                    name: "write".into(),
                    args: json!({}),
                },
            ),
            sig(6, SignalKind::ActionVerdict { record }),
            sig(
                7,
                SignalKind::ToolCompleted {
                    call_id: "c1".into(),
                    ok: true,
                    content: "done".into(),
                },
            ),
            sig(
                8,
                SignalKind::ObservationAppended {
                    text: "file written".into(),
                },
            ),
            sig(
                9,
                SignalKind::ArtifactAppended {
                    name: "main.rs".into(),
                },
            ),
            sig(10, SignalKind::LlmRequest),
            sig(
                11,
                SignalKind::LlmResponse {
                    text: "all done".into(),
                },
            ),
            sig(
                12,
                SignalKind::Result {
                    final_text: "all done".into(),
                },
            ),
        ]
    }

    #[test]
    fn full_run_folds_to_expected_projection() {
        let script = full_run_script();
        let proj = fold(&script);
        assert_eq!(proj.status, RunStatus::Answered);
        assert_eq!(proj.turns_used, 2);
        assert_eq!(proj.messages.len(), 3); // 2 assistant + 1 observation
        assert_eq!(proj.artifacts, vec!["main.rs".to_string()]);
        assert!(proj.pending_actions.is_empty()); // confirmed action completed
        assert!(proj.timeline.iter().any(|t| t.contains("phase: execute")));
    }

    #[test]
    fn pending_action_stays_until_completed() {
        let script = &full_run_script()[..6]; // through ActionVerdict
        let proj = fold(script);
        assert_eq!(proj.pending_actions.len(), 1);
        assert_eq!(proj.pending_actions[0].proposal.tool, "write");
    }

    #[test]
    fn replay_is_deterministic() {
        let script = full_run_script();
        assert_eq!(fold(&script), fold(&script));
    }

    #[test]
    fn terminal_signals_set_status() {
        let proj = fold(&[sig(
            1,
            SignalKind::Error {
                message: "boom".into(),
            },
        )]);
        assert_eq!(proj.status, RunStatus::Failed);
        let proj = fold(&[sig(1, SignalKind::Interrupted)]);
        assert_eq!(proj.status, RunStatus::Interrupted);
        let proj = fold(&[sig(
            1,
            SignalKind::StatusSet {
                status: RunStatus::BudgetExhausted,
            },
        )]);
        assert_eq!(proj.status, RunStatus::BudgetExhausted);
    }

    #[test]
    fn unknown_kind_deserializes_and_folds_as_noop() {
        let raw = r#"{"seq": 7, "run_id": "r1", "ts_ms": 0,
                      "kind": "from_the_future", "payload": {"x": 1}}"#;
        let signal: Signal = serde_json::from_str(raw).unwrap();
        assert_eq!(signal.kind, SignalKind::Unknown);
        let proj = step(RunProjection::default(), &signal);
        assert_eq!(proj, RunProjection::default()); // skipped, no panic
    }

    #[test]
    fn signal_serializes_with_flat_kind_tag() {
        let signal = sig(
            1,
            SignalKind::PhaseEntered {
                name: "plan".into(),
            },
        );
        let value = serde_json::to_value(&signal).unwrap();
        assert_eq!(value["kind"], "phase_entered");
        assert_eq!(value["name"], "plan");
        assert_eq!(value["seq"], 1);
        let back: Signal = serde_json::from_value(value).unwrap();
        assert_eq!(back, signal);
    }
}
