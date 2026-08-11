//! One model reply, parsed against one phase's contract. Its own file so
//! `step.rs` stays inside the 200-line rule (I12) and so contract parsing is
//! unit-testable against recorded model output without driving the machine.

use crate::calls::{parse_batches, Call};
use crate::error::AgentError;
use crate::phase::{ResponseContract, Verdict};
use crate::state::PlanStep;

/// A model reply, parsed against a contract. Typed so `step`'s transition
/// match is exhaustive — a reply shape the contract doesn't name cannot
/// reach the exit table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParsedReply {
    Plan(Vec<PlanStep>),
    /// Batches of tool calls, in the order the layout scheduled them.
    Tools(Vec<Vec<Call>>),
    Verdict { verdict: Verdict, reason: String },
    Answer(String),
}

/// Parse one raw reply against one contract. Public and separate from `step`
/// so contract parsing is unit-testable against recorded model output
/// without driving the whole machine.
pub fn parse_reply(contract: ResponseContract, raw: &str) -> Result<ParsedReply, AgentError> {
    match contract {
        // Prose is always well-formed prose.
        ResponseContract::Answer => Ok(ParsedReply::Answer(raw.trim().to_string())),
        // The tool contract is total too: no call in the text means the model
        // answered, which is a legal reply and the turn's cheap exit.
        ResponseContract::ToolEnvelope => Ok(ParsedReply::Tools(parse_batches(raw))),
        // The remaining structured contracts arrive with Plan and Verify.
        ResponseContract::PlanSteps | ResponseContract::Verdict => {
            todo!("Plan/Verify contracts")
        }
    }
}
