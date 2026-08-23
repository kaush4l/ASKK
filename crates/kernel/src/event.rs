//! Event + event-log types (I8: every transition emits an event; every view is
//! a projection of the log). Events are the sole input to `step()` and the
//! material of replay (GLOSSARY: Event — a fact about the past).
//!
//! **CHANGING A VARIANT'S SHAPE IS A MIGRATION, AND HERE IS WHY IT IS NOT
//! FREE.** `core::log::store::persist` writes every event to `events/{seq}` as
//! serde JSON, and `core::boot::replay_events` reads them back at boot and
//! REFUSES BOOT LOUDLY on a record it cannot deserialize (ADR-005: no silent
//! drops of history). So a field added without `#[serde(default)]` does not
//! degrade — it bricks every browser that already has a log. Every optional
//! field below carries that attribute for exactly this reason, and
//! `crates/core/tests/log_shape.rs` executes the claim rather than asserting
//! it in prose (I17).

use serde::{Deserialize, Serialize};

use crate::ids::{EventId, ModuleId, PhaseId, Timestamp, SectionId, ToolId, Version};
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
    /// `agent` is WHICH conversation it belongs to (increment 07): every agent
    /// is separately addressable, and a message to one must never appear in
    /// another's transcript. Empty means "this process's own agent", which is
    /// what every log written before per-agent chat says.
    UserMessage {
        text: String,
        #[serde(default)]
        agent: String,
        /// WHO said it. Empty is a person; a name is the agent that delegated
        /// this goal. Both land in the callee's history, and a transcript that
        /// labelled a lead's delegation "You" claimed the reader asked a
        /// question they never typed (`ux-walker`, increment 07).
        #[serde(default)]
        from: String,
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
        /// WHICH COMPONENTS THE BUDGET REMOVED ENTIRELY from the paper this
        /// call was sent — the ladder's `Fidelity::Elided` steps and no others.
        ///
        /// It is here because of ADR-009's one sharp edge: the rendered prompt
        /// is the artifact this product deliberately does NOT persist, and the
        /// `## compaction_notice` block is the system's ONLY statement of what
        /// it evicted. So the single sentence naming the loss was being written
        /// into the one place guaranteed to be thrown away, and the person was
        /// never told at all — measured on `main` in `work`, where the paper
        /// wanted 4174 tokens against a 4096 budget and `## observations` was
        /// elided on EVERY turn while the agent's own prose told it to read
        /// that block (`5131e0b`). I16: a truth the system holds and does not
        /// state is a defect.
        ///
        /// ELISIONS ONLY, AND THAT IS THE WHOLE DESIGN. `Summarized` and
        /// `Pointer` still put the section in the prompt and tell the model how
        /// to ask for it back; that is a budget working, it happens on any long
        /// conversation, and recording it here would put three to nine rows in
        /// the log on every model call to say nothing was wrong. `Elided`
        /// removes the heading, so the agent's prose then names a block that is
        /// not there. A healthy turn carries an empty vector; a line only
        /// appears when something is actually gone.
        ///
        /// COST: `"evicted":[]` on every persisted `ModelCalled` record, and
        /// `#[serde(default)]` so the records written before this field still
        /// replay (see this module's header — they would otherwise refuse boot).
        #[serde(default)]
        evicted: Vec<SectionId>,
    },
    /// The completed reply (ADR-002: token deltas never enter the log).
    /// Scoped like `UserMessage`: a sub-agent's answer is recorded against
    /// THAT agent, whether a person asked it or the lead delegated to it.
    ModelReplied {
        text: String,
        #[serde(default)]
        agent: String,
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
