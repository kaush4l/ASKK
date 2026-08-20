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
/// PROVISIONAL (G4 discovery): `Rc`, not the frozen `Box`. `execute_port_effect`
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
    /// Where every SHARED SPACE lives (increment 09). A separate injection
    /// from `store`, because `store` is this agent's own — its log and its
    /// events — and a space is by definition the one thing two agents in
    /// different Workers must both be able to read and write.
    pub spaces: Rc<dyn kernel::KvStore>,
    /// The Linux the agent can run commands in (increment 10, ADR-013). A
    /// port like every other capability: the core knows there is somewhere to
    /// run a command and nothing about what runs it, so the exec tool and its
    /// gate test on the host against a fake (I3).
    pub workspace: Rc<dyn kernel::WorkspacePort>,
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
    /// The host halves of the faculties this build can actually sense
    /// (`crate::faculty`). Here rather than on `Ports` because a sense is
    /// COMPOSED IN, not required: an app with none still runs every agent it
    /// has, and the composition root adds what its platform can reach through
    /// `faculty::install_sense`.
    pub(crate) senses: Vec<std::rc::Rc<dyn crate::faculty::Sense>>,
    /// The host halves that RUN what those faculties offer to call
    /// (`crate::faculty::ToolHost`). Here beside `senses`, and for the same
    /// reason: composed in through `faculty::install_tool_host`, absent by
    /// default, and never a required field of `Ports` — a build with no host
    /// still runs every tool compiled into this crate.
    pub(crate) tool_hosts: Vec<std::rc::Rc<dyn crate::faculty::ToolHost>>,
    /// Events awaiting the agent pump (G4: filled by module emission in
    /// dispatch and by effect results in `drive`).
    pub(crate) pending: Vec<Event>,
    /// Log entries not yet written through `StorePort` — drained by `drive`.
    pub(crate) unpersisted: Vec<Event>,
    /// This agent's OWN log — the Python's `agents/<name>/log.txt` — as writes
    /// waiting for the store, in the order they must happen. One ordered queue
    /// is what makes "drain before the rewrite" true by construction.
    pub(crate) unlogged: Vec<crate::log::decisions::LogOp>,
    /// How much of the window the log already holds.
    pub(crate) logbook: crate::log::decisions::Logbook,
    /// The agents loaded from `public/agents/` (plus the compiled-in
    /// built-ins they may override). Data, not code: installed after boot by
    /// `agents::install_agents`, replaced wholesale when the files change.
    pub(crate) agents: Vec<AgentSpec>,
    /// The `public/agents/` files exactly as fetched, kept so an agent
    /// authored in the browser can be merged over them WITHOUT a reload
    /// (increment 11) — the composition root fetches them once, at boot.
    pub(crate) files: Vec<(String, String)>,
    /// What this browser itself authored, `(name, agent.md, author)` — the
    /// fold of the log that `roster::reconcile` last applied. Held so a request
    /// can tell "nothing changed" from "an agent was written" without
    /// re-installing on every seam round-trip. An empty author is the person at
    /// the keyboard; anything else is the agent that wrote it (11b walk).
    pub(crate) authored: Vec<crate::agents::authored::Authored>,
    /// One sentence per `agent.md` that could not be read. Skipping a broken
    /// file is correct; staying silent about it is not (`ux-walker`), so the
    /// Agents panel projects this list beside what did load.
    pub(crate) agent_problems: Vec<String>,
    /// WHAT EVERY STAGE IS TOLD (`agent::brief`), loaded from `public/stages/`.
    /// Held on the App and not only on the agent because every agent in this
    /// process gets the same set — that is what makes `verify` mean one thing
    /// — and `install_agents` re-adopts them onto whichever agent it adopts.
    pub(crate) briefs: agent::Briefs,
    /// What every loaded agent is doing (Python `core/state.py`). Registered
    /// by `install_agents`, then moved ONLY by `AgentStatus` facts as they are
    /// appended — so the board a person watches and the log agree by
    /// construction (I8).
    pub(crate) board: Board,
    /// WHICH agent this process is (increment 07). The page is `main`; a
    /// sub-agent's Worker runs the same code as itself. Everything conversation
    /// -shaped that carries no explicit agent belongs to this one, which is how
    /// a log written before per-agent chat still reads correctly.
    pub(crate) me: String,
    /// Commands the runtime is AWAITING right now (R2-8). A typed command is a
    /// fact the moment it is requested and a second fact when it returns; in
    /// between there is nothing in the log to project, so navigating away and
    /// back dropped the "running…" line the pane had only in component state.
    /// In memory on purpose: a reload really does abandon the command, and a
    /// replayed log must not claim one is still running.
    pub(crate) running: Vec<String>,
    /// Workspace calls handed to the port and not yet answered (R11-4) — the
    /// agent's as well as the panes' and yours. Same reason and same lifetime
    /// as `running` one field above: an in-flight call has no fact to project
    /// until it returns, and for a command that never returns that was the
    /// whole seven minutes.
    pub(crate) calling: Vec<crate::trace::inflight::Inflight>,
    /// How much of the log was REPLAYED at boot — every entry before this index
    /// happened on an earlier page load, and therefore in a Linux this page does
    /// not have. Set once, by `boot`, and never moved: it is the only thing that
    /// can tell a command run in this tab from one whose answer describes a
    /// machine that no longer exists (R10-5).
    pub(crate) booted: usize,
}

impl App {
    /// Whose process this is — the agent a `UserMessage` with no name on it
    /// belongs to, and the only agent whose turns run in THIS event loop.
    pub(crate) fn me(&self) -> &str {
        &self.me
    }

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
