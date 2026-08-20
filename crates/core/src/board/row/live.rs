//! THE SECOND LINE OF A ROW: what is happening inside the turn right now, or
//! what the turn that just ended left to do about it. Separate from the row's
//! first line because that one is a standing description of the agent and this
//! one is a report on one turn — and because the clock, which both the words
//! and `data-elapsed` are, is read here and nowhere else (R6-7).

use agent::AgentRow;

use crate::dispatch::Ctx;
use crate::failure::ending::Ending;

/// The row inside a turn is the one worth looking at, so it says more (12 walk,
/// "give the live row priority"). A TURN THAT ENDED WELL CAN STILL HOLD A
/// FAILED CALL (R9-3): `ready · 1 turn` was the whole row over a trace whose
/// first line was red, so the failure clause — `failure::within_turn::clause`'s words,
/// written once there — rides along whatever else this line says.
///
/// AND THE ERRAND LEADS (T4). The line reported that a turn was running, for how
/// long, and what it last called, and never once said what the turn was FOR —
/// so a delegated run was a status word and a clock. `board::errand` is the
/// fold; it goes first because "what was it asked to do" is the question a
/// person arrives at this row with, and the rest of the line answers "how is
/// that going".
pub(super) fn second_line(
    agent: &AgentRow,
    ctx: &Ctx,
    orphaned: bool,
    ending: Option<Ending>,
    hurt: &Option<String>,
) -> Option<String> {
    let busy = agent.status.is_busy();
    let rest = match (busy, orphaned) {
        (true, _) => live_line(agent, ctx),
        // The same sentence Chat gives it, short enough for a row — and not an
        // `.error`: nothing failed, the page was reloaded.
        (false, true) => Some(
            "the page was reloaded while that turn was in flight, so nothing is \
             driving it — ask again"
                .into(),
        ),
        // …and an ending with something to do about it says so, in the words
        // `failure/ending.rs` writes once for this row and the card both.
        (false, false) => ending.and_then(Ending::line),
    };
    let errand = crate::board::errand::clause(ctx, &agent.name, busy);
    let parts: Vec<String> = [errand, rest, hurt.clone()].into_iter().flatten().collect();
    match parts.is_empty() {
        true => None,
        false => Some(parts.join(" · ")),
    }
}

/// How long this agent has been in its current status, in seconds — `None` when
/// this process has no clock. Words and `data-elapsed` are both this (R6-7).
pub(super) fn elapsed(agent: &AgentRow, ctx: &Ctx) -> Option<i64> {
    Some(ctx.clock?.0.saturating_sub(agent.since.0) / 1000)
}

/// WHICH PART OF THE TURN is running, how long it has been, and what it last
/// called — in that reading order (28). All three are folds of the log: the
/// stage is `stage::said`, `since` is the status fact's timestamp, and the tool
/// is the last `ToolInvoked`, which this log holds only for its OWN agent.
fn live_line(agent: &AgentRow, ctx: &Ctx) -> Option<String> {
    let mut parts: Vec<String> = Vec::from_iter(crate::board::stage::said(ctx, &agent.name));
    if let Some(seconds) = elapsed(agent, ctx) {
        parts.push(format!("in this turn for {seconds}s"));
    }
    if agent.name == ctx.me {
        if let Some(tool) = crate::board::stage::last_tool(ctx) {
            parts.push(format!("last tool: {tool}"));
        }
    }
    match parts.is_empty() {
        true => None,
        false => Some(parts.join(" · ")),
    }
}
