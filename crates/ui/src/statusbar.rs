//! The header's one strip of facts. Split out of `main.rs`, which owns the
//! shell and had no room left (I12), and because the strip has a RULE of its
//! own that is worth stating in one place.
//!
//! TWO RULES, AND THEY ARE BOTH ABOUT NOT LYING.
//!
//! **Order is priority (R5-7, R6-4).** The DOM order below is the order the
//! strip gives things up in, from the bottom: model line · spend · running ·
//! sandbox · agent. `chrome.css` drops them WHOLE, by width; nothing here
//! knows the width and nothing here clips. A FAILURE IS NOT IN THAT ORDER ANY
//! MORE (R8-2): it took the slot the endpoint and the spend were in, so being
//! told an endpoint was unreachable removed the name of the endpoint. It is a
//! row of its own under this strip and it evicts nothing.
//!
//! **Nothing in the strip drops any more (R7-12, R13-P1-5).** The sandbox and
//! the endpoint SHRINK — a dot and one word, `calls ` and the model id — and
//! the spend, which used to leave at 64rem, stays: at 390 it was in the DOM
//! with `offsetParent: null` under a legend, itself inside the collapsed
//! drawer, promising that the header carried the running total. `StatusFold`
//! still exists, and now for the reason that matters more: it is where each
//! pill's MEANING is written out as prose a keyboard can reach.
//!
//! **A status the app does not have yet is not rendered (R6-BOOT).** Boot is
//! async: for as long as the core has not answered, `Agent: main` and
//! `main's workspace · starting…` are two assertions this page cannot
//! make — it does not yet know the roster, so it does not know that `main` is
//! on it, and it has not read the agent's file, so it does not know whether
//! that agent has a workspace at all. At 138ms nobody catches it; a cold
//! CheerpX boot holds it on screen for seconds. The wordmark is the one thing
//! that is true before anything loads, so the wordmark is what shows.

use dioxus::prelude::*;

use crate::trouble::Fleet;
use crate::ui::Disclosure;
use crate::{frame, meter, trouble};

/// The sentence behind the workspace pill. Its own fn because the fold below
/// renders the SAME words as visible prose (R7-13).
pub fn workspace_hint(who: &str, sandbox: &str) -> String {
    format!(
        "{who} has a folder — in the one Linux this page runs — and can run \
         commands in it. That Linux is {sandbox}."
    )
}

/// …and the same for an agent whose file names no space (R18-P1-2: FOLDER is
/// the directory, LINUX is the machine, and SPACE is the group whose facts and
/// notes are shared — one word each, and this sentence used all three senses of
/// "workspace" in two lines).
pub fn no_workspace_hint(who: &str, sandbox: &str) -> String {
    format!(
        "{who}'s file names no space, so {who} has no folder and runs no commands. The \
         one Linux this page runs, shared by every agent that does have a folder, is {sandbox}."
    )
}

/// WHAT ANY OF THE PILLS MEAN (R7-12, R7-13).
///
/// Every pill's explanation was a `title` — mouse-only, on an element that was
/// not in the tab order, so a keyboard or screen-reader user got the number
/// and never the meaning. It was also the place the two facts that DROPPED at
/// narrow widths went; neither drops now (R13-P1-5), so this is the legend and
/// nothing else, and it can be trusted to agree with the strip beside it.
///
/// So the facts and their sentences are written out once, in prose, at the
/// foot of the nav — which the header's first control opens at every width.
/// A `<details>`, because at rest the nav is a list of destinations and this
/// is a footnote; a summary is a 44px target and it IS in the tab order.
#[component]
pub fn StatusFold(tokens: ReadSignal<u64>, endpoint: String) -> Element {
    let spent = tokens();
    rsx! {
        div { class: "status-fold",
        Disclosure { summary: "What the status pills mean",
            p { class: "note",
                if endpoint.is_empty() {
                    "No model endpoint is saved yet, so no turn can be sent. Settings is where \
                     one is chosen."
                } else {
                    "{endpoint}"
                }
            }
            p { class: "note",
                if spent == 0 {
                    "Nothing has been spent yet. Once a reply reports usage, the header carries \
                     the running total."
                } else {
                    "Tokens, every agent: {meter::grouped(spent)}. Every token spent by every agent \
                     since this browser first opened the app, summed from the event log. Replies \
                     whose provider reported no usage are not counted."
                }
            }
            // THE LEGEND SAYS WHAT THE COLOURS DO (R12-7). It read "grey
            // before it starts, amber while it boots, green once an agent can
            // run a command in it" — and amber is in fact "a command is
            // running", a meaning the legend never gave it, while three cold
            // boots went grey straight to green and never showed amber at all.
            // Grey was doing double duty too: it is also the permanent state of
            // an agent that has no workspace and never will have one.
            p { class: "note",
                "The dot beside the workspace is the Linux this page runs. Amber while it \
                 starts, and amber again whenever a command is running in it — including one \
                 you have stopped waiting for, which it is still finishing. Green when it is \
                 booted and free to take the next command. Red when it could not start, and \
                 the pill says why. Grey means this agent has no workspace of its own, which \
                 is a fact about the agent and not something the Linux can change."
            }
        }
        }
    }
}

#[component]
#[allow(clippy::too_many_arguments)]
pub fn StatusStrip(
    /// Whether the core has answered at all. False for the whole of boot, and
    /// then never false again.
    ready: bool,
    /// The page's subject — whichever agent every "run this" is addressed to.
    selected: Signal<String>,
    /// The `/agents` projection, for the workspace pill's one read.
    agents: Signal<String>,
    /// The board's own poll, published to the chrome (`trouble::Fleet`).
    fleet: Fleet,
    tokens: Signal<u64>,
    /// What the next turn calls — the one item that shrinks, in the parts it
    /// shrinks by (R11-10). It is no longer the first item DROPPED: it is the
    /// only one that never is.
    endpoint: crate::endpoint::Parts,
) -> Element {
    rsx! {
        // A SCROLLPORT A KEYBOARD CAN REACH (24-walk F1). At 390 this strip is
        // the one horizontally scrolling box on the page, and nothing inside it
        // is focusable, so the part past the edge was reachable by finger only.
        // `tabindex` on the scroller is what gives arrow keys somewhere to land.
        div { class: "status-strip", tabindex: "0", role: "group",
              "aria-label": "Status — scrolls sideways on a narrow screen",
            // A wordmark is a logo, not the page's <h1>, and it is the only
            // thing in this strip that is true before the core has answered.
            div { class: "wordmark", "HARNESS" }
            if ready {
                // WHICH agent every "run this" is addressed to (F2). Display,
                // not a picker: the picker is the stage head's strip.
                p { class: "pill subject", role: "status", "Agent: " strong { "{selected}" } }
                // Whether anything is RUNNING (R3-22), then the Linux, then the
                // spend. WHOSE LAST TURN FAILED IS NOT HERE ANY MORE (R8-2): a
                // banner that evicts pills to fit takes away the endpoint and
                // the spend at the moment they are most needed, so it has its
                // own row under this one (`main.rs`, `trouble::TroublePill`).
                trouble::RunPill { fleet }
                frame::WorkspaceWarmth { who: selected, agents }
                meter::TokenMeter { tokens }
                // LAST, and the only one that gives way — by SHRINKING, never
                // by leaving (R5-7, R11-10).
                crate::endpoint::EndpointPill { parts: endpoint }
            }
        }
    }
}
