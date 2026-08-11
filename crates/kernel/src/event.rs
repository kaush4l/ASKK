//! Event + event-log types (I8: every transition emits an event; every view is
//! a projection of the log). Events are the sole input to `step()` and the
//! material of replay (GLOSSARY: Event — a fact about the past).

use serde::{Deserialize, Serialize};

use crate::ids::{EventId, ModuleId, PhaseId, Timestamp, ToolId, Version};
use crate::status::Status;

/// One recorded fact. Public: the whole system communicates through these —
/// the log persists them, `step()` consumes them, views project them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Event {
    pub id: EventId,
    /// Log position; total order within one log (replay depends on it).
    pub seq: u64,
    /// Injected via `ClockPort` (I7) — never a wall-clock read at emit time.
    pub at: Timestamp,
    pub kind: EventKind,
}

/// The closed vocabulary of facts. Closed on purpose (typed, not stringly —
/// PROMPT §13); `Custom` is the pressure valve so a forged module can record
/// facts without a kernel change. PROVISIONAL: variants track G4's walking
/// skeleton; additions are cheap, renames are a migration.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum EventKind {
    /// A seam round-trip completed (I4); the log's view of every UI touch.
    RequestHandled {
        path: String,
        status: u16,
    },
    /// A user utterance entered the system — the usual trigger of a turn.
    UserMessage {
        text: String,
    },
    /// Registry fact (ADR-004): manifest body lives in storage, the log
    /// carries the reference — history stays small, storage stays the payload.
    ModuleInstalled {
        module: ModuleId,
        version: Version,
    },
    ModuleDeactivated {
        module: ModuleId,
        version: Version,
    },
    ModuleReactivated {
        module: ModuleId,
        version: Version,
    },
    /// The phase machine moved (ADR-010); replay reconstructs the walk.
    PhaseEntered {
        phase: PhaseId,
    },
    /// A model call left: hash + budget outcome only (ADR-009 — full text is
    /// personal and large; persisted on explicit request, never by default).
    ModelCalled {
        document_hash: String,
        spent_tokens: u32,
    },
    /// The completed reply (ADR-002: token deltas never enter the log).
    ModelReplied {
        text: String,
    },
    /// A tool ran through a granted capability; its envelope is the fact.
    /// `args` rides with it because the trace the user reads is worthless
    /// without what the tool was ASKED (plan, "UI shape": `ToolTrace` owns
    /// calls, args, results and errors). Refusals are facts too: `ok: false`
    /// with the repair message in `output`.
    ToolInvoked {
        tool: ToolId,
        #[serde(default)]
        args: String,
        ok: bool,
        output: String,
    },
    /// One agent's status moved (Python `core/state.py`: the table is written
    /// by whichever thread changed something). A fact, not a table read: the
    /// board is the fold of these over the log, so what the user watched is
    /// what the log says happened. `detail` carries a failure's own message.
    AgentStatus {
        agent: String,
        status: Status,
        #[serde(default)]
        detail: String,
    },
    /// A storage write failed (ADR-005: quota errors surface, never silent).
    StoreFailed {
        key: String,
        message: String,
    },
    /// Escape hatch for module-authored facts; kind is namespaced by module.
    Custom {
        kind: String,
        payload_json: String,
    },
}

/// The in-memory append-only log. Public: `core` appends and projects;
/// persistence rides `StorePort` as segments (ADR-005 `events/seg-*`), so this
/// type does no I/O and tests on the host (I3).
#[derive(Debug, Default)]
pub struct EventLog {
    events: Vec<Event>,
}

impl EventLog {
    /// Exists so boot can start an empty log before any segment is replayed.
    pub fn new() -> EventLog {
        EventLog { events: Vec::new() }
    }

    /// Append one fact; assigns `seq`. The only mutation the log permits —
    /// no edit, no delete — which is what makes views trustworthy projections.
    pub fn append(&mut self, mut event: Event) {
        let seq = self.events.len() as u64;
        event.seq = seq;
        event.id = EventId(seq);
        self.events.push(event);
    }

    /// Read the whole history in order; replay and the trace viewer are
    /// exactly this iterator plus a fold.
    pub fn iter(&self) -> impl Iterator<Item = &Event> {
        self.events.iter()
    }

    /// Next sequence number; public so persistence can name the segment
    /// boundary it has reached.
    pub fn len(&self) -> u64 {
        self.events.len() as u64
    }

    /// Clippy pairing for `len`; an empty log is the first-boot signal.
    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }
}
