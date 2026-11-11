//! # Tasks: the port for work that goes on after the caller has returned
//!
//! An engine woken by a message runs on its own, beside whoever woke it. *How* work is run
//! beside other work differs per build (threads on a server, the page's own loop in a browser
//! tab), so the core does not name a runtime: it hands the work to this port.
//!
//! | build | who runs the work | set in |
//! | --- | --- | --- |
//! | server | the server's runtime | `host/mod.rs` |
//! | browser tab | the tab's loop | `local/mod.rs` |
//! | none set | nobody: [`spawn`] says so, and the caller reports it | |
use super::Fut;
use std::sync::{Arc, OnceLock};

pub trait Tasks: Send + Sync {
    /// Start `work` and return at once.
    fn spawn(&self, work: Fut<()>);
}

static TASKS: OnceLock<Arc<dyn Tasks>> = OnceLock::new();

/// Name who runs background work in this build. The first call wins.
pub fn set(t: Arc<dyn Tasks>) {
    let _ = TASKS.set(t);
}

/// Start `work` beside the caller. False: this build has nobody to run it, and `work` was
/// dropped without running.
pub fn spawn(work: Fut<()>) -> bool {
    match TASKS.get() {
        Some(t) => {
            t.spawn(work);
            true
        }
        None => false,
    }
}
