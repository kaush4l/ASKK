//! `agent_panel` — WHO is loaded, and where from. The roster card beside the
//! editor: it reads the core's `/agents` projection and renders it, and it owns
//! nothing else. Its own file because it is a different job from writing an
//! agent — `authoring.rs` owns the form, this owns the list (I12).

use dioxus::prelude::*;

use crate::ui::{has_rows, Button, Card, EmptyState, Skeleton};
use crate::views::View;

/// WHICH shared space one agent is in, off the `/agents` projection this page
/// already holds — `""` when its file names none, `None` when the listing has
/// no card for it yet (boot, or a name that is not on the roster at all).
///
/// One read, three readers: the header pill says whether THIS agent can run a
/// command (R6-2), the task launcher offers only tasks it can finish (R6-1),
/// and the shared-space card knows which of its two nothings it is showing
/// (R6-15). Before this they each guessed from a different signal, and the
/// three guesses disagreed on the same screen. `runstatus::cell` is the same
/// one-bit read of a rendered attribute the board rows already get.
pub(crate) fn space_of(agents: &str, who: &str) -> Option<String> {
    crate::runstatus::cell(agents, who, "data-space")
}

/// …and the question every caller actually asks. An agent with no space has no
/// folder in the Linux, so it runs no commands and writes no files: the folder
/// belongs to the space (`scrollback::workspace_said`).
pub(crate) fn has_workspace(agents: &str, who: &str) -> bool {
    space_of(agents, who).is_some_and(|s| !s.is_empty())
}

/// WHICH AGENT A PRESS INSIDE THE DECK WAS ABOUT (R15-P1-9). The cards are the
/// core's own markup, and each already carries `data-agent`; the two buttons it
/// now renders carry `data-open`, naming the view the press goes to. Reading
/// the pressed element the same way `listing::clicked_path` reads a file row
/// keeps this one delegated handler instead of a component per card.
fn pressed(event: &Event<MouseData>) -> Option<(String, String)> {
    use wasm_bindgen::JsCast;
    let target = event.downcast::<web_sys::MouseEvent>()?.target()?;
    let button = target.dyn_ref::<web_sys::Element>()?.closest("[data-open]").ok()??;
    let card = button.closest(".agent-card").ok()??;
    Some((button.get_attribute("data-open")?, card.get_attribute("data-agent")?))
}

/// Who is loaded, and where from. Its own fn because the shell composes the
/// page and owns no content (plan, "UI shape").
pub(crate) fn agent_panel(
    agents: Signal<String>,
    // The page's subject. A press in the deck RE-POINTS it, because the hash
    // carries both halves (R6-3) and `route::show` is the one door.
    selected: Signal<String>,
    // Presses of `Write a new agent`. The editor empties itself on a change
    // (R17-P1-7); this link used to only scroll to it.
    mut blank: Signal<u32>,
) -> Element {
    let projection = agents.read().clone();
    let who = selected();
    rsx! {
        Card { title: "Agents", aria_label: "Agents",
            p { class: "note",
                "Every agent this page has. Each entry says where it came from, who wrote it, \
                 and what it can reach — written here means you saved it in this browser, and \
                 the rest are shipped with this site."
            }
            // THE EDITOR IS BELOW, AND IT WAS 2168px DOWN (R15-IA). One link at
            // the top of the catalogue, to the thing that adds to it — the
            // roster is what this view opens on (R2-17) and the way to grow it
            // should not depend on scrolling past the whole of it to notice.
            // …AND `NEW` MEANS EMPTY (R17-P1-7). The editor arrives holding the
            // agent this page is pointed at, so focusing it under this label
            // handed a newcomer somebody else's file over a Save that would
            // have replaced it. The press blanks the form first.
            Button {
                variant: "secondary",
                onclick: move |_| {
                    let n = blank.peek().to_owned();
                    blank.set(n + 1);
                    crate::ui::focus("agent-name");
                },
                "Write a new agent"
            }
            if projection.is_empty() {
                Skeleton { lines: 3, label: "Reading the agent roster" }
            } else if has_rows(&projection, "agent-card") {
                // A LIST OF CARDS IS A DECK (R7-6b). Each card stood at the
                // panel's full 1136px round a 544px text column — 592px of
                // dead space apiece, down a page as long as the roster. One
                // reading column per card, as many across as the stage fits.
                div {
                    class: "card-deck",
                    // A CATALOGUE YOU CAN ACT ON (R15-P1-9). Six cards and no
                    // way to do anything with any of them: to talk to the agent
                    // you had just read about you went to the nav, opened Chat,
                    // and found the strip. Each card's own two doors now, and
                    // both are the existing route — the hash IS the view and
                    // its subject, so this changes no state of its own.
                    onclick: move |e: Event<MouseData>| {
                        let Some((where_to, name)) = pressed(&e) else { return };
                        let to = match where_to.as_str() {
                            "task" => View::Dashboard,
                            _ => View::Chat,
                        };
                        crate::route::show(to, &name);
                    },
                    dangerous_inner_html: "{projection}",
                }
                p { class: "note", "This page is pointed at " strong { "{who}" } "." }
            } else {
                EmptyState {
                    title: "No agents are loaded",
                    // ONE SENTENCE (R8-EMPTY).
                    sentence: "This build ships with agents and none of them arrived, so \
                               write one here instead — it works straight away.",
                    Button {
                        variant: "secondary",
                        onclick: move |_| crate::ui::focus("agent-name"),
                        "Write an agent"
                    }
                }
            }
        }
    }
}
