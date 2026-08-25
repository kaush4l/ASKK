//! WHAT THE TRACE IS LEAVING OUT, and where those calls went.
//!
//! Three things sit under the list of calls, and all three are about rows that
//! are NOT in it: the page's own file-listing calls, which are off by default;
//! the shell commands, which are rendered in Commands and not here; and the
//! sentence saying what the list is a list of. The pane above owns the calls
//! the agent made; this owns the account of the rest.

use dioxus::prelude::*;

use crate::ui::{Button, Disclosure};
use crate::shell::views::View;

/// THE OTHER QUESTION, and it is not the one the card is titled with. Off by
/// default; the count is said either way, so nothing is hidden silently.
#[component]
pub(crate) fn AppActivityToggle(mut show_app: Signal<bool>, app_calls: usize) -> Element {
    if app_calls == 0 {
        return rsx! {};
    }
    // One label with the verb in it, not two sentences that must be kept in
    // step: the count is the same fact either way round.
    let verb = match show_app() {
        true => "Hide",
        false => "Show",
    };
    rsx! {
        Button {
            variant: "ghost",
            "aria-pressed": if show_app() { "true" } else { "false" },
            onclick: move |_| {
                let now = show_app.peek().to_owned();
                show_app.set(!now);
            },
            "{verb} what this page did on its own ({app_calls} calls)"
        }
    }
}

/// WHERE THE SHELL WENT (R15-P1-4). Commands and this pane used to render every
/// `exec` twice, verbatim, while Commands claimed in prose that they were only
/// in one of the two. They are in Commands now, and this is the door, with the
/// number it is leaving out.
///
/// …AND THE DOOR IS ON ITS OWN LINE (R18-P2). Dropped inline at the end of the
/// sentence, `Open Commands` butted against `they printed.` wherever the
/// paragraph happened to wrap. `.follow-up` is the shape this product already
/// uses for a sentence and the control that answers it (R5-misc) — no new
/// class, no new rule.
#[component]
pub(crate) fn ShellCallsDoor(shell_calls: usize, view: Signal<View>) -> Element {
    if shell_calls == 0 {
        return rsx! {};
    }
    let ran = match shell_calls {
        1 => "One shell command".to_string(),
        n => format!("{n} shell commands"),
    };
    rsx! {
        div { class: "follow-up",
            p { class: "note",
                "{ran} ran too. Shell commands are in Commands, with what they printed."
            }
            Button {
                variant: "ghost",
                onclick: move |_| {
                    let mut view = view;
                    view.set(View::Work);
                },
                "Open Commands"
            }
        }
    }
}

/// Four lines of explanation in front of "No tool has been called yet." is the
/// footnote outnumbering the signal 4:1 (12b walk, finding D2). Behind the
/// disclosure, word for word.
///
/// NOT OVER AN EMPTY TRACE (R11-AESTHETIC): `nothing_called` already says what
/// would put a row here, so `rows` keeps this off an empty one.
#[component]
pub(crate) fn WhatTheTraceHolds(who: String, rows: bool) -> Element {
    if !rows {
        return rsx! {};
    }
    rsx! {
        Disclosure { summary: "What the tool trace holds",
            p { class: "note",
                // Not "this session": the trace is a projection of the
                // persisted log, so it survives a reload. Saying less than
                // that undersold it (`ux-walker`, increment 05).
                "Every tool call {who} made in this conversation's history, with the \
                 arguments it wrote and what came back — including calls that were \
                 refused. It is read back from the stored log, so it is still here \
                 after a reload. The Files and Processes panels call the same tools \
                 to list a folder or check a process for you; those calls are this \
                 page's, not the agent's, and the button above shows them."
            }
        }
    }
}
