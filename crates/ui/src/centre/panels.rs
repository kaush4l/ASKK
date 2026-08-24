//! ONE SECTION PER ROUTE — the panels the stage switches between, and the band
//! above them. Each owns its own `id`, its own accessible name and the panels
//! it arranges; `centre/mod.rs` owns only which of them is on screen.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;

use crate::board::roster;
use crate::chat::thread;
use crate::settings::{self, endpoint_copy, linux_engine};
use crate::centre::plate;
use crate::shell::views::View;
use crate::shell::{agent_switcher, skin, theme};
use crate::{authoring, debug, terminal, trace};

/// THE STAGE'S HEAD — one band above whatever is routed: the KICKER names the
/// view (R5-misc) at `--t-caption`, then the SUBJECT PLATE (`plate.rs`), then
/// the agent switcher where the route has one. There is exactly one display
/// register in this product and it is a ruled plate naming the SCREEN'S
/// SUBJECT: the product on the Dashboard, where `core::builtins` owns the
/// `<h1>` inside the routed panel, and the SELECTED AGENT everywhere else —
/// never the view's own name, which says nothing on a screen whose subject is
/// a conversation (UPLIFT F2). `<h2>` there, not `<h1>`:
/// `core/tests/skeleton.rs:118` pins `GET /` at one.
#[component]
pub(crate) fn StageHead(
    here: View,
    loaded: Signal<Vec<String>>,
    authored: Signal<Vec<String>>,
    selected: Signal<String>,
) -> Element {
    let (controls, label) = here.picker();
    // The class the MARKUP states, not a `:has()` on the routed panel: that
    // selector flaked one run in five against the probe's own routing.
    let kicker = if here == View::Dashboard { "view-eyebrow kicker" } else { "view-eyebrow" };
    rsx! {
        div { class: "stage-head",
            p { class: "{kicker}", "{here.label()}" }
            if here != View::Dashboard {
                // One word, spanned to its box; `plate.rs` says why by `<svg>`.
                plate::SubjectPlate { word: selected.read().clone() }
            }
            // …AND NOT ON CHAT (R15-IA): the thread list IS the picker there.
            // …AND NOT ON THE DASHBOARD (lap 2's mobile critic, measured at
            // 390x844): the head sits above the routed panel and the Dashboard's
            // `<h1>` is INSIDE it, so a switcher here read kicker -> TAB BAND ->
            // nameplate, y=371 / 394 / 462 — navigation cutting between an eyebrow
            // and the product's one nameplate. `dashboard.rs` renders it under the
            // nameplate now, above the agent-scoped panels it switches, so all
            // three routes read kicker -> subject -> switcher.
            if here.scoped() && here != View::Chat && here != View::Dashboard {
                agent_switcher::AgentTabs { loaded, authored, selected, controls, label }
            }
        }
    }
}

/// MOUNTED ALWAYS, hidden when it is not the route (see `centre/mod.rs`: the
/// poller). The list around the pane is mounted with it, and reads nothing
/// while this is not the routed view (`thread.rs`, rule 1).
#[component]
#[allow(clippy::too_many_arguments)]
pub(crate) fn ChatView(
    here: View,
    web: Signal<Option<Rc<WebApp>>>,
    endpoint_set: Signal<bool>,
    tick: Signal<u32>,
    tokens: Signal<u64>,
    roster: ReadSignal<String>,
    loaded: Signal<Vec<String>>,
    selected: Signal<String>,
    view: Signal<View>,
) -> Element {
    rsx! {
        section {
            class: "view-panel chat-view",
            id: "chat-view",
            aria_label: "Chat",
            hidden: here != View::Chat,
            thread::ThreadList {
                web, endpoint_set, tick, tokens, roster, loaded, selected, view,
            }
        }
    }
}

/// THE AGENTS FIRST (R2-17): the view named "Agents" opened on a task launcher.
/// The roster is its subject, a DECK of reading columns (R7-6b, `roster.rs`).
///
/// …AND THE EDITOR, WITH NOTHING BESIDE IT (R15-IA): a second `Run a task` card
/// here put the editor 2168px down a page whose job is writing an agent.
#[component]
pub(crate) fn AgentsView(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    loaded: Signal<Vec<String>>,
    authored: Signal<Vec<String>>,
    agents: Signal<String>,
    selected: Signal<String>,
) -> Element {
    // Presses of `Write a new agent`: the roster's link and the editor it names
    // are two panels, and "new" has to mean the same thing in both (R17-P1-7).
    let blank = use_signal(|| 0u32);
    rsx! {
        section {
            class: "view-panel agents-view",
            id: "agents-view",
            aria_label: "Agents",
            {roster::agent_panel(agents, selected, blank)}
            authoring::AgentEditor { web, tick, loaded, authored, agent: selected, blank }
        }
    }
}

/// The TERMINAL is the primary column here (F10).
#[component]
pub(crate) fn WorkspaceView(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    selected: Signal<String>,
) -> Element {
    rsx! {
        section {
            class: "view-panel workspace-view",
            id: "workspace-view",
            aria_label: "Commands",
            // WHAT ELSE IS ON THIS VIEW (R17-P1-9) — IN the panel now, not
            // pinned above it in `.stage-head`, where one sentence about this
            // view's content cost 77px of chrome at 1440 and ~100px at 320
            // against `fold-probe.js`'s third-of-the-screen floor: at 390 the
            // deck panel opened at y=650 with 194px left and the toast band
            // over 62 of them. Nothing hidden; it scrolls with its subject.
            p { class: "note", {super::WORKSPACE_NOTE} }
            terminal::Terminal { web, tick, agent: selected }
        }
    }
}

#[component]
pub(crate) fn TraceView(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    selected: Signal<String>,
    view: Signal<View>,
) -> Element {
    rsx! {
        section {
            class: "view-panel trace-view",
            id: "trace-view",
            aria_label: "Tool trace",
            trace::ToolTrace { web, tick, agent: selected, view }
        }
    }
}

/// WHAT IS GOING ON UNDERNEATH — the facts the harness records and nothing else
/// reads. The tool trace answers "what did it DO"; this answers "what did it
/// decide, what did it cost, and what broke" (R15-IA).
#[component]
pub(crate) fn DebugView(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    selected: Signal<String>,
) -> Element {
    rsx! {
        section {
            class: "view-panel debug-view",
            id: "debug-view",
            aria_label: "Debug",
            debug::Debug { web, tick, agent: selected }
        }
    }
}

/// …and NOTHING about the component gallery (R3-11): a maintainer's specimen
/// sheet shipped as the last line of the product's Settings. It stays reachable
/// at `#/design-system`, MOUNTED ONLY ON ITS OWN ROUTE (R4-9).
#[component]
pub(crate) fn SettingsView(
    web: Signal<Option<Rc<WebApp>>>,
    endpoint_set: Signal<bool>,
    tick: Signal<u32>,
) -> Element {
    rsx! {
        section {
            class: "view-panel settings-view",
            id: "settings-view",
            aria_label: "Settings",
            settings::Settings { web, endpoint_set, tick }
            endpoint_copy::search::SearchEndpoint { web, tick }
            skin::Appearance {} // out of the header (R2-14)
            theme::Themes {} // the four directions (ADE-DESIGN.md §4)
            // WHAT Linux the agent runs in, and what it does to your files. It
            // was a picker; there is one engine now, so it states the trade.
            linux_engine::LinuxEngine {}
        }
    }
}
