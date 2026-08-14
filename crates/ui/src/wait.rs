//! The wait: the row that says a turn is running, and the press that ends it.
//! Split from `turn.rs`, which owns the turn itself, so both hold the 200-line
//! rule (I12) once the meter rides the same poll.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;

use crate::turn::{show, to, Turn};
use crate::ui::Button;

/// What `core::inflight::doing` says when the model is the thing outstanding.
/// Two places here branch on it, and neither may guess at a second spelling.
const MODEL_WAIT: &str = "waiting for the model";

/// The user stopped waiting. The wait is not the only thing that ends: the
/// TURN does, across the seam, or the swap `roster::reconcile` defers while a
/// task is outstanding never lands (11b walk).
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

/// THE STOP (R16-P0-2). Two fresh-context critics named the same absence as
/// the one thing keeping this below the hosted field: every control that said
/// "Stop" meant stop LOOKING. This one means stop WORKING.
///
/// It ends the run at the agent's next step boundary. It is not a kill: a
/// command already inside the Linux and a goal already handed to another
/// agent's Worker both run to their end, because nothing on this page can
/// reach into either. It guarantees only that nothing NEW is started.
fn stop_agent(web: Signal<Option<Rc<WebApp>>>, turn: Turn, who: &str) {
    if let Some(app) = web.peek().clone() {
        show(who, app.handle(to(who, Request::post_form("/chat/halt", &[]))), turn);
    }
}

/// THE STALL NOTE, recomputed (R11-2) and NAMING THE RIGHT EFFECT (R11-3). The
/// old copy said the model "accepted the request and never answered" and sent
/// the reader to Settings — over an endpoint that had answered 200 in 20ms four
/// minutes before, while the agent sat inside one `while true` loop. So it says
/// what the core says is outstanding, and offers Settings only when the thing
/// outstanding IS the model.
pub(crate) fn stalled(silent: u32, web: &Signal<Option<Rc<WebApp>>>, who: &str) -> String {
    let (board, doing) = crate::runstatus::progress(web, who);
    // …and never one fact in two spellings (R18-P2): the clause earns its place
    // only when work outlasts the silence the caller has already named.
    let worked = match board {
        Some(seconds) if seconds > silent => format!(", after {seconds}s of work"),
        _ => String::new(),
    };
    let why = match doing.as_str() {
        "" => "The agent may be in a long command, or the model may not have answered.".to_string(),
        MODEL_WAIT => format!(
            "It is waiting for the model, so the endpoint may have accepted the request and \
             never answered. The page gives up on a call after {} minutes and reports it as a \
             timeout; Settings is where the endpoint is.",
            adapters_web::TIMEOUT_SECS / 60
        ),
        // A command in the Linux, named, with the control that ends it.
        what => format!(
            // NOT "can stop it" (R17-P0-1): only c2w can, by typing the
            // interrupt into its one PTY. Commands says which, off
            // `x-interrupt`; this sentence must not answer for it.
            "It is {what}, which is not stuck by itself — a long command looks exactly like \
             this. The Commands view shows it running and says what can be done about it."
        ),
    };
    format!(
        "Nothing has changed for {silent} seconds{worked}. {why} Stop waiting hands this \
         conversation back to you; it does not stop the agent."
    )
}

/// While a turn is in flight: how long it has been, and the two ways out.
/// One of them is a way out of the WAIT only: the agent's turn runs in its own
/// Worker and its commands run in the Linux, and a `sleep 45` went right on
/// sleeping (R3-6). Every label here says which of the two it is (R17-P1-5).
///
/// THE CLOCK IS THE BOARD'S (R6-7). This row used to render `turn.elapsed`, a
/// count of the pane's own poll ticks that restarts whenever the poller does —
/// so beside a board reading `in this turn for 17s` this strip read `0s`. The
/// number comes off `data-elapsed` now, the board's own subtraction; the tick
/// count is the fallback for the moment before the agent's first status fact.
///
/// AND IT IS ONE ROW (R6-7). The clock and the buttons are unshrinkable and the
/// sentence takes a line of its own (`controls.css`); as shrinkable children of
/// a flex row the whole thing collapsed to a ~60px column.
pub(crate) fn waiting_row(
    web: Signal<Option<Rc<WebApp>>>,
    turn: Turn,
    busy: bool,
    who: String,
    // Whether the core says THIS run is one this page can stop (`x-stoppable`).
    stoppable: bool,
    // This agent's `max_rounds:` (`x-max-rounds`), empty when unknown.
    ceiling: String,
) -> Element {
    if !busy {
        return rsx! {};
    }
    let (mut stopped, mut halting) = (turn.stopped, turn.halting);
    let (board, doing) = crate::runstatus::progress(&web, &who);
    let seconds = board.unwrap_or_else(|| turn.elapsed.read().to_owned());
    // THE REAL EFFECT, NAMED (R11-3). This said `waiting for the model` whatever
    // the turn was doing, over an endpoint that had answered in 20ms. The core
    // says which; when it does not, this says what is true either way.
    let doing = match doing.is_empty() {
        true => "working".to_string(),
        false => doing,
    };
    // …AND WHAT THE WAIT IS WAITING OUT (R12-2b). A stopwatch with no dial:
    // the page gives the call a budget and gives up on it, and nothing said so
    // until the giving-up arrived as a failure. Only for the model — a command
    // in the Linux has no budget. Its OWN unshrinkable chunk, not more of the
    // clock's: one span ran 334px at 320px and the route overflowed.
    let budget = match doing == MODEL_WAIT {
        true => format!("of a {}-minute limit", adapters_web::TIMEOUT_SECS / 60),
        false => String::new(),
    };
    // THE QUALIFIER IS BACK ON BOTH LABELS (R17-P1-5). R16 dropped it on the
    // argument that the PAIR made each legible; a critic meeting the pair fresh
    // could not tell `Stop waiting` from `Stop main` without the paragraph
    // below, and a label needing a paragraph has not said its own job.
    let label = format!("Stop waiting — {who} keeps working");
    // …AND WHAT ENDS ONE THIS PAGE CANNOT STOP (R17-P0-1): its own ceiling.
    let ends = match ceiling.is_empty() {
        true => "it runs until it answers or hits its step limit".to_string(),
        false => format!("it runs until it answers or reaches its limit of {ceiling} steps"),
    };
    rsx! {
        p { class: "pending wait-clock", role: "status",
            span { class: "wait-time", "{doing} — {seconds}s" }
            if !budget.is_empty() {
                span { class: "wait-time", "{budget}" }
            }
            Button {
                variant: "secondary",
                onclick: {
                    let who = who.clone();
                    move |_| {
                        stopped.set(true);
                        stop_waiting(web, turn, &who);
                    }
                },
                "{label}"
            }
            if stoppable {
                Button {
                    variant: "danger",
                    disabled: halting(),
                    onclick: {
                        let who = who.clone();
                        move |_| {
                            halting.set(true);
                            stop_agent(web, turn, &who);
                        }
                    },
                    "Stop {who} — end the run"
                }
            }
            span { class: "note",
                // ONE SENTENCE PER BUTTON, in the order they sit in (R16-P0-2).
                // This used to be one control and a paragraph about what it
                // could not do; the distinction is the point now.
                "Stop waiting hands this conversation back to you and leaves {who} working. "
                if stoppable {
                    if halting() {
                        "Stopping {who}: it finishes the step it is in — a command already \
                         running in Linux, or an agent it handed work to — and starts nothing \
                         new."
                    } else {
                        "Stop {who} ends the run at its next step: a command already running in \
                         Linux finishes, and so does an agent it handed work to, but nothing \
                         new is started."
                    }
                } else {
                    // WHAT WAS HERE WAS FALSE (R17-P0-1): it sent a stuck
                    // person to Commands for a stop that view does not have,
                    // about agents that have no workspace at all.
                    "Nothing on this page can stop {who} once it has started — {ends}."
                }
            }
        }
    }
}
