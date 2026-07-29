//! The application aggregate and the injected ports bundle. `App` is what
//! the composition root builds once and the seam threads everywhere.

use std::rc::Rc;

use agent::{AgentState, PhaseConfig};
use kernel::{ClockPort, Event, EventKind, EventLog, ModelPort, NetPort, RngPort, StorePort};
use module::Registry;

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
}

impl App {
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
        self.log.append(event.clone());
        self.unpersisted.push(event.clone());
        event
    }
}
