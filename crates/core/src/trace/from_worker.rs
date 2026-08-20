//! A SUB-AGENT'S trace, and the clock every row reads. `pane.rs` owns this
//! page's own agent's calls; these are records of a different kind — not
//! `ToolInvoked` facts this loop appended, but what another agent's Worker
//! REPORTED across `postMessage`.
//!
//! END TO END, SINCE T4. This pane showed the middle of a delegated run and
//! neither end of it: the tool calls, but not the goal that started them, not
//! the answer they produced, and — when the run failed — not the reason. All
//! three are facts here now; the first two ride in the Worker's own report
//! (`log::store::activity_since`), the third is the caller's own
//! `core.agent_error`.

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
        if agent != who {
            continue;
        }
        // THE TWO ENDS OF THE RUN. They are not calls and are not counted as
        // any: a run whose whole report is "it was asked to X" still has to say
        // it has called no tool yet, or the count and the pane disagree.
        if let Some(said) = errand_line(&value) {
            list = list.child(FragmentBuilder::new("p").class("note").text(&said).build());
            continue;
        }
        let Some(tool) = value.get("tool").and_then(|t| t.as_str()) else { continue };
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
    // …AND WHY IT STOPPED, when it stopped badly. A failed delegation is the
    // run whose trace matters most, and this pane used to end at the last call
    // it managed to make. The words are `from_worker::told`'s — the same
    // sentence the board row carries — so one failure has one wording.
    if let Some(said) = failed_line(ctx, who) {
        list = list.child(FragmentBuilder::new("p").class("error").text(&said).build());
    }
    let mut response =
        html(200, list.attr("data-calls", &calls.to_string()).build().into_html());
    response.headers.push(("x-shell-calls".into(), shell.to_string()));
    response
}

/// THE GOAL OR THE ANSWER, out of one reported item. A Worker reports what it
/// DID as a list of small objects, one shape per kind of fact; these are the
/// two T4 added, and an item that is neither is not this function's business.
///
/// The words are the pane's, not the agent's: the report carries the text and
/// nothing else, and "was asked to" / "answered" is what makes a bare sentence
/// in a trace legible as one end of a run rather than as prose that appeared.
fn errand_line(value: &serde_json::Value) -> Option<String> {
    for (key, said) in [("goal", "was asked to"), ("answer", "answered")] {
        if let Some(text) = value.get(key).and_then(|t| t.as_str()) {
            return Some(format!("{said}: {text}"));
        }
    }
    None
}

/// WHY THIS AGENT'S LAST DELEGATED TURN FAILED, `None` if none did or if the
/// last one to fail was somebody else. This pane is the ONLY reader of
/// `failure::from_worker::last_delegated`, and deliberately so: a second
/// public reading of it existed for one round with nothing in the product
/// behind it, which made a test the only thing that could say the fold had
/// shipped. A person watching a delegated run opens this pane; the fold ends
/// here.
fn failed_line(ctx: &Ctx, who: &str) -> Option<String> {
    let (agent, message) = crate::failure::from_worker::last_delegated(ctx.recent.iter())?;
    match agent == who {
        true => Some(crate::failure::from_worker::told(&message, who)),
        false => None,
    }
}
