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
    // THE STRATEGY VOTE IS NOT A TURN, so it is not written down as one. It is
    // the machine asking the model a question about the message; putting
    // `assistant: ROUTE: project` in the conversation would leave the person
    // reading a reply they were never given, and would leave the model reading
    // its own routing decision back as context on every turn after it. Ahead of
    // everything else here for that reason: the gate, the ending words and the
    // steer check are all about a turn that tried to ANSWER, and this did not.
    if stages::current(&state) == crate::strategy::STRATEGY {
        let effects = stages::next(&mut state, text, at).unwrap_or_default();
        return (state, effects);
    }
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
        let nudge = crate::components::Directive { text: verify::NUDGE.into() };
        paper::set_component(&mut state.paper, &nudge, at);
        let effect = call_model(&mut state, at);
        return (state, vec![verify::nudged(), effect]);
    }
    // …AND A STAGE THAT IS NOT THE LAST ONE DOES NOT END THE TURN (20). It
    // moves the cursor on and asks again under the next stage's instruction:
    // plan hands its brief to work, work hands its result to verify. Ahead of
    // the ending and BEHIND the gate above, because a declared verify stage is
    // a better answer to "nothing has run since" than a nudge is — but only if
    // the gate has already had its say about the work stage itself.
    if let Some(effects) = stages::next(&mut state, text, at) {
        return (state, effects);
    }
    // …AND RUNNING OUT OF PASSES IS ITS OWN ENDING (22), ahead of the other
    // two: a turn the budget cut off is not a turn that answered, and R17-P0-2
    // is the whole reason this file names endings at all.
    let why = why(&state);
    let effect = ending::end(&mut state, why);
    (state, vec![effect])
}

/// WHICH ENDING THIS TURN EARNED. Four folds already computed, read in the
/// order of how much each one narrows what a person should do next.
///
/// …AND A TURN THE CRITIC DID NOT CLEAR IS NOT A TURN THAT ANSWERED (25). It
/// sits between the pass budget and the verify gate: running out of passes is
/// the more specific thing to say about a turn that did both, and a fault is a
/// stronger statement about the work than "nothing read it back". `reviewed` is
/// the fold in `verify::observe` over a separate agent's answer, never a reading
/// of this model's prose — the caller cannot summarise its way past it.
fn why(state: &AgentState) -> &'static str {
    match (
        crate::passes::exhausted(state),
        state.reviewed == Some(false),
        state.mutated && !state.green,
    ) {
        (true, _, _) => ending::PASS_CEILING,
        (_, true, _) => ending::CRITIC_FAULTED,
        (_, _, true) => ending::UNCHECKED,
        _ => ending::ANSWERED,
    }
}
