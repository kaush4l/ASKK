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

mod agentfile;
mod authoring;
mod board;
mod chat;
mod composer;
mod tabs;
mod terminal;
mod tools;
mod turn;
mod settings;
mod settings_view;
mod skin;
mod space;

fn main() {
    // The same Wasm bundle is imported by every agent's Worker (increment 06),
    // where there is no window and no document — it is loaded there for its
    // exported `AgentWorker`, not to mount a UI. Launching Dioxus in that
    // context would only throw. One `if` is the whole cost of one build.
    if web_sys::window().is_none() {
        return;
    }
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
fn watch_agents(
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
    // Every loaded agent, and which one the chat pane is currently the
    // conversation with. `main` by default: it is the agent a person opens the
    // page to talk to (Python `ThreadedAgent.entry`).
    let loaded = use_signal(Vec::<String>::new);
    // Which of them this browser wrote — the editor's Delete needs it.
    let authored = use_signal(Vec::<String>::new);
    let selected = use_signal(|| "main".to_string());
    // Whether an endpoint is configured: `Settings` knows (it reads the
    // broker), `ChatPane` needs it (a send with no endpoint is a request that
    // cannot work), so the shell owns the one signal between them.
    let endpoint_set = use_signal(|| false);
    // "something moved": bumped by a turn and by a settings save, read by the
    // panes that must redraw from the core when it does.
    let tick = use_signal(|| 0u32);

    use_effect(move || adopt(&booted.read(), web, fragment, agents, failure, loaded, authored));
    use_effect(move || {
        let _ = tick();
        watch_agents(web, agents, loaded, authored);
    });
    // The roster's own fingerprint: the listing changes exactly when an agent's
    // identity does. A memo, so it propagates only on a REAL change — `tick`
    // fires on every projection, and `ChatPane` re-reads its transcript from
    // this. Without it the chat header kept naming the shipped description
    // after an override had installed, and the deleted one after a delete —
    // two projections of one agent's identity disagreeing on screen (11b walk).
    let roster = use_memo(move || agents());
    // WHICH region the primary column shows. The deck — Write an agent, Agents,
    // Settings — used to be a row under the console, so the page was one screen
    // sitting on a 1400px manual and reaching Settings meant scrolling off the
    // instrument (12c walk, finding 1). It is a routed region now.
    let deck = use_signal(|| false);
    // The one sentence that says what the next turn actually calls. It was
    // prose in the chat pane; it is the same sentence, unchanged, typeset into
    // the header strip that used to be 77px holding two words (12c walk).
    // Reading `tick` is what makes it follow a settings save.
    let endpoint = {
        let _ = tick();
        chat::endpoint_line(web)
    };

    rsx! {
        header {
            // Not an <h1>: the page's one heading is the dashboard's title,
            // and a wordmark is a logo, not a level-one heading.
            div { class: "wordmark", "ASKK" }
            if !endpoint.is_empty() {
                p { class: "chat-endpoint", role: "status", "{endpoint}" }
            }
            skin::SkinToggle {}
        }
        main {
            if !failure.read().is_empty() {
                p { class: "error", "core failed to boot: {failure}" }
            } else if fragment.read().is_empty() {
                p { class: "pending", "booting the core…" }
            } else {
                // Three regions, in reading order, and the machine skin lays
                // them out as a grid at 1100px and up: the conversation you are
                // having, the instruments that must never scroll away while it
                // runs, and the surfaces you configure between turns. Nine
                // panels in one 736px column meant watching an agent work was
                // scrolling away from the terminal it was driving (12 walk,
                // "break the single column"). Wrappers only — every panel is
                // the same component in the same order, so the plain skin
                // stacks them exactly as before.
                div { class: "primary",
                    // The fragment is built by the core's escaping primitives
                    // (module::view) — the one scar the htmx design leaves.
                    div { class: "masthead", dangerous_inner_html: "{fragment}" }
                    tabs::AgentTabs { loaded, authored, selected, deck }
                    chat::ChatPane {
                        web, endpoint_set, tick, roster, agent: selected, hidden: deck(),
                    }
                    // The routed deck: the tabpanel half of the fourth tab.
                    // Both regions stay MOUNTED and one is `hidden` — dropping
                    // the chat pane would drop the poller following a turn.
                    section {
                        class: "deck",
                        id: "deck-panel",
                        role: "tabpanel",
                        aria_labelledby: "deck-tab",
                        aria_label: "Setup",
                        hidden: !deck(),
                        authoring::AgentEditor { web, tick, loaded, authored, agent: selected }
                        {authoring::agent_panel(agents)}
                        settings::Settings { web, endpoint_set, tick }
                    }
                }
                aside { class: "rail", aria_label: "Live instruments",
                    board::AgentBoard { web, tick }
                    tools::ToolTrace { web, tick, agent: selected }
                    terminal::Terminal { web, tick, agent: selected }
                    space::SpaceInspector { web, tick, agent: selected }
                }
            }
        }
    }
}
