//! THE FIRST TRIP THROUGH THE SEAM, and the re-read that follows every change.
//! `dash.rs` beside it owns the panel switches and the viewport listeners: how
//! the shell is ARRANGED and how it is FILLED are two jobs, and only this one
//! calls the core.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;

/// The first trip through the seam once boot resolves: `GET /` is the
/// dashboard route the registry already owns, and the booted app becomes
/// available to every component that talks to the core.
pub fn adopt(
    booted: &Option<Result<Rc<WebApp>, String>>,
    mut web: Signal<Option<Rc<WebApp>>>,
    mut fragment: Signal<String>,
    mut agents: Signal<String>,
    mut failure: Signal<String>,
    mut loaded: Signal<Vec<String>>,
    mut authored: Signal<Vec<String>>,
) {
    match booted {
        Some(Ok(app)) => {
            fragment.set(app.handle(Request::get("/")).body);
            agents.set(app.handle(Request::get("/agents")).body);
            loaded.set(app.agent_names());
            authored.set(app.authored_names());
            web.set(Some(Rc::clone(app)));
        }
        Some(Err(e)) => failure.set(e.clone()),
        None => {}
    }
}

/// Re-read the listing whenever anything moves. An agent can now be written,
/// edited or deleted while the page is open (increment 11), so a panel painted
/// once at boot would show a roster the core no longer has.
pub fn watch_agents(
    web: Signal<Option<Rc<WebApp>>>,
    mut agents: Signal<String>,
    mut loaded: Signal<Vec<String>>,
    mut authored: Signal<Vec<String>>,
    // …and the selection, which the address bar can now name (R6-3). It is
    // checked HERE because this is the one place that knows the roster.
    selected: Signal<String>,
) {
    let Some(app) = web.peek().clone() else { return };
    agents.set(app.handle(Request::get("/agents")).body);
    let names = app.agent_names();
    // A NAME IN THE HASH THAT IS NOT ON THE ROSTER. `#/chat/typo` addressed
    // five panes at an agent that does not exist, and an agent deleted in the
    // Agents view left the same hole behind it. The default is preferred over
    // the first name so the ordinary recovery is the ordinary agent.
    if !names.is_empty() && !names.iter().any(|n| n == &*selected.peek()) {
        let fallback = names.iter().find(|n| *n == crate::shell::route::DEFAULT_AGENT);
        let mut selected = selected;
        selected.set(fallback.or_else(|| names.first()).cloned().unwrap_or_default());
    }
    loaded.set(names);
    authored.set(app.authored_names());
}
