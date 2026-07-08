//! Tool-call dispatch (MAP hops 7-8): ToolSet membership check → action
//! gate → execute / park / deny. Confirmations pause the run; resolutions
//! resume it. Tool failures become observations, never exceptions.

use std::rc::Rc;

use askk_core::{
    ActionProposal, ActionRecord, SignalKind, Tool, ToolCall, ToolCtx, ToolResult, Verdict,
};
use serde_json::json;

use crate::actions::ActionGate;
use crate::run::session::{RunState, Shared};
use crate::run::turn::{effective_allow, emit, observe};
use crate::state::StoreError;

/// ToolCtx slice carrying the caller's delegation depth (read by DelegateTool).
pub(crate) const DEPTH_SLICE: &str = "delegation_depth";
/// ToolCtx slice carrying the caller's effective allowlist (authority narrows).
pub(crate) const PARENT_TOOLS_SLICE: &str = "parent_tools";

#[derive(PartialEq, Eq)]
pub(crate) enum Dispatch {
    Done,
    Paused,
}

/// The dispatch allowlist check: phase-effective membership, then the
/// registry (ADR-004). No per-call ToolSet rebuild.
fn resolve_tool(shared: &Shared, run: &RunState, name: &str) -> Option<Rc<dyn Tool>> {
    effective_allow(run)
        .iter()
        .any(|t| t == name)
        .then(|| shared.registry.get(name).cloned())
        .flatten()
}

/// Dispatch the run's queued tool calls: membership check → action gate →
/// execute / park / deny. Pauses (and returns) on a confirmation.
pub(crate) async fn dispatch_queued(
    shared: &Shared,
    run: &mut RunState,
) -> Result<Dispatch, StoreError> {
    while !run.queued_calls.is_empty() {
        let call = run.queued_calls.remove(0);
        emit(
            shared,
            run,
            SignalKind::ToolRequested {
                call_id: call.id.clone(),
                name: call.name.clone(),
                args: call.args.clone(),
            },
        )
        .await?;
        let Some(tool) = resolve_tool(shared, run, &call.name) else {
            let allow = effective_allow(run);
            observe(
                shared,
                run,
                format!(
                    "unknown tool '{}'; allowed tools: [{}]. Use one of those or answer.",
                    call.name,
                    allow.join(", ")
                ),
            )
            .await?;
            continue;
        };
        let host = shared.host();
        let gate = ActionGate::new({
            let host = host.clone();
            move || host.now_ms()
        });
        let (verdict, mut record) = gate.evaluate(&call, tool.spec(), &shared.policy);
        match verdict {
            Verdict::Auto => {
                emit(shared, run, SignalKind::ActionVerdict { record }).await?;
                execute_tool(shared, run, &call, &tool).await?;
            }
            Verdict::NeedsConfirmation if run.depth > 0 => {
                // A delegated run cannot pause its parent's tool call; the
                // confirmation degrades to a first-class denial observation.
                let content = format!(
                    "action '{}' requires confirmation, which is unavailable in a \
                     delegated run; it was denied",
                    call.name
                );
                record.verdict = Verdict::Denied {
                    reason: "confirmation unavailable in delegated run".into(),
                };
                record.result = Some(ToolResult::err(content.clone()));
                emit(shared, run, SignalKind::ActionVerdict { record }).await?;
                observe(shared, run, content).await?;
            }
            Verdict::NeedsConfirmation => {
                run.awaiting = Some(record.proposal.id.clone());
                emit(
                    shared,
                    run,
                    SignalKind::ActionVerdict {
                        record: record.clone(),
                    },
                )
                .await?;
                shared.pending.borrow_mut().park(record);
                host.confirm_ready(&shared.pending.borrow());
                return Ok(Dispatch::Paused);
            }
            Verdict::Denied { .. } => {
                let content = record
                    .result
                    .as_ref()
                    .map(|r| r.content.clone())
                    .unwrap_or_default();
                emit(shared, run, SignalKind::ActionVerdict { record }).await?;
                observe(shared, run, content).await?;
            }
        }
    }
    Ok(Dispatch::Done)
}

/// Execute one gated-through call. Tool errors become observations — they
/// never throw into the loop. Written state slices lift back with signals.
async fn execute_tool(
    shared: &Shared,
    run: &mut RunState,
    call: &ToolCall,
    tool: &Rc<dyn Tool>,
) -> Result<(), StoreError> {
    let mut ctx = ToolCtx::default();
    for (key, value) in &run.snapshot.slices {
        ctx.set_slice(key.clone(), value.clone());
    }
    ctx.set_slice(DEPTH_SLICE, json!(run.depth));
    ctx.set_slice(PARENT_TOOLS_SLICE, json!(effective_allow(run)));
    let result = tool.call(call.args.clone(), &mut ctx).await;

    // Lift back every slice the ctx now holds (ADR-005): ALL tool-written
    // keys — pre-declared or brand new — emit StateWritten on change.
    for key in ctx.slice_keys() {
        if key == DEPTH_SLICE || key == PARENT_TOOLS_SLICE {
            continue;
        }
        if let Some(value) = ctx.slice(&key) {
            if run.snapshot.slices.get(&key) != Some(value) {
                run.snapshot.slices.insert(key.clone(), value.clone());
                emit(shared, run, SignalKind::StateWritten { key }).await?;
            }
        }
    }

    emit(
        shared,
        run,
        SignalKind::ToolCompleted {
            call_id: call.id.clone(),
            ok: result.ok,
            content: result.content.clone(),
        },
    )
    .await?;
    observe(shared, run, format!("{}: {}", call.name, result.content)).await
}

/// Apply a user's confirmation decision: approve executes the parked
/// proposal; deny records the denial and its readable observation.
pub(crate) async fn apply_resolution(
    shared: &Shared,
    run: &mut RunState,
    proposal: ActionProposal,
    record: ActionRecord,
    approve: bool,
) -> Result<(), StoreError> {
    run.awaiting = None;
    if approve {
        let call = ToolCall {
            id: proposal.id.0.clone(),
            name: proposal.tool.clone(),
            args: proposal.args.clone(),
        };
        match resolve_tool(shared, run, &call.name) {
            Some(tool) => execute_tool(shared, run, &call, &tool).await,
            None => {
                observe(
                    shared,
                    run,
                    format!("approved tool '{}' is no longer available", call.name),
                )
                .await
            }
        }
    } else {
        let content = record
            .result
            .as_ref()
            .map(|r| r.content.clone())
            .unwrap_or_default();
        emit(
            shared,
            run,
            SignalKind::ActionVerdict {
                record: record.clone(),
            },
        )
        .await?;
        emit(
            shared,
            run,
            SignalKind::ToolCompleted {
                call_id: proposal.id.0.clone(),
                ok: false,
                content: content.clone(),
            },
        )
        .await?;
        observe(shared, run, content).await
    }
}
