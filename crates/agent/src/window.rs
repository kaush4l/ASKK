//! The rolling window (Python `core/engine.py::compact`). Once the history
//! reaches `compact_at` entries, everything except the newest `keep_recent` is
//! handed to the summarizer agent and replaced by its notes, so what the model
//! sees becomes a summary followed by that tail. The window ROLLS: the next
//! compaction is handed a transcript that opens with the previous summary, and
//! folds it into the new one.
//!
//! Pure, and deliberately so: `assemble` cannot author a summary (I14 — pure
//! assembly; RESEARCH: "summaries must be precomputed artifacts in `State`").
//! Compaction therefore PRODUCES the artifact — a model call the runtime makes
//! — and assembly only ever reads it back.

use context::{ProviderFormat, State};
use kernel::{EndpointName, PhaseId, Timestamp};

use crate::effect::Effect;
use crate::paper;
use crate::state::AgentState;

/// The line a compacted window opens with (Python `SUMMARY_HEADING`).
pub const SUMMARY_HEADING: &str = "Summary of the conversation so far:";

/// What the summarizer is asked, verbatim from Python `COMPACT_PROMPT`. The
/// agent's own file says HOW to summarise; this says WHAT is being summarised
/// and that its notes are the only copy that survives.
pub const COMPACT_PROMPT: &str = "Summarise the conversation transcript below. Your summary \
replaces it entirely, so the assistant will have nothing else to work from.\n\n\
If the transcript opens with an earlier summary, fold it into yours — what it records still \
counts, and yours is the only copy that survives.\n\n\
Keep: what the user asked for, decisions made, facts established, tool results that still \
matter, and anything left unfinished. Drop: greetings, failed attempts that were retried, \
tool results that were later superseded, and commentary.\n\n\
Write it as plain notes in the third person. No preamble, no sign-off.\n\n\
TRANSCRIPT:\n\n";

/// This agent's window: every history entry, in order. The one reader —
/// the log mirrors THIS, and the model sees THIS.
pub fn window(paper: &State) -> Vec<String> {
    paper::history(paper)
}

/// Restore a window read back from the log (a reload is a new process, but it
/// is not a new conversation — Python `preload_history`).
pub fn set_window(paper: &mut State, lines: &[String], at: Timestamp) {
    paper::set_history(paper, lines, at);
}

/// Is the history long enough to compact? Python `_step`: `compact_at` of zero
/// never compacts, and the check is `>=`, made BEFORE rendering — a prompt too
/// long to send is no use.
pub fn due(paper: &State, compact_at: usize) -> bool {
    compact_at != 0 && window(paper).len() >= compact_at
}

/// The transcript the summarizer is handed: everything except the newest
/// `keep` entries, joined the way the prompt renders them. `None` when nothing
/// is old enough — Python `compact` returns False on `len(messages) <= keep`.
pub fn transcript(paper: &State, keep: usize) -> Option<String> {
    let lines = window(paper);
    if lines.len() <= keep {
        return None;
    }
    let cut = lines.len() - keep;
    Some(format!("{COMPACT_PROMPT}{}", lines[..cut].join("\n\n")))
}

/// Replace the window with the summary and the retained tail. Called only once
/// the summary is IN HAND: a failed summarizer must leave the conversation
/// alone, which is why nothing here can fail. An empty summary is refused for
/// the same reason — Python: "summarizer returned nothing, keeping the
/// history".
pub fn compacted(paper: &mut State, summary: &str, keep: usize, at: Timestamp) -> bool {
    let summary = summary.trim();
    let lines = window(paper);
    if summary.is_empty() || lines.len() <= keep {
        return false;
    }
    let cut = lines.len() - keep;
    // `system:`, like every other entry carries its role — Python stores the
    // summary as a `Message(role="system", …)` and renders it `[SYSTEM]: …`.
    let mut next = vec![format!("system: {SUMMARY_HEADING}\n{summary}")];
    next.extend_from_slice(&lines[cut..]);
    paper::set_history(paper, &next, at);
    true
}

/// Hand the older window to the summarizer, if it is time and there is one.
/// `None` means "just take the turn": no summarizer file loaded, or nothing old
/// enough to summarise. A missing summarizer must cost a compaction and never a
/// conversation (Python: a failed summarizer is warned about and carried on
/// from).
pub(crate) fn compaction(state: &mut AgentState, at: Timestamp) -> Option<Effect> {
    if state.summarizer_prompt.is_empty() || !due(&state.paper, state.compact_at) {
        return None;
    }
    let transcript = transcript(&state.paper, state.keep_recent)?;
    state.compacting = true;
    // The summarizer's OWN paper: its `agent.md` body is the system block and
    // the transcript is the whole task. Stateless, and toolless — it reads the
    // transcript and nothing else, so the calling agent's tools and prompt
    // cannot steer it (Python `compact`). A Document, like every other model
    // call in this codebase (I13).
    let mut sheet = paper::seed();
    paper::set_text(&mut sheet, "soul", &state.summarizer_prompt);
    paper::set_text(&mut sheet, "identity", "Name: summarizer.");
    paper::set_text(&mut sheet, "affordances", "");
    paper::set_text(&mut sheet, "response_contract", "Reply with the notes and nothing else.");
    // No space: the summarizer reads the transcript and nothing else, and the
    // group's facts are not part of the conversation it is compressing.
    paper::set_dynamic(&mut sheet, "environment", &crate::now::environment(at, None), at);
    paper::set_task(&mut sheet, &transcript, at);
    paper::set_history(&mut sheet, &[], at);
    Some(Effect::CallModel {
        document: context::assemble(&sheet, PhaseId::Work, crate::phase::v1_phases()[0].budget),
        format: ProviderFormat::OpenAiChat { vision: false, audio: false },
        endpoint: EndpointName("model".into()),
        model: state.summarizer_model.clone(),
        speaker: paper::SUMMARIZER.to_string(),
    })
}
