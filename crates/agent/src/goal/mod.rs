//! THE STANDING GOAL — a continue condition that is an OBSERVED EXIT CODE.
//!
//! `crate::passes` continues a turn on `state.acted`: whether this lap changed
//! or ran anything. That is a proxy for progress and never a measure of the
//! goal, and the gap between the two is the whole reason this file exists — an
//! agent that keeps touching files keeps earning laps whether or not the thing
//! it was asked for is true yet. Meanwhile `public/stages/plan.md` asks the
//! model to write a CHECK line and NO MACHINE HAS EVER READ THAT LINE BACK. So
//! "is this done?" was answered by "did the model keep moving?".
//!
//! An agent file may declare a goal instead — an outcome, one command, and the
//! observable that ends the work — and the loop then continues or stops on that
//! command's exit code. Not on a verdict: a local 12B asked "are you done?"
//! answers "not yet" indefinitely (`passes.rs` cites the AutoGPT issues), and
//! "did it work?" is the same question one word over.
//!
//! IT IS TWO PHASES BECAUSE `step` IS PURE (I7). `WorkspacePort::exec` is async
//! and `step` cannot await, so the check is DESCRIBED on one step and DECIDED
//! on the next: [`check`] returns an `Effect::InvokeTool`, the result comes back
//! as an ordinary `ToolInvoked` event, and [`returned`] folds it. The machine
//! still runs nothing; it says what it wants run, which is the contract every
//! tool call in this crate already has.
//!
//! THE CORRELATION IS `checking`, AND IT IS SOUND. The harness asks for the
//! check only once the cursor has run off the end of the stage list after a
//! PROSE reply, so `state.pending_tools` is 0 and no model-issued call is
//! outstanding — the same "the batch is complete" fact `pending_tools` already
//! carries everywhere else. Nothing else can be in flight to confuse it with.
//! `tests/goal.rs` asserts that precondition rather than trusting this
//! paragraph.
//!
//! WHY THE EXIT CODE IS NOT WIDENED INTO `EventKind::ToolInvoked`. The obvious
//! move is a `status: i32` beside `ok`, because the numeral looks lost. It is
//! not, and it would be the wrong trade:
//!
//! - `core::workspace::gate` computes `ok` as `ran.status == 0`, straight off
//!   `Execution.status` from the port. So `ok` **is** the observed exit code,
//!   collapsed to the one bit the continue condition needs. It is not a model's
//!   report and not a parse of output — it is the port's own number, tested at
//!   the only place in this app a command runs.
//! - The numeral is not gone either: `gate::said` appends `(exit status N)` to
//!   the output whenever it is non-zero, so a person reading the trace sees it.
//! - "Continue or stop" is binary. `EventKind` is closed on purpose, and
//!   widening a closed kernel vocabulary to carry a number nothing branches on
//!   is speculative generality with about fifteen construction sites and every
//!   exhaustive destructure behind it.
//!
//! WHAT WOULD CHANGE THIS: a continue condition that has to tell exit 1 from
//! exit 2 — a check whose codes mean different things, not merely pass and
//! fail. None exists. When one does, widen it then, for that reason.
//!
//! …AND THE HARNESS DOES NOT NEED `exec` IN THE AGENT'S `tools:` LIST. The
//! allowlist is applied at reply-parse time (`subagent::invoke_or_refuse`), to
//! calls the MODEL wrote; this effect never goes through it. The check runs on
//! the SPACE grant alone (`core::workspace::gate::grant`), which is why
//! [`declare::refuse`] insists on a space and not on a tool. A read-only agent
//! can therefore be gated by a command it could not itself run, which is the
//! right shape: the measuring instrument does not belong to the thing measured.

pub(crate) mod declare;
pub(crate) mod fact;

use kernel::{Timestamp, ToolId};
use serde::{Deserialize, Serialize};

use crate::components::Observations;
use crate::effect::Effect;
use crate::state::AgentState;

/// The tool the check is issued through. One name, because there is one place
/// in this app a command runs: the harness's check and the model's own `exec`
/// are the same command in the same folder, under the same grant.
const EXEC: &str = "exec";

/// WHAT AN AGENT FILE DECLARED IT IS FOR. Three lines, and only `check` is read
/// by a machine — `outcome` and `done_when` are what the MODEL is told
/// (`components::Goal`). An empty `check` is an agent that declared no goal,
/// which is every agent written before this key existed and the reason none of
/// their turns changed.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Goal {
    #[serde(default)] pub outcome: String,
    #[serde(default)] pub check: String,
    #[serde(default)] pub done_when: String,
}

/// The declaration, plus what the harness has OBSERVED about it on this lap.
///
/// `checking` says the next tool result is the harness's own; `met` is the
/// exit code, `None` where this lap has not read it yet. Both are turn-scoped
/// and lap-scoped — [`clear`] empties them at every ending and `passes::again`
/// empties `met` at every new lap, because evidence about a lap that is over
/// says nothing about the one starting.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Standing {
    #[serde(default)] pub goal: Goal,
    #[serde(default)] pub checking: bool,
    #[serde(default)] pub met: Option<bool>,
}

/// Whether a goal was declared at all. The CHECK is the test and not the
/// outcome: a goal with no command is refused at load (`declare::refuse`), so
/// by the time a state exists these two questions have one answer.
pub(crate) fn declared(state: &AgentState) -> bool {
    !state.standing.goal.check.is_empty()
}

/// PHASE ONE — ask for the check and decide nothing. Reached from
/// `passes::again` when the cursor has run off the end and this lap has not
/// read the goal yet.
pub(crate) fn check(state: &mut AgentState) -> Vec<Effect> {
    state.standing.checking = true;
    let command = state.standing.goal.check.clone();
    vec![Effect::InvokeTool {
        tool: ToolId(EXEC.into()),
        args_json: serde_json::json!({ "command": command }).to_string(),
    }]
}

/// PHASE TWO — the exit code, folded, and the turn decided on it.
///
/// It deliberately does NOT go through `step::on_tool_result`. That would push
/// this result into the transcript as an observation the model asked for, spend
/// a round of the model's budget on it, and call the model again — three
/// charges for a question the machine asked itself.
pub(crate) fn returned(
    mut state: AgentState,
    ok: bool,
    output: &str,
    at: Timestamp,
) -> (AgentState, Vec<Effect>) {
    (state.standing.checking, state.standing.met) = (false, Some(ok));
    // A PASSING CHECK IS EVIDENCE, and it is exactly the evidence the verify
    // gate wants (`crate::verify`): a command ran, after whatever this turn
    // wrote, and exited 0. Leaving it unset would end a turn that verifiably
    // met its declared goal with the word `unchecked` — the page disbelieving
    // its own observation. `|=` and not `=`: a failing check invalidates
    // nothing that already ran.
    state.green |= ok;
    let fact = fact::checked(&state.standing.goal.check, ok, output);
    // WHY IT IS GOING ROUND AGAIN, WHERE THE MODEL CAN SEE IT. A lap that
    // starts over with no idea what failed is a lap that repeats the failure.
    let seen = Observations { lines: vec![fact::said(&state.standing.goal.check, ok, output)] };
    crate::paper::set_component(&mut state.paper, &seen, at);
    // …and now `again` decides, with `met` set: phase one cannot repeat, so
    // the re-entry terminates.
    match crate::passes::again(&mut state, at) {
        Some(effects) => (state, std::iter::once(fact).chain(effects).collect()),
        None => {
            let why = crate::answer::why(&state);
            let ending = crate::ending::end(&mut state, why);
            (state, vec![fact, ending])
        }
    }
}

/// WHETHER THIS LAP EARNED THE NEXT ONE, and which evidence decides it.
///
/// No goal declared: `state.acted`, exactly as before this file existed. With
/// one: THE EXIT CODE, and `acted` is not consulted at all — a lap that changed
/// nothing but left the goal unmet has still not finished, and a lap that
/// changed plenty over a goal already met has nothing left to do.
pub(crate) fn earned(state: &AgentState) -> bool {
    match state.standing.met {
        Some(met) => !met,
        None => state.acted,
    }
}

/// Turn-scoped, like the evidence flags: `verify::clear` calls this, so an
/// ending and a new turn both forget what was observed. THE DECLARATION IS NOT
/// CLEARED — it came from the agent's file, not from the turn.
pub(crate) fn clear(state: &mut AgentState) {
    (state.standing.checking, state.standing.met) = (false, None);
}
