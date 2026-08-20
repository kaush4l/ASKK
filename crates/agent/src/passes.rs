//! THE LOOP AROUND THE LOOP — one turn walking its `stages:` list more than
//! once, so an agent keeps working toward a goal across passes without a person
//! typing "carry on" between each of them. `passes:` in the file is the budget;
//! 1 is the default and 1 is byte-for-byte the turn this build has always taken.
//!
//! THE CONTINUE CONDITION IS MECHANICAL, AND THAT IS THE WHOLE POINT. It is
//! never the model's verdict on its own progress. A local 12B asked "are you
//! done?" answers "not yet" indefinitely — the documented AutoGPT failure
//! (Significant-Gravitas/AutoGPT #1994, #3444) — and this app ships against
//! exactly such a model. So the prose decides WHAT to do next and this fold
//! decides whether there IS a next: a pass that mutated nothing and ran nothing
//! has not earned another one, and a pass with no tool call in it at all is the
//! loop's natural end. The evidence is the one `verify::observe` already folds
//! (`state.acted`), reset at every lap.
//!
//! …AND WHERE A GOAL IS DECLARED, THE EVIDENCE IS AN EXIT CODE INSTEAD (26).
//! `acted` is still a proxy — it says the lap moved, not that the work is done
//! — so an agent file may declare `goal.check`, and then this fold reads what
//! that command returned and never `acted` at all. `crate::goal` holds the
//! whole argument, both phases of it, and why the check cannot run from here.
//!
//! IT LOOPS BACK TO `work`, NOT TO THE START. Re-planning from scratch every
//! pass is how a run drifts off the goal it opened with; the plan stage runs
//! once, and every later pass is work-and-check against it.
//!
//! THE ROUND BUDGET SPANS THE PASSES. `max_rounds` is per-TURN and only
//! `ending::end` clears `tool_rounds` — a pass is not an ending, so it does not
//! clear them, and the real ceiling stays `max_rounds` rather than quietly
//! becoming `max_rounds × passes`. That product is the user's bill, so the test
//! for it is not optional.

use kernel::{EventKind, Timestamp};

use crate::effect::Effect;
use crate::state::AgentState;
use crate::stages::WORK;

/// A lap was spent. Emitted so the passes are VISIBLE, projected beside
/// `core.stage_entered` (I8): a loop nobody can see is a token meter running
/// behind a spinner. Payload: `{"pass": n, "of": m}`, both 1-based.
pub const PASS_SPENT: &str = "core.pass_spent";

/// The cursor ran off the end of the stage list. Either the turn goes round
/// again — a lap spent, the cursor back on `work`, the model asked — or this
/// says `None` and the turn ends the way it always has, through `ending`.
pub(crate) fn again(state: &mut AgentState, at: Timestamp) -> Option<Vec<Effect>> {
    // No stages, no laps: an agent with no `stages:` cannot be here twice.
    // The lap goes back to the stage that acts, which on the `answer` route is
    // `answer` — the same stage with its tools taken away. A route with neither
    // is not a route that can loop.
    let work = state
        .stages
        .iter()
        .position(|s| s == WORK || s == crate::stages::ANSWER)?;
    // PHASE ONE OF THE GOAL CHECK (26), ahead of every decision below: a
    // declared goal that has not been read yet this lap is READ FIRST, and
    // nothing is decided until its exit code comes back through
    // `goal::returned`, which re-enters here with `met` set.
    if crate::goal::declared(state) && state.standing.met.is_none() {
        return Some(crate::goal::check(state));
    }
    if state.pass + 1 >= state.passes || !crate::goal::earned(state) {
        return None;
    }
    state.pass += 1;
    // Each pass earns its OWN continuation. Carrying the flag forward would let
    // one productive pass buy the whole budget for four silent ones after it,
    // and a goal met on one lap say nothing about the next.
    (state.acted, state.standing.met) = (false, None);
    state.stage = work;
    let spent = spent(state.pass + 1, state.passes);
    // A lap that cannot enter its stage is a lap that refuses it: `step_into`
    // ends the turn in words rather than working on unbriefed (`crate::brief`).
    Some(std::iter::once(spent).chain(crate::stages::step_into(state, at)).collect())
}

/// Whether the turn is ending because the BUDGET ran out rather than because
/// the work did. Asked only once the cursor has run off the end, so "wanted
/// another pass" is `acted` and "may not have one" is the budget.
///
/// It answers `false` for an agent that declared no budget, and that is what
/// keeps every other agent's ending word exactly what it was.
pub(crate) fn exhausted(state: &AgentState) -> bool {
    state.passes > 1 && state.pass + 1 >= state.passes && crate::goal::earned(state)
}

/// Turn-scoped, like the evidence flags: a new turn starts on lap one, with
/// nothing observed about its goal and no check in flight.
pub(crate) fn open(state: &mut AgentState) {
    (state.pass, state.acted) = (0, false);
    crate::goal::clear(state);
}

fn spent(pass: u16, of: u16) -> Effect {
    Effect::Emit {
        kind: EventKind::Custom {
            kind: PASS_SPENT.into(),
            payload_json: serde_json::json!({ "pass": pass, "of": of }).to_string(),
        },
    }
}

/// Which lap of how many one `PASS_SPENT` fact names, for the projections. An
/// unreadable record reads as no lap at all, like every other payload here.
pub fn pass_of(payload_json: &str) -> (u16, u16) {
    let read = |v: &serde_json::Value, k: &str| v.get(k).and_then(|n| n.as_u64()).unwrap_or(0) as u16;
    serde_json::from_str::<serde_json::Value>(payload_json)
        .map(|v| (read(&v, "pass"), read(&v, "of")))
        .unwrap_or((0, 0))
}
