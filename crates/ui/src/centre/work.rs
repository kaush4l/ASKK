//! THE RUN, AND THE WHOLE OF IT (docs/ADE-DESIGN.md §3, "WATCH").
//!
//! It replaces the Dashboard, and the replacement is the round's whole point.
//! The Dashboard opened on the product's name at 136px, a tagline, a collapsed
//! disclosure and a four-cell stat table, and the act the product exists for —
//! giving an agent a task — measured at y=1162 on a 844px phone and y=896 on a
//! 900px laptop (UPLIFT-FINDINGS F8). Its first screen was about ITSELF.
//!
//! This one opens on the field you type into. What follows it is the run that
//! field starts, in the order the run happens: the loop's walk, the transcript,
//! the tool calls with their arguments and output, the shell the calls ran in,
//! and last what the harness recorded underneath. Four navigation destinations
//! became four regions of one scroller, because a turn is one continuous event
//! and the person watching it should not have to correlate three tabs by
//! timestamp.
//!
//! WHAT LEFT, AND WHERE IT WENT — nothing was deleted:
//! * the fleet tiles, the agent board and the shared space are about EVERY
//!   agent, so they are on `Agents`, which is the view whose subject is the
//!   roster.
//! * the standfirst and its disclosure are onboarding prose, and they are on
//!   `Setup`, beside the endpoint they are mostly about.
//! * the `<h1>` nameplate is gone from the primary plane entirely. The identity
//!   is the wordmark in the header, which was always there; a product does not
//!   need to shout its own name at somebody already inside it, and 136px of it
//!   was the largest single reason the first screen held no work.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;

use crate::board::launch;
use crate::flow;
use crate::shell::views::View;

/// The head of the run: the field, then the walk.
///
/// THE FIELD IS FIRST AND THAT IS AN ASSERTION, not a preference — ADE-DESIGN.md
/// §6 E1 and E2, executed by `scripts/fold-probe.js`. E2 is the sharper of the
/// two: it is not enough for the task field to be ON the first screen, it has to
/// be the first thing on it you can act in, because a control a person reaches
/// after three others is a control they did not find.
#[component]
pub(crate) fn WorkView(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    selected: Signal<String>,
    agents: Signal<String>,
    view: Signal<View>,
) -> Element {
    rsx! {
        section {
            class: "view-panel work-view",
            id: "work-view",
            aria_label: "Work",
            // WHAT YOU CAME HERE TO DO. One field, at the top, on the first
            // screen at both sizes.
            launch::TaskLauncher { web, tick, agent: selected, agents, view }
            // WHICH PART OF THE LOOP IS RUNNING — strategy, plan, work, verify,
            // critique. Directly under the field that starts it, because the
            // walk is the answer to "what happened when I pressed that".
            flow::FlowDeck { web, tick, agent: selected }
        }
    }
}
