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
