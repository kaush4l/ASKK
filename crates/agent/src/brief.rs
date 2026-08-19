//! WHAT EACH STAGE IS TOLD — the words that go into the `## directive` block,
//! the reply shape that goes with them where the machine will read it back,
//! and which stages may act at all.
//!
//! These are the PROMPTS; `stages.rs` is the machine that walks them. They are
//! apart because they change for different reasons and at different rates: a
//! wording is edited by reading what a model did with it, a cursor is edited by
//! reasoning about a turn.

use crate::components::ResponseContract as Contract;
use crate::stages::{ANSWER, CRITIQUE, PLAN, VERIFY};
use crate::strategy::{self, STRATEGY};

/// The goal→plan pre-pass, and the place SKILLS enter the prompt.
///
/// The plan stage is granted the skill tools and nothing else (`stages::
/// tool_scope`), so "read the ones that apply" is a real instruction rather
/// than a suggestion it has no way to act on. It is here and not in `work`
/// because instruction is cheapest to load before the work starts and most
/// expensive to discover you needed halfway through it.
const PLAN_BRIEF: &str = "First, turn the request into a brief and write nothing else. \
    Before you write it, call `list_skills`. If any of them is instruction for the kind of \
    work this is, `read_skill` it — its body is written for exactly this and will be better \
    than what you would improvise. Skip the call entirely if the work is plainly outside \
    everything listed.\n\n\
    Then write five lines, each starting with its word: OUTCOME — what will be true when \
    this is done. PATHS — the files, folders or commands involved, as far as they can be \
    named. CHECK — the one command whose output would show it worked. DONE WHEN — the \
    observable that ends the work. ASSUMED — what had to be filled in because the request \
    did not say.";

/// Verify: run the check the brief named, and quote what it printed. The word
/// this asks for is what was OBSERVED — it never asks for a verdict on the work.
const VERIFY_BRIEF: &str = "Now check the work instead of describing it. Run the command the \
    brief named under CHECK and read what it prints. Quote the line that shows the outcome, \
    whichever way it went. If nothing can be run here, say in one sentence what is unchecked \
    and why. Claim nothing you have not read back.";

/// Critique: the turn's own reviewer, and then the answer. Deliberately last
/// and deliberately toolless — its job is to say what is still missing, which
/// is the one thing a model that has been acting for sixty rounds stops doing.
///
/// This is where the separate `critic` agent went. It was a whole extra Worker,
/// a whole extra file and a whole extra model to load, and what it produced was
/// this: a reading of the turn by something that did not do the work. Asking
/// for that reading in a stage whose directive says to take that stance costs
/// one call instead of a second agent, and it is the same model either way.
const CRITIQUE_BRIEF: &str = "Now read the whole turn back as somebody who did not do it and \
    is not impressed by it. In at most three lines, name what is still wrong, missing or \
    unchecked — not what went well. Then answer the person: what was done, what was checked \
    and what was not. Do not restate the brief, and do not pad.";

/// THE GOAL HAS TO OUTLIVE THE WINDOW (22). `main` compacts at 8 entries, and
/// a turn that walks its stages five times will summarise away the brief it
/// opened with — the plan is then a thing the run used to know. The space is
/// the durable place: `remember` writes survive compaction, are re-read by
/// `core::space::refresh` before every pass, are already in the environment
/// block and already cross Workers. So this is prose and one tool that already
/// exists, not a second store. Added only where the agent HAS a space, because
/// telling an agent to call a tool it was never granted is noise in the window.
pub(crate) const DURABLE: &str = "\n\nAnd the first thing to do in the work that follows: call \
    `remember` twice — key `outcome` with the OUTCOME line, key `done_when` with the DONE WHEN \
    line. This window gets compacted; the shared space does not, and it is read back to you \
    before every pass.";

/// What the model is told on entering a stage. `work` and `answer` have nothing
/// to add — the person's own request is the instruction, and a second one would
/// compete with it.
pub fn brief(stage: &str) -> &'static str {
    match stage {
        STRATEGY => strategy::BRIEF,
        PLAN => PLAN_BRIEF,
        VERIFY => VERIFY_BRIEF,
        CRITIQUE => CRITIQUE_BRIEF,
        _ => "",
    }
}

/// The reply shape this stage demands, where it demands one.
///
/// `None` means "whatever the phase would have asked for anyway" — prose to the
/// person, or a tool envelope where there are tools. Only a stage whose reply
/// the MACHINE reads needs to override that, and today exactly one does.
pub(crate) fn contract(stage: &str) -> Option<Contract> {
    match stage {
        STRATEGY => Some(Contract::shaped(strategy::OBJECT)),
        _ => None,
    }
}

/// Whether this stage may act, and — where it may — with what.
///
/// `plan` is the interesting one. It is told to read skills, so refusing it
/// every tool would make that instruction a lie; granting it the whole toolbox
/// would let it start the work it is supposed to be planning. It gets the two
/// skill tools, which is exactly the capability the brief names.
pub(crate) fn skill_only(stage: &str) -> bool {
    stage == PLAN
}

/// Stages that may call the agent's full toolbox. `answer` is absent on
/// purpose: the strategy vote said this needs no tool, and the enforcement is
/// what makes the vote worth taking.
pub(crate) fn acts(stage: &str) -> bool {
    !matches!(stage, STRATEGY | PLAN | CRITIQUE | ANSWER)
}
