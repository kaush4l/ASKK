//! SHAPE — the two surfaces where you change what the system IS, rather than
//! watch it work (docs/ADE-DESIGN.md §3). `Agents` is what agents exist and how
//! one is written; `Setup` is where turns are addressed and what this browser
//! holds.
//!
//! Its own file because `panels.rs` beside it is the RUN's regions and this is
//! not one of them — and because putting both in one file took that file to 224
//! lines against I12's 200. The split is by ADE-DESIGN.md's own verbs, which is
//! the only division of this crate a reader can predict.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;

use crate::board::{self, roster, tiles};
use crate::settings::{self, endpoint_copy, linux_engine};
use crate::shell::views::View;
use crate::shell::{skin, theme};
use crate::{authoring, space};


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
    view: Signal<View>,
) -> Element {
    // Presses of `Write a new agent`: the roster's link and the editor it names
    // are two panels, and "new" has to mean the same thing in both (R17-P1-7).
    let blank = use_signal(|| 0u32);
    rsx! {
        section {
            class: "view-panel agents-view",
            id: "agents-view",
            aria_label: "Agents",
            // WHAT EVERY AGENT IS DOING, ON THE VIEW WHOSE SUBJECT IS EVERY
            // AGENT (ADE-DESIGN.md §3). These three were the Dashboard's, and
            // the Dashboard was a home page for a product with one act. They are
            // not deleted and they are not homeless: a count of the fleet, a row
            // per agent and the facts they share are the roster's live state,
            // which is exactly what the view beside a panel is for (R17-IA).
            tiles::FleetTiles { web, tick }
            {roster::agent_panel(agents, selected, blank)}
            board::AgentBoard { web, tick, view }
            space::SpaceInspector { web, tick, agent: selected, agents, view }
            authoring::AgentEditor { web, tick, loaded, authored, agent: selected, blank }
        }
    }
}

/// …and NOTHING about the component gallery (R3-11): a maintainer's specimen
/// sheet shipped as the last line of the product's Settings. It stays reachable
/// at `#/design-system`, MOUNTED ONLY ON ITS OWN ROUTE (R4-9).
#[component]
pub(crate) fn SetupView(
    web: Signal<Option<Rc<WebApp>>>,
    endpoint_set: Signal<bool>,
    tick: Signal<u32>,
) -> Element {
    rsx! {
        section {
            class: "view-panel settings-view",
            id: "settings-view",
            aria_label: "Settings",
            // WHAT THIS THING IS, BESIDE THE ENDPOINT IT IS MOSTLY ABOUT
            // (ADE-DESIGN.md §3). The standfirst and its disclosure were the
            // Dashboard's second and third elements, above the act; they are
            // onboarding prose, and onboarding prose belongs where a person
            // goes when something has not worked — which for this product is
            // always the address of the model server.
            p { class: "tagline", {super::TAGLINE} }
            details { class: "lede-more",
                summary { "How a turn works, and what it needs" }
                p { {super::TAGLINE_MORE} }
            }
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
