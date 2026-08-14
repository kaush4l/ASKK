//! WHAT THE WORKSPACE IS DOING RIGHT NOW (R11-1, R11-4).
//!
//! A tool call is one `ToolInvoked` fact — appended when it COMES BACK. For the
//! seven minutes in between there was nothing to project, so every pane
//! described a world in which nothing was happening: the trace said no tool had
//! run while `pulse.log` was being written by the call it was not showing, and
//! two panes queued behind that call said they were "being asked" for something
//! the workspace could not answer until it returned.
//!
//! So the in-flight call is held here, in memory, exactly as `App::running`
//! holds a typed command for the same reason and with the same honesty: a
//! reload really does abandon a call, and a replayed log must not claim one is
//! still running.

use kernel::Timestamp;
use module::view::{Fragment, FragmentBuilder};

/// One call that has been handed to the workspace and has not come back.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Inflight {
    pub tool: String,
    /// The JSON the tool was called with — the same string the trace renders
    /// for a finished call, so the running row and the resolved row read alike.
    pub args: String,
    /// When it started (injected, I7), so the age is a subtraction and not a
    /// counter some pane keeps for itself.
    pub at: i64,
}

/// How long this call has been going, in seconds. `None` when this process has
/// no clock — the one case nothing may guess at (`boardrow::elapsed`'s rule).
pub(crate) fn age(ctx: &crate::dispatch::Ctx, call: &Inflight) -> Option<i64> {
    Some(ctx.clock?.0.saturating_sub(call.at) / 1000)
}

/// The oldest call still outstanding — the one everything else is queued
/// behind, because the workspace runs one command at a time.
pub(crate) fn blocking(ctx: &crate::dispatch::Ctx) -> Option<&Inflight> {
    ctx.calling.first()
}

/// What a call is, in the words the trace already uses for a finished one.
pub(crate) fn said(call: &Inflight) -> String {
    crate::tracerow::traceargs::said_args(&call.tool, &call.args)
}

/// WHAT THIS AGENT IS ACTUALLY WAITING ON (R11-3). The Chat pane said `waiting
/// for the model — 240s` over a wire showing exactly one
/// `POST /v1/chat/completions → 200 (20ms)`: the model had answered four
/// minutes earlier and the app was inside a tool call. There are only two
/// things a turn can be outstanding on and the app knows which — a workspace
/// call in flight is a tool call, and nothing in flight means the model.
/// Empty for an agent that is not working, and for anyone but this process's
/// own — another agent's calls happen in its Worker and are not in this list.
/// An empty string is the UI's cue to say nothing rather than to guess.
pub(crate) fn doing(ctx: &crate::dispatch::Ctx, agent: &str, busy: bool) -> String {
    if agent != ctx.me || !busy {
        return String::new();
    }
    match blocking(ctx) {
        None => "waiting for the model".to_string(),
        Some(call) if call.tool == "exec" => "running a command in the Linux".to_string(),
        Some(call) => format!("running {} in the Linux", call.tool),
    }
}

/// WHOSE CALL THE WORKSPACE IS INSIDE (R15-P0-1). `asked::Asked` is the same
/// boundary the tool trace's "Show the app's own activity" toggle is built on:
/// a request the FILE PANE made for itself is not a gesture and not the agent's
/// work. Replayed exactly as `trace::trace` replays it, off the same queue, so
/// the pane and the trace cannot disagree about who a call belongs to.
fn by_the_pane(ctx: &crate::dispatch::Ctx, call: &Inflight) -> bool {
    let mut asked = crate::asked::Asked::default();
    for (nth, kind) in ctx.recent.iter().enumerate() {
        asked.enqueue(nth, kind);
        if let kernel::EventKind::ToolInvoked { tool, args, .. } = kind {
            let _ = asked.actor(&tool.0, args, &ctx.me);
        }
    }
    asked.actor(&call.tool, &call.args, &ctx.me).0 == crate::asked::PANE
}

/// WHY A PANE IS STILL EMPTY, when the reason is that something else is running
/// (R11-1a). The Files and Processes panes both ask the workspace a question
/// and both queue behind whatever it is already doing; each said "the workspace
/// is being asked…" for seven minutes about a request that had not been sent
/// and could not be answered. `None` when nothing is running, and then the
/// pane's own ordinary sentence is the true one.
///
/// …AND A PANE IS NOT QUEUED BEHIND ITSELF (R15-P0-1). Clicking Workspace cold
/// ran the Files pane's own mount-time `list_files` and then reported it here,
/// in both panes, as contention: a first-time user's first act produced a busy
/// machine and an instruction to go stop something. The pane's own listing is
/// the thing this pane is showing, not a command in its way, so it says the
/// ordinary "nothing listed yet" and waits — which is what the reader sees for
/// the third of a second it takes.
pub(crate) fn waiting_on(ctx: &crate::dispatch::Ctx) -> Option<String> {
    let call = blocking(ctx)?;
    if by_the_pane(ctx, call) {
        return None;
    }
    let what = said(call);
    // ONE FACT PER SENTENCE, and no instruction to find a pane that is already
    // on this view. Commands is the panel beside these two.
    Some(match age(ctx, call) {
        Some(seconds) => format!(
            "Linux is busy running {what} — {seconds}s so far. It runs one command at a \
             time; Commands, on this view, can stop it."
        ),
        None => format!(
            "Linux is busy running {what}. It runs one command at a time; Commands, on \
             this view, can stop it."
        ),
    })
}

/// A CALL THAT HAS NOT COME BACK (R11-4). The trace said "No tool has run yet"
/// for the seven minutes an `exec` spent inside one command — and went on saying
/// it after a reload had shown the file that call had written. An agent's most
/// interesting moment is the one it spends inside a call, and it was the one
/// moment this log had no row for.
///
/// The SAME row, with the outcome word a call gets before it has one and a
/// clock where the output will be. It resolves in place: the fact lands, the
/// in-flight entry goes, and the row above becomes the ordinary finished row —
/// one call, one line, whichever half of its life you are looking at.
pub(crate) fn running_row(call: &Inflight, seconds: Option<i64>, by: &str) -> Fragment {
    let waited = match seconds {
        Some(n) => format!("running for {n}s — nothing has come back yet."),
        None => "running — nothing has come back yet.".to_string(),
    };
    FragmentBuilder::new("div")
        .class("tool-call pending")
        .attr("role", "status")
        .attr("data-tool", &call.tool)
        .attr("data-outcome", "running")
        .attr("data-by", by)
        .attr("data-at", &call.at.to_string())
        .child(
            FragmentBuilder::new("p")
                .class("tool-args")
                .child(FragmentBuilder::new("time").class("tool-time").text(&agent::clock(Timestamp(call.at))).build())
                .child(FragmentBuilder::new("span").class("tool-by").text(&format!(" {by} ran")).build())
                .child(FragmentBuilder::new("span").text(&format!(" {}", said(call))).build())
                .child(FragmentBuilder::new("span").class("tool-outcome").text(" — running").build())
                .build(),
        )
        .child(FragmentBuilder::new("pre").text(&waited).build())
        .build()
}
