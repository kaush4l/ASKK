//! The bounded spawner — the single **enqueue** seam every run flows through.
//!
//! Enqueuing `(agent, goal)` creates one [`EngineInstance`](crate::state::EngineInstance)
//! per run (via the active-run projection accessors) and drives it on the existing
//! worker path (one Web Worker per run, emitting to the bus). A
//! [`BoundedQueue`](super::logic::BoundedQueue) caps how many runs are in flight at
//! once — the bound comes from `orchestrator.max_parallelism` — and excess
//! enqueues wait in FIFO order, starting as running ones complete.
//!
//! WASM is single-threaded, so "concurrent" here means *multiple in-flight async
//! runs*: each owns its own Web Worker and their futures overlap at the I/O await
//! points. The pool is a thread-local — the page mounts once, and every enqueue
//! (chat submit, workspace submit, the in-tab scheduler firing an `AgentRun`
//! entry) routes through [`enqueue_agent_run`], so every run becomes a first-class
//! instance under one shared concurrency bound.
//!
//! The admission bookkeeping (cap / FIFO / free-a-slot) lives in the pure
//! [`BoundedQueue`](super::logic::BoundedQueue) and is host-tested there; this
//! module is the thin driver that turns an admitted item into a live run.

use super::logic::BoundedQueue;
use crate::engine::pick_agent;
use crate::state::AppSnapshot;
use crate::worker::client::run_goal_for_agent_in_worker_or_inline;
use dioxus::prelude::{ReadableExt, Signal, WritableExt};
use std::cell::RefCell;
use wasm_bindgen_futures::spawn_local;

/// One queued (agent, goal) enqueue, carrying the snapshot signal it drives and
/// the per-run `worker_id` that distinguishes its Web Worker (so a Stop can target
/// one instance).
struct Enqueued {
    snapshot: Signal<AppSnapshot>,
    agent_id: Option<String>,
    goal: String,
    worker_id: String,
}

thread_local! {
    /// The process-wide bounded pool. The cap is (re)synced from
    /// `orchestrator.max_parallelism` on every enqueue, so a settings change takes
    /// effect for the next admission without a reload.
    static POOL: RefCell<BoundedQueue<Enqueued>> = RefCell::new(BoundedQueue::new(1));
    /// Monotonic worker-id counter, so each spawned run gets a distinct
    /// `agent-worker-N` handle (the old single-run path hard-coded `-1`).
    static NEXT_WORKER: RefCell<u64> = const { RefCell::new(1) };
}

fn next_worker_id() -> String {
    NEXT_WORKER.with(|n| {
        let mut n = n.borrow_mut();
        let id = *n;
        *n += 1;
        format!("agent-worker-{id}")
    })
}

/// The single enqueue seam. Push `(agent, goal)` onto the bounded pool, sync the
/// cap from `max_parallelism`, then pump the queue so as many runs as the bound
/// allows start now (the rest wait, FIFO). `agent_id` `None` picks the first
/// enabled agent, exactly as the legacy single-run path did.
pub fn enqueue_agent_run(snapshot: Signal<AppSnapshot>, agent_id: Option<String>, goal: String) {
    let cap = snapshot.read().orchestrator.max_parallelism.max(1) as usize;
    let worker_id = next_worker_id();
    POOL.with(|pool| {
        let mut pool = pool.borrow_mut();
        pool.set_cap(cap);
        pool.enqueue(Enqueued {
            snapshot,
            agent_id,
            goal,
            worker_id,
        });
    });
    pump();
}

/// Start as many admitted items as the pool's free slots allow. Each started run
/// drives its own snapshot signal and, on completion, frees its slot and
/// re-pumps — so a finishing run immediately admits the next pending one.
fn pump() {
    loop {
        let next = POOL.with(|pool| pool.borrow_mut().take_next());
        let Some(item) = next else { break };
        spawn_run(item);
    }
}

/// Drive one admitted run to completion on the existing worker path, mirroring the
/// legacy chat `run_goal` observer (live `set_current_run` + checkpoint + persist),
/// then settle the terminal snapshot and free the pool slot.
fn spawn_run(item: Enqueued) {
    let Enqueued {
        snapshot,
        agent_id,
        goal,
        worker_id,
    } = item;
    let mut live = snapshot;
    let mut finish = snapshot;
    spawn_local(async move {
        let start = snapshot.read().clone();
        let agent = pick_agent(&start, agent_id.as_deref());
        let result =
            run_goal_for_agent_in_worker_or_inline(start, goal, agent, worker_id, move |run| {
                // Live projection: upsert this run as the active instance and
                // checkpoint it (best-effort persist), exactly as the legacy
                // single-run observer did.
                let mut next = live.read().clone();
                next.status = format!("Running {} lane...", run.lane.as_label());
                next.set_current_run(Some(run));
                next.checkpoint_current_run();
                let checkpoint = next.clone();
                spawn_local(async move {
                    persist(checkpoint).await;
                });
                live.set(next);
            })
            .await;

        match result {
            Ok(next) => {
                let run_status = next.status.clone();
                persist(next.clone()).await;
                finish.set(next);
                set_status_signal(&mut finish, run_status);
            }
            Err(err) => {
                set_status_signal(&mut finish, format!("Run failed: {err}"));
            }
        }

        // Free this run's slot and admit the next pending enqueue, if any.
        POOL.with(|pool| pool.borrow_mut().complete());
        pump();
    });
}

/// Best-effort persist of a snapshot to IndexedDB. Browser-only; on the host test
/// runner there is no IndexedDB, so this is a no-op (the storage open fails and is
/// swallowed), keeping the spawner host-compilable.
#[cfg(target_arch = "wasm32")]
async fn persist(snapshot: AppSnapshot) {
    use crate::storage::{IndexedDbStorage, StorageAdapter};
    if let Ok(storage) = IndexedDbStorage::open().await {
        let _ = storage.save_snapshot(&snapshot).await;
    }
}

#[cfg(not(target_arch = "wasm32"))]
async fn persist(_snapshot: AppSnapshot) {}

/// Set the snapshot status string in place. The spawner lives outside the
/// `components` tree, so it mirrors the `components::shared::set_status` one-line
/// write here rather than reaching into that module.
fn set_status_signal(snapshot: &mut Signal<AppSnapshot>, status: String) {
    let mut next = snapshot.read().clone();
    next.status = status;
    snapshot.set(next);
}
