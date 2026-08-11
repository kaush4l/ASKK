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
        //
        // Hand the watch over before letting go. `AgentBoard` is the page's
        // observer of every agent, and it only starts its clock when the core
        // says the board is not final — which becomes true a moment AFTER the
        // send, once `drive` enters the turn. Leaving silently in that window
        // left nobody watching at all: the queued status never drained and the
        // board lied for two minutes (12 walk). One counter, no projection —
        // this loop must never read another agent's conversation (increment 07).
        if *agent.peek() != who {
            let n = turn.tick.peek().to_owned();
            turn.tick.set(n + 1);
            return;
        }
        // The press already ended the turn and wrote the note. One last
        // projection before this loop lets go: ending the turn happens in the
        // ASYNC half — it is what lets a deferred agent swap install — and a
        // pane that stopped reading at the press would show the world as it
        // was one tick before the swap landed (11b walk).
        if turn.stopped.peek().to_owned() {
            let Some(app) = web.peek().clone() else { return };
            show(&who, app.handle(to(&who, Request::get("/chat"))), turn);
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

/// The user stopped waiting. The wait is not the only thing that ends: the
/// TURN does, across the seam, or the swap `roster::reconcile` defers while a
/// task is outstanding never lands — a prompt saved mid-flight stayed
/// uninstalled 45s after the press, until a reload (11b walk).
fn stop_waiting(web: Signal<Option<Rc<WebApp>>>, mut turn: Turn, who: &str) {
    if let Some(app) = web.peek().clone() {
        show(who, app.handle(to(who, Request::post_form("/chat/stop", &[]))), turn);
    }
    let mut shown = turn.shown.peek().clone();
    shown.pending = false;
    turn.shown.set(shown);
    turn.note.set(
        "Stopped waiting, and ended the turn. A reply that arrives after this is in the \
         log; anything you saved takes effect now."
            .into(),
    );
}

/// While a turn is in flight: how long it has been, and the way out.
pub(crate) fn waiting_row(
    web: Signal<Option<Rc<WebApp>>>,
    turn: Turn,
    busy: bool,
    who: String,
) -> Element {
    let mut stopped = turn.stopped;
    rsx! {
        if busy {
            p { class: "pending", role: "status",
                "waiting for the model — {turn.elapsed}s "
                button {
                    r#type: "button",
                    onclick: move |_| {
                        stopped.set(true);
                        stop_waiting(web, turn, &who);
                    },
                    "Stop waiting"
                }
            }
        }
    }
}
