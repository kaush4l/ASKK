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
        let distance = phase
            .on_fail
            .as_ref()
            .and_then(|target| {
                run.phases[..run.phase_idx]
                    .iter()
                    .position(|p| &p.name == target)
                    .map(|i| run.phase_idx - i)
            })
            .unwrap_or(1);
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
