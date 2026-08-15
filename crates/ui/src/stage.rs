//! WHAT you are doing — the centre column, routed by `View`.
//!
//! The CHAT pane stays mounted whatever view you are on, hidden when it is not
//! the one: its poller belongs to a turn in flight. Every other view is mounted
//! only while it is current — several panels carry a fixed `id` and a clock, so
//! mounting them all put three `ToolTrace`s and two `Terminal`s in one document.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;

mod intro;

use crate::views::View;
use crate::{authoring, board, crumbs, gallery, launch, roster, thread};
use crate::{endpointform, engine, settings, skin, space, tabs, terminal, tools};

/// The centre column. One `Signal` per thing two regions disagree about; the
/// prop list is long because the shell owns the state and this the layout.
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
    let (controls, label) = here.picker();
    // Presses of `Write a new agent`: the roster's link and the editor it names
    // are two panels, and "new" has to mean the same thing in both (R17-P1-7).
    let blank = use_signal(|| 0u32);
    rsx! {
        // `content` is where the skip link lands (R2-19), past the header and
        // the nav; `tabindex=-1` so it holds focus outside the tab order.
        div { class: "stage primary", id: "content", tabindex: "-1",
            // THE STAGE'S HEAD — one band above whatever is routed. The
            // EYEBROW names the view (R5-misc); it is also the only
            // `--t-caption` outside a message speaker, which stops 11px being
            // an orphan node (R5-A). The STRIP is the agent switcher (R5-6),
            // ONE instance, so `tab-{name}` is still unique and the roving
            // tabindex still works; `View::picker` re-points its accessible
            // name per view, because one name for five jobs is R4-10.
            div { class: "stage-head",
                p { class: "view-eyebrow", "{here.label()}" }
                // …AND WHAT ELSE IS ON IT, WHERE THE NAME IS READ (R17-P1-9) —
                // the copy and its reasons are `intro.rs`.
                if here == View::Workspace {
                    p { class: "note", {intro::WORKSPACE_NOTE} }
                }
                // …AND NOT ON CHAT (R15-IA, THREADS.md §7): the thread list IS
                // the picker there, and two controls for "which conversation"
                // on one screen is the bug R15 exists to prevent. It stays on
                // Dashboard, Commands and Trace, which are one-subject views.
                if here.scoped() && here != View::Chat {
                    tabs::AgentTabs { loaded, authored, selected, controls, label }
                }
            }
            if here == View::Dashboard {
                section {
                    class: "view-panel dashboard-view",
                    id: "dashboard-view",
                    aria_label: "Dashboard",
                    // The one <h1> on the page, in the seam's own words.
                    div { class: "masthead", dangerous_inner_html: "{fragment}" }
                    // What this thing IS, under the one heading — `intro.rs`.
                    p { class: "tagline", {intro::TAGLINE} }
                    // THE LAUNCHER IS THE READING COLUMN AND THE FLEET GOES
                    // BESIDE IT (R6-LAYOUT). R3-20 took this card out of the
                    // grid because it shared a 22rem cell with its own button;
                    // its own row then bought a 544px column of prose in a
                    // 1134px box with the run's live account below the fold.
                    // The card is `--column` and the board takes the rest, and
                    // the rest is now CLAMPED to it (R7-5).
                    div { class: "dash-grid",
                        launch::TaskLauncher { web, tick, agent: selected, agents, view }
                        div { class: "dash-side",
                            board::AgentBoard { web, tick, view }
                            space::SpaceInspector { web, tick, agent: selected, agents, view }
                        }
                    }
                }
            }
            // MOUNTED ALWAYS. See the module note: the poller. The list around
            // the pane is mounted with it — it is the same region — and reads
            // nothing while this is not the routed view (`thread.rs`, rule 1).
            section {
                class: "view-panel chat-view",
                id: "chat-view",
                aria_label: "Chat",
                hidden: here != View::Chat,
                thread::ThreadList {
                    web, endpoint_set, tick, tokens, roster, loaded, selected, view,
                }
            }
            if here == View::Agents {
                section {
                    class: "view-panel agents-view",
                    id: "agents-view",
                    aria_label: "Agents",
                    // THE AGENTS FIRST (R2-17): the view named "Agents" opened
                    // on a task launcher. The roster is its subject, and it is
                    // a DECK of reading columns rather than one wide card
                    // (R7-6b, `roster.rs`).
                    {roster::agent_panel(agents, selected, blank)}
                    // …AND THE EDITOR, WITH NOTHING BESIDE IT (R15-IA). This
                    // view used to end with a second `Run a task` card — the
                    // Dashboard's own panel, 600px of it, under six long roster
                    // cards — which put the editor 2168px down a page whose
                    // whole job is writing an agent. The launcher has one home
                    // and the roster links to it per agent; what is left here
                    // is the catalogue and the thing that adds to it.
                    authoring::AgentEditor { web, tick, loaded, authored, agent: selected, blank }
                }
            }
            if here == View::Workspace {
                section {
                    class: "view-panel workspace-view",
                    id: "workspace-view",
                    aria_label: "Commands",
                    // The TERMINAL is the primary column here (F10).
                    terminal::Terminal { web, tick, agent: selected }
                }
            }
            // View::Space is GONE (R5-22): a nav destination byte-identical to
            // the Dashboard's own tile, with 60% of the viewport empty below
            // it. The tile stays where it has context, beside the board.
            if here == View::Trace {
                section {
                    class: "view-panel trace-view",
                    id: "trace-view",
                    aria_label: "Tool trace",
                    tools::ToolTrace { web, tick, agent: selected, view }
                }
            }
            if here == View::Settings {
                section {
                    class: "view-panel settings-view",
                    id: "settings-view",
                    aria_label: "Settings",
                    settings::Settings { web, endpoint_set, tick }
                    endpointform::search::SearchEndpoint { web, tick }
                    skin::Appearance {} // out of the header (R2-14)
                    // WHICH Linux the agent runs in (increment 18). Beside
                    // Appearance because both are device-local preferences
                    // stored outside the app's data, and both take one press.
                    engine::LinuxEngine { web, tick, agent: selected }
                    // …and NOTHING about the component gallery (R3-11): a
                    // maintainer's page citing DESIGN.md sections and E1/E2/E3
                    // shipped as the last line of the product's Settings. It
                    // stays reachable at #/design-system.
                }
            }
            // MOUNTED ONLY ON ITS OWN ROUTE (R4-9). It was a `display: none`
            // section inside `.stage` on every screen, so a maintainer's
            // specimen sheet was in the document of every page anybody loaded.
            // The route is unchanged: `#/design-system` opens it.
            if here == View::DesignSystem {
                crumbs::DesignCrumb { view }
                gallery::DesignSystem {}
            }
        }
    }
}

// The RAIL is `rail.rs` (I12): this file routes the centre column.
