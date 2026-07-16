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
    // The agent should still resolve (the run was built from a validated or
    // spawned one). If that invariant ever breaks, skip fan-out with a trace
    // instead of panicking (ADR-042) — the phase's own turns then land the
    // terminal via one_turn. Mirrors the no-items degrade below: fan-out is
    // best-effort, never a hard failure.
    let Some(agent) = shared.agent_config(&run.agent_id) else {
        return observe(
            shared,
            run,
            format!(
                "fan-out: agent '{}' unavailable; continuing without fan-out",
                run.agent_id
            ),
        )
        .await;
    };
    let items: Vec<String> = run
        .phase_idx
        .checked_sub(1)
        .map(|i| &run.phases[i])
        .and_then(|prev| {
            let (_, artifact) = run.artifacts.iter().rev().find(|(n, _)| *n == prev.name)?;
            let contract = resolve_contract(&agent, &prev.contract).ok()?;
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

#[cfg(test)]
mod tests {
    use std::rc::Rc;

    use askk_core::{ActionPolicy, Budgets, ProviderError, RunId, SignalKind};

    use super::*;
    use crate::config::AgentConfig;
    use crate::run::session::{RunSession, SessionInit};
    use crate::state::{MemBlob, MemKv, MemoryStore, SessionStore, SignalLog};
    use crate::testutil::block_on;
    use crate::tools::ToolRegistry;

    /// A fan-out phase whose agent vanished mid-run degrades to a trace
    /// observation and queues nothing — never a panic (ADR-042).
    #[test]
    fn fan_out_missing_agent_degrades_not_panics() {
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
            })
            .unwrap();
            let shared = &session.shared;
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
            // The fan-out gate is reached (fan_out + parts set), but the agent
            // id no longer resolves.
            run.agent_id = "ghost".into();
            run.phases[0].fan_out = Some("worker".into());
            run.phases[0].parts = Some("steps".into());
            enqueue_fan_out(shared, &mut run).await.unwrap();
            assert!(run.queued_calls.is_empty());
            assert!(run.signals.iter().any(|s| matches!(
                &s.kind,
                SignalKind::ObservationAppended { text } if text.contains("unavailable")
            )));
        });
    }
}
