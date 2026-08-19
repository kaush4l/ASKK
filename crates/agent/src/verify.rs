//! THE VERIFY GATE — a fold over what the turn already recorded.
//!
//! An agent that writes a file and then says "done" has told you nothing you
//! can check, and eighteen rounds of work went into this page not claiming
//! things its own records disprove. So: if a turn changed a file and no command
//! has run since, a prose answer does not end it. The model is asked once more,
//! twice at most, and then the answer LANDS with an ending that says what is
//! and is not known about it.
//!
//! There is no ledger and no clock. Every tool result is already a fact in the
//! append-only log (`EventKind::ToolInvoked`), and **log order IS the freshness
//! rule**: this is a left-to-right fold, so a mutation clears the flag and any
//! evidence that survives to the end necessarily came after the last edit. That
//! is the whole freshness mechanism, and it is one line of `observe`.
//!
//! WHAT IT DOES NOT DO, deliberately: it does not judge whether the answer is
//! right, it does not run anything itself, it never refuses an answer
//! permanently, and it does not touch a turn that changed nothing. It is a
//! policy fold, not a verifier — which is why the word `verified` appears
//! nowhere in it, nor in anything it puts on screen.

use kernel::EventKind;

use crate::effect::Effect;
use crate::state::AgentState;

/// The one nudge fact. Emitted for `steer::STEERED`'s reason: the machine added
/// a round, a state field is not reachable by a projection, and I8 says every
/// view is a fold of the log. Without it the transcript shows a model talking
/// to itself and the token meter charges for a turn nobody can see.
pub const VERIFY_NUDGED: &str = "core.verify_nudged";

/// How many times one turn may be asked to check itself. Two, then the answer
/// lands: a gate that can hold an answer forever is a gate that loses answers.
const MAX_NUDGES: u8 = 2;

/// Whether this tool CHANGED something. A closed list, not a classifier:
/// guessing whether `sed -i` mutates is exactly the cleverness that produces a
/// wrong badge, and `exec` is left out on purpose — an agent that ran `ls` has
/// changed nothing, and counting it would nudge every read-only turn.
pub fn is_mutating(tool: &str) -> bool {
    matches!(tool, "write_file" | "write_agent")
}

/// Whether a tool result carried anything at all — blank output, or one of the
/// two phrases this codebase prints in place of it. `(nothing yet)` is the END
/// of a `read_process` answer, under a line naming the process and its line
/// count, so this is a suffix and not an equality.
///
/// IT LIVES HERE SO THERE IS ONE COPY. `core::trace::trustworthy` refuses to say `ok` about
/// a command that printed nothing and `core::terminal::row` writes `ok, and it
/// printed nothing` beside it; this decides whether the same command counts as
/// evidence. If those ever diverged the page could say a thing was checked over
/// a row saying it printed nothing — two surfaces, one turn, two stories.
pub fn says_nothing(output: &str) -> bool {
    let said = output.trim();
    said.is_empty() || said == "(no output)" || said.ends_with("(nothing yet)")
}

/// One tool result folded into the turn's evidence. ORDERING IS THE FRESHNESS
/// RULE: a successful mutation clears the flag, so anything still green at the
/// end postdates the edit it is offered for.
pub(crate) fn observe(state: &mut AgentState, tool: &str, ok: bool, output: &str) {
    if ok && is_mutating(tool) {
        (state.mutated, state.green, state.acted) = (true, false, true);
        // …AND A REVIEW OF WHAT THE FILE USED TO SAY IS NOT A REVIEW OF THIS
        // ONE (25). Same freshness rule as `green`, one line along: a verdict
        // handed down before the last edit has nothing to do with the edit.
        state.reviewed = None;
    }
    if ok && tool == "exec" && !says_nothing(output) {
        (state.green, state.acted) = (true, true);
    }
    // THE SEPARATE AGENT'S VERDICT, FOLDED LIKE ANY OTHER RESULT (25). This
    // file judges nothing — it records what the agent holding `role: critic`
    // said, and `crate::critic` holds why anything but a pass is not one.
    if !state.critic.is_empty() && tool == state.critic {
        state.reviewed = Some(ok && crate::critic::passed(output));
    }
}

/// Turn-scoped, like `pending_tools` and `tool_rounds`: cleared where they are.
pub(crate) fn clear(state: &mut AgentState) {
    (state.mutated, state.green, state.nudges) = (false, false, 0);
    // …and the verdict: a review belongs to the turn whose work it read.
    state.reviewed = None;
    // …and `acted`, which is the same fold on a shorter clock: `passes` resets
    // it at every lap, this resets it at every turn.
    state.acted = false;
}

/// Whether this answer may end the turn yet. Consumes a nudge when it may not,
/// so the caller cannot loop on it.
pub(crate) fn hold(state: &mut AgentState) -> bool {
    if !state.mutated || state.green || state.nudges >= MAX_NUDGES {
        return false;
    }
    state.nudges += 1;
    true
}

/// WHAT THE MODEL IS TOLD, and it is told what was observed and nothing more.
/// It does not say the work is wrong — nobody knows that — it says a file was
/// written and nothing has read it back since.
pub const NUDGE: &str = "[This turn changed a file and nothing has run since. Run the command \
                         that would show it worked and read what it prints. If nothing can be \
                         run here, say what is unchecked and why, in one sentence. Do not claim \
                         it works.]";

/// The record the nudge leaves. Not an ending and not work — the same shape as
/// `steer::carried`, and `stop::boundary` must let it past for the same reason.
pub(crate) fn nudged() -> Effect {
    Effect::Emit {
        kind: EventKind::Custom {
            kind: VERIFY_NUDGED.into(),
            payload_json: "null".into(),
        },
    }
}

/// Whether an effect is that record.
pub(crate) fn is_nudge(effect: &Effect) -> bool {
    matches!(
        effect,
        Effect::Emit { kind: EventKind::Custom { kind, .. } } if kind == VERIFY_NUDGED
    )
}

#[cfg(test)]
mod tests {
    use crate::state::AgentState;

    /// A write with a command after it is checked; the same command BEFORE the
    /// write is not, because the write invalidated it.
    #[test]
    fn order_is_the_freshness_rule() {
        let mut s = AgentState::new();
        super::observe(&mut s, "exec", true, "42");
        super::observe(&mut s, "write_file", true, "wrote notes.md");
        assert!(s.mutated && !s.green, "the write cleared earlier evidence");
        assert!(super::hold(&mut s), "held: nothing has run since the write");
        super::observe(&mut s, "exec", true, "42");
        assert!(s.green);
        assert!(!super::hold(&mut s), "a command ran and printed something");
    }

    /// A silent command is not evidence, a failed one is not either, and the
    /// hold gives up after two asks rather than eating the answer.
    #[test]
    fn silence_is_not_evidence_and_the_hold_gives_up() {
        let mut s = AgentState::new();
        super::observe(&mut s, "write_file", true, "ok");
        super::observe(&mut s, "exec", true, "  \n");
        super::observe(&mut s, "exec", false, "no such file");
        assert!(!s.green);
        assert!(super::hold(&mut s) && super::hold(&mut s));
        assert!(!super::hold(&mut s), "two nudges, then the answer lands");
        super::clear(&mut s);
        assert!(!s.mutated && s.nudges == 0);
    }
}
