//! WHAT you are doing — the centre column, routed by `View`.
//!
//! The CHAT pane stays mounted whatever view you are on, hidden when it is not
//! the one: its poller belongs to a turn in flight, and unmounting it would
//! leave that turn unwatched. Every other view is mounted only while it is the
//! current one.
//!
//! That split is not a preference. The panels are the same components the rail
//! holds — a view is an ARRANGEMENT of them, not a second implementation — and
//! several of them carry a fixed `id` (`workspace-command`, `composer-field`)
//! and a clock of their own. Mounting all seven views at once put three
//! `ToolTrace`s and two `Terminal`s in one document: duplicate ids, `focus()`
//! landing inside a `hidden` region, and three panels polling the seam for the
//! same projection. One mounted view, plus the chat pane, is the whole fix.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;

use crate::views::View;
use crate::{authoring, board, chat, files, gallery, launch, settings, space, tabs, terminal, tools};

/// The centre column. One `Signal` per thing two regions disagree about; the
/// prop list is long because the shell owns the state and this owns the layout,
/// which is the split that keeps either one readable.
#[component]
#[allow(clippy::too_many_arguments)]
pub fn Stage(
    web: Signal<Option<Rc<WebApp>>>,
    endpoint_set: Signal<bool>,
    tick: Signal<u32>,
    /// The page's token meter, written by the chat pane's poll.
    tokens: Signal<u64>,
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
            if here == View::Dashboard {
                section {
                    class: "view-panel dashboard-view",
                    id: "dashboard-view",
                    aria_label: "Dashboard",
                    // The one <h1> on the page, and the seam's own words for
                    // it. It moves with this view, which is a real cost: on
                    // every other view the page has no <h1> at all. The
                    // alternative — a heading in the frame — would name the
                    // product where the seam names the surface.
                    div { class: "masthead", dangerous_inner_html: "{fragment}" }
                    div { class: "dash-grid",
                        launch::TaskLauncher { web, tick, agent: selected, view }
                        board::AgentBoard { web, tick, view }
                        space::SpaceInspector { web, tick, agent: selected }
                    }
                }
            }
            // MOUNTED ALWAYS. See the module note: the poller.
            section {
                class: "view-panel chat-view",
                id: "chat-view",
                aria_label: "Chat",
                hidden: here != View::Chat,
                // Agents is not the navigation, so the switcher lives HERE, as
                // a tab strip inside the one view it changes the subject of.
                tabs::AgentTabs { loaded, authored, selected }
                chat::ChatPane {
                    web, endpoint_set, tick, tokens, roster, agent: selected, hidden: false,
                }
            }
            if here == View::Agents {
                section {
                    class: "view-panel agents-view",
                    id: "agents-view",
                    aria_label: "Agents",
                    launch::TaskLauncher { web, tick, agent: selected, view }
                    authoring::AgentEditor { web, tick, loaded, authored, agent: selected }
                    {authoring::agent_panel(agents)}
                }
            }
            if here == View::Workspace {
                section {
                    class: "view-panel workspace-view",
                    id: "workspace-view",
                    aria_label: "Workspace",
                    files::Files { web, tick, agent: selected }
                }
            }
            if here == View::Memory {
                section {
                    class: "view-panel memory-view",
                    id: "memory-view",
                    aria_label: "Memory",
                    space::SpaceInspector { web, tick, agent: selected }
                }
            }
            if here == View::Trace {
                section {
                    class: "view-panel trace-view",
                    id: "trace-view",
                    aria_label: "Trace",
                    tools::ToolTrace { web, tick, agent: selected }
                }
            }
            if here == View::Settings {
                section {
                    class: "view-panel settings-view",
                    id: "settings-view",
                    aria_label: "Settings",
                    settings::Settings { web, endpoint_set, tick }
                }
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
            if here == View::Workspace || here == View::Trace {
                terminal::Terminal { web, tick, agent: selected }
            }
        }
    }
}
