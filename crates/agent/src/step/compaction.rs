//! THE TWO ARMS WHERE THE REPLY IS NOT THIS AGENT'S.
//!
//! `state.compacting` says the model call in flight is the window being
//! summarised — a sheet compaction asked for with its own prompt
//! (`window::SUMMARIZE`), not an answer to the person. Both outcomes end the
//! same way, with the turn that was actually asked for finally being taken, and
//! neither may ever become an answer: `on_reply` is not reached on this path at
//! all, which is what stops a summary being rendered as the agent speaking.
//!
//! They are a file rather than two functions among the turn's own arms because
//! `step.rs` reads as one list of things that can happen to a turn, and these
//! two happen to the WINDOW.

use crate::ask::call_model;
use crate::state::AgentState;
use crate::window;

use super::Stepped;

/// The summarisation FAILED. A compaction costs a compaction and never a
/// conversation (Python `compact`: warned about, carried on from), so the
/// window is left as it was and the turn the person asked for is taken now, in
/// full — it was never asked at all before (09 walk).
pub(super) fn failed(mut state: AgentState, at: kernel::Timestamp) -> Stepped {
    state.compacting = false;
    let effect = call_model(&mut state, at);
    (state, vec![effect])
}

/// The summary is back. It REPLACES the older window, and the turn the person
/// asked for is taken against the compacted paper. The reply is the
/// summarizer's, which is why it never becomes an answer.
pub(super) fn summarised(mut state: AgentState, text: &str, at: kernel::Timestamp) -> Stepped {
    state.compacting = false;
    if window::compacted(&mut state.paper, text, state.keep_recent, at) {
        state.compactions += 1;
    }
    let effect = call_model(&mut state, at);
    (state, vec![effect])
}
