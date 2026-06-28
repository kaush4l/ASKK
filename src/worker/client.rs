#[cfg(not(target_arch = "wasm32"))]
use crate::engine::SessionRunner;
#[cfg(target_arch = "wasm32")]
use crate::engine::request_interrupt;
#[cfg(target_arch = "wasm32")]
use crate::state::RunId;
use crate::state::{Agent, AgentRun, AppResult, AppSnapshot};

#[cfg(target_arch = "wasm32")]
use crate::state::InstanceCollection;
#[cfg(target_arch = "wasm32")]
use crate::worker::transport::{
    PageOpResolved, WorkerCancel, WorkerCommand, WorkerDispatch, WorkerEvent, WorkerStatus,
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
        use crate::engine::LoopParams;
        let params = LoopParams {
            agent_id: Some(agent.id.clone()),
            ..LoopParams::default()
        };
        SessionRunner::new()
            .run_with_params_and_observer(snapshot.with_active_agent(agent), goal, params, observer)
            .await
    }
}

pub fn request_active_worker_cancel(reason: &str) {
    #[cfg(not(target_arch = "wasm32"))]
    let _ = reason;
    #[cfg(target_arch = "wasm32")]
    ACTIVE_WORKERS.with(|active| {
        for active in active.borrow().iter() {
            // Per-instance interrupt by id: flag this run page-side (belt-and-
            // suspenders) AND post the Cancel command so the worker thread, which
            // owns the run's own interrupt set, halts it after the current turn.
            request_interrupt(&RunId::from(active.run_id.clone()));
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

/// Request that the single run identified by `run_id` stop after its current turn,
/// leaving every other live instance running. The fleet's per-instance "Stop"
/// control routes here: it flags the run page-side and posts a `Cancel` to only the
/// worker that owns it (matched by `run_id`). A run with no live worker (already
/// terminal, or running inline) is simply flagged. The host build is a no-op.
pub fn request_run_cancel(run_id: &str, reason: &str) {
    #[cfg(not(target_arch = "wasm32"))]
    let _ = (run_id, reason);
    #[cfg(target_arch = "wasm32")]
    {
        // Flag the run page-side regardless of whether a worker is found, so an
        // inline run (or a worker mid-handoff) still halts after the current turn.
        request_interrupt(&RunId::from(run_id.to_string()));
        ACTIVE_WORKERS.with(|active| {
            for active in active.borrow().iter() {
                if active.run_id != run_id {
                    continue;
                }
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
        strategy: None,
        max_turns: None,
    });
    let worker = spawn_agent_worker()?;
    let (tx, rx) = oneshot::channel::<AppResult<AppSnapshot>>();
    let tx_cell = Rc::new(RefCell::new(Some(tx)));
    let observer_cell = Rc::new(RefCell::new(observer));
    // Per-instance projection: each run's `Signal` stream folds into ITS OWN
    // `EngineInstance.reducer` inside this collection, keyed by the signal's
    // `run_id`, so N concurrent runs each project independently. The bus is the
    // sole live channel now (the worker no longer posts the coarse `Progress`
    // clone), so there is no A/B flag.
    let instances_cell = Rc::new(RefCell::new(InstanceCollection::new()));

    install_message_handler(
        &worker,
        worker.clone(),
        Rc::clone(&tx_cell),
        Rc::clone(&observer_cell),
        Rc::clone(&instances_cell),
    );
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
    worker_handle: web_sys::Worker,
    tx_cell: Rc<RefCell<Option<oneshot::Sender<AppResult<AppSnapshot>>>>>,
    observer_cell: Rc<RefCell<F>>,
    instances_cell: Rc<RefCell<InstanceCollection>>,
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
                    // The per-instance bus is authoritative; the worker no longer
                    // posts the coarse `Progress` clone. This arm stays only to keep
                    // parsing tolerant of a stray `Progress` — fold it into the
                    // matching instance's projection (rather than push it as a
                    // bypassing live path) so the UI still reads one source of truth.
                    let run = progress.run;
                    let run_id = RunId::from(run.id.clone());
                    let mut instances = instances_cell.borrow_mut();
                    instances.upsert_run(run);
                    let projection = instances
                        .get(&run_id)
                        .map(|instance| instance.projection.clone());
                    drop(instances);
                    if let Some(projection) = projection {
                        observer_cell.borrow_mut()(projection);
                    }
                }
                // The worker's authoritative live channel: route each `Signal`
                // delta to ITS OWN instance's reducer (keyed by the signal's
                // `run_id`), then drive the observer with that instance's
                // reconstructed projection so the UI renders the live view from the
                // bus. With N concurrent runs each instance projects independently.
                Ok(WorkerEvent::Signal(signal)) => {
                    let routed = instances_cell.borrow_mut().apply_signal(&signal);
                    if let Some(run_id) = routed {
                        let run = instances_cell
                            .borrow()
                            .get(&run_id)
                            .map(|instance| instance.projection.clone());
                        if let Some(run) = run {
                            observer_cell.borrow_mut()(run);
                        }
                    }
                }
                Ok(WorkerEvent::Result(result)) => {
                    let status = result.status;
                    let snapshot = result.snapshot;
                    // RECONCILE: bound divergence by replacing the matching
                    // instance's projection with the authoritative terminal run from
                    // the result snapshot (the live delta view only carries the
                    // rendered subset), then push the reconciled run so the UI
                    // settles on the full, authoritative state.
                    if let Some(authoritative) = result_authoritative_run(&snapshot) {
                        let run_id = RunId::from(authoritative.id.clone());
                        let mut instances = instances_cell.borrow_mut();
                        // Prefer the reducer-backed `reconcile` so the matching
                        // instance's reducer rebinds to the authoritative snapshot
                        // (the divergence-bounding safety net). If this run never
                        // produced a live `RunStarted` on the page there is no
                        // instance to reconcile, so seed one straight from the
                        // terminal snapshot instead — either way it renders fully.
                        if !instances.reconcile_run(&run_id, authoritative.clone()) {
                            instances.upsert_run(authoritative);
                        }
                        let run = instances
                            .get(&run_id)
                            .map(|instance| instance.projection.clone());
                        drop(instances);
                        if let Some(run) = run {
                            observer_cell.borrow_mut()(run);
                        }
                    }
                    if status == WorkerStatus::Succeeded || status == WorkerStatus::Cancelled {
                        finish_once(&tx_cell, Ok(snapshot));
                    } else {
                        let detail = snapshot
                            .current_run()
                            .map(|run| run.final_answer.clone())
                            .filter(|answer| !answer.trim().is_empty())
                            .unwrap_or(result.answer);
                        finish_once(&tx_cell, Err(format!("Agent worker failed: {detail}")));
                    }
                }
                Ok(WorkerEvent::Error(error)) => finish_once(&tx_cell, Err(error.message)),
                Ok(WorkerEvent::Cancelled(_)) => {}
                Ok(WorkerEvent::Ready { .. }) => {}
                // The worker asked for a window-only operation (device capture,
                // local-model call): run it here on the page and post the result
                // back, correlated by request id. See `worker::page_proxy`.
                Ok(WorkerEvent::PageOpRequested { request_id, op }) => {
                    let responder = worker_handle.clone();
                    wasm_bindgen_futures::spawn_local(async move {
                        let outcome = crate::capabilities::page_ops::execute_page_op(&op).await;
                        let resolved = WorkerCommand::PageOpResolved(PageOpResolved {
                            request_id,
                            ok: outcome.is_ok(),
                            value: match outcome {
                                Ok(value) => value,
                                Err(error) => error,
                            },
                        });
                        if let Ok(payload) = serde_json::to_string(&resolved) {
                            let _ = responder.post_message(&JsValue::from_str(&payload));
                        }
                    });
                }
                Ok(WorkerEvent::PageOpAck { .. }) => {}
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

/// Pull the authoritative terminal [`AgentRun`] out of a worker-result snapshot for
/// [`RunReducer::reconcile`]. Prefers `current_run` (the run the worker just
/// finished); falls back to the most recently appended entry in `snapshot.runs`
/// (the worker checkpoints a finished run into `runs`). `None` only if the snapshot
/// carries no run at all, in which case there is nothing to reconcile against.
#[cfg(target_arch = "wasm32")]
fn result_authoritative_run(snapshot: &AppSnapshot) -> Option<AgentRun> {
    snapshot
        .current_run()
        .cloned()
        .or_else(|| snapshot.runs.last().cloned())
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

        let agent = crate::engine::pick_agent(&snapshot, None);

        assert_eq!(agent.name, "Enabled");
    }
}
