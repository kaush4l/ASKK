//! THE STEER, AS A FACT (R18-P0-1).
//!
//! A sentence typed into a running turn is steering: `step` appends it to the
//! history, emits nothing else, and the next `call_model` carries it. That has
//! been right since the composer was unlocked — and it was recorded in
//! `state.steered` and nowhere else, so no projection could see it.
//!
//! The conversation therefore read the only shape it had: a message over a turn
//! with no answer under it, which is ALSO what a reload leaves. It drew the
//! reload note, word for word, for a steer — *"the page was reloaded while it
//! was in flight, so nothing is driving it"* — over a turn that was running and
//! went on running. Two causes, one sentence, and the sentence named the wrong
//! one.
//!
//! This is `ending.rs`'s argument one act earlier: the machine knows the
//! difference, a serialized state field is not reachable by a projection, and
//! I8 says every view is a fold of the log. So the steer says so in the log.

use kernel::EventKind;

use crate::effect::Effect;

/// The one steer fact. It carries nothing: the sentence it is about is the
/// `UserMessage` immediately before it, already in the log in full.
pub const STEERED: &str = "core.steered";

/// The record a steer leaves. Not an ending and not work — the turn it lands
/// in neither ends nor starts anything, which is exactly why `stop::boundary`
/// must let it past.
pub(crate) fn carried() -> Effect {
    Effect::Emit {
        kind: EventKind::Custom {
            kind: STEERED.into(),
            payload_json: "null".into(),
        },
    }
}

/// Whether an effect is that record. `stop::boundary` asks, for the reason
/// `ending::is_ending` exists: a turn you steered under a pressed Stop is not a
/// turn that started new work, and halting on it would end the run at the
/// keystroke rather than at the next thing it tried to do.
pub(crate) fn is_steer(effect: &Effect) -> bool {
    matches!(
        effect,
        Effect::Emit { kind: EventKind::Custom { kind, .. } } if kind == STEERED
    )
}
