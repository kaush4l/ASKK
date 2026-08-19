//! The pure step function (§11) — the hard wall between thinking and doing.
//! `step` cannot do I/O; it can only describe it, so everything here tests on
//! the host by asserting on the returned effects (ARCHITECTURE §5).

use kernel::{Event, EventKind};

use crate::ask::{call_model, config, scoped_tools};
use crate::components::{Observations, Task};
use crate::effect::Effect;
use crate::paper;
use crate::reply::{parse_reply, ParsedReply};
use crate::state::AgentState;
use crate::tools::ToolResult;
use crate::{answer, ending, stages, steer, stop, verify, window};

/// A state and the effects it wants run — what every transition below returns.
type Stepped = (AgentState, Vec<Effect>);

/// The frozen §11 signature. Owns ALL transitions: parse the event against the
/// current phase's contract, match the result against its exits, emit the next
/// phase's effects; malformed replies, illegal transitions and exhausted
/// budgets are handled by the machine, never by prose. Consumes and returns
/// state by value, which is what makes debugging a fold over the log.
pub fn step(state: AgentState, input: Event) -> Stepped {
    // NOTHING NEW AFTER A STOP (R16-P0-2): `advance` starts work only by
    // RETURNING an effect, so one check on the way out is the whole boundary.
    let (state, effects) = advance(state, input);
    stop::boundary(state, effects)
}

/// THE EXIT TABLE — one arm per fact the agent can be handed. Every arm is a
/// pure state transform returning effects; the arms with anything to explain
/// are functions below, so this reads as the list of things that can happen.
fn advance(mut state: AgentState, input: Event) -> Stepped {
    match input.kind {
        // Stop pressed: recorded, NOTHING emitted (`stop.rs` holds why). An
        // idle agent is already stopped, so this only takes on a running turn.
        EventKind::Custom { ref kind, .. } if kind == stop::STOP_REQUESTED => {
            state.stopping = state.task.is_some();
            (state, Vec::new())
        }
        EventKind::UserMessage { ref text, .. } if state.task.is_some() => {
            on_steer(state, text, input.at)
        }
        EventKind::UserMessage { text, .. } => on_task(state, text, input.at),
        EventKind::ModelReplied { text, .. } if state.compacting => {
            on_summary(state, &text, input.at)
        }
        EventKind::Custom { ref kind, .. }
            if kind == "core.compaction_failed" && state.compacting =>
        {
            on_compaction_failed(state, input.at)
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
        // Facts observed but not acted on: quiescence, not effects.
        _ => (state, Vec::new()),
    }
}

/// A user utterance DURING a turn is steering, not a new turn. The naive
/// reading — reset the counters and call the model — would ask the model twice
/// at once and then decrement `pending_tools` below the batch still in flight.
/// So the sentence is appended and NO WORK is emitted: the round already
/// running finishes, and the next `call_model` assembles a paper with the
/// interjection in it. …AND IT SAYS SO IN THE LOG (R18-P0-1); `steer.rs` why.
fn on_steer(mut state: AgentState, text: &str, at: kernel::Timestamp) -> Stepped {
    paper::push_history(&mut state.paper, "user", text, at);
    state.steered = true;
    (state, vec![steer::carried()])
}

/// A user utterance starts (or redirects) the turn: assemble the paper under
/// the phase's budget and ask. The Document rides the effect (I13).
///
/// Everything a turn counts is reset, `stopping` included — a stop ends ONE
/// turn, not the next — and the cursor with them (20): a turn starts at the
/// first stage its file declares. Compaction runs at the TOP of a turn, with
/// the question just asked already in the window (Python `_step`): summarise
/// the question away and the model answers one it cannot see.
fn on_task(mut state: AgentState, text: String, at: kernel::Timestamp) -> Stepped {
    state.task = Some(text.clone());
    paper::set_component(&mut state.paper, &Task { text: text.clone() }, at);
    paper::push_history(&mut state.paper, "user", &text, at);
    (state.pending_tools, state.tool_rounds, state.stopping) = (0, 0, false);
    verify::clear(&mut state);
    let opened = stages::open(&mut state, at);
    let effect = window::compaction(&mut state, at).unwrap_or_else(|| call_model(&mut state, at));
    (state, opened.into_iter().chain([effect]).collect())
}

/// The summarisation FAILED. A compaction costs a compaction and never a
/// conversation (Python `compact`: warned about, carried on from), so the
/// window is left as it was and the turn the person asked for is taken now, in
/// full — it was never asked at all before (09 walk).
fn on_compaction_failed(mut state: AgentState, at: kernel::Timestamp) -> Stepped {
    state.compacting = false;
    let effect = call_model(&mut state, at);
    (state, vec![effect])
}

/// The summary is back. It REPLACES the older window, and the turn the person
/// asked for is taken against the compacted paper. The reply is the
/// summarizer's, which is why it never becomes an answer.
fn on_summary(mut state: AgentState, text: &str, at: kernel::Timestamp) -> Stepped {
    state.compacting = false;
    if window::compacted(&mut state.paper, text, state.keep_recent, at) {
        state.compactions += 1;
    }
    let effect = call_model(&mut state, at);
    (state, vec![effect])
}

/// One reply against the phase's contract. Tool calls act; anything else goes
/// to `answer.rs`, which owns the turn's cheap exit and the gate in front of it.
fn on_reply(mut state: AgentState, text: &str, at: kernel::Timestamp) -> Stepped {
    let cfg = config(&state);
    let batches = match parse_reply(cfg.contract, text) {
        Ok(ParsedReply::Tools(batches)) if !batches.is_empty() => batches,
        _ => return answer::answered(state, text, at),
    };
    paper::push_history(&mut state.paper, "assistant", text.trim(), at);
    // Batch ORDER is the schedule: a later line's calls are emitted after an
    // earlier line's, and the model sees no result until every call it wrote
    // has come back. The batch INDEX rides out on each delegation, so the
    // runtime can run one line's sub-agents concurrently in their own Workers
    // — the other half of the layout rule (increment 06).
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

/// One tool result. The batch is not done until the last one lands; then the
/// model gets them all at once and the loop goes round — up to `max_rounds`.
fn on_tool_result(mut state: AgentState, r: &ToolResult, at: kernel::Timestamp) -> Stepped {
    paper::push_history(&mut state.paper, "Result", &r.line(), at);
    let seen = Observations { lines: vec![r.line()] };
    paper::set_component(&mut state.paper, &seen, at);
    // THE FOLD, in log order — a write clears the flag, a command that printed
    // something after it sets it. `verify.rs` holds why order is enough.
    verify::observe(&mut state, &r.tool, r.ok, &r.output);
    state.pending_tools = state.pending_tools.saturating_sub(1);
    if state.pending_tools > 0 {
        return (state, Vec::new());
    }
    state.tool_rounds += 1; // a round is COMPLETE when its last result lands
    round_again(state, at)
}

/// The round is complete: go round once more, or stop at the ceiling. A steer
/// is consumed either way — asked again with the sentence in front of it, or
/// the turn ends and the sentence opens the next one.
///
/// THE CEILING IS AN ENDING LIKE ANY OTHER (R17-P0-2). It used to emit a
/// `core.note`, the kind the machine uses for anything it says, so only the
/// conversation could tell this ending from an answer. Its wording moved to
/// `core::failure::ending` beside the others', off that one fact.
///
/// Compaction runs before EVERY round, not only at the top of a turn: a turn
/// may take sixty-four (15C), each round appending a reply and a result, and
/// `assemble` degrades silently at the budget — so the late rounds of a long
/// run were quietly losing the task they were working on.
fn round_again(mut state: AgentState, at: kernel::Timestamp) -> Stepped {
    if state.tool_rounds >= state.max_rounds {
        let effect = ending::end(&mut state, ending::ROUND_CEILING);
        return (state, vec![effect]);
    }
    state.steered = false;
    let effect = window::compaction(&mut state, at).unwrap_or_else(|| call_model(&mut state, at));
    (state, vec![effect])
}
