//! THE ANSWER PATH — what happens when a reply is not a tool call.
//!
//! Lifted out of `step.rs`, which was at exactly 200 lines (I12) before the
//! verify gate needed eight of them. `step.rs` still owns every transition; this
//! owns the one arm where a turn tries to end, which is now three questions in a
//! row rather than one: has an unanswered steer overtaken it, has it changed a
//! file with nothing run since, and — only then — how did it end.

use crate::ask::call_model;
use crate::effect::Effect;
use crate::state::AgentState;
use crate::{ending, paper, stages, verify};
use crate::reply::malformed_call;

/// A reply with no readable calls in it. Returns the effects that end the turn,
/// or the ones that keep it going for one more round.
pub(crate) fn answered(
    mut state: AgentState,
    text: &str,
    at: kernel::Timestamp,
) -> (AgentState, Vec<Effect>) {
    paper::push_history(&mut state.paper, "assistant", text.trim(), at);
    // A steer that arrived while THIS call was in flight has not been answered
    // by it — the model never saw it. Ending the turn here would leave the
    // sentence sitting in the history unanswered, with the reply to the PREVIOUS
    // question rendered directly beneath it and nothing on screen saying it had
    // been ignored. So the turn continues instead: one more call, carrying it.
    if state.steered {
        state.steered = false;
        let effect = call_model(&mut state, at);
        return (state, vec![effect]);
    }
    // …AND A TURN ENDS BY SAYING SO (R17-P0-2). The tool contract is total, so
    // "no call in this text" meant "the model answered" — and the run that
    // stranded a six-part task ended on `exec({…}, {…}, …)`, which is neither.
    // The shape it OPENS with is the one thing this can be sure of.
    if malformed_call(text) {
        let effect = ending::end(&mut state, ending::NO_ANSWER);
        return (state, vec![effect]);
    }
    // THE GATE. It holds a prose answer over a turn that changed a file with
    // nothing run since — twice, and then the answer lands and the ending says
    // what is not known about it. The nudge is a FACT, not a silent injection:
    // a round the machine added must be visible as the machine's.
    if !stages::verify_ahead(&state) && verify::hold(&mut state) {
        paper::push_history(&mut state.paper, "user", verify::NUDGE, at);
        let effect = call_model(&mut state, at);
        return (state, vec![verify::nudged(), effect]);
    }
    // …AND A STAGE THAT IS NOT THE LAST ONE DOES NOT END THE TURN (20). It
    // moves the cursor on and asks again under the next stage's instruction:
    // plan hands its brief to work, work hands its result to verify. Ahead of
    // the ending and BEHIND the gate above, because a declared verify stage is
    // a better answer to "nothing has run since" than a nudge is — but only if
    // the gate has already had its say about the work stage itself.
    if let Some(effects) = stages::next(&mut state, at) {
        return (state, effects);
    }
    let why = match state.mutated && !state.green {
        true => ending::UNCHECKED,
        false => ending::ANSWERED,
    };
    let effect = ending::end(&mut state, why);
    (state, vec![effect])
}
