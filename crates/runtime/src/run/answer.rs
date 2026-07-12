//! Answer → phase routing with gate semantics (ADR-008): only a gate pass
//! ends a run as success; everything else advances, rewinds (bounded), or
//! terminates Unverified — no false success.

use askk_core::{route, ParsedResponse, Phase, RouteOutcome, Routing, RunStatus, SignalKind};
use serde_json::Value;

use crate::run::session::{RunState, Shared};
use crate::run::turn::{emit, observe, Turn};
use crate::state::StoreError;

/// Route one answered phase. A gate phase whose contract says
/// `verdict: revise` routes back along its on_fail edge.
pub(crate) async fn handle_answer(
    shared: &Shared,
    run: &mut RunState,
    phase: &Phase,
    parsed: &ParsedResponse,
    text: String,
) -> Result<Turn, StoreError> {
    let revise =
        phase.gate && parsed.fields.get("verdict").and_then(Value::as_str) == Some("revise");
    let proposed = if revise {
        let distance = match &phase.on_fail {
            None => 1, // no declared edge: one step back
            Some(target) => {
                let earlier = run.phases[..run.phase_idx]
                    .iter()
                    .position(|p| &p.name == target);
                match earlier {
                    Some(i) => run.phase_idx - i,
                    None => {
                        // Validation rejects on_fail targets at/after the
                        // gate; a config that bypassed it must never
                        // silently rewind — loud Error, Unverified terminal.
                        emit(
                            shared,
                            run,
                            SignalKind::Error {
                                message: format!(
                                    "gate '{}' on_fail target '{target}' is not an earlier phase",
                                    phase.name
                                ),
                            },
                        )
                        .await?;
                        finish_unverified(shared, run, text).await?;
                        return Ok(Turn::Terminal);
                    }
                }
            }
        };
        Routing::Back(distance)
    } else if phase.gate {
        Routing::Done
    } else {
        Routing::Next
    };
    match route(phase, proposed, run.back_edges) {
        RouteOutcome::Success => {
            run.artifacts.push((phase.name.clone(), text.clone()));
            emit(
                shared,
                run,
                SignalKind::Result {
                    final_text: text.clone(),
                },
            )
            .await?;
            run.status = RunStatus::Answered;
            run.final_text = Some(text);
            Ok(Turn::Terminal)
        }
        RouteOutcome::Advance => {
            run.artifacts.push((phase.name.clone(), text.clone()));
            run.phase_idx += 1;
            if run.phase_idx >= run.phases.len() {
                // Ran off the end without a gate pass: no false success.
                finish_unverified(shared, run, text).await?;
                return Ok(Turn::Terminal);
            }
            run.phase_entered = false;
            Ok(Turn::Continue)
        }
        RouteOutcome::Rewind(distance) => {
            run.back_edges += 1;
            run.phase_idx = run.phase_idx.saturating_sub(distance);
            run.phase_entered = false;
            let feedback = parsed
                .fields
                .get("feedback")
                .and_then(Value::as_str)
                .unwrap_or("");
            observe(
                shared,
                run,
                format!("Gate '{}' failed — revise. {feedback}", phase.name),
            )
            .await?;
            Ok(Turn::Continue)
        }
        RouteOutcome::Unverified => {
            finish_unverified(shared, run, text).await?;
            Ok(Turn::Terminal)
        }
    }
}

async fn finish_unverified(
    shared: &Shared,
    run: &mut RunState,
    text: String,
) -> Result<(), StoreError> {
    emit(
        shared,
        run,
        SignalKind::StatusSet {
            status: RunStatus::Unverified,
        },
    )
    .await?;
    emit(
        shared,
        run,
        SignalKind::Result {
            final_text: text.clone(),
        },
    )
    .await?;
    run.status = RunStatus::Unverified;
    run.final_text = Some(text);
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::rc::Rc;

    use askk_core::{Action, ActionPolicy, Budgets, LoopMode, ParsedFormat, ProviderError, RunId};
    use serde_json::{json, Map};

    use super::*;
    use crate::config::AgentConfig;
    use crate::run::session::{RunSession, SessionInit};
    use crate::state::{MemBlob, MemKv, MemoryStore, SessionStore, SignalLog};
    use crate::testutil::block_on;
    use crate::tools::ToolRegistry;

    /// FINDING 4 belt: a bad on_fail target (config that bypassed
    /// validation) ends the run Unverified with an Error signal naming the
    /// target — never a silent one-step rewind.
    #[test]
    fn bad_on_fail_target_is_unverified_not_silent_rewind() {
        block_on(async {
            let (log, _) = SignalLog::open(Rc::new(MemBlob::new()), Box::new(|| 0))
                .await
                .unwrap();
            let session = RunSession::new(SessionInit {
                agents: vec![],
                teams: Vec::new(),
                soul: String::new(),
                skills: vec![],
                registry: ToolRegistry::new(),
                resolver: Box::new(|_| Err(ProviderError::Malformed("unused".into()))),
                log,
                memory: MemoryStore::new(Rc::new(MemKv::new()), 8),
                session: SessionStore::new(Rc::new(MemKv::new())),
                budgets: Budgets::default(),
                policy: ActionPolicy::default(),
                known_providers: vec![],
                board: None,
            })
            .unwrap();
            let shared = session.shared();
            let agent = AgentConfig::from_markdown("agents/t.md", "---\nid: t\n---\n").unwrap();
            let mut run = RunState::new(
                &agent,
                "goal",
                vec![],
                0,
                Default::default(),
                RunId::new("run-t"),
                Budgets::default(),
            );
            // A phase list validation would reject: the gate names itself.
            let gate = Phase {
                name: "verify".into(),
                contract: "critique".into(),
                tool_filter: None,
                skill_filter: None,
                loop_mode: LoopMode::OneShot,
                gate: true,
                on_fail: Some("verify".into()),
                header: String::new(),
                fan_out: None,
                parts: None,
            };
            run.phases = vec![run.phases[0].clone(), gate.clone()];
            run.phase_idx = 1;
            let mut fields = Map::new();
            fields.insert("verdict".into(), json!("revise"));
            let parsed = ParsedResponse {
                fields,
                action: Action::Answer("no".into()),
                format: ParsedFormat::Json,
            };
            let turn = handle_answer(shared, &mut run, &gate, &parsed, "no".into())
                .await
                .unwrap();
            assert!(matches!(turn, Turn::Terminal));
            assert_eq!(run.status, RunStatus::Unverified);
            assert_eq!(run.phase_idx, 1); // no rewind happened
            assert_eq!(run.back_edges, 0);
            assert!(run.signals.iter().any(|s| matches!(
                &s.kind,
                SignalKind::Error { message } if message.contains("on_fail target 'verify'")
            )));
        });
    }
}
