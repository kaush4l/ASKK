//! One turn in flight: what the pane is showing, and the polling that follows
//! a turn to its end. Split from `chat.rs` so both hold the 200-line rule
//! (I12); this file owns the turn, `chat.rs` owns the pane.

use std::rc::Rc;

use adapters_web::{sleep, WebApp};
use dioxus::prelude::*;
use kernel::{Request, Response};

use crate::ui::Button;

/// How often the pane re-projects a turn in flight.
const TICK_MS: i32 = 400;

/// How long a turn may go with NOTHING changing before the pane says so:
/// 400 ms × 90 = 36 s, a little past the 30 s the broker aborts at, so its own
/// typed error is what a user sees.
///
/// It counts SILENCE, not the turn. It used to be the whole patience — 36
/// seconds and the pane declared the turn dead — which was right when a turn
/// was one model call and four tool rounds, and is wrong now that an agent may
/// take sixty-four (15C). An autonomous run that works for ten minutes is the
/// product; a run that says nothing for thirty-six seconds is a hang, and only
/// the second one is worth interrupting. Every tool result, every model reply
/// and every note changes the projection and resets this.
const STALL_TICKS: u32 = 90;

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
    // The newest message, where it can be read. From 12c the conversation is a
    // scroller inside a full-height column, so it has the terminal's old
    // problem — the answer LESS visible after it lands than while it ran — and
    // the terminal's fix. The DOM catches up on the next frame, so this waits.
    spawn(async move {
        let _ = sleep(30).await;
        crate::terminal::show_newest("chat-scroll");
    });
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
    // What the last projection looked like, and how many ticks ago it changed.
    // A turn that is still producing tool results is a turn that is working.
    let mut last = turn.shown.peek().html.clone();
    let mut silent = 0u32;
    for tick in 1.. {
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
        let now = turn.shown.peek().html.clone();
        if now == last {
            silent += 1;
        } else {
            (last, silent) = (now, 0);
        }
        if silent >= STALL_TICKS {
            let seconds = STALL_TICKS * TICK_MS as u32 / 1000;
            turn.note.set(format!(
                "Nothing has changed for {seconds} seconds, after {}s of work. The turn was \
                 interrupted, or the model endpoint accepted the request and never answered \
                 — check Settings.",
                turn.elapsed.peek()
            ));
            return;
        }
    }
}

/// The user stopped waiting. The wait is not the only thing that ends: the
/// TURN does, across the seam, or the swap `roster::reconcile` defers while a
/// task is outstanding never lands — a prompt saved mid-flight stayed
/// uninstalled 45s after the press, until a reload (11b walk).
fn stop_waiting(web: Signal<Option<Rc<WebApp>>>, turn: Turn, who: &str) {
    if let Some(app) = web.peek().clone() {
        show(who, app.handle(to(who, Request::post_form("/chat/stop", &[]))), turn);
    }
    // No local override of `pending` any more. It used to be forced false here
    // and then set true again one tick later by the loop's last projection,
    // which froze the clock at whatever second the press happened and left the
    // composer disabled for the rest of the timeout (12 walk, finding 2). The
    // stop is a FACT now, for any agent, so the projection answers correctly
    // and the pane has nothing to override.
    //
    // And no note. The transcript the line above just re-read already ends
    // with `transcript::STOPPED`, which said the same thing in nearly the same
    // words one line lower: one event, said twice, is the page disagreeing
    // with itself about how many things happened (12b walk, finding 2).
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
            p { class: "pending wait-clock", role: "status",
                "waiting for the model — {turn.elapsed}s "
                Button {
                    variant: "secondary",
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
