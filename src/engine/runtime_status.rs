//! Thread-local store for per-runtime asset readiness.
//!
//! The Workspace run panel renders one state chip per execution runtime
//! (JS, Python, WASI). The runtimes themselves are delivered by sibling units;
//! when one lands it feeds this store via [`set_state`] (e.g. flipping Python
//! to `Downloading { pct }` while its wheel/asset bundle streams in, then to
//! `Ready`). Until then the defaults apply: JS is `Ready` (built into the
//! browser), Python and WASI are `NotInstalled`.
//!
//! Like `process_registry`, this store is Dioxus-free and host-testable; the
//! UI polls [`snapshot`] from a short-interval future.

use std::cell::RefCell;

/// Well-known runtime ids, in the order the status strip displays them.
pub const KNOWN_RUNTIMES: [&str; 3] = ["js", "python", "wasi"];

/// Readiness of one runtime's assets in this browser profile.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimeAssetState {
    /// The runtime's assets have not been fetched yet.
    NotInstalled,
    /// Assets are streaming in; `pct` is 0–100.
    // Constructed by the sibling runtime units while their assets download;
    // nothing in-tree downloads yet, so allow it as dead code until they land.
    #[allow(dead_code)]
    Downloading {
        /// Download progress, 0–100.
        pct: u8,
    },
    /// The runtime is installed and ready to execute.
    Ready,
}

thread_local! {
    static STATES: RefCell<Vec<(String, RuntimeAssetState)>> = RefCell::new(
        KNOWN_RUNTIMES
            .iter()
            .map(|id| {
                // JS is built into the browser; everything else must be installed.
                let state = if *id == "js" {
                    RuntimeAssetState::Ready
                } else {
                    RuntimeAssetState::NotInstalled
                };
                (id.to_string(), state)
            })
            .collect(),
    );
}

/// Upsert the state for `runtime` (one of [`KNOWN_RUNTIMES`], or a new id —
/// unknown ids are appended so future runtimes show up without a code change).
/// This is the setter the sibling runtime units feed as they install assets.
// Seam API: no in-tree caller until the Python/WASI runtime units land.
#[allow(dead_code)]
pub fn set_state(runtime: &str, state: RuntimeAssetState) {
    STATES.with(|states| {
        let mut states = states.borrow_mut();
        if let Some(entry) = states.iter_mut().find(|(id, _)| id == runtime) {
            entry.1 = state;
        } else {
            states.push((runtime.to_string(), state));
        }
    });
}

/// Snapshot of every runtime's state, in display order.
pub fn snapshot() -> Vec<(String, RuntimeAssetState)> {
    STATES.with(|states| states.borrow().clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_show_js_ready_and_the_rest_not_installed() {
        let states = snapshot();
        assert_eq!(states.len(), KNOWN_RUNTIMES.len());
        assert_eq!(states[0], ("js".to_string(), RuntimeAssetState::Ready));
        assert_eq!(
            states[1],
            ("python".to_string(), RuntimeAssetState::NotInstalled)
        );
        assert_eq!(
            states[2],
            ("wasi".to_string(), RuntimeAssetState::NotInstalled)
        );
    }

    #[test]
    fn set_state_updates_known_and_appends_unknown_runtimes() {
        set_state("python", RuntimeAssetState::Downloading { pct: 40 });
        assert!(
            snapshot().iter().any(|(id, state)| id == "python"
                && *state == RuntimeAssetState::Downloading { pct: 40 })
        );
        set_state("python", RuntimeAssetState::Ready);
        assert!(
            snapshot()
                .iter()
                .any(|(id, state)| id == "python" && *state == RuntimeAssetState::Ready)
        );
        set_state("lua", RuntimeAssetState::NotInstalled);
        assert_eq!(
            snapshot().last().map(|(id, _)| id.clone()).as_deref(),
            Some("lua")
        );
    }
}
