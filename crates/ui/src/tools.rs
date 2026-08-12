//! `ToolTrace` — calls, args, results and errors (plan, "UI shape"; Python
//! counterpart `core/tools.py`). It owns nothing but the fetch: the content is
//! the core's own projection of the `ToolInvoked` facts in the event log (I8),
//! so a reload redraws the same trace from the replayed log.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;

use crate::ui::{focus, has_rows, Button, Card, Disclosure, EmptyState, Skeleton, COMPOSER_ID};

/// A trace with no rows is not a broken pane, and it is not "no data" either:
/// it is a conversation in which nothing has yet needed a tool. Its own fn so
/// `ToolTrace` stays one job (I12).
fn nothing_called(who: &str) -> Element {
    rsx! {
        EmptyState {
            glyph: "⚙",
            title: "No tool has run yet",
            sentence: "Tools are how {who} does things rather than only says them — read a \
                       file, run a command, remember a fact. Every call it makes lands here \
                       with the arguments it wrote and what came back, including the calls \
                       that were refused. A tool runs when a turn needs one.",
            Button {
                variant: "secondary",
                onclick: move |_| focus(COMPOSER_ID),
                "Ask {who} something"
            }
        }
    }
}

#[component]
pub fn ToolTrace(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    /// WHOSE calls (09 walk, finding 5): the pane was global, so the
    /// summarizer's tab showed five tool calls it never made.
    agent: ReadSignal<String>,
) -> Element {
    let mut trace = use_signal(String::new);
    // Re-projected whenever a turn moves; the pane holds no state of its own.
    use_effect(move || {
        let _ = tick();
        if let Some(app) = web.read().clone() {
            trace.set(
                app.handle(Request::get("/tools").with_header("x-agent", &agent()))
                    .body,
            );
        }
    });
    let projection = trace.read().clone();
    let who = agent();
    rsx! {
        Card { title: "Tools", aria_label: "Tool trace",
            if projection.is_empty() {
                Skeleton { lines: 2, label: "Reading the tool trace" }
            } else if has_rows(&projection, "tool-call") {
                div { dangerous_inner_html: "{projection}" }
            } else {
                {nothing_called(&who)}
            }
            // Four lines of explanation in front of "No tool has been called
            // yet." is the footnote outnumbering the signal 4:1 (12b walk,
            // finding D2). Behind the disclosure, word for word.
            Disclosure { summary: "What the tool trace holds",
                p { class: "note",
                    // Not "this session": the trace is a projection of the
                    // persisted log, so it survives a reload. Saying less than
                    // that undersold it (`ux-walker`, increment 05).
                    "Every tool call in this conversation's history, with the arguments \
                     the agent wrote and what came back — including calls that were \
                     refused. It is read back from the stored log, so it is still here \
                     after a reload."
                }
            }
        }
    }
}
