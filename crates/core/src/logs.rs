//! The log's two I/O halves: writing the queued ops out, and reading the
//! window back at boot. The DECISIONS are all in `logbook.rs` (pure); this file
//! only moves bytes through `StorePort`.

use crate::app::App;
use crate::error::CoreError;
use crate::logbook::{key, prefix, sync, LogOp, Logbook};

/// What this agent actually holds — the window the model sees, and the thing
/// the log mirrors. A projection like every other view (I8).
pub fn window(app: &App) -> Vec<String> {
    agent::window(&app.agent.paper)
}

/// What this process's agent HOLDS: how many entries are in its window, and —
/// when the oldest of them have been compacted — the summary that replaced
/// them. What a Worker reports about itself, so a sub-agent's pane prints a
/// fact rather than a guess, and its summary is readable where the page's is.
pub fn memory_held(app: &App) -> (usize, Option<String>) {
    let window = window(app);
    let summary = window
        .first()
        .filter(|line| line.contains(agent::SUMMARY_HEADING))
        .cloned();
    (window.len(), summary)
}

/// Queue whatever writes bring the log level with the window. Called after
/// every pump, so an append is queued the moment the turn produces it and a
/// compaction's rewrite lands BEHIND the appends already waiting.
pub(crate) fn record(app: &mut App) {
    let window = window(app);
    let ops = sync(&mut app.logbook, &window, app.agent.compactions);
    app.unlogged.extend(ops);
}

/// Drain the queue, in order. A log that will not write must not cost the
/// conversation (Python: "losing the log must not cost the conversation"), so a
/// failure is recorded as a fact and the turn carries on.
pub(crate) async fn drain(app: &std::rc::Rc<std::cell::RefCell<App>>) {
    let (store, me, ops) = {
        let mut a = app.borrow_mut();
        (
            std::rc::Rc::clone(&a.ports.store),
            a.me().to_string(),
            std::mem::take(&mut a.unlogged),
        )
    };
    for op in ops {
        let (label, result) = match &op {
            LogOp::Append { index, line } => (
                key(&me, *index),
                store.kv().put(&key(&me, *index), line).await,
            ),
            LogOp::Rewrite(lines) => {
                let entries: Vec<(String, String)> = lines
                    .iter()
                    .enumerate()
                    .map(|(i, line)| (key(&me, i), line.clone()))
                    .collect();
                (
                    prefix(&me),
                    store.kv().replace_prefix(&prefix(&me), &entries).await,
                )
            }
        };
        if let Err(e) = result {
            app.borrow_mut().append(kernel::EventKind::StoreFailed {
                key: label,
                message: format!("{e:?}"),
            });
        }
    }
}

/// Read this agent's stored log back into its window. A reload is a new
/// process but it is not a new conversation: without this a sub-agent came back
/// with an empty paper and answered its next turn knowing nothing it had been
/// told (the open item increment 07 left).
///
/// Called by the composition root right after `install_agents_as`, which is
/// what fixes WHICH agent this process is.
pub async fn restore_log(app: &mut App) -> Result<(), CoreError> {
    let me = app.me().to_string();
    let store = std::rc::Rc::clone(&app.ports.store);
    let keys = store
        .kv()
        .list_prefix(&prefix(&me))
        .await
        .map_err(CoreError::Store)?;
    let mut lines = Vec::with_capacity(keys.len());
    for k in &keys {
        match store.kv().get(k).await.map_err(CoreError::Store)? {
            Some(line) => lines.push(line),
            None => continue,
        }
    }
    if lines.is_empty() {
        return Ok(());
    }
    let at = app.ports.clock.now();
    agent::set_window(&mut app.agent.paper, &lines, at);
    app.logbook = Logbook::restored(lines.len());
    Ok(())
}

/// Write every unpersisted log entry through `StorePort` (`events/<seq>`).
/// The log is truth in memory the moment it is appended; the store catches up
/// here, and a failed write is itself a fact.
pub(crate) async fn persist(app: &std::rc::Rc<std::cell::RefCell<App>>) -> Result<(), CoreError> {
    let (store, batch) = {
        let mut a = app.borrow_mut();
        (
            std::rc::Rc::clone(&a.ports.store),
            std::mem::take(&mut a.unpersisted),
        )
    };
    for event in batch {
        let key = format!("events/{:08}", event.seq);
        let value = serde_json::to_string(&event).map_err(|e| {
            CoreError::Store(kernel::StoreError::Backend {
                message: e.to_string(),
            })
        })?;
        if let Err(e) = store.kv().put(&key, &value).await {
            app.borrow_mut().append(kernel::EventKind::StoreFailed {
                key,
                message: format!("{e:?}"),
            });
            return Err(CoreError::Store(e));
        }
    }
    Ok(())
}
