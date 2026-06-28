// The worker runtime only runs inside a Web Worker (wasm). On the host build its
// entry points are unused outside tests, so allow dead code off-wasm only.
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use crate::core::event::{InstanceName, Signal, SignalKind};
use crate::engine::{LoopParams, SessionRunner, request_interrupt};
use crate::state::{AgentRun, AppResult, RunId};
use crate::worker::transport::{
    WorkerCommand, WorkerDispatch, WorkerError, WorkerEvent, WorkerResult, WorkerStatus,
};

pub fn handle_non_dispatch_command(command: WorkerCommand) -> Option<WorkerEvent> {
    match command {
        WorkerCommand::Cancel(cancel) => {
            // Per-instance: interrupt only the run this Cancel names, so cancelling
            // one worker run never halts another live in the same worker.
            request_interrupt(&RunId::from(cancel.run_id.clone()));
            Some(WorkerEvent::Cancelled(cancel))
        }
        // The page answered a proxied page-thread operation: wake its waiter
        // (see `page_proxy`). The ack keeps the one-reply-per-message contract.
        WorkerCommand::PageOpResolved(resolved) => {
            let result = if resolved.ok {
                Ok(resolved.value)
            } else {
                Err(resolved.value)
            };
            crate::worker::page_proxy::resolve_page_op(&resolved.request_id, result);
            Some(WorkerEvent::PageOpAck {
                request_id: resolved.request_id,
            })
        }
        WorkerCommand::Dispatch(_) => None,
    }
}

pub async fn run_worker_command_json(payload: &str) -> AppResult<String> {
    let command: WorkerCommand = serde_json::from_str(payload)
        .map_err(|err| format!("Unable to parse worker command JSON: {err}"))?;
    let event = run_worker_command(command, post_worker_event).await;
    serde_json::to_string(&event)
        .map_err(|err| format!("Unable to encode worker event JSON: {err}"))
}

pub async fn run_worker_command<F>(command: WorkerCommand, progress_sink: F) -> WorkerEvent
where
    F: FnMut(WorkerEvent) + 'static,
{
    if let Some(event) = handle_non_dispatch_command(command.clone()) {
        return event;
    }

    match command {
        WorkerCommand::Dispatch(dispatch) => {
            let run_id = dispatch.run_id.clone();
            let worker_id = dispatch.worker_id.clone();
            match run_worker_dispatch(dispatch, progress_sink).await {
                Ok(result) => WorkerEvent::Result(result),
                Err(message) => WorkerEvent::Error(WorkerError {
                    run_id,
                    worker_id,
                    message,
                }),
            }
        }
        // `handle_non_dispatch_command` already returns for these above; the arms
        // exist only so the match is total. Never panic from the worker runtime.
        WorkerCommand::Cancel(cancel) => WorkerEvent::Error(WorkerError {
            run_id: cancel.run_id,
            worker_id: cancel.worker_id,
            message: "Cancel command reached dispatch handling unexpectedly.".to_string(),
        }),
        WorkerCommand::PageOpResolved(resolved) => WorkerEvent::PageOpAck {
            request_id: resolved.request_id,
        },
    }
}

pub async fn run_worker_dispatch<F>(
    dispatch: WorkerDispatch,
    progress_sink: F,
) -> AppResult<WorkerResult>
where
    F: FnMut(WorkerEvent) + 'static,
{
    let run_id = dispatch.run_id.clone();
    let worker_id = dispatch.worker_id.clone();
    let goal = dispatch.goal.clone();
    let params = LoopParams {
        agent_id: Some(dispatch.agent.id.clone()),
        strategy: dispatch.strategy.clone(),
        max_turns: dispatch.max_turns,
    };
    let snapshot = dispatch.snapshot.with_active_agent(dispatch.agent);
    let runtime = SessionRunner::new();

    // The page posts on this channel. After the Phase-2 cutover the Signal stream
    // below is the SOLE live channel, so only the Signal sink posts here.
    let sink = Rc::new(RefCell::new(progress_sink));

    // The observer is a no-op: the bus is authoritative, so the worker no longer
    // serializes a full `AgentRun` `Progress` clone across the worker boundary on
    // every state change (the engine's hooks also skip the clone when a Signal
    // sink is wired). The engine still requires an observer to satisfy its
    // signature; this one does nothing.
    let observer = |_run: AgentRun| {};

    // The Signal sink: the ONLY place seq/ts_ms/run_id are assigned. The
    // engine/hook layer emits only `(instance, kind)`; here we keep a per-
    // (run_id, instance) monotonic seq counter, stamp `ts_ms` from the browser
    // clock, fill the run id, assemble the full `Signal`, and post it as
    // `WorkerEvent::Signal`.
    let signal_sink: Box<dyn FnMut(InstanceName, SignalKind)> = {
        let sink = sink.clone();
        let signal_run_id = run_id.clone();
        let mut seqs: HashMap<InstanceName, u64> = HashMap::new();
        Box::new(move |instance: InstanceName, kind: SignalKind| {
            let seq = {
                let counter = seqs.entry(instance.clone()).or_insert(0);
                let current = *counter;
                *counter += 1;
                current
            };
            let signal = Signal {
                seq,
                run_id: signal_run_id.clone(),
                instance,
                kind,
                ts_ms: now_ms(),
            };
            (sink.borrow_mut())(WorkerEvent::Signal(signal));
        })
    };

    let final_snapshot = runtime
        .run_with_params_observer_and_signal(snapshot, goal, params, observer, Some(signal_sink))
        .await?;

    let status = final_snapshot
        .current_run()
        .map(|run| WorkerStatus::from(run.status))
        .unwrap_or(WorkerStatus::Failed);
    let answer = final_snapshot
        .current_run()
        .map(|run| run.final_answer.clone())
        .unwrap_or_default();
    let trace = final_snapshot
        .current_run()
        .map(trace_from_run)
        .unwrap_or_default();

    Ok(WorkerResult {
        run_id,
        worker_id,
        status,
        answer,
        trace,
        snapshot: final_snapshot,
    })
}

/// Millisecond epoch stamp for a [`Signal`], read at the worker boundary so the
/// pure core never touches a clock. The browser uses `Date::now()`; the host test
/// runner (no JS clock) stamps `0.0`, which the round-trip tests don't depend on.
#[cfg(target_arch = "wasm32")]
fn now_ms() -> f64 {
    js_sys::Date::now()
}

#[cfg(not(target_arch = "wasm32"))]
fn now_ms() -> f64 {
    0.0
}

fn trace_from_run(run: &AgentRun) -> Vec<String> {
    run.events
        .iter()
        .map(|event| format!("{:?}: {}", event.kind, event.title))
        .collect()
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn post_worker_event(event: WorkerEvent) {
    use wasm_bindgen::{JsCast, JsValue};

    let Ok(json) = serde_json::to_string(&event) else {
        return;
    };
    let global = js_sys::global();
    let Ok(post_message) = js_sys::Reflect::get(&global, &JsValue::from_str("postMessage")) else {
        return;
    };
    if let Some(function) = post_message.dyn_ref::<js_sys::Function>() {
        let _ = function.call1(&global, &JsValue::from_str(&json));
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn post_worker_event(_event: WorkerEvent) {}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub async fn askk_worker_handle(payload: String) -> Result<String, wasm_bindgen::JsValue> {
    run_worker_command_json(&payload)
        .await
        .map_err(|err| wasm_bindgen::JsValue::from_str(&err))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::worker::transport::{WorkerCancel, WorkerCommand, WorkerEvent};

    #[test]
    fn cancel_command_returns_structured_cancel_event() {
        let command = WorkerCommand::Cancel(WorkerCancel {
            run_id: "run-1".to_string(),
            worker_id: "worker-a".to_string(),
            reason: "user requested stop".to_string(),
        });

        let event = handle_non_dispatch_command(command).unwrap();

        match event {
            WorkerEvent::Cancelled(cancelled) => {
                assert_eq!(cancelled.run_id, "run-1");
                assert_eq!(cancelled.reason, "user requested stop");
            }
            other => panic!("expected cancelled event, got {other:?}"),
        }
    }
}
