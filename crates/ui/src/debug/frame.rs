//! THE FRAME AROUND THE PROJECTION — the three things the pane says in its own
//! voice, rather than the core's. `mod.rs` beside it owns the fetch and the
//! shape; each of these is a separate thing to say and none of them is a row.

use dioxus::prelude::*;

use crate::ui::{Badge, Disclosure, EmptyState};

/// STORAGE IS FAILING, ABOVE EVERYTHING. NOT A COLOUR (DESIGN.md §8): the alarm
/// is a WORD, `role="alert"` so it is announced and not merely painted, and the
/// sentence explaining it is the core's own, immediately below.
#[component]
pub(crate) fn Alarm(failed: usize) -> Element {
    if failed == 0 {
        return rsx! {};
    }
    rsx! {
        p { class: "debug-alarm", role: "alert",
            Badge { status: "failed", label: "not being saved" }
        }
    }
}

/// WHICH LOG THIS IS (I16). A sub-agent runs its turn in its own Worker, so its
/// route, its stages and its model calls are recorded there and not here. Said,
/// rather than left to be inferred from a turn that appears to have cost nothing.
#[component]
pub(crate) fn WhoseLog(who: String, own: bool) -> Element {
    if own {
        return rsx! {};
    }
    rsx! {
        p { class: "note",
            "{who} runs its turns in its own Worker, so its decisions and model calls are \
             recorded in that Worker's log and not this one. What is below is what came back."
        }
    }
}

/// A debug pane with nothing in it is not a broken pane and it is not "no
/// data": it is a conversation in which nothing has been asked yet, so there is
/// no decision to explain and no cost to account for.
#[component]
pub(crate) fn NothingYet(who: String) -> Element {
    rsx! {
        EmptyState {
            title: "{who} has not taken a turn yet",
            sentence: "Every turn records which loop it chose and why, what each model call \
                       cost, and what {who} said in the rounds where it called a tool instead \
                       of answering — this is the one place those are read back.",
        }
    }
}

/// WHERE EVERY LINE ON THIS PANE COMES FROM. Nothing here is measured for the
/// pane; the whole of it was already in the log with no reader.
#[component]
pub(crate) fn WhatThisReads() -> Element {
    rsx! {
        Disclosure { summary: "What this pane reads",
            p { class: "note",
                "Every line is a fact the harness already writes to the event log and, until \
                 now, nothing read back. The route and the clause behind it come from the vote \
                 each turn opens with; the stage list is the ROUTE's own and not the list the \
                 agent file declares, because the vote replaces it. The cost and the document \
                 hash come from each model call — two rounds carrying the same hash were sent \
                 the same prompt, which is a loop and not progress. The block under a round is \
                 what the model wrote when it decided to call a tool, which the conversation \
                 deliberately does not draw; a round with no block under it answered in prose, \
                 and prose is what Chat shows. A failed storage write means this browser \
                 refused to save the conversation."
            }
        }
    }
}
