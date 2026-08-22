//! THE THREE KEYS, AND THE FOUR REFUSALS.
//!
//! `spec::yaml` reads one line at a time and `spec::refuse_contradictions`
//! holds the rules that need the whole file in hand. The goal's half of each
//! lives here together, because the goal is ONE feature and splitting its
//! vocabulary across two files is how a key gets added in one and forgotten in
//! the other.
//!
//! DOTTED, NOT NESTED. `spec::yaml` reads `key: value`, a `- item` block list
//! and the inline `[a, b]` form, and is deliberately not a YAML parser. Three
//! dotted keys are three more `key: value` lines and no parser expansion at
//! all; a nested `goal:` block would be an indentation-sensitive shape that
//! reader has never had to understand, bought for nothing.
//!
//! THE CEILING, STATED (T50, I16). The strongest verification this harness can
//! express is ONE COMMAND'S EXIT CODE, and the strongest one the guest we ship
//! can actually produce is `test -f DONE.md`. **That proves a CLAIM was
//! written, not that anything WORKS** — an agent that writes the file and stops
//! satisfies it perfectly. Saying so here is the point of I16: the limit is
//! real either way, and a person choosing a `goal.check` should meet it while
//! choosing, not discover it from a run that reported success.
//!
//! THE CEILING IS THE GUEST'S, NOT THE LOOP'S. `passes::again` reads whatever
//! exit code the guest can produce; it has no opinion about how strong the
//! command is. So this rises for free as the environment gains capability
//! (`tracker.md` T44-T49) and needs no change here — which is also why the
//! tempting fix is the wrong one. Letting `goal.check` be a script, a pattern
//! or several commands would put a small language in the harness and start the
//! core parsing again, which is exactly what the briefs were moved out to
//! `public/stages/` to stop. One command, one exit code, is the right
//! primitive; what is missing is a guest that can run a strong one.
//!
//! EVERY REFUSAL HERE IS LOUD, on the rule that runs through the whole spec
//! module: a value this cannot honour is refused, never defaulted. A goal that
//! parses clean and gates nothing is `engine: reakt` with better manners.

use crate::error::AgentError;
use crate::spec::{bad, AgentSpec};

pub(crate) const OUTCOME: &str = "goal.outcome";
pub(crate) const CHECK: &str = "goal.check";
pub(crate) const DONE_WHEN: &str = "goal.done_when";

/// The vocabulary, in one place, so the reader that SETS these keys and the
/// refusal that PRINTS the legal ones cannot come apart.
pub(crate) const KEYS: [&str; 3] = [OUTCOME, CHECK, DONE_WHEN];

/// One `goal.*` line onto the spec. `false` is a key this does not hold, which
/// `yaml::set_field` then refuses along with every other unknown key — the rule
/// that made a misspelt `temprature:` loud rather than inert applies to a
/// misspelt `goal.chck:` for exactly the same reason.
pub(crate) fn field(spec: &mut AgentSpec, key: &str, value: &str) -> bool {
    match key {
        OUTCOME => spec.goal.outcome = value.into(),
        CHECK => spec.goal.check = value.into(),
        DONE_WHEN => spec.goal.done_when = value.into(),
        _ => return false,
    }
    true
}

/// THE FOUR WAYS A GOAL CAN BE WRITTEN AND MEAN NOTHING. Each needs the whole
/// file, so none of them can live in [`field`], and each is a refusal rather
/// than a dropped line: the file is asking for something it cannot have and
/// only its author knows which half was meant.
pub(crate) fn refuse(dir: &str, spec: &AgentSpec) -> Result<(), AgentError> {
    half_written(dir, &spec.goal)?;
    ungrounded(dir, spec)
}

/// THE TWO HALVES THAT NEED EACH OTHER: a goal is prose plus a command, and
/// either one alone is a file that means nothing it appears to mean.
fn half_written(dir: &str, goal: &crate::goal::Goal) -> Result<(), AgentError> {
    // A GOAL WITH NO CHECK IS THE SETTING THAT LOOKS APPLIED. The two prose
    // keys reach the model and change nothing about when the turn stops, so a
    // file declaring them alone would fall silently back to `acted` — the very
    // proxy the goal exists to replace, with a paragraph on screen implying
    // otherwise.
    if goal.check.is_empty() && !(goal.outcome.is_empty() && goal.done_when.is_empty()) {
        return Err(bad(
            dir,
            "goal.outcome and goal.done_when are read by the model; goal.check is the only \
             one a machine reads, and without it this turn still stops on whether the last \
             lap touched anything — add goal.check, or drop the goal",
        ));
    }
    // …and a check with no outcome is a command with no reason. Nothing on any
    // screen could say what the exit code was about.
    if !goal.check.is_empty() && goal.outcome.is_empty() {
        return Err(bad(
            dir,
            "goal.check stops the turn on a command's exit code and goal.outcome is the \
             only line that says what that command is for — add goal.outcome",
        ));
    }
    Ok(())
}

/// …AND THE TWO THINGS A CHECK NEEDS FROM THE REST OF THE FILE: a list to gate,
/// and a folder to run in. Neither is about the goal's own wording, which is
/// why they are not [`half_written`]'s business.
fn ungrounded(dir: &str, spec: &AgentSpec) -> Result<(), AgentError> {
    let goal = &spec.goal;
    // The identical rule `passes:` already carries: there is no list to lap, so
    // the check can gate nothing.
    if !goal.check.is_empty() && spec.stages.is_empty() {
        return Err(bad(
            dir,
            "goal.check gates the lap of a stages: list, so it needs one — add stages: \
             [plan, work, verify], or drop the goal",
        ));
    }
    // …and the same failure one key over. `core::workspace::gate::grant` hands
    // out a workspace ONLY from a space; with none, every `exec` is refused
    // before it reaches the port, so the check could never run at all.
    if !goal.check.is_empty() && spec.space.is_empty() {
        return Err(bad(
            dir,
            "goal.check runs a command in the folder a space grants, and this file names \
             no space — the check could never run — add a space:, or drop the goal",
        ));
    }
    Ok(())
}
