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

mod agentfile;
mod authoring;
mod board;
mod chat;
mod composer;
mod dash;
mod gallery;
mod tabs;
mod terminal;
mod tools;
mod turn;
mod settings;
mod settings_view;
mod skin;
mod space;
mod ui;

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
    // The two dismissable regions (increment 13). One bit each, owned here
    // because the switch that flips it lives in the header and the region it
    // flips lives in `main` — nothing below this needs to know.
    let nav_open = use_signal(dash::wide);
    let rail_open = use_signal(dash::wide);

    use_effect(move || {
        dash::adopt(&booted.read(), web, fragment, agents, failure, loaded, authored)
    });
    use_effect(move || {
        let _ = tick();
        dash::watch_agents(web, agents, loaded, authored);
    });
    // The roster's own fingerprint: the listing changes exactly when an agent's
    // identity does. A memo, so it propagates only on a REAL change — `tick`
    // fires on every projection, and `ChatPane` re-reads its transcript from
    // this. Without it the chat header kept naming the shipped description
    // after an override had installed, and the deleted one after a delete —
    // two projections of one agent's identity disagreeing on screen (11b walk).
    let roster = use_memo(move || agents());
    // WHICH surface the centre stage shows. The deck — Write an agent, Agents,
    // Settings — is the last entry in the left panel's list; every other entry
    // there is one agent's conversation.
    let deck = use_signal(|| false);
    // The third stage surface: /design-system (DESIGN.md §8). Routed exactly
    // the way the deck is — a `hidden` attribute over a mounted region, not a
    // router dependency — and opened directly by `#design-system` in the URL,
    // which is the one line that makes it linkable for a critic. It renders no
    // projection and calls the seam not once, so it is reachable with no model
    // endpoint configured.
    let design = use_signal(gallery::wanted);
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
            // The machine starts warming the moment the page paints, and this
            // is the only thing on screen that knows: nothing waits for it.
            dash::WorkspaceWarmth {}
            div { class: "switches",
                dash::PanelToggle { label: "Agents", controls: "nav", open: nav_open }
                dash::PanelToggle { label: "Instruments", controls: "rail", open: rail_open }
                dash::PanelToggle { label: "Design system", controls: "design-system", open: design }
                skin::SkinToggle {}
            }
        }
        main {
            if !failure.read().is_empty() {
                p { class: "error", "core failed to boot: {failure}" }
            } else if fragment.read().is_empty() {
                p { class: "pending", "booting the core…" }
            } else {
                // Three regions, in reading order: WHERE you are, WHAT you are
                // doing, and the instruments watching it happen. The two outer
                // ones fold away — a dashboard's panels are furniture, and a
                // 390px screen has room for exactly one of the three.
                nav {
                    class: "nav",
                    id: "nav",
                    aria_label: "Agents and setup",
                    hidden: !nav_open(),
                    tabs::AgentTabs { loaded, authored, selected, deck, design }
                }
                // `primary` stays on the class list: every console rule that
                // makes this column fill its glass is written against it, and
                // renaming the region is not what this increment is doing.
                div { class: "stage primary",
                    // The fragment is built by the core's escaping primitives
                    // (module::view) — the one scar the htmx design leaves.
                    div { class: "masthead", dangerous_inner_html: "{fragment}" }
                    chat::ChatPane {
                        web, endpoint_set, tick, roster, agent: selected,
                        hidden: deck() || design(),
                    }
                    // The routed deck: the tabpanel half of the last nav entry.
                    // Both surfaces stay MOUNTED and one is `hidden` — dropping
                    // the chat pane would drop the poller following a turn.
                    section {
                        class: "deck",
                        id: "deck-panel",
                        role: "tabpanel",
                        aria_labelledby: "deck-tab",
                        aria_label: "Setup",
                        hidden: !deck() || design(),
                        authoring::AgentEditor { web, tick, loaded, authored, agent: selected }
                        {authoring::agent_panel(agents)}
                        settings::Settings { web, endpoint_set, tick }
                    }
                    gallery::DesignSystem { hidden: !design() }
                }
                aside {
                    class: "rail",
                    id: "rail",
                    // WHOSE instruments. Selecting Setup leaves the rail
                    // pointed at the agent you were last talking to — which is
                    // correct, it is the agent the deck edits — but nothing on
                    // screen said so, and it read as the deck's own state
                    // (13 walk, finding 3). The name is in the label and in
                    // the visible caption below it.
                    aria_label: "Live instruments for {selected}",
                    hidden: !rail_open(),
                    p { class: "rail-who", "Instruments · " strong { "{selected}" } }
                    board::AgentBoard { web, tick, deck }
                    tools::ToolTrace { web, tick, agent: selected }
                    terminal::Terminal { web, tick, agent: selected }
                    space::SpaceInspector { web, tick, agent: selected }
                }
            }
        }
    }
}
