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

use crate::views::View;

mod agentfile;
mod artifacts;
mod authoring;
mod board;
mod chat;
mod composer;
mod dash;
mod files;
mod gallery;
mod launch;
mod stage;
mod tabs;
mod terminal;
mod tools;
mod turn;
mod wait;
mod settings;
mod settings_view;
mod skin;
mod space;
mod ui;
mod views;

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
    // Whether an endpoint is configured. `Settings` writes it when it is on
    // screen, and the SHELL derives it every tick as well — because since 15H
    // a view mounts only while it is current, and a signal published by a
    // component nobody has opened is a signal that is false: the composer sat
    // disabled on a fresh load until you visited Settings, over an endpoint
    // that was configured and working. The broker is the source of truth and
    // both readers ask it.
    let endpoint_set = use_signal(|| false);
    // "something moved": bumped by a turn and by a settings save, read by the
    // panes that must redraw from the core when it does.
    let tick = use_signal(|| 0u32);
    // What this page has spent. Written by the chat pane's poll off the
    // projection's `x-tokens` header, read by the meter in the header strip.
    let tokens = use_signal(|| 0u64);
    // The two dismissable regions (increment 13). One bit each, owned here
    // because the switch that flips it lives in the header and the region it
    // flips lives in `main` — nothing below this needs to know.
    let nav_open = use_signal(dash::wide);
    let rail_open = use_signal(dash::wide);
    // WHERE you are. One signal replaces the two booleans the stage routed on;
    // the Dashboard is where you land, because that is what the page is for.
    let view = use_signal(|| {
        if gallery::wanted() {
            View::DesignSystem
        } else {
            View::Dashboard
        }
    });

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
    // The one sentence that says what the next turn actually calls. It was
    // prose in the chat pane; it is the same sentence, unchanged, typeset into
    // the header strip that used to be 77px holding two words (12c walk).
    // Reading `tick` is what makes it follow a settings save.
    let endpoint = {
        let _ = tick();
        chat::endpoint_line(web)
    };
    use_effect(move || {
        let _ = tick();
        let configured = chat::endpoint_configured(web);
        let mut endpoint_set = endpoint_set;
        if *endpoint_set.peek() != configured {
            endpoint_set.set(configured);
        }
    });

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
            dash::TokenMeter { tokens }
            div { class: "switches",
                dash::PanelToggle { label: "Views", controls: "nav", open: nav_open }
                dash::PanelToggle { label: "Instruments", controls: "rail", open: rail_open }
                views::DesignSwitch { view }
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
                    aria_label: "Views",
                    hidden: !nav_open(),
                    views::ViewNav { view }
                }
                stage::Stage {
                    web, endpoint_set, tick, tokens, roster, agents, loaded, authored,
                    selected, fragment, view,
                }
                // WHOSE instruments, and which ones: the rail is contextual,
                // and it folds on the views that need none (VIEWS.md §5). The
                // person's own switch still wins over the view's default.
                if rail_open() {
                    stage::Rail { web, tick, selected, view }
                }
            }
        }
    }
}
