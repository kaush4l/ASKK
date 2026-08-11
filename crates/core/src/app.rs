//! The application aggregate and the injected ports bundle. `App` is what
//! the composition root builds once and the seam threads everywhere.

use std::rc::Rc;

use agent::{AgentSpec, AgentState, Board, PhaseConfig};
use kernel::{
    AgentPort, ClockPort, Event, EventKind, EventLog, ModelPort, NetPort, RngPort, StorePort,
};
use module::Registry;

/// The agent a PERSON is talking to. Only it can be `Waiting` on someone;
/// every other agent answers to another agent and goes back to `Idle`
/// (Python `ThreadedAgent.entry`).
pub const ENTRY_AGENT: &str = "main";

/// All five ports as shared trait objects (ARCHITECTURE §4: injected at the
/// entry point). A struct, not five parameters, so adding a port later
/// touches the composition roots and nothing between.
///
/// PROVISIONAL (G4 discovery): `Rc`, not the frozen `Box`. `execute_effect`
/// must return a `'static` future — a future borrowing `App` across a model
/// await would wedge the whole seam for the duration of the fetch (every
/// poll round-trip would hit a live `&mut App`). Cloning an `Rc` handle out
/// lets the runtime await without holding the app. Single-threaded host, so
/// `Rc` is the honest tool.
pub struct Ports {
    pub model: Rc<dyn ModelPort>,
    pub store: Rc<dyn StorePort>,
    pub net: Rc<dyn NetPort>,
    pub clock: Rc<dyn ClockPort>,
    pub rng: Rc<dyn RngPort>,
    /// The other agents, each in its own Worker (increment 06). A port, not a
    /// field of handles: the core names an agent and waits for an answer, and
    /// cannot reach into its loop even by accident (ADR-008).
    pub agents: Rc<dyn AgentPort>,
}

/// Everything alive at runtime: the registry fold, the agent, the phase
/// configs, the log, the ports. Fields private — the seam (`handle`), the
/// runtime (`drive`), and boot are the only doors, which is what keeps every
/// mutation an Event (I8).
pub struct App {
    pub(crate) registry: Registry,
    pub(crate) agent: AgentState,
    pub(crate) phases: Vec<PhaseConfig>,
    pub(crate) log: EventLog,
    pub(crate) ports: Ports,
    /// Events awaiting the agent pump (G4: filled by module emission in
    /// dispatch and by effect results in `drive`).
    pub(crate) pending: Vec<Event>,
    /// Log entries not yet written through `StorePort` — drained by `drive`.
    pub(crate) unpersisted: Vec<Event>,
    /// The agents loaded from `public/agents/` (plus the compiled-in
    /// built-ins they may override). Data, not code: installed after boot by
    /// `agents::install_agents`, replaced wholesale when the files change.
    pub(crate) agents: Vec<AgentSpec>,
    /// One sentence per `agent.md` that could not be read. Skipping a broken
    /// file is correct; staying silent about it is not (`ux-walker`), so the
    /// Agents panel projects this list beside what did load.
    pub(crate) agent_problems: Vec<String>,
    /// What every loaded agent is doing (Python `core/state.py`). Registered
    /// by `install_agents`, then moved ONLY by `AgentStatus` facts as they are
    /// appended — so the board a person watches and the log agree by
    /// construction (I8).
    pub(crate) board: Board,
}

impl App {
    /// Move an agent's status, if it is not already there. The guard is what
    /// keeps a no-op seam round-trip from writing a fact; a status that did
    /// not change is not news. Returns whether anything was recorded.
    pub(crate) fn set_status(&mut self, agent: &str, status: kernel::Status, detail: &str) -> bool {
        let unchanged = self
            .board
            .get(agent)
            .is_some_and(|r| r.status == status && r.detail == detail);
        if unchanged {
            return false;
        }
        self.append(EventKind::AgentStatus {
            agent: agent.to_string(),
            status,
            detail: detail.to_string(),
        });
        true
    }

    /// Append one fact to the log NOW (I8) and stage it for persistence.
    /// The one append door: every event gets its seq, its injected
    /// timestamp, and its place in the persistence queue here.
    pub(crate) fn append(&mut self, kind: EventKind) -> Event {
        let event = Event {
            id: kernel::EventId(self.log.len()),
            seq: self.log.len(),
            at: self.ports.clock.now(),
            kind,
        };
        // The board is a FOLD of the log, applied here so there is exactly one
        // place a status can move (I8) — a table set directly from a handler
        // could disagree with the history.
        if let EventKind::AgentStatus {
            agent,
            status,
            detail,
        } = &event.kind
        {
            self.board.set(agent, *status, detail, event.at);
        }
        self.log.append(event.clone());
        self.unpersisted.push(event.clone());
        event
    }
}
