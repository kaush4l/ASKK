//! The status board: one row per loaded agent, and nothing else (plan, "UI
//! shape": `AgentBoard` owns agent status, Python counterpart `core/state.py`).
//!
//! A projection of `App.board`, which is itself a fold of `AgentStatus` facts
//! over the log (I8) — so what the board shows during a delegation and what
//! the log says happened cannot disagree.

use agent::AgentRow;
use kernel::{ModuleId, Request, Response, Status, Version};
use module::view::{Fragment, FragmentBuilder};
use module::{DataSchema, Manifest, RouteSpec, Tier};

use crate::dispatch::{error_fragment, html, Ctx};

pub(crate) fn manifest() -> Manifest {
    Manifest {
        id: ModuleId("board".into()),
        name: "Agent board".into(),
        version: Version(1),
        description: "What every loaded agent is doing right now.".into(),
        capabilities: vec![],
        routes: vec![RouteSpec {
            method: "GET".into(),
            path: "/board".into(),
        }],
        // No slot: `AgentBoard` mounts this route itself, like `ChatPane` and
        // `ToolTrace`. A slot would only add a second, emptier placeholder.
        slots: vec![],
        section: None,
        schema: DataSchema {
            kv_prefix: "mod/board/".into(),
            version: 1,
        },
        tier: Tier::T0Rust,
        tests: vec![],
    }
}

/// Named ONLY from `dispatch::builtin_entry` (ADR-004).
pub(crate) fn board(req: &Request, ctx: &mut Ctx) -> Response {
    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/board") => table(ctx),
        _ => error_fragment(404, "board: unknown subroute"),
    }
}

fn table(ctx: &Ctx) -> Response {
    let mut list = FragmentBuilder::new("div").id("agent-board");
    if ctx.board.is_empty() {
        list = list.child(
            FragmentBuilder::new("p")
                .class("pending")
                .text("No agents are loaded, so there is nothing running.")
                .build(),
        );
    }
    for agent in &ctx.board {
        list = list.child(row(agent));
    }
    let mut response = html(200, list.build().into_html());
    // Whether anything is working, as a header: the pane must be able to keep
    // polling without parsing its own fragment (same rule as `x-turn`).
    if ctx.board.iter().any(|r| r.status.is_busy()) {
        response.headers.push(("x-busy".into(), "1".into()));
    }
    // Somebody's Worker is still coming up, so this board is not final yet —
    // and nothing else on an idle page will ask again (increment 07).
    if ctx.board.iter().any(|r| r.status == Status::Starting) {
        response.headers.push(("x-settling".into(), "1".into()));
    }
    response
}

/// One agent's row. The status is a WORD, not only a colour: a row that
/// differs from its neighbour by hue alone says nothing with the stylesheet
/// off, and nothing at all to a screen reader.
fn row(agent: &AgentRow) -> Fragment {
    let turns = match agent.turns {
        1 => "1 turn".to_string(),
        n => format!("{n} turns"),
    };
    let origin = match agent.builtin {
        true => "built in",
        false => "public/agents/",
    };
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
                .text(&format!("{} — {turns}, from {origin}", gloss(agent)))
                .build(),
        );
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
