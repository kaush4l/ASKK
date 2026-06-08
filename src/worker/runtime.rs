// The worker runtime only runs inside a Web Worker (wasm). On the host build its
// entry points are unused outside tests, so allow dead code off-wasm only.
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

use crate::engine::{ReActEngine, request_interrupt};
use crate::state::{AgentRun, AppResult};
use crate::worker::transport::{
    WorkerCommand, WorkerDispatch, WorkerError, WorkerEvent, WorkerProgress, WorkerResult,
    WorkerStatus,
};

pub fn handle_non_dispatch_command(command: WorkerCommand) -> Option<WorkerEvent> {
    match command {
        WorkerCommand::Cancel(cancel) => {
            request_interrupt();
            Some(WorkerEvent::Cancelled(cancel))
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
        // `handle_non_dispatch_command` already returns for Cancel above; this arm
        // exists only so the match is total. Never panic from the worker runtime.
        WorkerCommand::Cancel(cancel) => WorkerEvent::Error(WorkerError {
            run_id: cancel.run_id,
            worker_id: cancel.worker_id,
            message: "Cancel command reached dispatch handling unexpectedly.".to_string(),
        }),
    }
}

pub async fn run_worker_dispatch<F>(
    dispatch: WorkerDispatch,
    mut progress_sink: F,
) -> AppResult<WorkerResult>
where
    F: FnMut(WorkerEvent) + 'static,
{
    let run_id = dispatch.run_id.clone();
    let worker_id = dispatch.worker_id.clone();
    let goal = dispatch.goal.clone();
    let snapshot = dispatch.snapshot.with_active_agent(dispatch.agent);
    let runtime = ReActEngine::new();
    let progress_run_id = run_id.clone();
    let progress_worker_id = worker_id.clone();

    let final_snapshot = runtime
        .run_goal_with_observer(snapshot, goal, move |run| {
            progress_sink(progress_event(
                progress_run_id.clone(),
                progress_worker_id.clone(),
                run,
            ));
        })
        .await?;

    let status = final_snapshot
        .current_run
        .as_ref()
        .map(|run| WorkerStatus::from(run.status))
        .unwrap_or(WorkerStatus::Failed);
    let answer = final_snapshot
        .current_run
        .as_ref()
        .map(|run| run.final_answer.clone())
        .unwrap_or_default();
    let trace = final_snapshot
        .current_run
        .as_ref()
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

fn progress_event(run_id: String, worker_id: String, run: AgentRun) -> WorkerEvent {
    WorkerEvent::Progress(WorkerProgress {
        run_id,
        worker_id,
        message: format!("Running {} lane", run.lane.as_label()),
        run,
    })
}

fn trace_from_run(run: &AgentRun) -> Vec<String> {
    run.events
        .iter()
        .map(|event| format!("{:?}: {}", event.kind, event.title))
        .collect()
}

#[cfg(target_arch = "wasm32")]
fn post_worker_event(event: WorkerEvent) {
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
