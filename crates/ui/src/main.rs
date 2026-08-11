//! L3 (ARCHITECTURE §4): the Dioxus app, replacing htmx and `transport.js`.
//! An event handler calls `core::handle` directly through `WebApp::handle`, so
//! the seam is unchanged (I4) and no application logic is left in JS (I5).
//!
//! This crate owns layout and component boundaries and nothing else — every
//! byte of conversation content comes back from the core as a projection of
//! the event log (I8). Components segregate by concept (plan, "UI shape"):
//! `ChatPane` owns one conversation, `Settings` owns endpoints and keys.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;

mod chat;
mod settings;

fn main() {
    dioxus::launch(shell);
}

/// The first trip through the seam once boot resolves: `GET /` is the
/// dashboard route the registry already owns, and the booted app becomes
/// available to every component that talks to the core.
fn adopt(
    booted: &Option<Result<Rc<WebApp>, String>>,
    mut web: Signal<Option<Rc<WebApp>>>,
    mut fragment: Signal<String>,
    mut agents: Signal<String>,
    mut failure: Signal<String>,
) {
    match booted {
        Some(Ok(app)) => {
            fragment.set(app.handle(Request::get("/")).body);
            agents.set(app.handle(Request::get("/agents")).body);
            web.set(Some(Rc::clone(app)));
        }
        Some(Err(e)) => failure.set(e.clone()),
        None => {}
    }
}

/// Who is loaded, and where from. Its own fn because the shell composes the
/// page and owns no content (plan, "UI shape").
fn agent_panel(agents: Signal<String>) -> Element {
    rsx! {
        section { class: "panel", aria_label: "Agents",
            h2 { "Agents" }
            p { class: "note",
                "Loaded from public/agents/ at boot — edit an agent.md, redeploy, reload, \
                 and the agent changes with no rebuild."
            }
            div { dangerous_inner_html: "{agents}" }
        }
    }
}

/// Boot is async (IndexedDB), so the shell paints immediately and the page
/// fills when the core is up. A boot failure is shown, never swallowed.
fn shell() -> Element {
    let booted = use_resource(|| async {
        WebApp::boot()
            .await
            .map(Rc::new)
            .map_err(|e| format!("{e:?}"))
    });
    let web = use_signal(|| None::<Rc<WebApp>>);
    let fragment = use_signal(String::new);
    let agents = use_signal(String::new); // the public/agents/ listing (I8)
    let failure = use_signal(String::new);
    // Whether an endpoint is configured: `Settings` knows (it reads the
    // broker), `ChatPane` needs it (a send with no endpoint is a request that
    // cannot work), so the shell owns the one signal between them.
    let endpoint_set = use_signal(|| false);

    use_effect(move || adopt(&booted.read(), web, fragment, agents, failure));

    rsx! {
        header {
            // Not an <h1>: the page's one heading is the dashboard's title,
            // and a wordmark is a logo, not a level-one heading.
            div { class: "wordmark", "ASKK" }
        }
        main {
            if !failure.read().is_empty() {
                p { class: "error", "core failed to boot: {failure}" }
            } else if fragment.read().is_empty() {
                p { class: "pending", "booting the core…" }
            } else {
                // The fragment is built by the core's escaping primitives
                // (module::view) — the one scar the htmx design leaves.
                div { dangerous_inner_html: "{fragment}" }
                chat::ChatPane { web, endpoint_set }
                {agent_panel(agents)}
                settings::Settings { web, endpoint_set }
            }
        }
    }
}
