//! Context-transparent execution of [`PageOp`]s: in place when a window exists,
//! proxied over the worker↔page channel when running inside the agent worker.
//!
//! Worker side: [`run_page_op`] posts a [`WorkerEvent::PageOpRequested`] and
//! parks on a oneshot keyed by `request_id`. Page side (`client.rs`) executes
//! the op and posts back a [`WorkerCommand::PageOpResolved`], which the worker
//! runtime routes here via [`resolve_page_op`]. Single-threaded WASM: the
//! pending map is a `thread_local`, same as every other cross-call registry in
//! this crate.
//!
//! [`WorkerEvent::PageOpRequested`]: crate::worker::transport::WorkerEvent::PageOpRequested
//! [`WorkerCommand::PageOpResolved`]: crate::worker::transport::WorkerCommand::PageOpResolved

use crate::capabilities::page_ops::PageOp;
#[cfg(target_arch = "wasm32")]
use crate::capabilities::page_ops::execute_page_op;

#[cfg(target_arch = "wasm32")]
use std::cell::RefCell;
#[cfg(target_arch = "wasm32")]
use std::collections::HashMap;

#[cfg(target_arch = "wasm32")]
thread_local! {
    static PENDING_PAGE_OPS: RefCell<HashMap<String, futures_channel::oneshot::Sender<Result<String, String>>>> =
        RefCell::new(HashMap::new());
}

/// Run a page-thread operation from any context and return its JSON envelope.
#[cfg(target_arch = "wasm32")]
pub async fn run_page_op(op: PageOp) -> Result<String, String> {
    if web_sys::window().is_some() {
        return execute_page_op(&op).await;
    }
    proxy_to_page(op).await
}

/// Host builds have no page; ops fail closed with a clear reason.
#[cfg(not(target_arch = "wasm32"))]
pub async fn run_page_op(_op: PageOp) -> Result<String, String> {
    Err("page operations require the browser build".to_string())
}

/// Worker context: request the page run the op, await the routed result.
#[cfg(target_arch = "wasm32")]
async fn proxy_to_page(op: PageOp) -> Result<String, String> {
    use crate::worker::runtime::post_worker_event;
    use crate::worker::transport::WorkerEvent;

    let request_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = futures_channel::oneshot::channel::<Result<String, String>>();
    PENDING_PAGE_OPS.with(|pending| {
        pending.borrow_mut().insert(request_id.clone(), tx);
    });

    post_worker_event(WorkerEvent::PageOpRequested {
        request_id: request_id.clone(),
        op,
    });

    let outcome = rx
        .await
        .unwrap_or_else(|_| Err("the page dropped this operation without responding".to_string()));
    // Belt-and-braces: the entry is removed when resolved; clear any leftover.
    PENDING_PAGE_OPS.with(|pending| {
        pending.borrow_mut().remove(&request_id);
    });
    outcome
}

/// Route a page-resolved result to the parked waiter. Returns `false` when no
/// waiter is registered (already resolved, or a stale id) — callers treat that
/// as harmless.
#[cfg(target_arch = "wasm32")]
pub fn resolve_page_op(request_id: &str, result: Result<String, String>) -> bool {
    PENDING_PAGE_OPS.with(|pending| {
        if let Some(tx) = pending.borrow_mut().remove(request_id) {
            tx.send(result).is_ok()
        } else {
            false
        }
    })
}

#[cfg(not(target_arch = "wasm32"))]
pub fn resolve_page_op(_request_id: &str, _result: Result<String, String>) -> bool {
    false
}
