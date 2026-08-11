//! The six agent statuses (Python `core/state.py`). Here in `kernel` because
//! `EventKind::AgentStatus` carries one and the event vocabulary is kernel's;
//! the TABLE they are written into lives in `agent::supervisor`.
//!
//! Statuses are about who the agent is waiting on, not about the model:
//!
//! - `Starting` — its Worker exists, its engine is still being built
//! - `Idle` — loaded and doing nothing; nobody has called it
//! - `Working` — inside a turn: inferring, or running a tool
//! - `Waiting` — it answered, and the next move is the user's
//! - `Failed` — it did not load, or its last turn raised
//! - `Closed` — its Worker is stopped
//!
//! `Idle` and `Waiting` are both "not busy"; the difference is whether anyone
//! is expected to speak next. A sub-agent goes back to `Idle` after it answers,
//! because its caller already has what it asked for.

use serde::{Deserialize, Serialize};

/// One agent's status. A closed enum, so a seventh state is a design change
/// rather than a new string somebody typed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Status {
    Starting,
    Idle,
    Working,
    Waiting,
    Failed,
    Closed,
}

impl Status {
    /// The Python's own lowercase name — what the board prints and what a
    /// screen reader reads.
    pub fn label(self) -> &'static str {
        match self {
            Status::Starting => "starting",
            Status::Idle => "idle",
            Status::Working => "working",
            Status::Waiting => "waiting",
            Status::Failed => "failed",
            Status::Closed => "closed",
        }
    }

    /// Whether this status is one an agent is busy in — the Python's `busy()`.
    pub fn is_busy(self) -> bool {
        matches!(self, Status::Working)
    }
}
