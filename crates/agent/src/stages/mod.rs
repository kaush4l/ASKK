//! THE LOOP A TURN RUNS — and, since the strategy stage, the loop the turn
//! CHOOSES.
//!
//! An agent file used to name its stages outright (`stages: [plan, work,
//! verify]`) and every turn walked all of them. That made the loop a property
//! of the agent when it is a property of the message: the same assistant that
//! should answer "hello" in one call should plan, work, check and critique when
//! asked to build something. `strategy` is one cheap call that reads the
//! message and picks; `crate::strategy` holds the three routes and why an
//! unreadable vote lands in the middle one.
//!
//! A STAGE IS NOT A NEW MACHINE. It is one instruction pushed into the paper
//! and one more call, taken by the same `step` against the same window: the
//! stage's prose reply, instead of ending the turn, moves the cursor on and
//! opens the next one. So a stage cannot invent a transition the loop did not
//! already have, and there is no second state machine to keep in agreement
//! with the first.
//!
//! WHY NOT TOOLS IN EVERY STAGE. `strategy`, `plan`, `critique` and `answer`
//! may not act, and `ask::scoped_tools` enforces it rather than trusting the
//! sentence — the `engine: base` lesson (19): a capability that is described
//! but not enforced is a setting that looks applied. `plan` is the one
//! exception and a narrow one: it is granted the two skill tools, because its
//! brief tells it to read skills and an instruction to call a tool the agent
//! was never given is noise.
//!
//! The FACTS a staged turn leaves behind, and the projections that read them,
//! are their own subject next door in `facts.rs`.

use kernel::Timestamp;

use crate::ask::call_model;
use crate::brief;
use crate::effect::Effect;
use crate::state::AgentState;
use crate::strategy::{self, STRATEGY};

mod facts;

pub use facts::{route_of, stage_of, ROUTE_CHOSEN, STAGE_ENTERED};
pub(crate) use facts::entered;
use facts::chosen;

pub const PLAN: &str = "plan";
pub const WORK: &str = "work";
pub const VERIFY: &str = "verify";
pub const CRITIQUE: &str = "critique";
/// Work with the tools taken away, which is what the `answer` route is. A
/// separate name rather than a flag on `work` because `stages::tools_on` is
/// read in four places and a stage list is the thing they all read.
pub const ANSWER: &str = "answer";

/// The stages that exist — `spec` refuses any other name for the reason
/// `engine` refuses `reakt`: a stage that parses clean and selects nothing is
/// worse than no stage key at all.
pub const STAGES: [&str; 6] = [STRATEGY, PLAN, WORK, VERIFY, CRITIQUE, ANSWER];


pub fn is_stage(name: &str) -> bool {
    STAGES.contains(&name)
}

/// Whether this stage may call the agent's full toolbox.
pub fn tools_on(stage: &str) -> bool {
    brief::acts(stage)
}

/// The stage the turn is in. Absent `stages:` reads as `work`, which is what
/// makes a file with no stage key behave exactly as it did before this existed.
pub(crate) fn current(state: &AgentState) -> &str {
    state.stages.get(state.stage).map(String::as_str).unwrap_or(WORK)
}

/// Enter the stage the cursor is on: its instruction into its own block, the
/// fact into the log. `Err(key)` is a stage whose brief never loaded, and
/// `brief::directive` says why that refuses rather than entering empty.
pub(crate) fn enter(state: &mut AgentState, at: Timestamp) -> Result<Effect, String> {
    let stage = current(state).to_string();
    let text = brief::directive(&state.briefs, &stage, state.space.is_some())?;
    crate::paper::set_component(&mut state.paper, &crate::components::Directive { text }, at);
    Ok(entered(&stage))
}

/// Enter the next stage and ask the model — or refuse the turn, in words. Every
/// cursor move comes through here, so no path can forget the refusal.
pub(crate) fn step_into(state: &mut AgentState, at: Timestamp) -> Vec<Effect> {
    match enter(state, at) {
        Ok(entered) => vec![entered, call_model(state, at)],
        Err(key) => crate::ending::unbriefed(state, &key),
    }
}

/// The start of a turn: the strategy vote first, then whatever it chooses.
///
/// A file that declares its own `stages:` keeps them — the route machinery is
/// what an agent gets by declaring `[strategy]`, not something imposed on every
/// file. Declaring nothing is still the bare react loop.
pub(crate) fn open(state: &mut AgentState, at: Timestamp) -> Vec<Effect> {
    state.stage = 0;
    crate::passes::open(state);
    // A turn that ran a route last time starts over from the declaration, or
    // the second message of a conversation would inherit the first's plan.
    state.stages = state.declared.clone();
    if state.stages.is_empty() {
        return Vec::new();
    }
    // Not `step_into`: the first call is the caller's, after compaction.
    match enter(state, at) {
        Ok(entered) => vec![entered],
        Err(key) => crate::ending::unbriefed(state, &key),
    }
}

/// A stage produced prose. `None` when that was the last one AND the turn has
/// not earned another pass — then the turn ends the way it always has, through
/// `ending`.
pub(crate) fn next(state: &mut AgentState, reply: &str, at: Timestamp) -> Option<Vec<Effect>> {
    // THE VOTE IS THE ONLY REPLY THAT REWRITES THE LIST. Read here rather than
    // in `step` because this is where a stage's reply is already in hand, and
    // splitting "read the reply" from "act on it" is how the two drift.
    if current(state) == STRATEGY {
        return Some(route(state, reply, at));
    }
    if state.stage + 1 >= state.stages.len() {
        // …OR ROUND AGAIN, back to `work` and never to the start (22). The
        // budget and the mechanical continue condition are both in `passes`.
        return crate::passes::again(state, at);
    }
    state.stage += 1;
    // The evidence flags are NOT cleared here: they are the turn's, and a
    // verify stage that forgot what the work stage wrote would ask the model
    // to check nothing (`verify.rs` — order is the freshness rule).
    Some(step_into(state, at))
}

/// Install the route the vote named and open its first stage. The vote itself
/// never reaches the person: it is a decision about the turn, not a turn.
fn route(state: &mut AgentState, reply: &str, at: Timestamp) -> Vec<Effect> {
    let route = strategy::route_of(reply);
    state.stages = route.stages();
    state.stage = 0;
    let chosen = chosen(route, reply);
    std::iter::once(chosen).chain(step_into(state, at)).collect()
}

/// Whether a `verify` stage is still AHEAD in this turn. The mechanical gate
/// in `verify.rs` and a declared verify stage answer the same question — "a
/// file changed and nothing has run since" — and a turn that fired both asked
/// the model twice and printed two notices saying it (browser walk, 20). The
/// declaration wins: it is the loop this agent's own file asked for.
pub(crate) fn verify_ahead(state: &AgentState) -> bool {
    state.stages.iter().skip(state.stage + 1).any(|s| s == VERIFY)
}
