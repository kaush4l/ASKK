//! THE FLOW RAIL (ROADMAP #7) — which loop this agent's turn is running, and
//! how far through it is, on every surface that shows an agent.
//!
//! ONE COMPONENT, TWO MOUNTS, AND THE DIFFERENCE IS ONLY WHO ALREADY HOLDS THE
//! PROJECTION. `chat::thread` reads `/board` ONCE for the whole thread list
//! (its rule 1) and hands the string down, so a rail there must not open a
//! second request; the Dashboard has no such string in hand. Both roads end in
//! `read::of` and `rail::rail`, so there is exactly one reader of the
//! attributes and exactly one set of words — a second surface cannot fork
//! either. This file is the only one of the three that knows what a `Signal`
//! is, which is what keeps `read.rs` and `rail.rs` typed on DATA.
//!
//! WHY A NEW FLOW COSTS ZERO FILES. Nothing here names a route. `data-walk` is
//! the authority and it is a list of words; a fourth loop from `crates/agent`
//! arrives as a longer list and draws itself.

pub(crate) mod rail;
pub(crate) mod read;

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;

/// The rail off a `/board` projection the caller already has (`chat::thread`).
pub(crate) fn from_board(board: &str, who: &str) -> Element {
    rail::rail(&read::of(board, who))
}

/// The rail where nothing else is reading the board — the Dashboard. It follows
/// the shell's heartbeat like every other panel there rather than keeping a
/// clock of its own, and writes only when the projection actually moved, so a
/// still board costs no re-render.
#[component]
pub(crate) fn FlowDeck(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    /// WHICH agent's flow. `ReadSignal` so switching agents re-reads rather
    /// than re-mounting, exactly as the chat pane does.
    agent: ReadSignal<String>,
) -> Element {
    let mut board = use_signal(String::new);
    use_effect(move || {
        let _ = tick();
        let Some(app) = web.read().clone() else { return };
        let now = app.handle(Request::get("/board")).body;
        if *board.peek() != now {
            board.set(now);
        }
    });
    let projection = board.read().clone();
    from_board(&projection, &agent())
}
