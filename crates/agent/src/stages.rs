//! THE LOOP AN AGENT FILE DECLARES — plan, work, verify, critique.
//!
//! The react loop is one stage of four, and which of the four an agent runs is
//! a line in its own `agent.md` (`stages: [plan, work, verify]`). A file that
//! names none runs exactly what this build has always run: work, and nothing
//! before or after it. That is the whole compatibility rule.
//!
//! A STAGE IS NOT A NEW MACHINE. It is one instruction pushed into the paper
//! and one more call, taken by the same `step` against the same window: the
//! stage's prose reply, instead of ending the turn, moves the cursor on and
//! opens the next one. So a stage cannot invent a transition the loop did not
//! already have, and there is no second state machine to keep in agreement
//! with the first.
//!
//! WHY THE PLAN STAGE EXISTS AT ALL. A goal typed by a person carries none of
//! the technical detail the work needs — which files, which command shows it
//! worked, what makes it done. Every harness answers that by demanding the
//! person write it into the prompt. One model call ahead of the work moves
//! that job to the model: the reply is a brief in five named lines, and it is
//! in the window for every round after it. The cognitive load shifts from
//! figuring out HOW to prompt to saying WHAT is wanted.
//!
//! WHY NOT TOOLS IN EVERY STAGE. `plan` and `critique` are told to call
//! nothing, and `ask::scoped_tools` enforces it rather than trusting the
//! sentence — the `engine: base` lesson (19): a capability that is described
//! but not enforced is a setting that looks applied.

use kernel::{EventKind, Timestamp};

use crate::ask::call_model;
use crate::effect::Effect;
use crate::state::AgentState;

pub const PLAN: &str = "plan";
pub const WORK: &str = "work";
pub const VERIFY: &str = "verify";
pub const CRITIQUE: &str = "critique";

/// The four, and there are only four — `spec` refuses any other name for the
/// reason `engine` refuses `reakt`: a stage that parses clean and selects
/// nothing is worse than no stage key at all.
pub const STAGES: [&str; 4] = [PLAN, WORK, VERIFY, CRITIQUE];

/// The fact a stage was entered. Emitted for `verify::VERIFY_NUDGED`'s reason
/// (I8): the machine added a round, and a round nobody can see is a model
/// talking to itself while the token meter charges for it.
pub const STAGE_ENTERED: &str = "core.stage_entered";

pub fn is_stage(name: &str) -> bool {
    STAGES.contains(&name)
}

/// Whether this stage may act. Work does the work and verify has to RUN the
/// check — a verify stage that could not run a command would be one more
/// model opinion about code it never executed.
pub fn tools_on(stage: &str) -> bool {
    matches!(stage, WORK | VERIFY)
}

/// The stage the turn is in. Absent `stages:` reads as `work`, which is what
/// makes a file with no stage key behave exactly as it did before this existed.
pub(crate) fn current(state: &AgentState) -> &str {
    state.stages.get(state.stage).map(String::as_str).unwrap_or(WORK)
}

/// The goal→plan pre-pass. Five named lines, and the escape hatch in the last
/// sentence: a greeting must not cost a plan.
const PLAN_BRIEF: &str = "[First, turn the request into a brief and write nothing else. Five \
    lines, each starting with its word: OUTCOME — what will be true when this is done. PATHS — \
    the files, folders or commands involved, as far as they can be named. CHECK — the one \
    command whose output would show it worked. DONE WHEN — the observable that ends the work. \
    ASSUMED — what had to be filled in because the request did not say. If the request is a \
    question or a greeting and needs no work, write the OUTCOME line alone. Call no tools.]";

/// Verify: run the check the brief named, and quote what it printed. The word
/// this asks for is what was OBSERVED — it never asks for a verdict on the work.
const VERIFY_BRIEF: &str = "[Now check the work instead of describing it. Run the command the \
    brief named under CHECK and read what it prints. Quote the line that shows the outcome, \
    whichever way it went. If nothing can be run here, say in one sentence what is unchecked \
    and why. Claim nothing you have not read back.]";

/// Critique: the turn's own reviewer, and then the answer. Deliberately last
/// and deliberately toolless — its job is to say what is still missing, which
/// is the one thing a model that has been acting for sixty rounds stops doing.
const CRITIQUE_BRIEF: &str = "[Now read the whole turn back as somebody who did not do it. In \
    at most three lines, name what is still wrong, missing or unchecked. Then answer the \
    person: what was done, what was checked and what was not. Call no tools, do not restate \
    the brief, and do not pad.]";

/// What the model is told on entering a stage. Work has nothing to add — the
/// person's own request is the instruction, and a second one would compete.
pub fn brief(stage: &str) -> &'static str {
    match stage {
        PLAN => PLAN_BRIEF,
        VERIFY => VERIFY_BRIEF,
        CRITIQUE => CRITIQUE_BRIEF,
        _ => "",
    }
}

/// Enter the stage the cursor is on: its instruction into the window, and the
/// fact into the log.
fn enter(state: &mut AgentState, at: Timestamp) -> Effect {
    let stage = current(state).to_string();
    let said = brief(&stage);
    if !said.is_empty() {
        crate::paper::push_history(&mut state.paper, "user", said, at);
    }
    entered(&stage)
}

/// The start of a turn. Empty for an agent with no `stages:`, which is why
/// nothing about the old single-stage turn changed.
pub(crate) fn open(state: &mut AgentState, at: Timestamp) -> Vec<Effect> {
    state.stage = 0;
    match state.stages.is_empty() {
        true => Vec::new(),
        false => vec![enter(state, at)],
    }
}

/// A stage produced prose. `None` when that was the last one — then the turn
/// ends the way it always has, through `ending`.
pub(crate) fn next(state: &mut AgentState, at: Timestamp) -> Option<Vec<Effect>> {
    if state.stage + 1 >= state.stages.len() {
        return None;
    }
    state.stage += 1;
    // The evidence flags are NOT cleared here: they are the turn's, and a
    // verify stage that forgot what the work stage wrote would ask the model
    // to check nothing (`verify.rs` — order is the freshness rule).
    let entered = enter(state, at);
    let call = call_model(state, at);
    Some(vec![entered, call])
}

/// Whether a `verify` stage is still AHEAD in this turn. The mechanical gate
/// in `verify.rs` and a declared verify stage answer the same question — "a
/// file changed and nothing has run since" — and a turn that fired both asked
/// the model twice and printed two notices saying it (browser walk, 20). The
/// declaration wins: it is the loop this agent's own file asked for.
pub(crate) fn verify_ahead(state: &AgentState) -> bool {
    state.stages.iter().skip(state.stage + 1).any(|s| s == VERIFY)
}

pub(crate) fn entered(stage: &str) -> Effect {
    Effect::Emit {
        kind: EventKind::Custom {
            kind: STAGE_ENTERED.into(),
            payload_json: serde_json::to_string(stage).unwrap_or_else(|_| "\"\"".into()),
        },
    }
}

/// Which stage a `STAGE_ENTERED` fact names, for the projections.
///
/// EVERY ASSERTION ABOUT THIS FILE IS IN `tests/stages.rs`, through `step` and
/// against the real shipped agent files — what a stage does is a sequence of
/// effects a turn produces, and a unit test of the cursor could pass while the
/// turn it drives ended in the wrong place.
pub fn stage_of(payload_json: &str) -> String {
    serde_json::from_str::<String>(payload_json).unwrap_or_default()
}
