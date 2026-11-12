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
    hand(id, &text, vec![])
}

/// Settle what the session's harness was refused and waits for the owner's yes. `allow`: the
/// session is prompted again and told it may (each harness is given the yes in its own words);
/// otherwise the asks go and the session notes that the owner did not allow them.
pub async fn session_allow(id: u64, allow: bool) -> Result<Session, String> {
    crate::core::world::world();
    let (st, root) = (crate::core::store::data(), crate::core::manifest::manifest().sessions.clone());
    if !allow {
        return crate::core::session::deny(&*st, &root, id).map_err(say);
    }
    let rules = crate::core::session::pending(&*st, &root, id).map_err(say)?;
    hand(id, crate::core::session::ALLOWED, rules)?;
    crate::core::session::get(&*st, &root, id).map_err(say)
}

/// The one way a prompt reaches a harness from here.
fn hand(id: u64, text: &str, allowed: Vec<String>) -> Result<(), String> {
    crate::host::harness::prompt(id, text, allowed).map_err(say)
}

/// Choose what the session's harness may do without asking (`ask`, `edits`, `all`), from its
/// next prompt on; each harness is given it in its own words (`host/harness/`).
pub async fn session_permit(id: u64, mode: String) -> Result<Session, String> {
    crate::core::world::world();
    let mode = crate::core::permit::Mode::parse(&mode)?;
    crate::core::session::set_permit(&*crate::core::store::data(), &crate::core::manifest::manifest().sessions, id, mode).map_err(say)
}
