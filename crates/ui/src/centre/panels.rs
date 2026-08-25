//! ONE SECTION PER ROUTE — the panels the stage switches between, and the band
//! above them. Each owns its own `id`, its own accessible name and the panels
//! it arranges; `centre/mod.rs` owns only which of them is on screen.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;

use crate::chat::thread;
use crate::centre::plate;
use crate::shell::views::View;
use crate::{debug, terminal, trace};

/// THE STAGE'S HEAD — one band above whatever is routed: the KICKER names the
/// view (R5-misc) at `--t-caption`, then the SUBJECT PLATE (`plate.rs`) on the
/// view that has a subject.
///
/// THERE IS EXACTLY ONE DISPLAY REGISTER IN THIS PRODUCT and since the ADE
/// round it is here and only here. It used to be the `<h1>` nameplate
/// `core::builtins` renders inside the Dashboard — the product's own name at
/// 136px, at the top of the first screen, which is the single largest reason
/// that screen held no work (UPLIFT F8). The Dashboard is gone and so is the
/// nameplate; the identity is the wordmark in the header, where it costs 18px.
/// The plate names the SCREEN'S SUBJECT, which is the selected agent.
///
/// AND NO AGENT SWITCHER, ON ANY VIEW. It rendered on the views that were about
/// one agent and not on Chat, because there the thread list IS the picker
/// (R19-IA: a view has one control for its own subject). The run absorbed Chat,
/// so the thread list is on the only agent-scoped view there is, so the strip
/// has no view left to appear on. `shell/agent_switcher.rs` is deleted with this
/// change rather than kept behind a condition that is now always false — which
/// is what the mechanical rename of the views left, and it took the plate with
/// it: `here != View::Dashboard` and `here != View::Chat` both became
/// `here != View::Work`, so the plate disappeared from the one view that has a
/// subject and the strip became unreachable. Two live controls lost to a
/// sed, silently, behind a green compile.
#[component]
pub(crate) fn StageHead(here: View, selected: Signal<String>) -> Element {
    // EVERY VIEW HAS A PLATE, and it names that view's own subject: the AGENT
    // on the run, and the view itself on the two that are not about one.
    //
    // It was the run's alone for one build and the gate caught it in 52 of 78
    // configurations: with `scoped()` narrowed to `Work`, Agents and Setup
    // carried no display type at all and RAMPRANGE fell to 2.00:1 — below the
    // 6:1 floor, and the same arithmetic UPLIFT F2 recorded as the
    // cheap-imitation signature on the two routes a person spends time in. The
    // floor did not move; the pages got a subject.
    //
    // THE KICKER IS ONLY WHERE IT SAYS SOMETHING DIFFERENT. On the run it reads
    // `Work` over the agent's name, which are two facts. On Agents it would
    // read `Agents` over `Agents`, which is a label above its own echo.
    let word = match here.scoped() {
        true => selected.read().clone(),
        false => here.label().to_string(),
    };
    rsx! {
        div { class: "stage-head",
            // The class the MARKUP states, not a `:has()` on the routed panel:
            // that selector flaked one run in five against the probe's routing.
            if here.scoped() {
                p { class: "view-eyebrow kicker", "{here.label()}" }
            }
            // NOT spanned — `plate.rs` says why, at length, and it cost a
            // shipped regression to learn.
            plate::SubjectPlate { word }
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
            hidden: here != View::Work,
            thread::ThreadList {
                web, endpoint_set, tick, tokens, roster, loaded, selected, view,
            }
        }
    }
}

/// THE SHELL THE TOOL CALLS RAN IN — a region of the run now, not a
/// destination called Commands (ADE-DESIGN.md §3). Renamed from `WorkspaceView`
/// with it: the view it was named after no longer exists, and a component
/// named for a deleted route is the kind of stale noun this round is about.
#[component]
pub(crate) fn ShellPanel(
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
