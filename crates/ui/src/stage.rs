//! WHAT you are doing — the centre column, routed by `View`.
//!
//! Every region stays MOUNTED and all but one carry `hidden` (the mechanism the
//! two booleans this replaces already used): unmounting the chat pane would
//! drop the poller following a turn in flight, and unmounting the board would
//! restart its clock every time somebody looked at Settings.
//!
//! The panels themselves are the same components the rail has always held. A
//! view is an ARRANGEMENT of them, not a second implementation of each.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;

use crate::views::View;
use crate::{authoring, board, chat, gallery, settings, space, tabs, terminal, tools};

/// The centre column. One `Signal` per thing two regions disagree about; the
/// prop list is long because the shell owns the state and this owns the layout,
/// which is the split that keeps either one readable.
#[component]
#[allow(clippy::too_many_arguments)]
pub fn Stage(
    web: Signal<Option<Rc<WebApp>>>,
    endpoint_set: Signal<bool>,
    tick: Signal<u32>,
    /// The roster's fingerprint — see the memo in `main`.
    roster: ReadSignal<String>,
    /// The `/agents` listing itself, for the roster panel.
    agents: Signal<String>,
    loaded: Signal<Vec<String>>,
    authored: Signal<Vec<String>>,
    selected: Signal<String>,
    /// The masthead fragment: `GET /`, built by the core's escaping primitives.
    fragment: Signal<String>,
    view: Signal<View>,
) -> Element {
    let here = view();
    rsx! {
        div { class: "stage primary",
            section {
                class: "view-panel dashboard-view",
                id: "dashboard-view",
                aria_label: "Dashboard",
                hidden: here != View::Dashboard,
                // The one <h1> on the page, and the seam's own words for it.
                div { class: "masthead", dangerous_inner_html: "{fragment}" }
                div { class: "dash-grid",
                    board::AgentBoard { web, tick, view }
                    tools::ToolTrace { web, tick, agent: selected }
                    terminal::Terminal { web, tick, agent: selected }
                    space::SpaceInspector { web, tick, agent: selected }
                }
            }
            section {
                class: "view-panel chat-view",
                id: "chat-view",
                aria_label: "Chat",
                hidden: here != View::Chat,
                // Agents is not the navigation, so the switcher lives HERE, as
                // a tab strip inside the one view it changes the subject of.
                tabs::AgentTabs { loaded, authored, selected }
                chat::ChatPane { web, endpoint_set, tick, roster, agent: selected, hidden: false }
            }
            section {
                class: "view-panel agents-view",
                id: "agents-view",
                aria_label: "Agents",
                hidden: here != View::Agents,
                authoring::AgentEditor { web, tick, loaded, authored, agent: selected }
                {authoring::agent_panel(agents)}
            }
            section {
                class: "view-panel memory-view",
                id: "memory-view",
                aria_label: "Memory",
                hidden: here != View::Memory,
                space::SpaceInspector { web, tick, agent: selected }
            }
            section {
                class: "view-panel trace-view",
                id: "trace-view",
                aria_label: "Trace",
                hidden: here != View::Trace,
                tools::ToolTrace { web, tick, agent: selected }
            }
            section {
                class: "view-panel settings-view",
                id: "settings-view",
                aria_label: "Settings",
                hidden: here != View::Settings,
                settings::Settings { web, endpoint_set, tick }
            }
            gallery::DesignSystem { hidden: here != View::DesignSystem }
        }
    }
}

/// The instruments, per view (VIEWS.md §5). The rail is the answer to "what
/// else do I need while I am doing this", so it is different per view rather
/// than the same four panels forever — and on Memory, Settings and the
/// Dashboard (which already holds them all) the answer is nothing, so
/// `View::rail` folds it.
#[component]
pub fn Rail(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    selected: Signal<String>,
    view: Signal<View>,
) -> Element {
    let here = view();
    rsx! {
        aside {
            class: "rail",
            id: "rail",
            aria_label: "Live instruments for {selected}",
            hidden: !here.rail(),
            p { class: "rail-who", "Instruments · " strong { "{selected}" } }
            if here == View::Chat {
                board::AgentBoard { web, tick, view }
                tools::ToolTrace { web, tick, agent: selected }
            }
            if here == View::Agents {
                board::AgentBoard { web, tick, view }
            }
            if here == View::Trace {
                terminal::Terminal { web, tick, agent: selected }
            }
        }
    }
}
