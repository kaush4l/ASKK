//! WHAT you are doing — the centre column, routed by `View`.
//!
//! IT IS THE THEATRE SENSE OF THE WORD, AND IT USED TO BE SPELLED `stage`. That
//! is also `core::board::stage`'s word for WHICH PART OF A TURN IS RUNNING — plan,
//! work, verify, critique — and the two have nothing to do with each other:
//! nothing in this file touches a turn's stage, and nothing in `core::board::stage`
//! knows a column exists. A name that means two things is a defect, so this one
//! is the region of the SCREEN and only that.
//!
//! The CHAT pane stays mounted whatever view you are on, hidden when it is not
//! the one: its poller belongs to a turn in flight. Every other view is mounted
//! only while it is current — several panels carry a fixed `id` and a clock, so
//! mounting them all put three `ToolTrace`s and two `Terminal`s in one document.
//!
//! `View::Space` is GONE (R5-22): a nav destination byte-identical to the
//! Dashboard's own tile, with 60% of the viewport empty below it. The tile
//! stays where it has context, beside the board.

pub(crate) mod dashboard;
pub(crate) mod panels;

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;


use crate::shell::views::View;
use crate::files::breadcrumbs;
use crate::gallery;
use dashboard::DashboardView;
use panels::{AgentsView, ChatView, SettingsView, StageHead, TraceView, WorkspaceView};

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
    rsx! {
        // `content` is where the skip link lands (R2-19), past the header and
        // the nav; `tabindex=-1` so it holds focus outside the tab order.
        div { class: "stage primary", id: "content", tabindex: "-1",
            StageHead { here, loaded, authored, selected }
            if here == View::Dashboard {
                DashboardView { web, tick, selected, agents, view, fragment }
            }
            ChatView { here, web, endpoint_set, tick, tokens, roster, loaded, selected, view }
            if here == View::Agents {
                AgentsView { web, tick, loaded, authored, agents, selected }
            }
            if here == View::Workspace { WorkspaceView { web, tick, selected } }
            if here == View::Trace { TraceView { web, tick, selected, view } }
            if here == View::Settings { SettingsView { web, endpoint_set, tick } }
            if here == View::DesignSystem {
                breadcrumbs::DesignCrumb { view }
                gallery::DesignSystem {}
            }
        }
    }
}

// The RAIL is `rail.rs`: this file routes the centre column.

/// The one paragraph under the masthead. Nothing on the page said what this
/// product IS (F1) — three names and no sentence.
///
/// IT IS ALSO WHERE THE NOUNS ARE INTRODUCED (R18-P1-2). One word — workspace —
/// was on the Linux, on the folder and on the shared facts and notes at once.
/// This names each of them once, in the place a first-timer reads first.
///
/// …AND THE LOOP IS ONE OF THEM NOW (21). Increment 20 shipped a declared
/// plan → work → verify → critique loop and the interface never named it: the
/// only definition of the four words was three layers down, inside a collapsed
/// disclosure, on the Agents view. The word a person meets in the conversation
/// ("Plan stage:") is now introduced before they meet it.
///
/// …AND SO IS THE ONE THING A TURN CANNOT DO WITHOUT (31-walk F1). A first-time
/// reader met a header stating, as fact, that the next turn calls a model on
/// `127.0.0.1`, an intro that never mentioned a model server at all, and the
/// page's own example task. They pressed Start and waited ten seconds for
/// `main's turn failed`. The explanation that arrives then is a good one — it
/// is just at the bottom of the funnel, after the failure it describes.
///
/// It is a SENTENCE and deliberately not a probe. What is knowable before a
/// turn is that this page has no model of its own and that nothing here has
/// called the endpoint yet; whether a server is listening is not knowable
/// without calling it, and I15 says say less rather than claim either way. A
/// probe would also fire on a render, against an address the person has not
/// finished typing — so the honest cue is the one that costs nothing.
pub(crate) const TAGLINE: &str = "This runs AI agents in your browser, and it has no model of its \
    own: every turn is sent to a model endpoint you choose, and nothing here has called that \
    endpoint yet. This build ships pointed at a server on this machine, so unless one is running \
    there, the first turn will fail and say what to do — Settings is where the address is \
    changed. An agent whose file names a space also gets a folder in the Linux this page runs, \
    where it can write files and run commands, and it shares facts and notes with every other \
    agent naming that space. Each turn opens by deciding how much work the message needs: a \
    question it can answer gets one reply, something needing a tool gets as many steps as it \
    takes, and something to build gets planned, worked, checked and criticised — and the \
    conversation names each stage as it opens. Give an agent a task and walk away, or talk to \
    it while it works.";

/// The Commands view's one gloss. `Commands` names the panel you type into; the
/// three panels beside it are that panel's leavings, and nothing on screen said
/// so (R17-P1-9). One line, on the one view whose name does not cover it — the
/// others need no gloss and get none.
///
/// NOT "BESIDE IT" (R18-P2). On a phone that panel is not beside anything: it
/// is behind the `folder` switch in the header, and below 1100px it starts
/// folded on every screen. This names the panel and the switch that opens it,
/// which is true at every width and in both fold states.
pub(crate) const WORKSPACE_NOTE: &str = "The shell below. The folder these commands run in, what \
    is still running, and the files they finished are in the folder panel — the switch for it is \
    in the header.";

#[cfg(test)]
mod tests {
    /// The forewarning arrives BEFORE the invitation to press Start, not after
    /// the failure it describes (31-walk F1) — and it claims nothing about
    /// whether the endpoint answers, because nothing on this page knows (I15).
    #[test]
    fn the_intro_says_a_turn_needs_an_endpoint_before_it_invites_a_task() {
        let t = super::TAGLINE;
        let warned = t.find("endpoint").expect("the intro names the model endpoint");
        let invited = t.find("Give an agent a task").expect("the intro still invites a task");
        assert!(warned < invited, "the warning arrives after the invitation: {t}");
        assert!(t.contains("Settings"), "nothing says where the address goes: {t}");
        assert!(t.contains("nothing here has called that endpoint yet"), "unchecked, not ok: {t}");
    }
}
