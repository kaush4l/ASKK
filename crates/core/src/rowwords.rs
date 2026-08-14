//! THE WORDS A BOARD ROW USES for a status and for where an agent came from.
//! Split from `boardrow.rs` — which owns the fragment — for the reason
//! `tracerow.rs` is not `trace.rs`: choosing the vocabulary and building the
//! markup are two jobs, and both files hold the 200-line rule (I12).

use agent::AgentRow;
use kernel::Status;

/// Where this agent came from, WHEN that is not the ordinary case. An agent
/// shipped with the site is what a person expects and says nothing; the two
/// that are worth a word are the one this browser wrote and the one compiled
/// in. "from public/agents/" was a repository path on every ordinary row.
pub(crate) fn origin(agent: &AgentRow, authored: &[(String, String)]) -> String {
    match (authored.iter().find(|(n, _)| *n == agent.name), agent.builtin) {
        (Some((_, by)), _) if by.is_empty() => "written here".to_string(),
        (Some((_, by)), _) => format!("written here by {by}"),
        (None, true) => "built in to this build".to_string(),
        (None, false) => String::new(),
    }
}

/// The status in words a stranger already knows — ONE short label per state
/// (R3-12). One list held three wordings for one lifecycle state at once, and
/// the long ones wrapped: ragged heights as well as three vocabularies. `Idle`
/// and `Waiting` differ only in who is owed the next move, a fact about the
/// runtime, not the agent. The count beside it does the rest of the work:
/// "ready · 3 turns in all" says it has worked and is free now.
pub(crate) fn gloss(status: Status) -> &'static str {
    match status {
        Status::Starting => "starting up",
        Status::Idle | Status::Waiting => "ready",
        Status::Working => "working",
        Status::Failed => "failed",
        Status::Closed => "stopped",
    }
}
