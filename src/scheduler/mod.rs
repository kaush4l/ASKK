//! In-tab scheduler. Pure logic lives in `logic` (host-testable); WASM runtime
//! ticks every 30 seconds in `start_scheduler`.

pub(crate) mod logic;

#[cfg(target_arch = "wasm32")]
pub use runtime::start_scheduler;

#[cfg(target_arch = "wasm32")]
mod runtime {
    use super::logic::{catch_up_entries, local_tz_offset_min, mark_fired};
    use crate::engine::{LoopParams, ReActEngine};
    use crate::state::AppSnapshot;
    use crate::state::{ScheduleEntry, ScheduleKind, SchedulePayload};
    use crate::storage::{IndexedDbStorage, StorageAdapter};
    use dioxus::prelude::{ReadableExt, Signal, WritableExt};
    use futures_util::StreamExt;
    use gloo_timers::future::IntervalStream;
    use wasm_bindgen_futures::spawn_local;
    use web_sys::{Notification, NotificationOptions, NotificationPermission};

    /// Spawn the scheduler on app mount.
    ///
    /// (1) An immediate catch-up pass fires anything missed while the tab was closed.
    /// (2) A 30-second tick loop continues while the tab is open.
    pub fn start_scheduler(snapshot: Signal<AppSnapshot>) {
        let snap1 = snapshot;
        spawn_local(async move {
            tick(snap1, true).await;
        });
        spawn_local(async move {
            let mut interval = IntervalStream::new(30_000);
            while interval.next().await.is_some() {
                tick(snapshot, false).await;
            }
        });
    }

    async fn tick(mut snapshot: Signal<AppSnapshot>, _catch_up: bool) {
        let now_ms = js_sys::Date::now() as u64;
        let tz = local_tz_offset_min();
        let snap = snapshot.read().clone();
        let due = catch_up_entries(&snap.schedules, now_ms, tz);
        if due.is_empty() {
            return;
        }

        let entries: Vec<ScheduleEntry> = due
            .iter()
            .filter_map(|&i| snap.schedules.get(i).cloned())
            .collect();

        for entry in &entries {
            fire_entry(entry, snapshot);
        }

        let mut updated = snap.clone();
        for entry in &entries {
            if let Some(e) = updated.schedules.iter_mut().find(|e| e.id == entry.id) {
                mark_fired(e, now_ms);
            }
        }
        // Remove one-shot entries that have now been fired (last_fired_ms is now Some).
        updated.schedules.retain(|e| {
            !matches!(e.kind, ScheduleKind::OneShot { .. }) || e.last_fired_ms.is_none()
        });

        if let Ok(storage) = IndexedDbStorage::open().await {
            let _ = storage.save_snapshot(&updated).await;
        }
        snapshot.set(updated);
    }

    fn fire_entry(entry: &ScheduleEntry, snapshot: Signal<AppSnapshot>) {
        match &entry.payload {
            SchedulePayload::Notification { text } => {
                notify("ASKK", text);
            }
            SchedulePayload::AgentRun { agent_id, goal } => {
                notify("ASKK", &format!("Starting: {}", entry.label));
                let agent_id = agent_id.clone();
                let goal = goal.clone();
                let mut sig = snapshot;
                spawn_local(async move {
                    let start = sig.read().clone();
                    let params = LoopParams {
                        agent_id: Some(agent_id),
                        ..LoopParams::default()
                    };
                    // obs_sig is a Copy clone of sig, used only inside the observer closure.
                    let mut obs_sig = sig;
                    let result = ReActEngine::new()
                        .run_with_params_and_observer(start, goal, params, move |run| {
                            let mut next = obs_sig.read().clone();
                            next.current_run = Some(run);
                            obs_sig.set(next);
                        })
                        .await;
                    match result {
                        Ok(final_snap) => {
                            if let Ok(storage) = IndexedDbStorage::open().await {
                                let _ = storage.save_snapshot(&final_snap).await;
                            }
                            sig.set(final_snap);
                        }
                        Err(err) => {
                            web_sys::console::warn_1(&wasm_bindgen::JsValue::from_str(&format!(
                                "ASKK scheduler: agent run failed: {err}"
                            )));
                        }
                    }
                });
            }
        }
    }

    fn notify(title: &str, body: &str) {
        if Notification::permission() != NotificationPermission::Granted {
            return;
        }
        let opts = NotificationOptions::new();
        opts.set_body(body);
        let _ = Notification::new_with_options(title, &opts);
    }
}
