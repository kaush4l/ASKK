//! The dashboard shell's own parts: the two panel switches, and the boot
//! plumbing `main.rs` no longer has room for.
//!
//! Increment 13. Both skins were a scroll of everything — the machine skin
//! stacked nine panels below 1100px and the plain skin stacked them at every
//! width — so neither had a place to STAND. A dashboard has three regions and
//! two of them are dismissable: navigation left, the surface you are working on
//! in the middle, the instruments right.
//!
//! Collapse is expressed as the `hidden` attribute, not a stylesheet class, for
//! the reason `[hidden] { display: none !important }` already exists in
//! screen.css: it works with the machine layer switched off. The plain skin is
//! the permanent fallback, and a fallback that cannot put the rail away is the
//! thing this increment was called to fix.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;

/// Whether this screen has room for three columns at all. Read ONCE, as the
/// initial state of each panel: below the console breakpoint the regions stack,
/// so opening both by default is the scroll-of-everything by another name.
/// After that it is a person's choice, and a resize must not overwrite one.
pub fn wide() -> bool {
    web_sys::window()
        .and_then(|w| w.inner_width().ok())
        .and_then(|v| v.as_f64())
        .is_none_or(|w| w >= 1100.0)
}

/// One panel switch. `aria-expanded` + `aria-controls` is the disclosure
/// pattern, and the label names the REGION rather than the action, so it reads
/// the same pressed or not — the state is what `aria-expanded` is for.
#[component]
pub fn PanelToggle(label: String, controls: String, open: Signal<bool>) -> Element {
    rsx! {
        button {
            r#type: "button",
            class: if open() { "panel-toggle open" } else { "panel-toggle" },
            aria_expanded: if open() { "true" } else { "false" },
            aria_controls: "{controls}",
            onclick: move |_| {
                let mut open = open;
                let next = !open.peek().to_owned();
                open.set(next);
            },
            // Visible with no stylesheet at all: the marker is UA text.
            span { aria_hidden: "true", if open() { "▾ " } else { "▸ " } }
            "{label}"
        }
    }
}

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
) {
    let Some(app) = web.peek().clone() else { return };
    agents.set(app.handle(Request::get("/agents")).body);
    loaded.set(app.agent_names());
    authored.set(app.authored_names());
}
