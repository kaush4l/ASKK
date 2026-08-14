//! WHAT THE SHARED-SPACE CARD SAYS WHEN THERE IS NOTHING IN IT.
//!
//! Split from `space.rs` — which owns the fetch, the clock and the card — for
//! the 200-line rule (I12), and because R6-15 turned one empty state into
//! three: a space that exists and holds nothing, an agent that is in no space
//! at all, and an agent whose space is not the one this page reads. All three
//! are now the SAME grammar (headline → one sentence → one action), which is
//! the finding, and keeping them side by side in one file is what stops the
//! next one drifting back to a bare sentence.

use dioxus::prelude::*;

use adapters_web::sleep;
use dioxus::core::spawn_forever;

use crate::ui::{focus, Button, EmptyState, COMPOSER_ID};
use crate::views::View;

/// ONE GRAMMAR FOR THIS CARD'S NOTHINGS (R6-15).
///
/// `SHARED SPACE · MAIN` got a headline and a paragraph; `SHARED SPACE ·
/// SUMMARIZER` got a bare sentence with neither, because that sentence
/// comes from the core's projection and the card rendered it raw. Same card,
/// two grammars, one screen apart. This is the fuller one, wrapped around the
/// core's own words — the sentence is not rewritten here, it is placed, so
/// there is still exactly one wording of "this agent is in no shared space".
pub(crate) fn not_in_a_space(who: &str, projection: &str, alone: bool, view: Signal<View>) -> Element {
    let title = match alone {
        true => format!("{who} is in no space"),
        false => format!("{who}'s space is not the one this page reads"),
    };
    rsx! {
        EmptyState { title,
            div { dangerous_inner_html: "{projection}" }
            // WHERE THE FIX IS — AND IT ARRIVES OPEN (R7-8). This landed on
            // the Agents view scrolled to the top with an EMPTY editor and
            // nothing loaded: an instruction the product would not carry out.
            // The editor now loads the agent the page is pointed at when it
            // mounts (`authoring::AgentEditor`), which is this agent, because
            // the hash carries the subject (R6-3) — so routing here IS opening
            // the file, and the focus lands in the file rather than beside it.
            Button {
                variant: "secondary",
                onclick: move |_| {
                    let mut view = view;
                    view.set(View::Agents);
                    spawn_forever(async move {
                        let _ = sleep(60).await;
                        focus("agent-md");
                    });
                },
                // ONE NAME FOR ONE DESTINATION (R15-P0-2). The sentence above
                // this button now names the panel by its visible title, and a
                // button landing there under a different name is the same
                // wrong-turn this fix is about.
                "Open Write an agent"
            }
        }
    }
}

/// A space that exists and holds nothing. Its own fn so `SpaceInspector`
/// stays one job (I12).
pub(crate) fn nothing_shared(_who: &str, view: Signal<View>) -> Element {
    rsx! {
        EmptyState {
            title: "Nothing has been recorded here yet",
            // ONE NAME for this concept, everywhere (F6): the shared space is
            // what the core, the agent files (`space:`) and the tools call it.
            //
            // A CONDITION, NOT A PROPHECY (R4-14). It used to promise the space
            // "fills up once {who} has run a task" — a critic ran one, the board
            // read `main ready · 11 turns`, and this pane was still empty and
            // still saying it. An agent writes here when it CALLS a tool that
            // writes here, which many tasks never do.
            //
            // ONE SENTENCE (R8-EMPTY). It was sixty words, and the disclosure
            // four lines below — "How the shared space is read and written" —
            // said the same thing again, in the place with the least to say.
            // Whose it is, what writes to it and when are all down there.
            sentence: "Only the remember, forget and post_note tools write here, and no agent \
                       has called one. Files an agent writes are not here — they go to \
                       its folder, which Commands lists.",
            // It has to GO somewhere (F3). This button was the only action in
            // the empty state and it moved nothing — not the route, not even
            // focus — because the composer it aimed at lives in the Chat pane,
            // which is `hidden` from every other view, and `focus()` on a
            // hidden element lands nowhere. So: route first, then focus, one
            // frame later, once the region it is in is on screen.
            Button {
                variant: "secondary",
                onclick: move |_| {
                    let mut view = view;
                    view.set(View::Chat);
                    // `spawn_forever`, not `spawn`: the route change UNMOUNTS
                    // this pane, and a task owned by a dropped scope is
                    // cancelled with it — so the plain spawn routed correctly
                    // and then never focused anything, which is the same
                    // half-dead button one line further on.
                    spawn_forever(async move {
                        let _ = sleep(30).await;
                        focus(COMPOSER_ID);
                    });
                },
                // ONE LABEL, ONE BEHAVIOUR (R5-3). This said `Start agent`,
                // which is what the Dashboard's primary says — and that one
                // starts a run while this one changes the route. A critic
                // pressed this by mistake inside the first minute and
                // distrusted every button on the page afterwards. R4-18 was
                // right that one intent needs one name; the intent here is
                // GOING somewhere, so the name is where it goes.
                "Open Chat"
            }
        }
    }
}

