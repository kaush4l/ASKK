//! Thread-local registry of running in-browser processes.
//!
//! Every long-lived unit of in-browser work (a sandboxed exec Web Worker, a
//! Python/WASI runtime instance, …) registers itself here so the Workspace run
//! panel can list it and offer a Kill button. WASM is single-threaded, so a
//! thread-local store is sufficient; in the dedicated agent worker the registry
//! is a separate (empty) instance, which is fine — only the page instance has a
//! UI to show.
//!
//! Change notification is deliberately Dioxus-free to keep this module pure and
//! host-testable: every mutation bumps [`version`], a monotonic counter the UI
//! polls from a short-interval future (see `components::run_panel`). Polling a
//! `u64` every few hundred milliseconds is cheap, survives component
//! mount/unmount without dangling callbacks, and doubles as the tick that keeps
//! elapsed-time labels moving.
//!
//! # `on_kill` contract
//!
//! The `on_kill` closure passed to [`register`] **must be idempotent**: it is
//! invoked at most once by the registry, but the resource it tears down (e.g.
//! `Worker::terminate()`) may already have been released by the process's own
//! completion path, and the completion path may still run after a kill. Closures
//! should therefore tolerate "already terminated" without erroring.

use std::cell::{Cell, RefCell};

/// A registered in-browser process, as shown in the run panel.
#[derive(Clone, Debug, PartialEq)]
pub struct ProcessInfo {
    /// Registry-assigned id, unique within this thread/instance.
    pub id: u64,
    /// Human-readable label (e.g. the script path or a code preview).
    pub label: String,
    /// Coarse runtime kind, e.g. `"js"`, `"python"`, `"wasm"`.
    pub kind: String,
    /// Start time in milliseconds (epoch on the host, `Date.now()` in the
    /// browser). Compare against [`now_ms`] for elapsed time.
    pub started_ms: f64,
}

/// One live entry: the public info plus the teardown closure.
struct Entry {
    info: ProcessInfo,
    on_kill: Option<Box<dyn FnOnce()>>,
}

thread_local! {
    static PROCESSES: RefCell<Vec<Entry>> = const { RefCell::new(Vec::new()) };
    static NEXT_ID: Cell<u64> = const { Cell::new(1) };
    static VERSION: Cell<u64> = const { Cell::new(0) };
}

fn bump_version() {
    VERSION.with(|version| version.set(version.get().wrapping_add(1)));
}

/// Current time in milliseconds, comparable with [`ProcessInfo::started_ms`].
#[cfg(target_arch = "wasm32")]
pub fn now_ms() -> f64 {
    js_sys::Date::now()
}

/// Current time in milliseconds, comparable with [`ProcessInfo::started_ms`].
#[cfg(not(target_arch = "wasm32"))]
pub fn now_ms() -> f64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as f64)
        .unwrap_or(0.0)
}

/// Register a running process and return its id. `on_kill` is invoked (at most
/// once) by [`kill`] to tear the process down — it must be idempotent, see the
/// module docs.
// Called from the wasm exec-worker path (browser_exec); the host build reaches
// it only from tests, so allow it as dead code there.
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub fn register(
    label: impl Into<String>,
    kind: impl Into<String>,
    on_kill: Box<dyn FnOnce()>,
) -> u64 {
    let id = NEXT_ID.with(|next| {
        let id = next.get();
        next.set(id + 1);
        id
    });
    PROCESSES.with(|processes| {
        processes.borrow_mut().push(Entry {
            info: ProcessInfo {
                id,
                label: label.into(),
                kind: kind.into(),
                started_ms: now_ms(),
            },
            on_kill: Some(on_kill),
        });
    });
    bump_version();
    id
}

/// Kill the process with `id`: remove it from the registry and invoke its
/// `on_kill` teardown. A no-op for unknown ids (e.g. a process that already
/// completed and unregistered itself). The closure runs *after* the registry
/// borrow is released, so a re-entrant teardown (one that registers or kills
/// other processes) cannot deadlock the store.
pub fn kill(id: u64) {
    let on_kill = PROCESSES.with(|processes| {
        let mut processes = processes.borrow_mut();
        let index = processes.iter().position(|entry| entry.info.id == id)?;
        let mut entry = processes.remove(index);
        entry.on_kill.take()
    });
    if let Some(on_kill) = on_kill {
        bump_version();
        on_kill();
    }
}

/// Remove the process with `id` without invoking `on_kill` — the completion
/// path, called when the process finished (or was torn down) on its own. A
/// no-op for unknown ids, so completion after a [`kill`] is safe.
// Called from the wasm exec-worker path (browser_exec); the host build reaches
// it only from tests, so allow it as dead code there.
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub fn unregister(id: u64) {
    let removed = PROCESSES.with(|processes| {
        let mut processes = processes.borrow_mut();
        let before = processes.len();
        processes.retain(|entry| entry.info.id != id);
        processes.len() != before
    });
    if removed {
        bump_version();
    }
}

/// Snapshot of all running processes, in registration order.
pub fn list() -> Vec<ProcessInfo> {
    PROCESSES.with(|processes| {
        processes
            .borrow()
            .iter()
            .map(|entry| entry.info.clone())
            .collect()
    })
}

/// Monotonic change counter: bumped on every register/kill/unregister. The UI
/// polls this and refreshes its process list when the value moves.
pub fn version() -> u64 {
    VERSION.with(Cell::get)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::rc::Rc;

    #[test]
    fn register_assigns_unique_ids_and_lists_in_order() {
        let a = register("first", "js", Box::new(|| {}));
        let b = register("second", "python", Box::new(|| {}));
        assert_ne!(a, b);
        let listed = list();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].label, "first");
        assert_eq!(listed[0].kind, "js");
        assert_eq!(listed[1].label, "second");
        assert!(listed[0].started_ms <= now_ms());
    }

    #[test]
    fn kill_invokes_on_kill_once_and_removes_the_entry() {
        let killed = Rc::new(Cell::new(0u32));
        let flag = Rc::clone(&killed);
        let id = register("victim", "js", Box::new(move || flag.set(flag.get() + 1)));
        kill(id);
        assert_eq!(killed.get(), 1);
        assert!(list().iter().all(|info| info.id != id));
        // A second kill is a no-op: the entry is gone, the closure never reruns.
        kill(id);
        assert_eq!(killed.get(), 1);
    }

    #[test]
    fn unregister_removes_without_invoking_on_kill() {
        let killed = Rc::new(Cell::new(false));
        let flag = Rc::clone(&killed);
        let id = register("done", "js", Box::new(move || flag.set(true)));
        unregister(id);
        assert!(!killed.get());
        assert!(list().is_empty());
        // Kill after completion is a no-op (the race the UI can always lose).
        kill(id);
        assert!(!killed.get());
    }

    #[test]
    fn version_bumps_on_changes_only() {
        let start = version();
        let id = register("p", "js", Box::new(|| {}));
        assert!(version() > start);
        let after_register = version();
        unregister(9_999_999); // unknown id: no change, no bump
        assert_eq!(version(), after_register);
        unregister(id);
        assert!(version() > after_register);
    }

    #[test]
    fn reentrant_kill_from_on_kill_does_not_panic() {
        let other = register("other", "js", Box::new(|| {}));
        let id = register("outer", "js", Box::new(move || kill(other)));
        kill(id);
        assert!(list().is_empty());
    }
}
