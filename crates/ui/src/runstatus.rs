//! WHAT HAPPENED TO THE TASK YOU LAUNCHED (R2-2).
//!
//! The Dashboard's confirmation was a static string: `main is on it: "…"`,
//! written once at the press and never touched again, while forty pixels right
//! the board read `main · failed`. Two projections of one run disagreeing, and
//! the one a person had just been handed could never change.
//!
//! There is no second source of truth here. This reads the SAME `/board`
//! projection the board renders, for the one agent the launch was addressed to.
//! Reading `data-status` is the one-bit read of a rendered attribute that
//! `ui::has_rows` and `terminal::commands_in` already do.

use dioxus::prelude::*;

use crate::boardcell::at;
// The reads themselves moved next door; six callers name them here, so they
// are re-exported rather than renamed across six files for one line count.
pub(crate) use crate::boardcell::{cell, live, progress, since};
use crate::recover::Recovery;
use crate::ui::Button;
use crate::views::View;

/// The confirmation, for as long as it is true, and then the ending.
#[component]
pub fn LaunchedRun(
    /// The `/board` projection, read ONCE by the card around this (R6-6): the
    /// card has to know the same answer to decide whether to show a composer,
    /// and two reads of one fold is how the card and its own confirmation came
    /// to disagree.
    board: String,
    /// The agent the task was handed to — NOT whoever is selected now.
    who: String,
    task: String,
    /// The timestamp of its status at the moment of the press. Nothing this
    /// run did can be read off the board until that number moves.
    baseline: u64,
    view: Signal<View>,
    /// Send it again. The same closure the Run button calls, so a retry is the
    /// one launch path and not a second one.
    on_retry: EventHandler<String>,
) -> Element {
    let projection = board;
    let status = cell(&projection, &who, "data-status").unwrap_or_default();
    let moved = at(&projection, &who) > baseline;
    let ended = !matches!(status.as_str(), "working" | "starting");
    let open_chat = move |_| {
        let mut view = view;
        view.set(View::Chat);
    };
    if moved && status == "failed" {
        return rsx! {
            // ONE NAME FOR ONE EVENT (R8-8). This said "could not finish" while
            // the board row said `failed` and the header said "last turn
            // failed": three wordings of one fact on one screen. The row's word
            // is the one the projection writes, so it is the one that stays.
            p { class: "error", role: "status",
                "{who}'s turn failed: {crate::ui::quoted(&task)} The conversation says why."
            }
            // …AND A DOOR TO IT (R8-13). The copy named the conversation and
            // offered everything except the way there.
            Recovery {
                view, chat: true, last: task.clone(),
                on_retry: move |t: String| on_retry.call(t),
            }
        };
    }
    // A RUN THE RELOAD KILLED IS NOT A RUN THAT FINISHED (R9-1). This card read
    // `main finished “Run 'sleep 90'…” / Read the reply` while the board forty
    // pixels below said `main stopped mid-turn · 7 turns — the page was
    // reloaded…`, and the button landed on a transcript ending in that same
    // note. The board's copy was right; the card was reading only the row's
    // STATUS word, which a reload leaves at `Idle`, truthfully and uselessly.
    // The row now says so on itself, and the card renders the row's own
    // sentence — one wording, not a second derivation of it (R8-8).
    // …AND NEITHER IS A RUN THAT ABANDONED ITS TASK (R17-P0-2). A critic gave
    // `main` a six-part task and came back to `main finished "…"` and `Read the
    // reply`, over a turn that never wrote the file it was asked for and whose
    // last message was a raw malformed tool call. `data-ending` is the row's own
    // answer to how that turn ended, off the one fold (`core::ending`), and it
    // is empty exactly when there IS a reply to read. The two cases share this
    // branch because the honest card is the same in both: the row's sentence,
    // and the two acts that are true — ask again, or go and look.
    let stranded = !cell(&projection, &who, "data-ending").unwrap_or_default().is_empty();
    let reloaded = cell(&projection, &who, "data-orphaned").as_deref() == Some("1");
    if moved && ended && (stranded || reloaded) {
        let said = cell(&projection, &who, "data-line").unwrap_or_default();
        return rsx! {
            div { class: "follow-up",
                p { class: "pending", role: "status", "{who} {said}" }
                // NOT "Read the reply": there is no reply. The acts the board's
                // own copy names are the ones on the buttons.
                Button {
                    variant: "secondary",
                    onclick: move |_| on_retry.call(task.clone()),
                    "Ask again"
                }
                Button {
                    variant: "secondary",
                    onclick: move |_| {
                        let mut view = view;
                        view.set(View::Trace);
                    },
                    "Open the tool trace"
                }
            }
        };
    }
    if moved && ended {
        // …AND A TURN THAT ENDED WELL CAN STILL HOLD A FAILED CALL (R9-3). The
        // clause is the board row's (`failed::note`), carried on the row rather
        // than re-derived here, so the card, the row and the conversation say
        // one thing about one turn. It does NOT judge the answer — this page
        // cannot know whether the answer is wrong, only that a call failed.
        let hurt = cell(&projection, &who, "data-failed-note").unwrap_or_default();
        // …AND "FINISHED" WAS A VERDICT THIS PAGE CANNOT REACH (R18-P1-5). A
        // task asked for a headline written to `artifacts/news.md`; the agent
        // refused it for want of a browser, no file appeared, and this card
        // said `main finished "…"`. `Answered` was the true ending — answered
        // is just not did-what-you-asked. So it says what the turn DID, and
        // `data-tools-ran` says whether anything ran while it did.
        let ran_nothing = cell(&projection, &who, "data-tools-ran").as_deref() == Some("0");
        return rsx! {
            div { class: "follow-up",
                p { class: "pending", role: "status", "{who} answered {crate::ui::quoted(&task)}" }
                if ran_nothing {
                    p { class: "warn", role: "status",
                        "It called no tool while it did, so nothing was run, fetched or \
                         written — the reply is the whole of what that turn produced."
                    }
                }
                if !hurt.is_empty() {
                    p { class: "warn", role: "status", "…and {hurt}" }
                }
                Button { variant: "secondary", onclick: open_chat, "Read the reply" }
                if !hurt.is_empty() {
                    Button {
                        variant: "secondary",
                        onclick: move |_| {
                            let mut view = view;
                            view.set(View::Trace);
                        },
                        "Open the tool trace"
                    }
                }
            }
        };
    }
    // STILL GOING — the state that REPLACES the form (R6-6), ONCE PER SCREEN
    // (R17-P2): the board row below prints `data-line`; this card no longer.
    rsx! {
        div { class: "follow-up",
            p { class: "pending", role: "status", "{who} is on it: {crate::ui::quoted(&task)}" }
            Button { variant: "secondary", onclick: open_chat, "Watch it" }
        }
    }
}
