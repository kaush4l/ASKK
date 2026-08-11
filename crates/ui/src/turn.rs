//! One turn in flight: what the pane is showing, and the polling that follows
//! a turn to its end. Split from `chat.rs` so both hold the 200-line rule
//! (I12); this file owns the turn, `chat.rs` owns the pane.

use std::rc::Rc;

use adapters_web::{sleep, WebApp};
use dioxus::prelude::*;
use kernel::{Request, Response};

/// Poll interval and patience for one turn: 400 ms × 90 = 36 s, a little past
/// the 30 s the broker aborts at, so its own typed error is what a user sees.
const TICK_MS: i32 = 400;
const TICKS: u32 = 90;

/// What the pane is showing, as ONE value: whose conversation it is, the
/// conversation itself, and whether THAT agent's turn is still running.
///
/// One read, so the heading and the transcript can never name different
/// agents. Before this the heading came from the prop and the transcript from
/// a signal a stale poller kept writing, so switching agents mid-turn showed
/// one agent's private conversation under another's name until you sent a
/// message or reloaded (`ux-walker`, increment 07).
#[derive(Clone, Default, PartialEq)]
pub(crate) struct Shown {
    pub(crate) who: String,
    pub(crate) html: String,
    /// In flight FOR `who` — the `x-turn` header of that agent's own
    /// projection. Per agent, never per page: one agent's slow turn must not
    /// disable the composer of another, which has its own Worker.
    pub(crate) pending: bool,
}

/// The signals one turn moves. Grouped so `watch` takes a turn, not six
/// arguments; `Signal` is `Copy`, so this is free.
#[derive(Clone, Copy)]
pub(crate) struct Turn {
    pub(crate) shown: Signal<Shown>,
    pub(crate) note: Signal<String>,
    pub(crate) elapsed: Signal<u32>,
    pub(crate) stopped: Signal<bool>,
    /// Bumped on every projection so the tool trace follows the turn live.
    pub(crate) tick: Signal<u32>,
}

/// One seam request addressed to THIS pane's agent (increment 07): `/chat` is
/// one route projecting one conversation per agent, and an unaddressed
/// request means "whoever the page itself is".
pub(crate) fn to(agent: &str, req: Request) -> Request {
    req.with_header("x-agent", agent)
}

/// Apply one seam response as a single value. Whose conversation it is comes
/// from the response's own `x-agent` header — the core says who it projected,
/// the pane does not assume — falling back to the agent it asked about when
/// the answer is an error fragment that carries no header.
pub(crate) fn show(asked: &str, res: Response, mut turn: Turn) {
    let who = res
        .headers
        .iter()
        .find(|(k, _)| k == "x-agent")
        .map(|(_, v)| v.clone())
        .unwrap_or_else(|| asked.to_string());
    let pending = res.headers.iter().any(|(k, v)| k == "x-turn" && v == "pending");
    turn.shown.set(Shown {
        who,
        html: res.body,
        pending,
    });
    let n = turn.tick.peek().to_owned();
    turn.tick.set(n + 1);
}

/// Watch one turn to its end: re-project after every tick until the core stops
/// reporting it pending, the user stops waiting, or patience runs out. Every
/// tick also publishes how long it has been — a wait with no clock on it is
/// indistinguishable from a hang.
pub(crate) async fn watch(
    web: Signal<Option<Rc<WebApp>>>,
    mut turn: Turn,
    agent: ReadSignal<String>,
    who: String,
) {
    turn.stopped.set(false);
    turn.elapsed.set(0);
    for tick in 1..=TICKS {
        if sleep(TICK_MS).await.is_err() {
            return;
        }
        // The pane has moved to another agent. This loop belongs to the agent
        // it started on; the pane re-projects and re-spawns when you come back,
        // and the turn itself keeps running in that agent's own Worker.
        if *agent.peek() != who {
            return;
        }
        if turn.stopped.peek().to_owned() {
            stop_waiting(turn);
            return;
        }
        turn.elapsed.set(tick * TICK_MS as u32 / 1000);
        let Some(app) = web.peek().clone() else { return };
        show(&who, app.handle(to(&who, Request::get("/chat"))), turn);
        if !turn.shown.peek().pending {
            return;
        }
    }
    turn.note.set(
        "No reply in 36 seconds. The turn was interrupted, or the model endpoint \
         accepted the request and never answered — check Settings."
            .into(),
    );
}

/// The user stopped waiting: the pane stops polling, and says plainly that the
/// request may still land — it is the WAIT that ended, not the turn.
fn stop_waiting(mut turn: Turn) {
    let mut shown = turn.shown.peek().clone();
    shown.pending = false;
    turn.shown.set(shown);
    turn.note.set(
        "Stopped waiting. The request may still be in flight — a reply that \
         arrives is in the log, and a reload will show it."
            .into(),
    );
}

/// While a turn is in flight: how long it has been, and the way out.
pub(crate) fn waiting_row(turn: Turn, busy: bool) -> Element {
    let mut stopped = turn.stopped;
    rsx! {
        if busy {
            p { class: "pending",
                "waiting for the model — {turn.elapsed}s "
                button { r#type: "button", onclick: move |_| stopped.set(true), "Stop waiting" }
            }
        }
    }
}
