//! Answers: sessions with other agents.
//!
//! Plain functions over the core: no UI library, no wire. Whoever asks (a Dioxus window, the
//! `/ask` route, the tab's own page) gets the same answer, and an error is one sentence.
use super::*;
use crate::api::say;

/// Every kind of harness, and why any of them cannot be used on this machine.
pub async fn harnesses() -> Result<Vec<HarnessInfo>, String> {
    crate::core::world::world();
    Ok(crate::host::harness::infos())
}

/// Every session, oldest first.
pub async fn sessions() -> Result<Vec<Session>, String> {
    crate::core::world::world();
    Ok(crate::host::harness::list())
}

/// Start a session with a harness; `project` is a folder under the workspace (empty = the
/// workspace). Nothing runs until it is prompted.
pub async fn session_open(harness: String, title: String, project: String) -> Result<Session, String> {
    crate::core::world::world();
    crate::host::harness::open(harness.trim(), &title, project.trim()).map_err(say)
}

/// Prompt a session and return at once; its answer lands in the session when the harness ends.
pub async fn session_prompt(id: u64, text: String) -> Result<(), String> {
    crate::core::world::world();
    crate::host::harness::prompt(id, &text).map_err(say)
}
