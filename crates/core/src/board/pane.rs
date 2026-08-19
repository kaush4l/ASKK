//! The status board: one row per loaded agent, and nothing else (plan, "UI
//! shape": `AgentBoard` owns agent status, Python counterpart `core/state.py`).
//!
//! A projection of `App.board`, which is itself a fold of `AgentStatus` facts
//! over the log (I8) — so what the board shows during a delegation and what
//! the log says happened cannot disagree.

use kernel::{ModuleId, Request, Response, Status, Version};
use module::view::FragmentBuilder;
use module::{DataSchema, Manifest, RouteSpec, Tier};

use crate::board::row::row;
use crate::dispatch::{error_fragment, html, Ctx};

pub(crate) fn manifest() -> Manifest {
    Manifest {
        id: ModuleId("board".into()),
        name: "Agents and what they are doing".into(),
        version: Version(1),
        description: "What every loaded agent is doing right now.".into(),
        // Clock, so a row that is inside a turn can say how long it has been in
        // it. `since` is the timestamp of the status fact itself, so the number
        // is a subtraction of two logged times and never a reading taken here.
        capabilities: vec![kernel::CapabilityId::Clock],
        routes: vec![
            RouteSpec {
                method: "GET".into(),
                path: "/board".into(),
            },
            // THE SAME FOLD, COUNTED (27). The Dashboard's tile strip is the
            // fleet at a glance and the rows below it are the fleet in detail,
            // so both belong to the module that owns the fleet's status. A
            // module of its own would have had to be handed the same `board`
            // projection and the same `queued` list to answer the same
            // question, and two modules holding one fold is how the two
            // regions come to disagree.
            RouteSpec {
                method: "GET".into(),
                path: "/tiles".into(),
            },
        ],
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
        ("GET", "/tiles") => crate::board::tiles::strip(ctx),
        _ => error_fragment(404, "board: unknown subroute"),
    }
}

fn table(ctx: &Ctx) -> Response {
    // A task ACCEPTED for an agent whose Worker has not entered the turn yet is
    // work in progress, and it is the state the Dashboard's launcher announces
    // at the press. If the board did not agree, it also stopped POLLING — the
    // headers below are what keep this pane's clock running, and with none of
    // them the page went quiet in the one second after Start agent and the row
    // sat on its old status until something else happened to bump a tick
    // (R3-2). Same fold, same signal, in the rows (`board/row`) and here.
    //
    // THE PREDICATE ITSELF MOVED TO `board/tiles.rs` (27), because a third reader
    // arrived: the Dashboard's tile says how many agents are working, and a
    // count derived from its own filter would drift from the names in the
    // header below the moment one of the two forgot `queued`.
    let busy_names = crate::board::tiles::busy_names(ctx);
    let working = |r: &agent::AgentRow| busy_names.contains(&r.name);
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
    //
    // The VALUE is WHO is working, not "1". A run was invisible from every view
    // but Chat — the header carries pills and a heartbeat, and neither said an
    // agent was going, so walking away from the Workspace view left no way to
    // tell (R3-22). The frame wears this; the presence test every other reader
    // makes is unchanged.
    if !busy_names.is_empty() {
        response.headers.push(("x-busy".into(), busy_names.join(", ")));
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
        .any(|r| r.status == Status::Starting || working(r))
    {
        response.headers.push(("x-watch".into(), "1".into()));
    }
    // WHETHER THE LAST CALL FAILED, as a header the frame can wear. The one
    // status dot in the chrome was the Linux sandbox's, so a page whose model
    // endpoint was refusing every turn still read `● workspace ready` in green
    // and nothing anywhere turned red (F12). The board is the page's own health
    // projection and the frame polls it already; this is the same rule `x-busy`
    // follows — a pane must not parse a fragment to learn what it is showing.
    // The VALUE is the one-line reason (`failure::reason`), so the pill can say
    // what went wrong and not merely that something did.
    if let Some(row) = ctx.board.iter().find(|r| r.status == Status::Failed) {
        let why = match row.detail.is_empty() {
            true => "the turn failed".to_string(),
            false => row.detail.clone(),
        };
        response.headers.push(("x-failed".into(), why));
        // WHOSE failure. The pill wearing this sat inside the header's
        // `Agent: author` cluster and read as a fact about `author`, which had
        // taken no turns at all (R2-4). One header, and the chrome can name the
        // agent that actually failed instead of implying the selected one.
        response
            .headers
            .push(("x-failed-agent".into(), row.name.clone()));
        // WHICH failure this is. The pill's dismissal was keyed on the words —
        // and the same agent failing the same way twice says the same words, so
        // one press silenced every later instance of that failure for the life
        // of the tab (R3-3).
        //
        // IT WAS `since`, THE STATUS FACT'S TIMESTAMP, AND THAT NUMBER DOES NOT
        // SURVIVE A RELOAD (R8-4): the status is re-entered when the page comes
        // back, so the same failure arrives wearing a new stamp and a dismissal
        // stored against the old one silenced nothing. THE TURN NUMBER is the
        // same distinction taken from the fold instead of from the clock: it
        // rises on the next turn, so a repeat is still a different failure, and
        // it is identical on both sides of a reload because it is counted from
        // the log and not from when the tab happened to open.
        response
            .headers
            .push(("x-failed-turn".into(), row.turns.to_string()));
    }
    // The page's spend rides here as well as on `/chat`. The meter is in the
    // frame, and the frame is on screen whether or not a conversation is being
    // polled — a task launched from the Dashboard (15L) moved the number
    // nowhere until you opened Chat, over tokens that had already been spent.
    response
        .headers
        .push(("x-tokens".into(), crate::chat::fold::spent(ctx).to_string()));
    response
}
