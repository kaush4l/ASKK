//! THE TURN SLOT: the one turn a Worker can have in flight, the words that
//! refuse a second one, and the ways a turn can end without an answer.

use std::cell::RefCell;
use std::rc::Rc;

use js_sys::{Function, Object, Promise, Reflect};
use wasm_bindgen::JsValue;

use super::Live;

/// The turn in flight: the two halves of its promise, and WHEN it was given.
///
/// `started` is the only thing this side ever learns about a turn it cannot
/// see. It exists so the refusal below can state a measured fact instead of a
/// prediction — everything else about a running turn lives in the Worker.
pub(crate) struct Turn {
    pub(crate) resolve: Function,
    pub(crate) reject: Function,
    started: f64,
}

/// Wall clock, and NOT through `ClockPort` — `ports.rs:151` is the one place
/// time enters the SYSTEM, meaning the log, and this number never gets there.
/// It is read and rendered inside one sentence and then forgotten, so it
/// changes no event, no projection and no test's determinism (I7 stands).
fn now_ms() -> f64 {
    js_sys::Date::now()
}

/// End the turn in flight without an answer, saying why. A settled turn holds
/// the slot no longer — which is what lets the peer be asked again.
pub(super) fn lose(pending: &RefCell<Option<Turn>>, why: &str) {
    if let Some(turn) = pending.borrow_mut().take() {
        turn.reject.call1(&JsValue::UNDEFINED, &why.into()).ok();
    }
}

/// How long ago, in words, never in a negative number of seconds.
fn ago(elapsed_ms: f64) -> String {
    match (elapsed_ms / 1000.0).max(0.0) as i64 {
        0 => "less than a second".to_string(),
        1 => "a second".to_string(),
        n => format!("{n} seconds"),
    }
}

/// Why a second goal was not delivered, in words the caller can act on (I15)
/// and only in words this side has CHECKED (I16).
///
/// It used to end "Ask it again once that turn has answered" — a recovery
/// nothing here verifies, promised about a turn that may never answer at all.
/// A Worker that accepts a `run` and neither answers nor raises holds this slot
/// for the life of the page, so that sentence was a falsehood the product
/// repeated cheerfully, forever, to explain a peer it had permanently lost.
///
/// UNPREFIXED, and it starts with "it": `core::batch::delegate` already renders
/// this as "<agent> failed: <this>" and the board row is already labelled with
/// the name, so naming the agent again reads as a stutter (the same reason
/// `worker/mod.rs`'s failure text is unprefixed).
fn busy(elapsed_ms: f64) -> String {
    format!(
        "it took a goal {} ago and has not answered yet, and it takes one at a \
         time. Nothing on this side can tell whether it is still working or \
         lost, so ask a different agent rather than waiting on this one.",
        ago(elapsed_ms)
    )
}

/// Send one goal and resolve when that Worker answers — or refuse it, in words,
/// when that Worker is already answering one.
///
/// `waiting` IS ONE SLOT and stays one. A Worker runs ONE agent loop over one
/// `core::App` (`crate::worker::AgentWorker::run` posts to `/chat` and drives
/// that same app), so two goals in flight there are not two turns; a map from
/// request id to resolver would settle two promises against one turn, which is
/// more machinery bought with a falsehood.
///
/// WHAT IT MUST NOT DO IS OVERWRITE. It used to: `*waiting.borrow_mut() =
/// Some(..)` dropped the first turn's resolver, so that promise never settled,
/// the lead's `pending_tools` never reached zero, and its turn hung forever
/// with no timeout and no error card. Two callers reach here at once — the
/// model naming one peer twice on a batch line, and a person messaging that
/// agent from Threads (`core::runtime::requests::ran_elsewhere`) while the lead
/// delegates to it. `agent/src/step/line.rs` refuses the first WHERE THE GATE
/// CAN EXECUTE THE CLAIM (I17); this file is only `cargo check`ed, so it is the
/// guard for the second and the backstop for the first.
///
/// WHAT STILL CANNOT BE DETECTED, and is not pretended to be — an I17
/// unpinnable, named rather than papered over with a weak check. Three things
/// free this slot: an answer, an `error` event (`super::on_error`), and the
/// Worker being stopped (`Live::drop`). A Worker that accepts a run and does
/// none of the three — a loop inside the guest, a message the runtime dropped
/// — keeps it until the page is reloaded. A DEADLINE that presumed such a turn
/// lost and handed the slot to the next ask would be a guess dressed as a fact:
/// `web/agent-worker.js` posts `{kind:"answer", ok, text}` with nothing tying
/// an answer to the run that produced it, so a late answer from the abandoned
/// turn is indistinguishable HERE from the new turn answering, and the caller
/// who took over would be handed another goal's work as its own. THE MACHINE
/// FACT THAT WOULD SETTLE IT DOES NOT EXIST: no turn id is echoed back on an
/// answer. Until one is, this refuses, and says only what it measured.
pub(crate) fn ask(live: &Live, goal: &str) -> Promise {
    let goal = goal.to_string();
    let (worker, waiting) = (live.worker.clone(), Rc::clone(&live.waiting));
    Promise::new(&mut |resolve, reject| {
        let refuse = reject.clone();
        // Measured, then the borrow is dropped: the refusal is rendered from
        // the turn in flight and must not be rendered while holding it.
        let busy_for = waiting.borrow().as_ref().map(|turn| now_ms() - turn.started);
        // The executor runs synchronously, so this rejects the NEW promise
        // before it is ever handed out — and leaves the turn in flight alone.
        if let Some(elapsed) = busy_for {
            refuse.call1(&JsValue::UNDEFINED, &busy(elapsed).into()).ok();
            return;
        }
        *waiting.borrow_mut() = Some(Turn { resolve, reject, started: now_ms() });
        let message = Object::new();
        let sent = Reflect::set(&message, &"kind".into(), &"run".into())
            .and_then(|_| Reflect::set(&message, &"goal".into(), &goal.as_str().into()))
            .and_then(|_| worker.post_message(&message));
        if let Err(e) = sent {
            waiting.borrow_mut().take();
            refuse.call1(&JsValue::UNDEFINED, &e).ok();
        }
    })
}

/// The refusal is the part of this file the HOST gate can execute, so it is
/// tested here: `busy` and `ago` touch no browser at all, and the sentence a
/// caller reads is exactly what I16 says must be checked before it is said.
#[cfg(test)]
mod tests {
    use super::{ago, busy};

    #[test]
    fn the_refusal_states_the_elapsed_time_it_was_measured_with() {
        assert!(busy(12_400.0).contains("12 seconds"), "{}", busy(12_400.0));
        assert!(busy(1_000.0).contains("a second ago"), "{}", busy(1_000.0));
    }

    #[test]
    fn the_refusal_promises_nothing_about_the_turn_in_flight() {
        let said = busy(3_000.0);
        assert!(
            !said.contains("once that turn has answered"),
            "the sentence this replaced promised a recovery nothing checks: {said}"
        );
        assert!(said.contains("can tell whether it is still working or lost"), "{said}");
    }

    #[test]
    fn elapsed_reads_as_words_and_never_as_a_negative_number() {
        assert_eq!(ago(0.0), "less than a second");
        assert_eq!(ago(999.0), "less than a second");
        assert_eq!(ago(1_500.0), "a second");
        assert_eq!(ago(61_000.0), "61 seconds");
        // A clock stepped backwards mid-turn is the only way this goes
        // negative, and "-3 seconds ago" is not a thing a person can act on.
        assert_eq!(ago(-3_000.0), "less than a second");
    }
}
