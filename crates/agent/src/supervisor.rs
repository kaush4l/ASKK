//! The status table — what every agent is doing, right now. The Python
//! `core/state.py` ported whole: one row per loaded agent, written by whoever
//! changed something and read by anyone.
//!
//! Pure and host-tested (I3). In the Python this needed a lock because the
//! writers were on different threads; here every write goes through the one
//! event-append door in `core`, so the table is a FOLD of `AgentStatus` facts
//! over the log (I8) and the lock has nothing to protect.
//!
//! Two rules carry over exactly, because both are behaviour rather than shape:
//!
//! 1. `turns` increments on ENTRY TO WORKING and nowhere else.
//! 2. `Waiting` and `Idle` are different: the entry agent — the one a person
//!    is talking to — waits on the user; a sub-agent goes back to idle,
//!    because its caller already has what it asked for.

use kernel::{Status, Timestamp};

/// One agent's row. Cloned out of the table, never handed by reference, so a
/// snapshot cannot change under its reader (the Python's frozen dataclass).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentRow {
    pub name: String,
    /// Shipped with the code rather than with the project (Python `builtin`).
    pub builtin: bool,
    pub status: Status,
    pub turns: u32,
    /// When this status was entered — injected time, never a clock read (I7).
    pub since: Timestamp,
    /// A failure's own message; empty otherwise.
    pub detail: String,
}

impl AgentRow {
    /// The Python `__str__`: one line per agent, for a human.
    pub fn line(&self) -> String {
        let origin = match self.builtin {
            true => "builtin",
            false => "agents",
        };
        let line = format!(
            "{} [{}]: {} ({} turns)",
            self.name,
            origin,
            self.status.label(),
            self.turns
        );
        match self.detail.is_empty() {
            true => line,
            false => format!("{line} — {}", self.detail),
        }
    }
}

/// The one table. Rows are kept sorted by name, so every reader — the board,
/// a test, a log line — sees the same order.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Board {
    rows: Vec<AgentRow>,
}

impl Board {
    /// Put an agent in the table, fresh (Python `State.register`). Re-
    /// registering RESETS the row: a reload is a new process, and carrying a
    /// previous session's `working` into it would be a lie.
    pub fn register(&mut self, name: &str, builtin: bool, at: Timestamp) {
        let row = AgentRow {
            name: name.to_string(),
            builtin,
            status: Status::Starting,
            turns: 0,
            since: at,
            detail: String::new(),
        };
        match self.rows.iter().position(|r| r.name == name) {
            Some(i) => self.rows[i] = row,
            None => self.rows.push(row),
        }
        self.rows.sort_by(|a, b| a.name.cmp(&b.name));
    }

    /// Move an agent to a status. Counts a turn each time it ENTERS Working —
    /// the Python's `turns + (status is Status.WORKING)`, which is why an
    /// agent that answers twice has two turns and an agent that idles has
    /// none. An unregistered name registers itself, exactly as the Python's
    /// `_agents.get(name) or AgentState(name=name)` does.
    pub fn set(&mut self, name: &str, status: Status, detail: &str, at: Timestamp) {
        if !self.rows.iter().any(|r| r.name == name) {
            self.register(name, false, at);
        }
        let row = self
            .rows
            .iter_mut()
            .find(|r| r.name == name)
            .expect("just registered");
        row.turns += u32::from(status == Status::Working);
        row.status = status;
        row.detail = detail.to_string();
        row.since = at;
    }

    /// Carry a count of turns from a REPLAYED history onto a freshly
    /// registered row (increment 07). A reload is a new process, so nobody is
    /// working any more — but "main has taken four turns" is a fact about the
    /// past, and resetting it to zero while the transcript still showed four
    /// exchanges made two panels on one screen disagree (`ux-walker`).
    pub fn restore(&mut self, name: &str, turns: u32) {
        if let Some(row) = self.rows.iter_mut().find(|r| r.name == name) {
            row.turns = turns;
        }
    }

    /// Drop an agent's row — the agent is no longer loaded (increment 11: an
    /// authored agent deleted in the browser). The counterpart of `register`;
    /// a board that kept a row for an agent nobody can call would be a board
    /// offering a conversation that cannot happen.
    pub fn forget(&mut self, name: &str) {
        self.rows.retain(|r| r.name != name);
    }

    pub fn get(&self, name: &str) -> Option<&AgentRow> {
        self.rows.iter().find(|r| r.name == name)
    }

    /// Every row, by name (Python `snapshot`).
    pub fn snapshot(&self) -> &[AgentRow] {
        &self.rows
    }

    /// Who is working right now (Python `busy`).
    pub fn busy(&self) -> Vec<&str> {
        self.rows
            .iter()
            .filter(|r| r.status.is_busy())
            .map(|r| r.name.as_str())
            .collect()
    }

    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }
}
