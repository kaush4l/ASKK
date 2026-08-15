//! HOW A TURN ENDED, AS A FACT (R17-P0-2).
//!
//! A turn used to end by ABSENCE: `state.task = None`, and every summary on the
//! page then read the same absence as success. A run that abandoned a six-part
//! task reported `main finished "…"` with a `Read the reply` button, and the
//! reply it landed on was the model's own malformed tool call.
//!
//! The machine already knew the difference — the answered path, the round
//! ceiling and the stop are three different lines of `step` — so this makes the
//! ending a RECORD with a kind rather than a hole where the task was. One fact,
//! `core.ended`, emitted by the pure step function at every ending it owns; the
//! card, the board row and the conversation are folds of it (`core::ending`),
//! which is the shape `halted.rs` already proved for the stop.
//!
//! `core.stopped` keeps its own fact and its own file: it is emitted at the
//! boundary rather than by an arm of the machine, it carries a wording no other
//! ending needs, and a second record of it here would be the split round 16 was
//! spent removing.

use kernel::EventKind;

use crate::effect::Effect;
use crate::state::AgentState;

/// The one ending fact. Payload: `{"why": …, "rounds": n}`.
pub const ENDED: &str = "core.ended";

/// The model replied with prose. The turn's cheap exit, and the ONLY ending
/// after which there is a reply to read.
pub const ANSWERED: &str = "answered";

/// The model replied with machine output — a tool call this page could not read
/// (`reply::malformed_call`). Nothing ran and nothing was answered.
pub const NO_ANSWER: &str = "no answer";

/// The turn used every round of tool calls its agent file allows.
pub const ROUND_CEILING: &str = "round ceiling";

/// THE PASS BUDGET RAN OUT WHILE THE WORK WAS STILL GOING (22). Its own ending
/// beside `ROUND_CEILING`, and for R17-P0-2's reason: a six-part task was
/// abandoned and reported as `main finished`. A turn that stopped because it
/// ran out of laps — not because it finished — must never read as an answer,
/// so the surfaces get a word for it and the conversation says the work
/// stopped on the budget.
pub const PASS_CEILING: &str = "pass ceiling";

/// THE MODEL ANSWERED, AND THE ANSWER IS SHOWN — but the turn changed a file
/// and no command has run since, so nothing on this page knows whether it
/// worked (`crate::verify`). Not a failure and not a judgement about the
/// answer: an ending that says which of the two things a reader might assume is
/// actually known.
pub const UNCHECKED: &str = "unchecked";

/// END THE TURN, AND SAY WHY. Every arm of `step` that ends one goes through
/// here, so "what a turn ending clears" is written once and the reason is never
/// optional — the compiler asks for it at the call site.
pub(crate) fn end(state: &mut AgentState, why: &str) -> Effect {
    let payload = serde_json::json!({ "why": why, "rounds": state.tool_rounds }).to_string();
    (state.task, state.retries, state.tool_rounds) = (None, 0, 0);
    crate::verify::clear(state); // evidence is about ONE turn, like the rounds
    Effect::Emit {
        kind: EventKind::Custom {
            kind: ENDED.into(),
            payload_json: payload,
        },
    }
}

/// Why the turn ended, out of the payload. An unreadable record says nothing
/// rather than guessing a reason, and the surfaces treat that as today's
/// behaviour — which is what every log written before this reads as.
pub fn ended_why(payload_json: &str) -> String {
    serde_json::from_str::<serde_json::Value>(payload_json)
        .ok()
        .and_then(|v| v.get("why")?.as_str().map(str::to_string))
        .unwrap_or_default()
}

/// How many rounds of tool calls it had completed when it ended.
pub fn ended_rounds(payload_json: &str) -> u16 {
    serde_json::from_str::<serde_json::Value>(payload_json)
        .ok()
        .and_then(|v| v.get("rounds")?.as_u64())
        .unwrap_or(0) as u16
}

/// Whether an effect is one of these records rather than work. `stop::boundary`
/// asks: a turn that ended on its own is not a turn you cut off.
pub(crate) fn is_ending(effect: &Effect) -> bool {
    matches!(
        effect,
        Effect::Emit { kind: EventKind::Custom { kind, .. } } if kind == ENDED
    )
}

#[cfg(test)]
mod tests {
    use crate::state::AgentState;

    /// The reason and the count survive the round trip, and a turn that ended
    /// holds nothing a running one holds.
    #[test]
    fn an_ending_carries_its_reason_and_the_rounds_behind_it() {
        let mut state = AgentState::new();
        (state.task, state.tool_rounds) = (Some("do it".into()), 7);
        let effect = super::end(&mut state, super::ROUND_CEILING);
        assert!(super::is_ending(&effect));
        let crate::effect::Effect::Emit {
            kind: kernel::EventKind::Custom { payload_json, .. },
        } = &effect
        else {
            panic!("an ending is one emitted Custom fact")
        };
        assert_eq!(super::ended_why(payload_json), super::ROUND_CEILING);
        assert_eq!(super::ended_rounds(payload_json), 7);
        assert!(state.task.is_none(), "an ended turn holds no task");
        // A log written before this fact existed reads as no reason at all.
        assert_eq!(super::ended_why("null"), "");
    }
}
