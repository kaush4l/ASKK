//! `ToolTrace` — calls, args, results and errors (plan, "UI shape"; Python
//! counterpart `core/tools.py`). It owns nothing but the fetch: the content is
//! the core's own projection of the `ToolInvoked` facts in the event log (I8),
//! so a reload redraws the same trace from the replayed log.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;

use dioxus::core::spawn_forever;

use crate::ui::{has_rows, Button, Card, Disclosure, EmptyState, Skeleton};
use crate::views::View;

/// A trace with no rows is not a broken pane, and it is not "no data" either:
/// it is a conversation in which nothing has yet needed a tool. Its own fn so
/// `ToolTrace` stays one job (I12).
///
/// NO ACTION (R15-P1-8). It carried `Open Chat` — in the right rail OF the Chat
/// view, while the Chat view was open — one of three primary buttons in the
/// product standing above the control they duplicate. An empty state teaches;
/// it does not need a door to the screen you are already on.
fn nothing_called(who: &str) -> Element {
    rsx! {
        EmptyState {
            // WHOSE TRACE THIS IS (R15-P1-3). "No tool has run yet" sat one
            // line above "Show the app's own activity (3 calls by the file
            // panes)" — the same card denying and reporting the same thing.
            // Both are true and they are about different actors, so the
            // headline says which actor it is about.
            title: "{who} has not used a tool yet",
            // ONE SENTENCE (R8-EMPTY); "What the tool trace holds" is below it
            // and held every word this used to repeat.
            // The shell is NOT an example any more: it has one home and that
            // home is Commands (R15-P1-4).
            sentence: "Tools are how {who} does things rather than only says them — reads a \
                       file, remembers a fact, starts a process — and every call lands here.",
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
    /// Where the shell's own rows live (R15-P1-4): the door below routes to
    /// Commands, which is the one home of every `exec` in the log.
    view: Signal<View>,
) -> Element {
    let mut trace = use_signal(String::new);
    // THE APP'S OWN ACTIVITY IS OFF (R7-1). The file panes list a folder on
    // mount and re-list it on every status change, and those calls outnumbered
    // the agent's 70 to 20 in a log titled with the agent's name. The core
    // filters them; this is the switch, and `x-app-calls` is how many it is
    // leaving out, so the pane can say the number rather than hide it.
    let mut show_app = use_signal(|| false);
    let app_calls = use_signal(|| 0usize);
    // …AND HOW MANY WENT TO COMMANDS (R15-P1-4). Not a toggle: those rows have
    // a home, and this is a door to it rather than a second copy of them.
    let shell_calls = use_signal(|| 0usize);
    // Re-projected whenever a turn moves; the pane holds no state of its own.
    use_effect(move || {
        let _ = (tick(), show_app());
        let Some(app) = web.read().clone() else { return };
        let mut req = Request::get("/tools").with_header("x-agent", &agent());
        if show_app() {
            req = req.with_header("x-app-activity", "1");
        }
        let res = app.handle(req);
        let count = |name: &str| {
            res.headers
                .iter()
                .find(|(k, _)| k == name)
                .and_then(|(_, v)| v.parse::<usize>().ok())
                .unwrap_or(0)
        };
        for (mut signal, now) in
            [(app_calls, count("x-app-calls")), (shell_calls, count("x-shell-calls"))]
        {
            if *signal.peek() != now {
                signal.set(now);
            }
        }
        let next = res.body;
        if *trace.peek() == next {
            return;
        }
        trace.set(next);
        // AT THE NEWEST CALL (R4-12). The rail sat at `scrollTop = 0` of a
        // 2363px scrollHeight while a chat message three inches away said the
        // agent was calling tools, so the panel showed the OLDEST call in the
        // log. Only on a CHANGE, and asking the last row to bring itself into
        // view, because which ancestor is the scrollport moves with the
        // breakpoint and with the view (the rail here, `.stage` on Trace) —
        // the same reason `route::newest_turn` does it this way.
        spawn_forever(async move {
            let _ = adapters_web::sleep(30).await;
            // `#tool-trace` is the CORE's own id on the list it renders
            // (`trace.rs`); this pane does not add a second one.
            crate::ui::show_last("#tool-trace > .tool-call:last-of-type");
        });
    });
    let projection = trace.read().clone();
    let who = agent();
    rsx! {
        // "Tool trace", not "Tools": the nav item that lands here says Tool
        // trace, and a destination that renames itself makes a person think
        // they mis-clicked (F6).
        // NAMED WITH ITS AGENT (R4-10). The heading read `TOOL TRACE` while
        // the side panel two lines above it said `SIDE PANEL · MAIN`: an
        // agent-scoped view titled as though it were the whole fleet's, next
        // to a panel that qualifies itself correctly.
        Card { title: "Tool trace · {who}", aria_label: "Tool trace for {who}",
            if projection.is_empty() {
                Skeleton { lines: 2, label: "Reading the tool trace" }
            } else if has_rows(&projection, "tool-call") {
                div { dangerous_inner_html: "{projection}" }
            } else {
                {nothing_called(&who)}
            }
            // THE OTHER QUESTION, and it is not the one this card is titled
            // with. Off by default; the count is said either way, so nothing
            // is hidden silently.
            if app_calls() > 0 {
                Button {
                    variant: "ghost",
                    "aria-pressed": if show_app() { "true" } else { "false" },
                    onclick: move |_| {
                        let now = show_app.peek().to_owned();
                        show_app.set(!now);
                    },
                    if show_app() {
                        "Hide what this page did on its own ({app_calls} calls)"
                    } else {
                        "Show what this page did on its own ({app_calls} calls)"
                    }
                }
            }
            // WHERE THE SHELL WENT (R15-P1-4). Commands and this pane used to
            // render every `exec` twice, verbatim, while Commands claimed in
            // prose that they were only in one of the two. They are in Commands
            // now, and this is the door, with the number it is leaving out.
            // …AND THE DOOR IS ON ITS OWN LINE (R18-P2). Dropped inline at the
            // end of the sentence, `Open Commands` butted against `they
            // printed.` wherever the paragraph happened to wrap. `.follow-up`
            // is the shape this product already uses for a sentence and the
            // control that answers it (R5-misc) — no new class, no new rule.
            if shell_calls() > 0 {
                div { class: "follow-up",
                    p { class: "note",
                        if shell_calls() == 1 {
                            "One shell command ran too. Shell commands are in Commands, with \
                             what they printed."
                        } else {
                            "{shell_calls} shell commands ran too. Shell commands are in \
                             Commands, with what they printed."
                        }
                    }
                    Button {
                        variant: "ghost",
                        onclick: move |_| {
                            let mut view = view;
                            view.set(View::Workspace);
                        },
                        "Open Commands"
                    }
                }
            }
            // Four lines of explanation in front of "No tool has been called
            // yet." is the footnote outnumbering the signal 4:1 (12b walk,
            // finding D2). Behind the disclosure, word for word.
            // NOT OVER AN EMPTY TRACE (R11-AESTHETIC): `nothing_called` already
            // says what would put a row here.
            if has_rows(&projection, "tool-call") {
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
    }
}
