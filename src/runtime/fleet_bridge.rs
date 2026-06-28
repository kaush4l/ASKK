//! Bridge from the durable **state plane** ([`Signal`]) onto the ephemeral
//! **telemetry plane** ([`TelemetrySignal`]) that drives the live fleet UI.
//!
//! The milestone goal is that the UI shows each running agent's live activity —
//! "waiting on the model", "calling web_search", "thinking". Engines do not yet emit
//! [`TelemetrySignal`] natively (that lands when the engine worker is cut over to the
//! hub); until then this projects the run's existing fine-grained [`Signal`] stream
//! onto the telemetry plane so the fleet view is real *now*, on the current
//! single-worker substrate. The mapping is best-effort and lossy by design — only the
//! transitions that change an agent's badge are surfaced; everything else is `None`.
//!
//! Pure and host-tested; the main thread folds the produced signals into a
//! [`FleetView`](super::fleet::FleetView) via the coalescer.

use crate::core::event::{Signal, SignalKind};
use crate::core::lifecycle::ComponentKind;
use crate::core::telemetry::{AgentActivity, TelemetrySignal, ThreadKind};

/// Project one state-plane [`Signal`] onto the telemetry plane, keyed by the signal's
/// `instance` (the emitting component's bus address) as the fleet node id. Returns
/// `None` for signals that don't move an agent's badge.
pub fn telemetry_from_signal(signal: &Signal) -> Option<TelemetrySignal> {
    let id = signal.instance.as_str().to_string();
    match &signal.kind {
        // A run begins → the root engine node appears, labelled by its goal.
        SignalKind::RunStarted { goal, .. } => Some(TelemetrySignal::Spawned {
            id,
            kind: ThreadKind::Engine,
            parent: None,
            label: truncate(goal, 60),
        }),
        // The model round-trip is the most visible "what is it doing" transition.
        SignalKind::LlmRequest => Some(TelemetrySignal::StatusChanged {
            id,
            activity: AgentActivity::WaitingLlm,
        }),
        SignalKind::LlmResponse { .. } | SignalKind::LlmDelta { .. } => {
            Some(TelemetrySignal::StatusChanged {
                id,
                activity: AgentActivity::Thinking,
            })
        }
        SignalKind::ToolRequested { name, .. } => Some(TelemetrySignal::StatusChanged {
            id,
            activity: AgentActivity::CallingTool { name: name.clone() },
        }),
        SignalKind::ToolCompleted { .. } => Some(TelemetrySignal::StatusChanged {
            id,
            activity: AgentActivity::Thinking,
        }),
        // The "steps N/M" counter is the closest proxy we have for live progress until
        // the engine streams token counts; surface it on the Progress channel.
        SignalKind::StepsUsedSet { steps_used } => Some(TelemetrySignal::Progress {
            id,
            tokens: *steps_used,
            elapsed_ms: 0,
        }),
        // Worker lifecycle edges that bracket a node's life.
        SignalKind::Lifecycle { to, .. } if to == "terminated" => {
            Some(TelemetrySignal::Terminated {
                id,
                reason: "terminated".to_string(),
            })
        }
        SignalKind::Lifecycle { component, to, .. }
            if to == "ready" && matches!(component, ComponentKind::Worker) =>
        {
            Some(TelemetrySignal::Spawned {
                id: id.clone(),
                kind: ThreadKind::Engine,
                parent: None,
                label: id,
            })
        }
        // Terminal outcomes end the node.
        SignalKind::Result { .. } => Some(TelemetrySignal::Terminated {
            id,
            reason: "done".to_string(),
        }),
        SignalKind::Error { message } => Some(TelemetrySignal::Terminated {
            id,
            reason: truncate(message, 60),
        }),
        SignalKind::Interrupted => Some(TelemetrySignal::Terminated {
            id,
            reason: "cancelled".to_string(),
        }),
        // Everything else is not a badge transition.
        _ => None,
    }
}

/// Truncate a label to `max` chars on a char boundary, appending an ellipsis.
fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sig(kind: SignalKind) -> Signal {
        Signal::new(0, "run-1", "agent-0", kind, 0.0)
    }

    #[test]
    fn llm_request_becomes_waiting_llm() {
        let t = telemetry_from_signal(&sig(SignalKind::LlmRequest)).unwrap();
        assert_eq!(
            t,
            TelemetrySignal::StatusChanged {
                id: "agent-0".into(),
                activity: AgentActivity::WaitingLlm,
            }
        );
    }

    #[test]
    fn tool_requested_carries_the_tool_name() {
        let t = telemetry_from_signal(&sig(SignalKind::ToolRequested {
            call_id: "c1".into(),
            name: "web_search".into(),
            arguments: serde_json::Value::Null,
        }))
        .unwrap();
        assert_eq!(
            t,
            TelemetrySignal::StatusChanged {
                id: "agent-0".into(),
                activity: AgentActivity::CallingTool {
                    name: "web_search".into()
                },
            }
        );
    }

    #[test]
    fn run_started_spawns_engine_node_labelled_by_goal() {
        let t = telemetry_from_signal(&sig(SignalKind::RunStarted {
            id: "run-1".into(),
            goal: "compare two sources".into(),
            lane: crate::state::RunLane::BoundedTask,
            created_at: "now".into(),
        }))
        .unwrap();
        match t {
            TelemetrySignal::Spawned { kind, label, .. } => {
                assert_eq!(kind, ThreadKind::Engine);
                assert_eq!(label, "compare two sources");
            }
            other => panic!("expected Spawned, got {other:?}"),
        }
    }

    #[test]
    fn result_and_error_terminate() {
        assert!(matches!(
            telemetry_from_signal(&sig(SignalKind::Result {
                final_text: "x".into()
            })),
            Some(TelemetrySignal::Terminated { .. })
        ));
        assert!(matches!(
            telemetry_from_signal(&sig(SignalKind::Error {
                message: "boom".into()
            })),
            Some(TelemetrySignal::Terminated { .. })
        ));
    }

    #[test]
    fn non_badge_signals_map_to_none() {
        assert!(telemetry_from_signal(&sig(SignalKind::Memory)).is_none());
        assert!(
            telemetry_from_signal(&sig(SignalKind::Phase {
                name: "plan".into(),
                done: false
            }))
            .is_none()
        );
    }

    #[test]
    fn steps_used_is_progress() {
        let t = telemetry_from_signal(&sig(SignalKind::StepsUsedSet { steps_used: 3 })).unwrap();
        assert_eq!(
            t,
            TelemetrySignal::Progress {
                id: "agent-0".into(),
                tokens: 3,
                elapsed_ms: 0,
            }
        );
    }
}
