//! THE DASHBOARD: the one `<h1>` on the page, what this thing is, the fleet at
//! a glance, and the launcher with the board beside it.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;

use crate::board::{self, launch, tiles};
use crate::shell::agent_switcher;
use crate::shell::views::View;
use crate::space;

#[component]
pub(crate) fn DashboardView(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    selected: Signal<String>,
    agents: Signal<String>,
    loaded: Signal<Vec<String>>,
    authored: Signal<Vec<String>>,
    view: Signal<View>,
    /// The masthead fragment: `GET /`, built by the core's escaping primitives.
    fragment: Signal<String>,
) -> Element {
    let (controls, label) = View::Dashboard.picker();
    rsx! {
        section {
            class: "view-panel dashboard-view",
            id: "dashboard-view",
            aria_label: "Dashboard",
            // The one <h1> on the page, in the seam's own words.
            div { class: "masthead", dangerous_inner_html: "{fragment}" }
            // What this thing IS, under the one heading — a standfirst and a
            // disclosure now rather than 170 words (`Lede`).
            Lede {}
            // THE FLEET AT A GLANCE (27): four facts about the WHOLE fleet, in
            // one band, before the launcher and the board. Same fold the board
            // renders, not a second count of it; no tile reports health.
            tiles::FleetTiles { web, tick }
            // WHICH AGENT — under the nameplate, not above it (lap 2). In
            // `.stage-head` this band sat BETWEEN the kicker and the `<h1>`,
            // because the head is pinned above the routed panel and this route's
            // nameplate is inside it. Here it is under the band that is about
            // ALL agents and above everything scoped to ONE, which is what it
            // switches.
            agent_switcher::AgentTabs { loaded, authored, selected, controls, label }
            // WHICH LOOP THE SELECTED AGENT'S TURN IS RUNNING (ROADMAP #7) —
            // the one question the board's status word underneath cannot answer.
            crate::flow::FlowDeck { web, tick, agent: selected }
            LauncherAndBoard { web, tick, selected, agents, view }
        }
    }
}

/// THE STANDFIRST AND THE REST OF THE STORY (the editorial round). Its own
/// component because `DashboardView` above is at the 40-line function ceiling
/// (I12) and this is two elements, not one.
///
/// The disclosure is a real `<details>`: the deferred half is in the tab order
/// and in the accessibility tree at every moment, which is the difference
/// between DEFERRED and HIDDEN. It ships CLOSED because a returning reader has
/// read it and a first-time reader has not reached it yet.
#[component]
fn Lede() -> Element {
    rsx! {
        p { class: "tagline", {super::TAGLINE} }
        details { class: "lede-more",
            summary { "How a turn works, and what it needs" }
            p { {super::TAGLINE_MORE} }
        }
    }
}

/// THE LAUNCHER IS THE READING COLUMN AND THE FLEET GOES BESIDE IT
/// (R6-LAYOUT). R3-20 took this card out of the grid because it shared a 22rem
/// cell with its own button; its own row then bought a 544px column of prose in
/// a 1134px box with the run's live account below the fold. The card is
/// `--column` and the board takes the rest, and the rest is now CLAMPED to it
/// (R7-5).
#[component]
fn LauncherAndBoard(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    selected: Signal<String>,
    agents: Signal<String>,
    view: Signal<View>,
) -> Element {
    rsx! {
        div { class: "dash-grid",
            launch::TaskLauncher { web, tick, agent: selected, agents, view }
            div { class: "dash-side",
                board::AgentBoard { web, tick, view }
                space::SpaceInspector { web, tick, agent: selected, agents, view }
            }
        }
    }
}
