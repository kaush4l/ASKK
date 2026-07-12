//! Phase-boundary flow: declared fan-out on entry (`phase.N.fan_out`/`parts`)
//! and loop-exhaustion rerouting along `on_fail`. Split from turn.rs to hold
//! the ADR-012 line cap.

use askk_core::{route, InferenceReply, RouteOutcome, Routing, ToolCall};
use serde_json::json;

use crate::config::resolve_contract;
use crate::run::session::{RunState, Shared};
use crate::run::turn::observe;
use crate::state::StoreError;

/// Loop exhaustion with a declared `on_fail` routes back like a failed gate
/// (same back-edge bound); true = rerouted, false = caller lands Unverified.
pub(crate) async fn reroute_exhausted(
    shared: &Shared,
    run: &mut RunState,
) -> Result<bool, StoreError> {
    let phase = run.phases[run.phase_idx].clone();
    let Some(target) = phase.on_fail.clone() else {
        return Ok(false);
    };
    // Validation pins on_fail to an earlier phase; a miss falls off to the
    // Unverified terminal rather than rewinding somewhere silently.
    let Some(earlier) = run.phases[..run.phase_idx]
        .iter()
        .position(|p| p.name == target)
    else {
        return Ok(false);
    };
    match route(
        &phase,
        Routing::Back(run.phase_idx - earlier),
        run.back_edges,
    ) {
        RouteOutcome::Rewind(distance) => {
            run.back_edges += 1;
            run.phase_idx -= distance;
            run.phase_entered = false;
            observe(
                shared,
                run,
                format!(
                    "Phase '{}' exhausted its turn budget without an answer — \
                     routing back to '{target}'.",
                    phase.name
                ),
            )
            .await?;
            Ok(true)
        }
        _ => Ok(false), // back-edge budget spent: no more rewinds
    }
}

/// Declared fan-out (`phase.N.fan_out`/`parts`): on phase entry, split the
/// previous phase's artifact along its contract's `parts` List field and
/// queue one delegate call per item — the queued batch runs concurrently
/// through the normal dispatch path. No items = an observation, never a
/// hard failure; the phase then runs its normal turns.
pub(crate) async fn enqueue_fan_out(shared: &Shared, run: &mut RunState) -> Result<(), StoreError> {
    let phase = &run.phases[run.phase_idx];
    let (Some(tool), Some(parts)) = (phase.fan_out.clone(), phase.parts.clone()) else {
        return Ok(());
    };
    let agent = shared
        .agents
        .get(&run.agent_id)
        .expect("run built from a validated agent");
    let items: Vec<String> = run
        .phase_idx
        .checked_sub(1)
        .map(|i| &run.phases[i])
        .and_then(|prev| {
            let (_, artifact) = run.artifacts.iter().rev().find(|(n, _)| *n == prev.name)?;
            let contract = resolve_contract(agent, &prev.contract).ok()?;
            let parsed = contract.parse(&InferenceReply::text(artifact)).ok()?;
            Some(
                parsed
                    .fields
                    .get(&parts)?
                    .as_array()?
                    .iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect(),
            )
        })
        .unwrap_or_default();
    if items.is_empty() {
        return observe(
            shared,
            run,
            format!(
                "fan-out: no '{parts}' list items found in the previous phase's \
                 artifact; continuing without fan-out"
            ),
        )
        .await;
    }
    for item in items {
        run.queued_calls.push(ToolCall {
            id: format!("{}-call-{}", run.id.0, run.call_seq),
            name: tool.clone(),
            args: json!({ "goal": item }),
        });
        run.call_seq += 1;
    }
    Ok(())
}
