//! THE DASHBOARD: the one `<h1>` on the page, what this thing is, the fleet at
//! a glance, and the launcher with the board beside it.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;

use crate::board::{self, launch, tiles};
use crate::shell::views::View;
use crate::space;

#[component]
pub(crate) fn DashboardView(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    selected: Signal<String>,
    agents: Signal<String>,
    view: Signal<View>,
    /// The masthead fragment: `GET /`, built by the core's escaping primitives.
    fragment: Signal<String>,
) -> Element {
    rsx! {
        section {
            class: "view-panel dashboard-view",
            id: "dashboard-view",
            aria_label: "Dashboard",
            // The one <h1> on the page, in the seam's own words.
            div { class: "masthead", dangerous_inner_html: "{fragment}" }
            // What this thing IS, under the one heading (`TAGLINE`).
            p { class: "tagline", {super::TAGLINE} }
            // THE FLEET AT A GLANCE, ABOVE THE GRID (27). The Dashboard
            // answered "what is this thing doing right now" only by being
            // read — the launcher, then the board's rows, then the space
            // card. Four facts about the whole fleet, in one band, before
            // any of that. It is the same fold the board renders and not a
            // second count of it (`core::board::tiles`), and no tile reports
            // health: a failure is stated, a success is never announced.
            tiles::FleetTiles { web, tick }
            LauncherAndBoard { web, tick, selected, agents, view }
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
