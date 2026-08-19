//! A SUB-AGENT'S trace, and the clock every row reads. `pane.rs` owns this
//! page's own agent's calls; these are records of a different kind — not
//! `ToolInvoked` facts this loop appended, but what another agent's Worker
//! REPORTED across `postMessage`.

use kernel::{EventKind, Response};
use module::view::FragmentBuilder;

use crate::dispatch::{html, Ctx};
use crate::trace::row::row;

/// The injected timestamp of the `nth` fact in `recent` (I7), or 0 for a log
/// old enough to predate the parallel list.
pub(crate) fn at(ctx: &Ctx, nth: usize) -> i64 {
    ctx.at.get(nth).copied().unwrap_or_default()
}

/// A sub-agent's calls, as its own Worker REPORTED them. Its own fn because it
/// is a different record from the one `pane::trace` reads: not
/// `ToolInvoked` facts in this log but `core.agent_activity`, adopted through
/// one door (`told`). This branch used to show nothing at all.
pub(crate) fn reported(ctx: &Ctx, who: &str) -> Response {
    let mut list = FragmentBuilder::new("div").id("tool-trace").attr("data-agent", who);
    let (mut calls, mut shell) = (0usize, 0usize);
    for (nth, kind) in ctx.recent.iter().enumerate() {
        let EventKind::Custom { kind, payload_json } = kind else { continue };
        if kind != crate::failure::from_worker::AGENT_ACTIVITY {
            continue;
        }
        let Some((agent, value)) = crate::failure::from_worker::activity(payload_json) else { continue };
        let Some(tool) = value.get("tool").and_then(|t| t.as_str()) else { continue };
        if agent != who {
            continue;
        }
        // Its shell is in Commands too (`terminal::row_selection::reported`, R15-P1-4).
        if crate::trace::pane::is_shell(tool) {
            shell += 1;
            continue;
        }
        let args = value.get("args").and_then(|a| a.as_str()).unwrap_or("{}");
        let ok = value.get("ok").and_then(serde_json::Value::as_bool).unwrap_or(false);
        let output = value.get("output").and_then(|o| o.as_str()).unwrap_or_default();
        // A person cannot type into another agent's workspace: these are the
        // agent's, always. The TIME is this page's own — the Worker's report
        // carries no clock, so the log holds when the report was adopted.
        // A Worker's report carries no clock of its own, so the log holds when
        // the report was ADOPTED — an ending, like every other unrequested call.
        list = list.child(row(tool, args, ok, output, who, at(ctx, nth), None, false));
        calls += 1;
    }
    if calls == 0 {
        let said = format!(
            "{who} has not called a tool yet. When it does, it reports each call and they \
             appear here — the same trace this page keeps for {}.",
            ctx.me
        );
        list = list.child(FragmentBuilder::new("p").class("pending").text(&said).build());
    }
    let mut response =
        html(200, list.attr("data-calls", &calls.to_string()).build().into_html());
    response.headers.push(("x-shell-calls".into(), shell.to_string()));
    response
}
