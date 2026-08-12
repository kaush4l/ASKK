//! The status board: one row per loaded agent, and nothing else (plan, "UI
//! shape": `AgentBoard` owns agent status, Python counterpart `core/state.py`).
//!
//! A projection of `App.board`, which is itself a fold of `AgentStatus` facts
//! over the log (I8) — so what the board shows during a delegation and what
//! the log says happened cannot disagree.

use kernel::{ModuleId, Request, Response, Status, Version};
use module::view::FragmentBuilder;
use module::{DataSchema, Manifest, RouteSpec, Tier};

use crate::boardrow::row;
use crate::dispatch::{error_fragment, html, Ctx};

pub(crate) fn manifest() -> Manifest {
    Manifest {
        id: ModuleId("board".into()),
        name: "Agent board".into(),
        version: Version(1),
        description: "What every loaded agent is doing right now.".into(),
        // Clock, so a row that is inside a turn can say how long it has been in
        // it. `since` is the timestamp of the status fact itself, so the number
        // is a subtraction of two logged times and never a reading taken here.
        capabilities: vec![kernel::CapabilityId::Clock],
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
        list = list.child(row(agent, ctx));
    }
    let mut response = html(200, list.build().into_html());
    // Whether anything is working, as a header: the pane must be able to keep
    // polling without parsing its own fragment (same rule as `x-turn`).
    if ctx.board.iter().any(|r| r.status.is_busy()) {
        response.headers.push(("x-busy".into(), "1".into()));
    }
    // This board is NOT FINAL: somebody's Worker is still coming up, or an
    // agent is inside a turn whose end nothing else on the page will notice.
    //
    // It used to say so only while Workers were starting, so the only thing
    // watching a turn was the chat pane's poller — and 07b's rule is that a
    // turn's poller belongs to the agent it started on. Switch away and NOTHING
    // called the seam: the queued status never drained, the board still read
    // "working — inside a turn" two minutes after that turn had failed, and the
    // agent swap `roster::reconcile` defers until the turn ends never installed
    // (12 walk). One agent's turn is every agent's business here, because this
    // pane is the page's observer of all of them.
    if ctx
        .board
        .iter()
        .any(|r| r.status == Status::Starting || r.status.is_busy())
    {
        response.headers.push(("x-watch".into(), "1".into()));
    }
    // The page's spend rides here as well as on `/chat`. The meter is in the
    // frame, and the frame is on screen whether or not a conversation is being
    // polled — a task launched from the Dashboard (15L) moved the number
    // nowhere until you opened Chat, over tokens that had already been spent.
    response
        .headers
        .push(("x-tokens".into(), crate::fold::spent(ctx).to_string()));
    response
}
