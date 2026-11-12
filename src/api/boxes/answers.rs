//! Answers: boxes.
//!
//! Plain functions over the core: no UI library, no wire. Whoever asks (a Dioxus window, the
//! `/ask` route, the tab's own page) gets the same answer, and an error is one sentence.
use super::*;

/// Every session there is, as a box: the engines depth first, then the sessions with other
/// agents, oldest first. What a box says of itself depends on how deep askk can see into it
/// (`core/boxes.rs`). A window asks again when an engine or a session is marked changed.
pub async fn boxes() -> Result<Vec<SessionBox>, String> {
    Ok(crate::core::boxes::all())
}

/// Every place a box runs in (its project folder; empty is the workspace itself), in the
/// order the boxes first name it, with the state of its git where it is a repository of its
/// own: the branch, how many files changed, how far ahead and behind. Read with git by the
/// service and kept for two seconds; when a place's state changes, `workspaces` is marked
/// on the change feed. A window groups its boxes by these places, as herdr's Spaces.
pub async fn workspaces() -> Result<Vec<crate::core::workspaces::Workspace>, String> {
    Ok(crate::core::workspaces::all())
}
