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
/// ToolCtx slice carrying the caller's run id (DelegateTool resolves the
/// parent's live host through it for the nested run).
pub(crate) const PARENT_RUN_SLICE: &str = "parent_run_id";

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
///
/// Consecutive Auto-verdict calls execute CONCURRENTLY (ADR-015): their
/// `Tool::call` futures are joined, so a multi-call turn fans sub-agents and
/// I/O-bound tools out in parallel; results absorb in call order.
pub(crate) async fn dispatch_queued(
    shared: &Shared,
    run: &mut RunState,
) -> Result<Dispatch, StoreError> {
    let mut batch: Vec<(ToolCall, Rc<dyn Tool>)> = Vec::new();
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
            execute_batch(shared, run, &mut batch).await?;
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
        let host = shared.host(&run.id);
        let gate = ActionGate::new({
            let host = host.clone();
            move || host.now_ms()
        });
        let (verdict, mut record) = gate.evaluate(&call, tool.spec(), &shared.policy);
        match verdict {
            Verdict::Auto => {
                emit(shared, run, SignalKind::ActionVerdict { record }).await?;
                batch.push((call, tool));
            }
            Verdict::NeedsConfirmation if run.depth > 0 => {
                execute_batch(shared, run, &mut batch).await?;
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
                execute_batch(shared, run, &mut batch).await?;
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
                execute_batch(shared, run, &mut batch).await?;
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
    execute_batch(shared, run, &mut batch).await?;
    Ok(Dispatch::Done)
}

/// Run the accumulated Auto-verdict batch: one call executes inline; several
/// run their futures concurrently (join_all), then absorb sequentially in
/// call order (deterministic signals; a shared state slice = last writer
/// wins, same as the sequential path).
async fn execute_batch(
    shared: &Shared,
    run: &mut RunState,
    batch: &mut Vec<(ToolCall, Rc<dyn Tool>)>,
) -> Result<(), StoreError> {
    if batch.len() <= 1 {
        if let Some((call, tool)) = batch.pop() {
            execute_tool(shared, run, &call, &tool).await?;
        }
        return Ok(());
    }
    let calls: Vec<(ToolCall, Rc<dyn Tool>)> = std::mem::take(batch);
    let jobs = calls.iter().map(|(call, tool)| {
        let mut ctx = make_ctx(run);
        async move {
            let result = tool.call(call.args.clone(), &mut ctx).await;
            (result, ctx)
        }
    });
    let outcomes = futures::future::join_all(jobs).await;
    for ((call, _), (result, ctx)) in calls.iter().zip(outcomes) {
        absorb_result(shared, run, call, result, ctx).await?;
    }
    Ok(())
}

/// The per-call ToolCtx: the run's state slices + the delegation slices.
fn make_ctx(run: &RunState) -> ToolCtx {
    let mut ctx = ToolCtx::default();
    for (key, value) in &run.snapshot.slices {
        ctx.set_slice(key.clone(), value.clone());
    }
    ctx.set_slice(DEPTH_SLICE, json!(run.depth));
    ctx.set_slice(PARENT_TOOLS_SLICE, json!(effective_allow(run)));
    ctx.set_slice(PARENT_RUN_SLICE, json!(run.id.0));
    ctx
}

/// Execute one gated-through call. Tool errors become observations — they
/// never throw into the loop. Written state slices lift back with signals.
async fn execute_tool(
    shared: &Shared,
    run: &mut RunState,
    call: &ToolCall,
    tool: &Rc<dyn Tool>,
) -> Result<(), StoreError> {
    let mut ctx = make_ctx(run);
    let result = tool.call(call.args.clone(), &mut ctx).await;
    absorb_result(shared, run, call, result, ctx).await
}

/// Lift written slices back, land ToolCompleted, append the observation.
async fn absorb_result(
    shared: &Shared,
    run: &mut RunState,
    call: &ToolCall,
    result: askk_core::ToolResult,
    ctx: ToolCtx,
) -> Result<(), StoreError> {
    // Lift back every slice the ctx now holds (ADR-005): ALL tool-written
    // keys — pre-declared or brand new — emit StateWritten on change.
    for key in ctx.slice_keys() {
        if key == DEPTH_SLICE || key == PARENT_TOOLS_SLICE || key == PARENT_RUN_SLICE {
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
