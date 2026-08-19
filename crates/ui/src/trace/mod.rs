//! `ToolTrace` — calls, args, results and errors. It owns nothing but the
//! fetch: the content is the core's own projection of the `ToolInvoked` facts
//! in the event log (I8), so a reload redraws the same trace from the replayed
//! log.
//!
//! ITS MIRROR IS `core::trace`, NOT `core::tools`. For every pane P, `core/P`
//! serves the fragment and `ui/P` mounts it — and this pane was called `tools`
//! for long enough to point a reader at the tool EXECUTOR, which is a different
//! file doing a different job. What runs a call and what shows one are not the
//! same subject, so they no longer share a name.

pub(crate) mod omitted;

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;

use dioxus::core::spawn_forever;

use crate::shell::views::View;
use crate::ui::{has_rows, Card, EmptyState, Skeleton};
use omitted::{AppActivityToggle, ShellCallsDoor, WhatTheTraceHolds};

/// A trace with no rows is not a broken pane, and it is not "no data" either:
/// it is a conversation in which nothing has yet needed a tool.
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

/// Bring the NEWEST call into view (R4-12). The rail sat at `scrollTop = 0` of
/// a 2363px scrollHeight while a chat message three inches away said the agent
/// was calling tools, so the panel showed the OLDEST call in the log. Only on a
/// CHANGE, and asking the last row to bring itself into view, because which
/// ancestor is the scrollport moves with the breakpoint and with the view (the
/// rail here, `.stage` on Trace) — the same reason `route::newest_turn` does it
/// this way.
fn to_newest_call() {
    spawn_forever(async move {
        let _ = adapters_web::sleep(30).await;
        // `#tool-trace` is the CORE's own id on the list it renders
        // (`core::trace`); this pane does not add a second one.
        crate::ui::show_last("#tool-trace > .tool-call:last-of-type");
    });
}

/// Re-projected whenever a turn moves; the pane holds no state of its own.
///
/// `x-app-calls` and `x-shell-calls` ride the same response: how many rows the
/// core left out, so the card can say the number rather than hide it.
fn reproject(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    agent: ReadSignal<String>,
    mut trace: Signal<String>,
    show_app: Signal<bool>,
    app_calls: Signal<usize>,
    shell_calls: Signal<usize>,
) {
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
        to_newest_call();
    });
}

/// The list itself, in its three states: not read yet, rows, and a
/// conversation that has needed no tool.
#[component]
fn TraceRows(projection: String, who: String) -> Element {
    rsx! {
        if projection.is_empty() {
            Skeleton { lines: 2, label: "Reading the tool trace" }
        } else if has_rows(&projection, "tool-call") {
            div { dangerous_inner_html: "{projection}" }
        } else {
            {nothing_called(&who)}
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
    let trace = use_signal(String::new);
    // THE APP'S OWN ACTIVITY IS OFF (R7-1). The file panes list a folder on
    // mount and re-list it on every status change, and those calls outnumbered
    // the agent's 70 to 20 in a log titled with the agent's name. The core
    // filters them; the toggle below is the switch.
    let show_app = use_signal(|| false);
    let app_calls = use_signal(|| 0usize);
    // …AND HOW MANY WENT TO COMMANDS (R15-P1-4). Not a toggle: those rows have
    // a home, and this is a door to it rather than a second copy of them.
    let shell_calls = use_signal(|| 0usize);
    reproject(web, tick, agent, trace, show_app, app_calls, shell_calls);
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
            TraceRows { projection: projection.clone(), who: who.clone() }
            AppActivityToggle { show_app, app_calls: app_calls() }
            ShellCallsDoor { shell_calls: shell_calls(), view }
            WhatTheTraceHolds { who: who.clone(), rows: has_rows(&projection, "tool-call") }
        }
    }
}
