//! The pure step function (§11) — the hard wall between thinking and doing.
//! `step` cannot do I/O; it can only describe it. Everything here tests on
//! the host with a scripted model port and no fakes at all: assert on the
//! returned effects (ARCHITECTURE §5).

use context::ProviderFormat;
use kernel::{EndpointName, Event, EventKind};

use crate::effect::Effect;
use crate::paper;
use crate::phase::{v1_phases, PhaseConfig, ResponseContract};
use crate::reply::{parse_reply, ParsedReply};
use crate::state::AgentState;
use crate::toolbox::Toolbox;
use crate::window;
use crate::tools::ToolResult;

/// How many times one turn may go round the call-a-tool loop before the agent
/// stops and says so. A looping model must terminate deterministically, and it
/// terminates on a counter in state, never on prose (ADR-010).
const MAX_TOOL_ROUNDS: u8 = 4;

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
        EventKind::UserMessage { text, .. } => {
            state.task = Some(text.clone());
            paper::set_task(&mut state.paper, &text, input.at);
            paper::push_history(&mut state.paper, "user", &text, input.at);
            (state.pending_tools, state.tool_rounds) = (0, 0);
            // Compaction runs at the TOP of a turn, with the question just
            // asked already in the window — Python `_step`, and the reason it
            // is there: summarise the question away and the model answers one
            // it can no longer see, confidently.
            let effect = window::compaction(&mut state, input.at)
                .unwrap_or_else(|| call_model(&mut state, input.at));
            (state, vec![effect])
        }
        // The summary is back. It REPLACES the older window, and then the turn
        // the person actually asked for is taken against the compacted paper.
        // The reply is the summarizer's, not this agent's, which is why it
        // never reaches `on_reply` and never becomes an answer.
        EventKind::ModelReplied { text, .. } if state.compacting => {
            state.compacting = false;
            if window::compacted(&mut state.paper, &text, state.keep_recent, input.at) {
                state.compactions += 1;
            }
            let effect = call_model(&mut state, input.at);
            (state, vec![effect])
        }
        // The completed reply (ADR-002: deltas never reach the log): either
        // tool calls to run, or the answer that ends the turn.
        EventKind::ModelReplied { text, .. } => on_reply(state, &text, input.at),
        // One tool came back. The batch is done when the last result lands,
        // and then — and only then — the model sees them all.
        EventKind::ToolInvoked { tool, ok, output, .. } => {
            let result = ToolResult {
                tool: tool.0,
                ok,
                output: output.clone(),
                error: output,
            };
            on_tool_result(state, &result, input.at)
        }
        // Facts the machine observes but does not act on: request traffic,
        // registry changes, module errors. Quiescence, not effects.
        _ => (state, Vec::new()),
    }
}

/// This agent's phase configuration.
fn config(state: &AgentState) -> PhaseConfig {
    v1_phases()
        .into_iter()
        .find(|c| c.phase == state.phase)
        .expect("current phase is configured")
}

/// The toolbox this phase grants — the ONLY source of what the model is told
/// it can call: THIS agent's toolbox (its `agent.md` `tools:` list, resolved
/// by `subagent::toolbox_for`) narrowed by the phase's `ToolScope`.
fn scoped_tools(state: &AgentState, cfg: &PhaseConfig) -> Toolbox {
    state.toolbox.scoped(&cfg.tools)
}

/// Assemble the paper and ask the model. The affordances and response-contract
/// sections are rewritten from the phase's granted toolbox first, so what the
/// model may call and what it is told it may call cannot drift (I13).
fn call_model(state: &mut AgentState, at: kernel::Timestamp) -> Effect {
    let cfg = config(state);
    let tools = scoped_tools(state, &cfg);
    paper::set_text(&mut state.paper, "affordances", &tools.instructions());
    paper::set_text(&mut state.paper, "response_contract", &contract_text(&cfg, &tools));
    // Fresh every request, never cached: a cached clock is a wrong clock
    // (Python `Engine.context`).
    let environment = crate::now::environment(at, state.space.as_ref());
    paper::set_dynamic(&mut state.paper, "environment", &environment, at);
    Effect::CallModel {
        document: context::assemble(&state.paper, state.phase, cfg.budget),
        // G4 target: the local OpenAI-compatible proxy, text-only.
        format: ProviderFormat::OpenAiChat {
            vision: false,
            audio: false,
        },
        endpoint: EndpointName("model".into()),
        model: state.model.clone(),
        speaker: String::new(), // this agent's own turn
    }
}


/// What the phase demands back, in words the model can obey.
fn contract_text(cfg: &PhaseConfig, tools: &Toolbox) -> String {
    match (cfg.contract, tools.is_empty()) {
        (ResponseContract::ToolEnvelope, false) => "Either answer the user in plain prose, or \
             call tools by writing the calls exactly as AFFORDANCES shows them and nothing \
             else. Results come back on lines beginning `Result:` — read them, then answer."
            .into(),
        _ => "Reply in plain prose to the user's message. Be concise.".into(),
    }
}

/// One reply against the phase's contract. Tool calls act; anything else is
/// the answer that ends the turn — the cheap exit every graph must have.
fn on_reply(mut state: AgentState, text: &str, at: kernel::Timestamp) -> (AgentState, Vec<Effect>) {
    let cfg = config(&state);
    let batches = match parse_reply(cfg.contract, text) {
        Ok(ParsedReply::Tools(batches)) if !batches.is_empty() => batches,
        _ => {
            paper::push_history(&mut state.paper, "assistant", text.trim(), at);
            (state.task, state.retries, state.tool_rounds) = (None, 0, 0);
            return (state, Vec::new());
        }
    };
    paper::push_history(&mut state.paper, "assistant", text.trim(), at);
    state.tool_rounds += 1;
    // Batch ORDER is the schedule: a later line's calls are emitted after an
    // earlier line's, and the model sees no result until every call it wrote
    // has come back. The batch INDEX rides out on each delegation, so the
    // runtime can run one line's sub-agents at the same time in their own
    // Workers — the concurrency half of the layout rule (increment 06).
    let tools = scoped_tools(&state, &cfg);
    let effects: Vec<Effect> = batches
        .into_iter()
        .enumerate()
        .flat_map(|(line, calls)| {
            let tools = &tools;
            calls
                .into_iter()
                .map(move |call| crate::subagent::invoke_or_refuse(tools, call, line as u16))
        })
        .collect();
    state.pending_tools = effects.len();
    (state, effects)
}

/// One tool result. The batch is not done until the last one lands; when it
/// is, the model gets them all at once and the loop goes round — up to
/// `MAX_TOOL_ROUNDS`, after which the agent says it stopped.
fn on_tool_result(
    mut state: AgentState,
    result: &ToolResult,
    at: kernel::Timestamp,
) -> (AgentState, Vec<Effect>) {
    paper::push_history(&mut state.paper, "Result", &result.line(), at);
    paper::set_text(&mut state.paper, "observations", &result.line());
    state.pending_tools = state.pending_tools.saturating_sub(1);
    if state.pending_tools > 0 {
        return (state, Vec::new());
    }
    if state.tool_rounds >= MAX_TOOL_ROUNDS {
        state.task = None;
        return (
            state,
            vec![Effect::Emit {
                kind: EventKind::Custom {
                    kind: "core.note".into(),
                    payload_json: format!(
                        "\"Stopped after {MAX_TOOL_ROUNDS} rounds of tool calls without an answer.\""
                    ),
                },
            }],
        );
    }
    let effect = call_model(&mut state, at);
    (state, vec![effect])
}
