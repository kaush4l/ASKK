//! WHAT ELSE YOU NEED WHILE YOU ARE DOING THIS — the instruments column, per
//! view (VIEWS.md §5). `centre/mod.rs` next door routes the centre: what is IN the
//! middle and what stands beside it are two decisions, and only this one has
//! state of its own.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;

use crate::shell::views::View;
use crate::files::{self, artifacts, listing};
use crate::proc;

/// WHY THIS RAIL HAS NO FOLDER OF THIS AGENT'S TO SHOW, if it has none: the
/// core's own fragment, read once. One trip through the seam for a projection
/// the core already writes the answer on — never a second definition of "has a
/// workspace", and never a second wording of why not.
fn refused(web: &Signal<Option<Rc<WebApp>>>, agent: &str) -> Option<String> {
    if web.peek().is_none() {
        return None; // no app yet is not a refusal
    }
    let html = listing::read(*web, agent, Request::get("/files").with_header("x-at", ".")).html;
    (!listing::served(&html)).then_some(html)
}

/// Whether the selected agent is in no shared space, and so has no workspace
/// folder, nothing running in one, and nothing made in one (`data-why`,
/// `listing::spaceless`).
fn spaceless(web: &Signal<Option<Rc<WebApp>>>, agent: &str) -> bool {
    refused(web, agent).is_some_and(|html| listing::spaceless(&html))
}

/// WHETHER THE RAIL HAS ANYTHING TO STAND BESIDE (R12-6). The header's toggle
/// and the rail itself both need this answer, and while only the rail had it
/// the header carried `Hide workspace files` with `aria-expanded="true"` over a
/// `#rail` that was `display: none` at 0x0 — a dead control reporting a state
/// it did not have, and a press that changed the label and nothing else.
pub fn instruments(web: &Signal<Option<Rc<WebApp>>>, here: View, agent: &str) -> bool {
    here.rail() && !(here == View::Workspace && spaceless(web, agent))
}

/// The shell's one read of it, as a signal the header's switch and the region
/// it controls both take their answer from.
pub fn available(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    selected: Signal<String>,
    view: Signal<View>,
) -> Signal<bool> {
    let mut open = use_signal(|| false);
    use_effect(move || {
        let _ = tick();
        let now = instruments(&web, view(), &selected());
        if *open.peek() != now {
            open.set(now);
        }
    });
    open
}

/// The instruments, per view (VIEWS.md §5). The rail answers "what else do I
/// need while I am doing this", so it differs per view — and on Settings and
/// the Dashboard the answer is nothing (`View::rail`).
#[component]
pub fn Rail(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    selected: Signal<String>,
    view: Signal<View>,
) -> Element {
    let here = view();
    let noun = here.rail_noun(); // what is IN it, not where it is (R8-7)
    // WHICH FOLDER the Workspace rail is on. Here because two panes move it:
    // Files when you press a folder, Processes when you open a log.
    let at = use_signal(|| ".".to_string());
    // …AND WHEN THERE IS NO FOLDER OF THIS AGENT'S TO PUT IN IT, WHY — ONCE
    // (R16-P1-3). Selecting `ask` left this rail headed `workspace files · ask`
    // over three panes each printing the same 60-word paragraph about main,
    // ending in an instruction to undo the selection just made. The panes have
    // nothing to show in that state; the header names the agent and one
    // paragraph under it says why, so the heading and the body are about the
    // same agent and the reader reads it once.
    let mut denial = use_signal(String::new);
    use_effect(move || {
        let _ = tick();
        if view() != View::Workspace {
            return;
        }
        let now = refused(&web, &selected())
            .filter(|html| !crate::files::listing::spaceless(html))
            .unwrap_or_default();
        if *denial.peek() != now {
            denial.set(now);
        }
    });
    // ONE MESSAGE, ONCE (R10-11). On `#/workspace/author` this rail printed
    // *"author is in no shared space, so it has no workspace folder to
    // browse…"* under Files and again, verbatim, under Processes — where the
    // browsing it offers to explain is not what the pane is about — beside a
    // third wording of it in the Commands pane that owns the subject. Three
    // panes about a folder that does not exist have nothing to show and no
    // reason to be on screen: the centre column says it, and says it once.
    //
    // WHO DECIDES IS THE SHELL, NOT THIS (R12-6): the header's switch has to
    // know the same answer, and two components deriving it separately is how
    // the switch came to advertise a region that was not on the page.
    rsx! {
        aside {
            class: "rail",
            id: "rail",
            aria_label: "{noun} for {selected}",
            hidden: !here.rail(),
            p { class: "rail-who", "{noun} · " strong { "{selected}" } }
            // THE CHAT RAIL IS GONE (R15-IA). It held a compact agent board and
            // a tool trace — the Dashboard's subject and the Tool trace view's
            // subject — under a heading that read `agent activity · main` over
            // a first card listing all six agents. Both panels kept their own
            // homes; the conversation is now the whole of its own view.
            // NOT on Agents (F24) or Trace (R2-18). On Commands the terminal
            // has the centre, so the folder, what is running and the shelf go
            // BESIDE it, and ALL RE-READ ON EVERY AGENT CHANGE (R5-1).
            if here == View::Workspace && !denial.read().is_empty() {
                div { aria_live: "polite", dangerous_inner_html: "{denial}" }
            } else if here == View::Workspace {
                files::Files { web, tick, agent: selected, at }
                // …and WHAT IS RUNNING: Commands is what happened. It shares
                // the folder signal so a log opens in the Files editor (R10-6).
                proc::Processes { web, tick, agent: selected, at }
                artifacts::Artifacts { web, tick, agent: selected, view }
            }
        }
    }
}
