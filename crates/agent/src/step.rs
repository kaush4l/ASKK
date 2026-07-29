//! The pure step function (§11) — the hard wall between thinking and doing.
//! `step` cannot do I/O; it can only describe it. Everything here tests on
//! the host with a scripted model port and no fakes at all: assert on the
//! returned effects (ARCHITECTURE §5).

use kernel::Event;

use crate::effect::Effect;
use crate::error::AgentError;
use crate::phase::{ResponseContract, Verdict};
use crate::state::{AgentState, PlanStep};

/// The frozen §11 signature. Owns ALL transitions: parse the event against
/// the current phase's contract, match the result against its exits, emit
/// the next phase's effects; malformed replies, illegal transitions, and
/// exhausted budgets are handled by the machine (retry with a repair notice,
/// or fail the task) — never by prose. Consumes and returns state by value:
/// the old state remains valid data, which is what makes time-travel
/// debugging a fold over the log.
pub fn step(state: AgentState, input: Event) -> (AgentState, Vec<Effect>) {
    let _ = (state, input);
    todo!("G4")
}

/// A model reply, parsed against a contract. Typed so `step`'s transition
/// match is exhaustive — a reply shape the contract doesn't name cannot
/// reach the exit table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParsedReply {
    Plan(Vec<PlanStep>),
    Tool { tool: String, args_json: String },
    Verdict { verdict: Verdict, reason: String },
    Answer(String),
}

/// Parse one raw reply against one contract. Public and separate from `step`
/// so contract parsing is unit-testable against recorded model output
/// without driving the whole machine.
pub fn parse_reply(contract: ResponseContract, raw: &str) -> Result<ParsedReply, AgentError> {
    let _ = (contract, raw);
    todo!("G4")
}
