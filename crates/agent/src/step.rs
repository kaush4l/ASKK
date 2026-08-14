//! The pure step function (§11) — the hard wall between thinking and doing.
//! `step` cannot do I/O; it can only describe it, so everything here tests on
//! the host by asserting on the returned effects (ARCHITECTURE §5).

use kernel::{Event, EventKind};

use crate::ask::{call_model, config, scoped_tools};
use crate::effect::Effect;
use crate::paper;
use crate::reply::{parse_reply, ParsedReply};
use crate::state::AgentState;
use crate::tools::ToolResult;
use crate::{answer, ending, stages, steer, stop, verify, window};

/// The frozen §11 signature. Owns ALL transitions: parse the event against the
/// current phase's contract, match the result against its exits, emit the next
/// phase's effects; malformed replies, illegal transitions and exhausted
/// budgets are handled by the machine, never by prose. Consumes and returns
/// state by value, which is what makes debugging a fold over the log.
pub fn step(state: AgentState, input: Event) -> (AgentState, Vec<Effect>) {
    // NOTHING NEW AFTER A STOP (R16-P0-2): `advance` starts work only by
    // RETURNING an effect, so one check on the way out is the whole boundary.
    let (state, effects) = advance(state, input);
    stop::boundary(state, effects)
}

fn advance(mut state: AgentState, input: Event) -> (AgentState, Vec<Effect>) {
    match input.kind {
        // The person pressed Stop: recorded, NOTHING emitted — the `steered`
        // shape one arm below, and `stop.rs` holds why. An idle agent is
        // already stopped, so the flag only takes on a turn that is running.
        EventKind::Custom { ref kind, .. } if kind == stop::STOP_REQUESTED => {
            state.stopping = state.task.is_some();
            (state, Vec::new())
        }
        // A user utterance DURING a turn is steering, not a new turn.
        //
        // The composer used to be disabled for the duration, so this case could
        // not arise; unlocking it is half the product's stated intent, and the
        // naive reading — fall through, reset the counters, call the model —
        // would ask the model twice at once and then decrement `pending_tools`
        // below the batch still in flight. So the sentence is appended to the
        // history and NO WORK is emitted: the round already running finishes,
        // and the next `call_model` assembles a paper with the interjection in
        // it. The agent picks it up on its next step, deterministically.
        // …AND IT SAYS SO IN THE LOG (R18-P0-1). `steer.rs` holds why.
        EventKind::UserMessage { ref text, .. } if state.task.is_some() => {
            paper::push_history(&mut state.paper, "user", text, input.at);
            state.steered = true;
            (state, vec![steer::carried()])
        }
        // A user utterance starts (or redirects) the turn: assemble the paper
        // under the phase's budget and ask. The Document rides the effect
        // (I13) — no string prompt can exist here.
        EventKind::UserMessage { text, .. } => {
            state.task = Some(text.clone());
            paper::set_task(&mut state.paper, &text, input.at);
            paper::push_history(&mut state.paper, "user", &text, input.at);
            // …and `stopping` with them: a stop ends ONE turn, not the next.
            (state.pending_tools, state.tool_rounds, state.stopping) = (0, 0, false);
            verify::clear(&mut state); // …and the evidence: it is one turn's
            // …AND THE CURSOR (20): a turn starts at the first stage its file
            // declares, and pushes that stage's instruction into the window
            // ahead of the call. An agent with no `stages:` gets nothing here.
            let opened = stages::open(&mut state, input.at);
            // Compaction runs at the TOP of a turn, with the question just
            // asked already in the window (Python `_step`): summarise the
            // question away and the model answers one it cannot see.
            let effect = window::compaction(&mut state, input.at)
                .unwrap_or_else(|| call_model(&mut state, input.at));
            (state, opened.into_iter().chain([effect]).collect())
        }
        // The summary is back. It REPLACES the older window, and the turn the
        // person asked for is taken against the compacted paper. The reply is
        // the summarizer's, which is why it never becomes an answer.
        EventKind::ModelReplied { text, .. } if state.compacting => {
            state.compacting = false;
            if window::compacted(&mut state.paper, &text, state.keep_recent, input.at) {
                state.compactions += 1;
            }
            let effect = call_model(&mut state, input.at);
            (state, vec![effect])
        }
        // The summarisation FAILED. A compaction costs a compaction and never
        // a conversation (Python `compact`: warned about, carried on from), so
        // the window is left as it was and the turn the person asked for is
        // taken now, in full — it was never asked at all before (09 walk).
        EventKind::Custom { ref kind, .. }
            if kind == "core.compaction_failed" && state.compacting =>
        {
            state.compacting = false;
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
        // Facts observed but not acted on: quiescence, not effects.
        _ => (state, Vec::new()),
    }
}

/// One reply against the phase's contract. Tool calls act; anything else goes
/// to `answer.rs`, which owns the turn's cheap exit and the gate in front of it.
fn on_reply(mut state: AgentState, text: &str, at: kernel::Timestamp) -> (AgentState, Vec<Effect>) {
    let cfg = config(&state);
    let batches = match parse_reply(cfg.contract, text) {
        Ok(ParsedReply::Tools(batches)) if !batches.is_empty() => batches,
        _ => return answer::answered(state, text, at),
    };
    paper::push_history(&mut state.paper, "assistant", text.trim(), at);
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

/// One tool result. The batch is not done until the last one lands; then the
/// model gets them all at once and the loop goes round — up to `max_rounds`.
fn on_tool_result(
    mut state: AgentState,
    result: &ToolResult,
    at: kernel::Timestamp,
) -> (AgentState, Vec<Effect>) {
    paper::push_history(&mut state.paper, "Result", &result.line(), at);
    paper::set_text(&mut state.paper, "observations", &result.line());
    // THE FOLD, in log order — a write clears the flag, a command that printed
    // something after it sets it. `verify.rs` holds why order is enough.
    verify::observe(&mut state, &result.tool, result.ok, &result.output);
    state.pending_tools = state.pending_tools.saturating_sub(1);
    if state.pending_tools > 0 {
        return (state, Vec::new());
    }
    state.tool_rounds += 1; // a round is COMPLETE when its last result lands
    // A steer is consumed by the call this round is about to make, whether or
    // not the ceiling stops the loop below — the model is asked once more with
    // the sentence in front of it, or the turn ends and the sentence is the
    // next turn's opening line. Either way it is not silently unanswered.
    // THE CEILING IS AN ENDING LIKE ANY OTHER (R17-P0-2). It used to emit a
    // `core.note` — the same kind the machine uses for anything it wants to say
    // — so the only surface that could tell this ending from an answer was the
    // conversation, by reading the sentence. The sentence moved to
    // `core::ending`, beside the other endings' wordings, off this one fact.
    if state.tool_rounds >= state.max_rounds {
        let effect = ending::end(&mut state, ending::ROUND_CEILING);
        return (state, vec![effect]);
    }
    state.steered = false;
    // Compaction runs before EVERY round, not only at the top of a turn.
    //
    // It was called from the `UserMessage` arm alone, which was right when a
    // turn was one call and four tool rounds: the window could not outgrow the
    // budget inside one. A turn may now take sixty-four (15C), each round
    // appending a reply and a result, so the window grows all through it — and
    // `assemble` degrades silently at the budget, which means the late rounds
    // of a long run were quietly losing the task they were working on. The
    // ceiling being 64 is worth nothing if round 30 cannot see round 1.
    let effect = window::compaction(&mut state, at).unwrap_or_else(|| call_model(&mut state, at));
    (state, vec![effect])
}
