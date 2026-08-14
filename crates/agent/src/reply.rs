//! One model reply, parsed against one phase's contract. Its own file so
//! `step.rs` stays inside the 200-line rule (I12) and so contract parsing is
//! unit-testable against recorded model output without driving the machine.

use crate::calls::{has_calls, is_ident, is_ident_start, parse_batches, skip_ws, Call};
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

/// TEXT THAT TRIED TO CALL A TOOL AND IS NOT ONE (R17-P0-2).
///
/// A six-part task ended on this reply, verbatim: `exec({"command": "cat
/// a.md"}, {"command": "cat b.md"}, …)`. `parse_batches` is right to find no
/// call in it — a call takes ONE argument object, and the `,` where the `)`
/// should be is where this stops being one — and the tool contract is total, so
/// "no call in the text" meant "the model answered". The machine's own output
/// was then rendered as the agent's reply under a card reading `main finished`,
/// with a `Read the reply` button pointing at it.
///
/// So the reading is narrowed by ONE fact this can be sure of: the text OPENS
/// with the three tokens a call opens with — an identifier, `(`, `{` — and no
/// call could be read out of it. Prose that mentions a call in the middle of a
/// sentence is still prose; a reply that begins as machine output is not an
/// answer, and nothing here has to guess which.
pub fn malformed_call(text: &str) -> bool {
    let said = text.trim_start();
    !has_calls(said) && opens_a_call(said.as_bytes())
}

/// Whether `b` starts `name({` — with whitespace allowed where a call allows it.
fn opens_a_call(b: &[u8]) -> bool {
    if b.first().is_none_or(|c| !is_ident_start(*c)) {
        return false;
    }
    let mut j = 0;
    while j < b.len() && is_ident(b[j]) {
        j += 1;
    }
    let open = skip_ws(b, j);
    b.get(open) == Some(&b'(') && b.get(skip_ws(b, open + 1)) == Some(&b'{')
}
