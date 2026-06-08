#[cfg(not(target_arch = "wasm32"))]
use crate::engine::ReActEngine;
use crate::engine::request_interrupt;
use crate::state::{Agent, AgentRun, AppResult, AppSnapshot};

#[cfg(target_arch = "wasm32")]
use crate::worker::transport::{
    WorkerCancel, WorkerCommand, WorkerDispatch, WorkerEvent, WorkerStatus,
};
#[cfg(target_arch = "wasm32")]
use dioxus::prelude::*;
#[cfg(target_arch = "wasm32")]
use futures_channel::oneshot;
#[cfg(target_arch = "wasm32")]
use std::cell::RefCell;
#[cfg(target_arch = "wasm32")]
use std::rc::Rc;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::{JsCast, JsValue, closure::Closure};

#[cfg(target_arch = "wasm32")]
const AGENT_WORKER_JS: Asset = asset!("/assets/agent_worker.js");

#[cfg(target_arch = "wasm32")]
thread_local! {
    static ACTIVE_WORKERS: RefCell<Vec<ActiveWorker>> = const { RefCell::new(Vec::new()) };
}

#[cfg(target_arch = "wasm32")]
#[derive(Clone)]
struct ActiveWorker {
    worker: web_sys::Worker,
    run_id: String,
    worker_id: String,
}

pub async fn run_goal_in_worker_or_inline<F>(
    snapshot: AppSnapshot,
    goal: String,
    observer: F,
) -> AppResult<AppSnapshot>
where
    F: FnMut(AgentRun) + 'static,
{
    let agent = crate::engine::pick_agent(&snapshot);
    run_goal_for_agent_in_worker_or_inline(
        snapshot,
        goal,
        agent,
        "agent-worker-1".to_string(),
        observer,
    )
    .await
}

pub async fn run_goal_for_agent_in_worker_or_inline<F>(
    snapshot: AppSnapshot,
    goal: String,
    agent: Agent,
    worker_id: String,
    observer: F,
) -> AppResult<AppSnapshot>
where
    F: FnMut(AgentRun) + 'static,
{
    #[cfg(not(target_arch = "wasm32"))]
    let _ = worker_id;
    #[cfg(target_arch = "wasm32")]
    {
        run_goal_in_web_worker(snapshot, goal, agent, worker_id, observer).await
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        ReActEngine::new()
            .run_goal_with_observer(snapshot.with_active_agent(agent), goal, observer)
            .await
    }
}

pub fn request_active_worker_cancel(reason: &str) {
    request_interrupt();
    #[cfg(not(target_arch = "wasm32"))]
    let _ = reason;
    #[cfg(target_arch = "wasm32")]
    ACTIVE_WORKERS.with(|active| {
        for active in active.borrow().iter() {
            let command = WorkerCommand::Cancel(WorkerCancel {
                run_id: active.run_id.clone(),
                worker_id: active.worker_id.clone(),
                reason: reason.to_string(),
            });
            if let Ok(payload) = serde_json::to_string(&command) {
                let _ = active.worker.post_message(&JsValue::from_str(&payload));
            }
        }
    });
}

#[cfg(target_arch = "wasm32")]
async fn run_goal_in_web_worker<F>(
    snapshot: AppSnapshot,
    goal: String,
    agent: Agent,
    worker_id: String,
    observer: F,
) -> AppResult<AppSnapshot>
where
    F: FnMut(AgentRun) + 'static,
{
    let run_id = uuid::Uuid::new_v4().to_string();
    let command = WorkerCommand::Dispatch(WorkerDispatch {
        run_id: run_id.clone(),
        worker_id: worker_id.clone(),
        goal,
        agent,
        snapshot,
    });
    let worker = spawn_agent_worker()?;
    let (tx, rx) = oneshot::channel::<AppResult<AppSnapshot>>();
    let tx_cell = Rc::new(RefCell::new(Some(tx)));
    let observer_cell = Rc::new(RefCell::new(observer));

    install_message_handler(&worker, Rc::clone(&tx_cell), Rc::clone(&observer_cell));
    install_error_handler(&worker, Rc::clone(&tx_cell));

    ACTIVE_WORKERS.with(|active| {
        active.borrow_mut().push(ActiveWorker {
            worker: worker.clone(),
            run_id: run_id.clone(),
            worker_id: worker_id.clone(),
        });
    });

    let payload = serde_json::to_string(&command)
        .map_err(|err| format!("Unable to encode worker dispatch: {err}"))?;
    worker
        .post_message(&JsValue::from_str(&payload))
        .map_err(|err| format!("Unable to dispatch worker command: {err:?}"))?;

    let result = rx
        .await
        .unwrap_or_else(|_| Err("Agent worker closed without returning a result.".to_string()));
    worker.terminate();
    ACTIVE_WORKERS.with(|active| {
        active
            .borrow_mut()
            .retain(|active_worker| active_worker.run_id != run_id);
    });
    result
}

#[cfg(target_arch = "wasm32")]
fn spawn_agent_worker() -> AppResult<web_sys::Worker> {
    let options = web_sys::WorkerOptions::new();
    options.set_type(web_sys::WorkerType::Module);
    let mut script_url = AGENT_WORKER_JS.to_string();
    // The worker must import the SAME wasm-bindgen glue the page loaded. Its hashed
    // URL respects the deploy base path (e.g. /ASKK/assets/askk-<hash>.js), which a
    // static worker file cannot hardcode — so discover it from the page and hand it
    // to the worker as a query parameter.
    if let Some(glue) = main_wasm_glue_url() {
        let encoded = String::from(js_sys::encode_uri_component(&glue));
        script_url = format!("{script_url}?wasm={encoded}");
    }
    web_sys::Worker::new_with_options(&script_url, &options)
        .map_err(|err| format!("Unable to start agent Web Worker `{script_url}`: {err:?}"))
}

/// Find the URL of the wasm-bindgen glue script the page loaded, so the worker can
/// import the same module under whatever base path the app is hosted at.
#[cfg(target_arch = "wasm32")]
fn main_wasm_glue_url() -> Option<String> {
    let document = web_sys::window()?.document()?;
    let scripts = document
        .query_selector_all("script[type=\"module\"][src]")
        .ok()?;
    for index in 0..scripts.length() {
        let Some(node) = scripts.item(index) else {
            continue;
        };
        let Some(element) = node.dyn_ref::<web_sys::Element>() else {
            continue;
        };
        let Some(src) = element.get_attribute("src") else {
            continue;
        };
        if src.contains("askk") && src.ends_with(".js") && !src.contains("worker") {
            return Some(src);
        }
    }
    None
}

#[cfg(target_arch = "wasm32")]
fn install_message_handler<F>(
    worker: &web_sys::Worker,
    tx_cell: Rc<RefCell<Option<oneshot::Sender<AppResult<AppSnapshot>>>>>,
    observer_cell: Rc<RefCell<F>>,
) where
    F: FnMut(AgentRun) + 'static,
{
    let onmessage = Closure::<dyn FnMut(web_sys::MessageEvent)>::wrap(Box::new(
        move |event: web_sys::MessageEvent| {
            let Some(payload) = event.data().as_string() else {
                finish_once(
                    &tx_cell,
                    Err("Agent worker sent a non-string message.".to_string()),
                );
                return;
            };
            let parsed = serde_json::from_str::<WorkerEvent>(&payload);
            match parsed {
                Ok(WorkerEvent::Progress(progress)) => {
                    observer_cell.borrow_mut()(progress.run);
                }
                Ok(WorkerEvent::Result(result)) => {
                    let status = result.status;
                    let snapshot = result.snapshot;
                    if status == WorkerStatus::Succeeded || status == WorkerStatus::Cancelled {
                        finish_once(&tx_cell, Ok(snapshot));
                    } else {
                        let detail = snapshot
                            .current_run
                            .as_ref()
                            .map(|run| run.final_answer.clone())
                            .filter(|answer| !answer.trim().is_empty())
                            .unwrap_or(result.answer);
                        finish_once(&tx_cell, Err(format!("Agent worker failed: {detail}")));
                    }
                }
                Ok(WorkerEvent::Error(error)) => finish_once(&tx_cell, Err(error.message)),
                Ok(WorkerEvent::Cancelled(_)) => {}
                Ok(WorkerEvent::Ready { .. }) => {}
                Err(err) => finish_once(
                    &tx_cell,
                    Err(format!(
                        "Unable to parse agent worker event: {err}: {payload}"
                    )),
                ),
            }
        },
    ));
    worker.set_onmessage(Some(onmessage.as_ref().unchecked_ref()));
    onmessage.forget();
}

#[cfg(target_arch = "wasm32")]
fn install_error_handler(
    worker: &web_sys::Worker,
    tx_cell: Rc<RefCell<Option<oneshot::Sender<AppResult<AppSnapshot>>>>>,
) {
    let onerror = Closure::<dyn FnMut(web_sys::ErrorEvent)>::wrap(Box::new(
        move |event: web_sys::ErrorEvent| {
            finish_once(
                &tx_cell,
                Err(format!(
                    "Agent worker error at {}:{}: {}",
                    event.filename(),
                    event.lineno(),
                    event.message()
                )),
            );
        },
    ));
    worker.set_onerror(Some(onerror.as_ref().unchecked_ref()));
    onerror.forget();
}

#[cfg(target_arch = "wasm32")]
fn finish_once(
    tx_cell: &Rc<RefCell<Option<oneshot::Sender<AppResult<AppSnapshot>>>>>,
    result: AppResult<AppSnapshot>,
) {
    if let Some(tx) = tx_cell.borrow_mut().take() {
        let _ = tx.send(result);
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::field_reassign_with_default)]
    use crate::state::{Agent, AppSnapshot};

    #[test]
    fn pick_agent_prefers_enabled_agent() {
        let mut snapshot = AppSnapshot::default();
        snapshot.agents = vec![
            Agent {
                enabled: false,
                ..Agent::new("Disabled", "Do not pick", vec!["web_search".to_string()])
            },
            Agent::new("Enabled", "Pick me", vec!["web_search".to_string()]),
        ];

        let agent = crate::engine::pick_agent(&snapshot);

        assert_eq!(agent.name, "Enabled");
    }
}
