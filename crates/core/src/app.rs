//! The application aggregate and the injected ports bundle. `App` is what
//! the composition root builds once and the seam threads everywhere.

use agent::{AgentState, PhaseConfig};
use kernel::{ClockPort, EventLog, ModelPort, NetPort, RngPort, StorePort};
use module::Registry;

/// All five ports as trait objects (ARCHITECTURE §4: injected as `dyn` at
/// the entry point). A struct, not five parameters, so adding a port later
/// touches the composition roots and nothing between.
pub struct Ports {
    pub model: Box<dyn ModelPort>,
    pub store: Box<dyn StorePort>,
    pub net: Box<dyn NetPort>,
    pub clock: Box<dyn ClockPort>,
    pub rng: Box<dyn RngPort>,
}

/// Everything alive at runtime: the registry fold, the agent, the phase
/// configs, the log, the ports. Fields private — the seam (`handle`), the
/// runtime (`pump`), and boot are the only doors, which is what keeps every
/// mutation an Event (I8).
pub struct App {
    pub(crate) registry: Registry,
    pub(crate) agent: AgentState,
    pub(crate) phases: Vec<PhaseConfig>,
    pub(crate) log: EventLog,
    pub(crate) ports: Ports,
}
