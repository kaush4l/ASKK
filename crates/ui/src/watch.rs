//! FOLLOWING ONE TURN TO ITS END: the poller, its patience, and the note it
//! writes when nothing has changed for a while. Split from `turn.rs`, which
//! owns what the pane is SHOWING, so both hold the 200-line rule (I12).

use std::rc::Rc;

use adapters_web::{sleep, WebApp};
use dioxus::prelude::*;
use kernel::Request;

use crate::turn::{show, to, Turn};

/// How often the pane re-projects a turn in flight.
const TICK_MS: i32 = 400;

/// How long a turn may go with NOTHING changing before the pane SAYS so:
/// 400 ms × 90 = 36 s. It is a note and not a verdict — the watch continues,
/// and the next change clears it.
///
/// It counts SILENCE, not the turn. It used to be the whole patience, which was
/// right when a turn was one model call and four tool rounds and is wrong now
/// that an agent may take sixty-four (15C): an autonomous run that works for
/// ten minutes is the product, a run that says nothing for thirty-six seconds
/// is a hang, and only the second is worth interrupting. Every tool result,
/// reply and note changes the projection and resets this.
const STALL_TICKS: u32 = 90;

/// Start watching, unless something already is — the pane re-projects whenever
/// the route brings it forward (R3-1), and two loops writing one `Shown` is the
/// crossed-projection shape 07 spent a walk on.
pub(crate) fn follow(
    web: Signal<Option<Rc<WebApp>>>,
    turn: Turn,
    agent: ReadSignal<String>,
    who: String, mut watching: Signal<bool>,
) {
    if watching.peek().to_owned() {
        return; // this turn already has a poller
    } // …and the flag drops below, whichever way `watch` returns
    watching.set(true);
    spawn(async move {
        watch(web, turn, agent, who).await;
        watching.set(false);
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
    turn.halting.set(false);
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
        // it started on; the pane re-projects when you come back, and the turn
        // keeps running in that agent's own Worker.
        //
        // Hand the watch over before letting go. `AgentBoard` starts its clock
        // only when the core says the board is not final, which becomes true a
        // moment AFTER the send: leaving silently in that window left nobody
        // watching, the queued status never drained and the board lied for two
        // minutes (12 walk). One counter, no projection — this loop must never
        // read another agent's conversation (increment 07).
        if *agent.peek() != who {
            let n = turn.tick.peek().to_owned();
            turn.tick.set(n + 1);
            return;
        }
        // The press already ended the wait and wrote the note. One last
        // projection before this loop lets go: it happens in the ASYNC half —
        // which is what lets a deferred agent swap install — so a pane that
        // stopped reading at the press would be a tick stale (11b walk).
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
            if !turn.note.peek().is_empty() {
                turn.note.set(String::new());
            }
        }
        // The note is a WARNING, not an exit. Returning here killed the poll —
        // transcript, trace and meter froze for the rest of a run that was
        // still going. It is said once and the watch continues.
        //
        // …AND ITS CLOCKS ARE LIVE, AND THEY ARE THE SAME CLOCKS (R11-2). It
        // was written ONCE, at the tick silence crossed the threshold, out of a
        // constant and a snapshot: `Nothing has changed for 36 seconds, after
        // 36s of work` held at 36 for four minutes beside two adjacent numbers
        // reading 240. Both are recomputed every tick now, from the same two
        // places the strip above takes them from.
        if silent >= STALL_TICKS {
            turn.note.set(crate::wait::stalled(silent * TICK_MS as u32 / 1000, &web, &who));
        }
    }
}
