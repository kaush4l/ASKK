//! READING THE BOARD PROJECTION — the one-bit reads of a rendered attribute
//! that `ui::has_rows` and `terminal::commands_in` already make. Split from
//! `runstatus.rs`, which owns what the launch card SAYS, so both hold the
//! 200-line rule (I12).

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;

/// One `data-*` value off ONE agent's board row. `data-agent` is the row's
/// identity and every attribute asked for here is written after it in the same
/// tag, so the search starts there and cannot run into a neighbour's row.
pub(crate) fn cell(html: &str, agent: &str, attr: &str) -> Option<String> {
    let at = html.find(&format!("data-agent=\"{agent}\""))?;
    let (_, rest) = html[at..].split_once(&format!("{attr}=\""))?;
    rest.split_once('"').map(|(v, _)| v.to_string())
}

/// When that agent's CURRENT status was entered — the baseline a launch records
/// so it can tell a failure of its own run from one that was already on the
/// board when it pressed Run.
pub(crate) fn since(web: &Signal<Option<Rc<WebApp>>>, agent: &str) -> u64 {
    let Some(app) = web.peek().clone() else { return 0 };
    at(&app.handle(Request::get("/board")).body, agent)
}

/// HOW LONG, AND ON WHAT — ONE READ (R11-2, R11-3). The in-flight strip and the
/// stall note both need both numbers and both phrases, and taking them from one
/// projection is what stops three clocks on one screen from showing three ages:
/// `Nothing has changed for 36 seconds, after 36s of work` sat frozen beside
/// `waiting for the model — 240s` and `in this turn for 240s`. `None` for the
/// elapsed means the board is not counting — no row, or no clock in this
/// process — and an empty phrase means it is not saying what it is waiting on.
pub(crate) fn progress(web: &Signal<Option<Rc<WebApp>>>, agent: &str) -> (Option<u32>, String) {
    let Some(app) = web.peek().clone() else { return (None, String::new()) };
    let board = app.handle(Request::get("/board")).body;
    (
        cell(&board, agent, "data-elapsed").and_then(|n| n.parse().ok()),
        cell(&board, agent, "data-doing").unwrap_or_default(),
    )
}

/// The same read, off a projection already in hand. 0 when the agent has no row
/// yet, which reads as "nothing has happened", and that is true.
pub(crate) fn at(board: &str, agent: &str) -> u64 {
    cell(board, agent, "data-since")
        .and_then(|n| n.parse().ok())
        .unwrap_or(0)
}

/// IS THIS RUN STILL THE THING THIS CARD IS ABOUT? (R6-6)
///
/// The launcher asks it whether to render a composer at all and `LaunchedRun`
/// asks it what to say: one answer, so the two halves of one card cannot
/// contradict each other.
///
/// Has the board said anything about THIS run yet? Until the status timestamp
/// moves past the press, every word on that row is about the run before it, so
/// "not moved yet" is LIVE. `turns` cannot answer it: the core counts a turn
/// when the agent ENTERS Working, so it rises at the start.
pub(crate) fn live(board: &str, who: &str, baseline: u64) -> bool {
    let status = cell(board, who, "data-status").unwrap_or_default();
    let moved = at(board, who) > baseline;
    !moved || matches!(status.as_str(), "working" | "starting")
}
