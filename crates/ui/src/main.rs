//! L3 (ARCHITECTURE §4): the Dioxus app. A handler calls `core::handle` through
//! `WebApp::handle` — the seam unchanged (I4), no logic in JS (I5), layout (I8).

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
mod adopt;
mod agentfile;
mod agentkeys;
mod artifacts;
mod authoring;
mod board;
mod boardcell;
mod chat;
mod composer;
mod credit;
mod crumbs;
mod dash;
mod endpoint;
mod endpointform;
mod engine;
mod enginecost;
mod examples;
mod fileedit;
mod files;
mod frame;
mod gallery;
mod launch;
mod listing;
mod meter;
mod processes;
mod procrows;
mod rail;
mod receipt;
mod recover;
mod roster;
mod route;
mod runstatus;
mod stage;
mod statusbar;
mod trouble;
mod tabs;
mod stopcommand;
mod terminal;
mod thread;
mod tiles;
mod tools;
mod turn;
mod wait;
mod watch;
mod settings;
mod settings_view;
mod skin;
mod space;
mod spacegap;
mod ui;
mod views;

fn main() {
    if web_sys::window().is_none() {
        return;
    }
    dioxus::launch(shell);
}

/// Boot is async (IndexedDB): the shell paints at once, the page fills when the
/// core is up, and a boot failure is shown rather than swallowed.
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
    // Every loaded agent, and which one the chat pane is talking to.
    let loaded = use_signal(Vec::<String>::new);
    let authored = use_signal(Vec::<String>::new); // …and which it WROTE
    // …from the ADDRESS BAR, where it goes back to (R6-3).
    let selected = use_signal(|| route::agent().unwrap_or_else(|| route::DEFAULT_AGENT.into()));
    // A signal published by a component nobody has opened is false (15H).
    let endpoint_set = use_signal(|| false);
    let tick = use_signal(|| 0u32); // "something moved": a turn, or a save
    let tokens = use_signal(|| 0u64); // off `x-tokens`, for the meter
    let fleet = trouble::Fleet::new(); // the chrome's two health pills
    let (nav_open, rail_open) = (use_signal(dash::wide), use_signal(dash::wide));
    let chosen = use_signal(|| false); // width leads until a press (R2-3)
    use_hook(|| dash::follow_width(nav_open, rail_open, chosen));
    use_hook(|| dash::close_on_escape(nav_open)); // Escape shuts it (R4-15)
    // WHERE you are, in the ADDRESS BAR (F13).
    let view = use_signal(route::current);
    let has_rail = rail::available(web, tick, selected, view); // R12-6
    use_hook(|| route::listen(view, selected));
    // BOTH HALVES of the hash follow the page (R6-3).
    use_effect(move || route::show(view(), &selected()));
    // …and the arriving VIEW starts where it should be read from (R2-1).
    use_effect(move || route::land(view()));
    use_effect(move || {
        adopt::adopt(&booted.read(), web, fragment, agents, failure, loaded, authored)
    });
    use_effect(move || {
        let _ = tick();
        adopt::watch_agents(web, agents, loaded, authored, selected);
    });
    // The roster's fingerprint: a memo, so it moves on a REAL change (11b).
    let roster = use_memo(move || agents());
    // What the next turn calls (12c walk). `tick` follows a save.
    let endpoint = {
        let _ = tick();
        endpoint::endpoint_parts(web)
    };
    use_effect(move || {
        let _ = tick();
        let configured = endpoint::endpoint_configured(web);
        let mut endpoint_set = endpoint_set;
        if *endpoint_set.peek() != configured {
            endpoint_set.set(configured);
        }
    });
    // Whether the core has answered: nothing asserting a state the page does
    // not have yet renders before this is true (R6-BOOT, R7-BOOT).
    let ready = !fragment.read().is_empty();

    rsx! {
        // First in the tab order (R2-19): a keyboard user walked the whole nav
        // on every view. Visible only while focused (base.css).
        a { class: "skip-link", href: "#content", "Skip to content" }
        header {
            // FIRST, and on every screen (R2-3). "views", not "sidebar"
            // (R4-18) — and NOT BEFORE THERE ARE ANY (R7-BOOT): `☰ Hide views`
            // on a boot screen with no views is R2-12 wearing a menu.
            if ready {
                dash::PanelToggle { noun: "views", controls: "nav", open: nav_open, chosen }
            }
            // ONE STRIP FOR EVERY FACT, IN PRIORITY ORDER, AND NOTHING IT DOES
            // NOT YET KNOW (R5-7, R6-4, R6-BOOT). `statusbar.rs` states both.
            statusbar::StatusStrip {
                ready, selected, agents, fleet, tokens, endpoint: endpoint.clone(),
            }
            frame::Heartbeat { web, tick, tokens, fleet }
            // ABSENT, not disabled (R2-12); `views::rail_noun` has R17-P1-9.
            if has_rail() {
                div { class: "switches",
                    dash::PanelToggle { // named for its CONTENTS (R8-7)
                        noun: view().rail_noun(), controls: "rail", open: rail_open, chosen,
                    }
                }
            }
        }
        // A FAILED TURN GETS A ROW, NOT A SLOT (R8-2): in the strip it evicted
        // the endpoint and the spend, the two facts the failure needs.
        if ready { trouble::TroublePill { fleet, view, tick } }
        main {
            if !failure.read().is_empty() {
                p { class: "error", "core failed to boot: {failure}" }
            } else if !ready {
                // THE PRODUCT'S FIRST SENTENCE (R6-BOOT): it was "booting the
                // core…", the name of a crate in this repository.
                p { class: "pending", role: "status",
                    "Starting up — reading the agents and the history this browser has stored."
                }
            } else {
                // THE DARK UNDER THE DRAWER (R5-8): rendered whenever the nav
                // is open, `display: none` above the breakpoint. `aria-hidden`.
                if nav_open() {
                    div {
                        class: "nav-scrim",
                        aria_hidden: "true",
                        onclick: move |_| {
                            let mut nav_open = nav_open;
                            nav_open.set(false);
                        },
                    }
                }
                nav {
                    class: "nav",
                    id: "nav",
                    aria_label: "Views",
                    hidden: !nav_open(),
                    views::ViewNav { view, nav: nav_open }
                    // …and the facts the header gives up narrow, in prose and
                    // in the tab order (R7-12, R7-13), at its foot.
                    statusbar::StatusFold { tokens, endpoint: endpoint::joined(&endpoint) }
                }
                stage::Stage {
                    web, endpoint_set, tick, tokens, roster, agents, loaded, authored,
                    selected, fragment, view,
                }
                // WHOSE instruments, and which ones (VIEWS.md §5).
                if rail_open() && has_rail() {
                    rail::Rail { web, tick, selected, view }
                }
            }
        }
    }
}
