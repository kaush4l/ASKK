//! One row of the agent board: who, what it is doing, how long, and where it
//! came from. Split from `board.rs`, which owns the module and the route, so
//! both hold the 200-line rule (I12).

use agent::AgentRow;
use kernel::Status;
use module::view::{Fragment, FragmentBuilder};

use crate::dispatch::Ctx;

/// One agent's row. The status is a WORD, not only a colour: a row that
/// differs from its neighbour by hue alone says nothing with the stylesheet
/// off, and nothing at all to a screen reader.
pub(crate) fn row(agent: &AgentRow, ctx: &Ctx) -> Fragment {
    let authored = &ctx.authored;
    let turns = match agent.turns {
        1 => "1 turn".to_string(),
        n => format!("{n} turns"),
    };
    let origin = origin(agent, authored);
    let mut card = FragmentBuilder::new("div")
        .class(&format!("agent-row status-{}", agent.status.label()))
        .attr("data-agent", &agent.name)
        .attr("data-status", agent.status.label())
        .child(FragmentBuilder::new("h3").text(&agent.name).build())
        .child(
            FragmentBuilder::new("p")
                .class("agent-status")
                // The accessible name says which agent, so two agents in the
                // same status are not the same control to a screen reader.
                .attr("aria-label", &format!("{} is {}", agent.name, gloss(agent)))
                .text(&format!("{} — {turns}, {origin}", gloss(agent)))
                .build(),
        );
    // The row inside a turn is the one worth looking at, so it says more (12
    // walk, "give the live row priority"). Every other row stays exactly as
    // legible; it stops claiming the same weight as the one that is running.
    if agent.status.is_busy() {
        if let Some(live) = live_line(agent, ctx) {
            card = card.child(FragmentBuilder::new("p").class("agent-live").text(&live).build());
        }
    }
    if !agent.detail.is_empty() {
        card = card.child(
            FragmentBuilder::new("p")
                .class("error")
                .text(&agent.detail)
                .build(),
        );
    }
    card.build()
}

/// Where this agent came from. Every row used to say "from public/agents/",
/// including rows for agents written in this browser — the Agents card three
/// panels below said the opposite about the same agent (11b walk). One rule,
/// three origins.
fn origin(agent: &AgentRow, authored: &[(String, String)]) -> String {
    match (authored.iter().find(|(n, _)| *n == agent.name), agent.builtin) {
        (Some((_, by)), _) if by.is_empty() => "written in this browser".to_string(),
        (Some((_, by)), _) => format!("written in this browser by {by}"),
        (None, true) => "built in to this build".to_string(),
        (None, false) => "from public/agents/".to_string(),
    }
}

/// How long this turn has been running, and what it last called. Both are
/// folds of the log: `since` is the timestamp of the status fact, and the tool
/// is the last `ToolInvoked` — which this log only holds for its OWN agent
/// (`trace::trace`), so another agent's row says nothing rather than guessing.
fn live_line(agent: &AgentRow, ctx: &Ctx) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    if let Some(now) = ctx.clock {
        let seconds = now.0.saturating_sub(agent.since.0) / 1000;
        parts.push(format!("in this turn for {seconds}s"));
    }
    if agent.name == ctx.me {
        if let Some(tool) = last_tool(ctx) {
            parts.push(format!("last tool: {tool}"));
        }
    }
    match parts.is_empty() {
        true => None,
        false => Some(parts.join(" · ")),
    }
}

/// The last tool this process's agent called, by name.
fn last_tool(ctx: &Ctx) -> Option<String> {
    ctx.recent
        .iter()
        .filter_map(|kind| match kind {
            kernel::EventKind::ToolInvoked { tool, .. } => Some(tool.0.clone()),
            _ => None,
        })
        .last()
}

/// The status in words a person can act on — the Python's own gloss, which is
/// the whole reason `idle` and `waiting` are two statuses and not one.
fn gloss(agent: &AgentRow) -> &'static str {
    // "idle — nobody has called it" beside "2 turns" contradicts itself: an
    // agent that has answered IS idle, but somebody plainly called it.
    match (agent.status, agent.turns) {
        (Status::Idle, 1..) => "idle — it answered, and nobody is waiting on it",
        (status, _) => sentence(status),
    }
}

/// The status alone, for an agent that has taken no turn yet.
fn sentence(status: Status) -> &'static str {
    match status {
        Status::Starting => "starting — its Worker is coming up",
        Status::Idle => "idle — nobody has called it",
        Status::Working => "working — inside a turn",
        Status::Waiting => "waiting for you",
        Status::Failed => "failed",
        Status::Closed => "closed — its Worker is stopped",
    }
}
