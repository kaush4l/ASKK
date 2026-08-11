//! The pure step function (§11) — the hard wall between thinking and doing.
//! `step` cannot do I/O; it can only describe it. Everything here tests on
//! the host with a scripted model port and no fakes at all: assert on the
//! returned effects (ARCHITECTURE §5).

use context::ProviderFormat;
use kernel::{EndpointName, Event, EventKind};

use crate::effect::Effect;
use crate::error::AgentError;
use crate::paper;
use crate::phase::{v1_phases, ResponseContract, Verdict};
use crate::state::{AgentState, PlanStep};

/// The frozen §11 signature. Owns ALL transitions: parse the event against
/// the current phase's contract, match the result against its exits, emit
/// the next phase's effects; malformed replies, illegal transitions, and
/// exhausted budgets are handled by the machine (retry with a repair notice,
/// or fail the task) — never by prose. Consumes and returns state by value:
/// the old state remains valid data, which is what makes time-travel
/// debugging a fold over the log.
pub fn step(mut state: AgentState, input: Event) -> (AgentState, Vec<Effect>) {
    match input.kind {
        // A user utterance starts (or redirects) the turn: refresh the paper,
        // assemble it under the current phase's budget, ask the model. The
        // Document rides the effect (I13) — no string prompt can exist here.
        EventKind::UserMessage { text } => {
            state.task = Some(text.clone());
            paper::set_task(&mut state.paper, &text, input.at);
            paper::push_history(&mut state.paper, "user", &text, input.at);
            let cfg = v1_phases()
                .into_iter()
                .find(|c| c.phase == state.phase)
                .expect("current phase is configured");
            let document = context::assemble(&state.paper, state.phase, cfg.budget);
            let effects = vec![Effect::CallModel {
                document,
                // G4 target: the local OpenAI-compatible proxy, text-only.
                format: ProviderFormat::OpenAiChat {
                    vision: false,
                    audio: false,
                },
                endpoint: EndpointName("model".into()),
                model: state.model.clone(),
            }];
            (state, effects)
        }
        // The completed reply (ADR-002: deltas never reach the log). Under
        // the G4 Answer contract this ends the turn: record it, go quiescent.
        EventKind::ModelReplied { text } => {
            match parse_reply(ResponseContract::Answer, &text) {
                Ok(ParsedReply::Answer(answer)) => {
                    paper::push_history(&mut state.paper, "assistant", &answer, input.at);
                    state.task = None;
                    state.retries = 0;
                }
                // Answer parsing is total today; other contracts land at G5.
                _ => unreachable!("Answer contract parses totally"),
            }
            (state, Vec::new())
        }
        // Facts the machine observes but does not act on (yet): request
        // traffic, registry changes, module errors. Quiescence, not effects.
        _ => (state, Vec::new()),
    }
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
    match contract {
        // Prose is always well-formed prose.
        ResponseContract::Answer => Ok(ParsedReply::Answer(raw.trim().to_string())),
        // Structured contracts arrive with the first tool phase (G5).
        ResponseContract::PlanSteps
        | ResponseContract::ToolEnvelope
        | ResponseContract::Verdict => {
            todo!("G5: structured contracts")
        }
    }
}
