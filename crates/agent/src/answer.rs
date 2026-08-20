//! THE ANSWER PATH — what happens when a reply is not a tool call.
//!
//! `step.rs` owns every transition; this owns the one arm where a turn tries to
//! END, which is a run of questions rather than one: was this even a turn, has
//! an unanswered steer overtaken it, is it machine output pretending to be
//! prose, has it changed a file with nothing run since, is there another stage
//! to walk — and only then, how did it end.
//!
//! The ORDER of those questions is the whole design here, and each one is a
//! function below saying why it sits where it does.

use crate::ask::call_model;
use crate::effect::Effect;
use crate::reply::malformed_call;
use crate::state::AgentState;
use crate::{ending, paper, stages, verify};

/// A reply with no readable calls in it. Returns the effects that end the turn,
/// or the ones that keep it going for one more round.
pub(crate) fn answered(
    mut state: AgentState,
    text: &str,
    at: kernel::Timestamp,
) -> (AgentState, Vec<Effect>) {
    if stages::current(&state) == crate::strategy::STRATEGY {
        return voted(state, text, at);
    }
    paper::push_history(&mut state.paper, "assistant", text.trim(), at);
    if state.steered {
        return carrying_the_steer(state, at);
    }
    if malformed_call(text) {
        let effect = ending::end(&mut state, ending::NO_ANSWER);
        return (state, vec![effect]);
    }
    if !stages::verify_ahead(&state) && verify::hold(&mut state) {
        return nudged(state, at);
    }
    // …AND A STAGE THAT IS NOT THE LAST ONE DOES NOT END THE TURN (20). It
    // moves the cursor on and asks again under the next stage's instruction:
    // plan hands its brief to work, work hands its result to verify. Behind the
    // gate above, because a declared verify stage is a better answer to
    // "nothing has run since" than a nudge is — but only if the gate has
    // already had its say about the work stage itself.
    if let Some(effects) = stages::next(&mut state, text, at) {
        return (state, effects);
    }
    let why = why(&state);
    let effect = ending::end(&mut state, why);
    (state, vec![effect])
}

/// THE STRATEGY VOTE IS NOT A TURN, so it is not written down as one — which is
/// why this is ahead of everything else, including the history write.
///
/// It is the machine asking the model a question ABOUT the message. Putting
/// `assistant: ROUTE: project` in the conversation would leave the person
/// reading a reply they were never given, and would leave the model reading its
/// own routing decision back as context on every turn after it. The gate, the
/// ending words and the steer check are all about a turn that tried to ANSWER,
/// and this did not.
fn voted(mut state: AgentState, text: &str, at: kernel::Timestamp) -> (AgentState, Vec<Effect>) {
    let effects = stages::next(&mut state, text, at).unwrap_or_default();
    (state, effects)
}

/// A steer that arrived while THIS call was in flight has not been answered by
/// it — the model never saw it. Ending the turn here would leave the sentence
/// sitting in the history unanswered, with the reply to the PREVIOUS question
/// rendered directly beneath it and nothing on screen saying it had been
/// ignored. So the turn continues instead: one more call, carrying it.
fn carrying_the_steer(mut state: AgentState, at: kernel::Timestamp) -> (AgentState, Vec<Effect>) {
    state.steered = false;
    let effect = call_model(&mut state, at);
    (state, vec![effect])
}

/// THE GATE. It holds a prose answer over a turn that changed a file with
/// nothing run since — twice, and then the answer lands and the ending says
/// what is not known about it. The nudge is a FACT, not a silent injection: a
/// round the machine added must be visible as the machine's.
fn nudged(mut state: AgentState, at: kernel::Timestamp) -> (AgentState, Vec<Effect>) {
    let nudge = crate::components::Directive { text: verify::NUDGE.into() };
    paper::set_component(&mut state.paper, &nudge, at);
    let effect = call_model(&mut state, at);
    (state, vec![verify::nudged(), effect])
}

/// WHICH ENDING THIS TURN EARNED. Five folds already computed, read in the
/// order of how much each one narrows what a person should do next.
///
/// AN UNMET DECLARED GOAL COMES FIRST (26), ahead of the pass ceiling it would
/// otherwise be reported as. Reaching here with `met == Some(false)` can only
/// mean the harness ran the declared command, read a non-zero exit code, and
/// had no lap left — so the budget did stop it, and the pass ceiling is true as
/// far as it goes. It is just the weaker of two true things: "it was still
/// changing files" is a fold over which tools got called, and "the command this
/// file nominated still fails" is the command's own answer. The stronger
/// statement wins, and it names a different act — read the check, not raise
/// `passes:`.
///
/// Running out of passes comes next (22): a turn the budget cut off is not a
/// turn that answered, and R17-P0-2 is the whole reason this file names endings
/// at all.
///
/// …AND A TURN THE CRITIC DID NOT CLEAR IS NOT A TURN THAT ANSWERED (25). It
/// sits between the pass budget and the verify gate: running out of passes is
/// the more specific thing to say about a turn that did both, and a fault is a
/// stronger statement about the work than "nothing read it back". `reviewed` is
/// the fold in `verify::observe` over a separate agent's answer, never a reading
/// of this model's prose — the caller cannot summarise its way past it.
pub(crate) fn why(state: &AgentState) -> &'static str {
    match (
        state.standing.met == Some(false),
        crate::passes::exhausted(state),
        state.reviewed == Some(false),
        state.mutated && !state.green,
    ) {
        (true, ..) => ending::GOAL_UNMET,
        (_, true, _, _) => ending::PASS_CEILING,
        (_, _, true, _) => ending::CRITIC_FAULTED,
        (_, _, _, true) => ending::UNCHECKED,
        _ => ending::ANSWERED,
    }
}
