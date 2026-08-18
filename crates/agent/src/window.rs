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

use crate::components::{
    Affordances, Environment, History, Identity, ResponseContract as Contract, Soul, Task,
};
use crate::effect::Effect;
use crate::paper;
use crate::state::AgentState;

/// WHO the summarizing model is, which used to be a file. Short on purpose:
/// everything about HOW to summarise is in `COMPACT_PROMPT`, which arrives as
/// the task, and a soul that repeated it would be the same instruction twice at
/// two levels of the prompt.
pub const SUMMARIZE: &str = "You compress conversations. You are handed a transcript and you \
return notes that replace it. You add nothing that is not in it, and you leave out nothing \
that the conversation still depends on.";

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

/// THE SUMMARIZER IS NO LONGER AN AGENT — it is a sheet.
///
/// It used to be a whole `agent.md` in `public/agents/`, found by the `role:`
/// it declared and loaded into the state of every other agent as three fields.
/// What that file actually contributed was a system prompt, because a summarizer
/// has no tools, no space, no history and no conversation: the transcript is its
/// whole task and its notes are its whole reply. So the prompt is [`SUMMARIZE`],
/// the sheet below is the rest of it, and there is one agent in this build.
///
/// This also removes the silent failure the role key was introduced to catch.
/// A missing summarizer file used to mean compaction never ran and nothing said
/// so; a long conversation quietly degraded to a pointer instead. There is now
/// nothing to be missing.
///
/// `None` means "just take the turn": the window is not long enough yet, or
/// nothing in it is old enough to summarise.
pub(crate) fn compaction(state: &mut AgentState, at: Timestamp) -> Option<Effect> {
    if !due(&state.paper, state.compact_at) {
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
    let soul = Soul { text: SUMMARIZE.into() };
    let identity = Identity { name: "summarizer".into(), description: String::new() };
    paper::set_component(&mut sheet, &soul, at);
    paper::set_component(&mut sheet, &identity, at);
    paper::set_component(&mut sheet, &Affordances::default(), at);
    paper::set_component(
        &mut sheet,
        &Contract::saying("Reply with the notes and nothing else."),
        at,
    );
    // No space: the summarizer reads the transcript and nothing else, and the
    // group's facts are not part of the conversation it is compressing.
    let environment = Environment { text: crate::now::environment(at, None) };
    paper::set_component(&mut sheet, &environment, at);
    paper::set_component(&mut sheet, &Task { text: transcript.clone() }, at);
    // Deliberately empty, not the seeded marker: the summarizer's transcript
    // is the TASK it was handed, and a second copy of a conversation in the
    // history block would be the thing it is being asked to compress, twice.
    paper::set_component(&mut sheet, &History { entries: Vec::new() }, at);
    Some(Effect::CallModel {
        document: context::assemble(&sheet, PhaseId::Work, crate::phase::v1_phases()[0].budget),
        format: ProviderFormat::OpenAiChat { vision: false, audio: false },
        endpoint: EndpointName("model".into()),
        // The agent's own model. One agent, one endpoint: a second catalogue
        // key here would be a second model to configure and a second thing to
        // be misconfigured, for a job that is the same model reading its own
        // conversation back.
        model: state.model.clone(),
        temperature: state.temperature,
        speaker: paper::SUMMARIZER.to_string(),
    })
}
