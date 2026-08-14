//! THE STOP (R16-P0-2). Two consecutive critics named the same blocker: every
//! button on the page that says "Stop" means "stop looking". This is the one
//! that means "stop working", and it is the same shape as `state.steered` —
//! a fact the person made, recorded in `step`, acted on at the next boundary.
//!
//! It is an ABORT AT THE NEXT STEP BOUNDARY and not a kill. Nothing here can
//! interrupt a command already inside the Linux, or a sub-agent already running
//! in its own Worker: `step` describes work, it does not hold it. What it can
//! do — exactly, deterministically — is refuse to describe any more. So the
//! call in flight lands, and nothing new is started. The copy says that.

use kernel::EventKind;

use crate::effect::Effect;
use crate::state::AgentState;

/// The person pressed Stop. Carries nothing: only this process's own agent
/// runs in this loop, so there is no second agent it could be about.
pub const STOP_REQUESTED: &str = "core.stop_requested";

/// The fact the boundary records, with the rounds it had done behind it. ONE
/// fact, and both the conversation and the tool trace are folds of it — the
/// class of split round 16 was spent removing.
pub const STOPPED: &str = "core.stopped";

/// How many rounds of tool calls the stopped turn had made. The payload is the
/// number and nothing else; an unreadable one reads as none, which is what a
/// record with no rounds in it means.
pub fn rounds(payload_json: &str) -> u16 {
    payload_json.trim().parse().unwrap_or(0)
}

/// THE ONE FUNNEL. Every arm of `step` that starts new work does it by
/// RETURNING an effect, so a single check on the way out covers all of them —
/// the model call at the top of a turn, the retry after a failed compaction,
/// the tool batch a reply asked for, the next round after the last result.
/// Guarding them one at a time is four chances to miss the fifth.
///
/// An empty effect list is not a boundary: results are still landing, and the
/// last of them will produce the effect this catches.
///
/// AN ENDING IS NOT NEW WORK (R17-P0-2). Since `advance` says how a turn ended
/// by RETURNING a `core.ended` fact, an unfiltered check would read a turn that
/// answered on its own as one you cut off — and report a completed run as
/// stopped. The exemption is by fact kind, not by position, so it holds however
/// many arms end a turn.
///
/// A STEER IS NOT NEW WORK EITHER (R18-P0-1). It records that a sentence landed
/// mid-turn; the round in flight is what will carry it. Halting on it would end
/// the run at the keystroke rather than at the next thing it tried to do.
pub(crate) fn boundary(state: AgentState, effects: Vec<Effect>) -> (AgentState, Vec<Effect>) {
    // …NOR IS THE VERIFY NUDGE. It records that the machine asked a turn to
    // check itself; the call beside it is the work, and THAT is what this
    // catches. (It rides out with a `CallModel`, so a stopped turn still halts.)
    let record = |e: &Effect| {
        crate::ending::is_ending(e) || crate::steer::is_steer(e) || crate::verify::is_nudge(e)
    };
    let starts_work = effects.iter().any(|e| !record(e));
    match state.stopping && starts_work {
        true => halted(state),
        false => (state, effects),
    }
}

/// The turn ends here. Same shape as the round ceiling's own stop — clear the
/// task, say the number, and say what the number means.
fn halted(mut state: AgentState) -> (AgentState, Vec<Effect>) {
    let done = state.tool_rounds;
    (state.task, state.stopping) = (None, false);
    (state.tool_rounds, state.retries) = (0, 0);
    (
        state,
        vec![Effect::Emit {
            kind: EventKind::Custom {
                kind: STOPPED.into(),
                payload_json: done.to_string(),
            },
        }],
    )
}
