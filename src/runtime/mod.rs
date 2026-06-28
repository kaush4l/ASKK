//! Runtime pillar — the in-process [`Signal`](crate::core::event::Signal) bus and
//! the projection that folds it into a renderable view.
//!
//! Where `core` defines the wire format ([`Signal`](crate::core::event::Signal),
//! [`SignalKind`](crate::core::event::SignalKind)) and the per-component
//! [`lifecycle`](crate::core::lifecycle) state machines, this module is the *spine*
//! that carries those deltas at runtime: one [`Bus`] every component publishes to,
//! and one [`RunProjection`] that reduces the stream into per-instance lifecycle
//! state plus an ordered event-log timeline. The UI reads the projection; nothing
//! here touches the DOM, the clock, or web APIs.
//!
//! On top of that spine, [`RunReducer`] folds the same delta stream into a full,
//! renderable [`crate::state::AgentRun`], so the existing UI components keep
//! rendering an `AgentRun` unchanged while the run path moves onto the bus.
//!
//! This is a self-contained foundation: it does not yet replace the live run path
//! or the worker transport — those wire onto the bus in a later step. For now it
//! compiles and is host-tested on its own.

mod bus;
pub mod fleet;
pub mod fleet_bridge;
pub mod patch_apply;
mod reducer;
pub mod state_writer;

pub use bus::{Bus, LifecycleState, OrderingAnomaly, RunProjection, Subscriber, TimelineEntry};
pub use fleet::{FleetNode, FleetView};
pub use reducer::RunReducer;
