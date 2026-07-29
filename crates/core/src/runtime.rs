//! The effect runtime loop (§11, ARCHITECTURE §1c: ≤40 lines when
//! implemented). `step` describes; this executes through ports and feeds
//! results back as Events — event sourcing's other half, not an extra system.

use agent::Effect;
use kernel::{BoxFuture, Event};

use crate::app::{App, Ports};
use crate::error::CoreError;

/// Execute ONE effect through the ports and return the resulting fact.
/// Separate from `pump` so a single effect is testable against in-memory
/// ports without driving the whole loop.
pub fn execute_effect<'a>(
    ports: &'a Ports,
    effect: Effect,
) -> BoxFuture<'a, Result<Event, CoreError>> {
    let _ = (ports, effect);
    todo!("G4")
}

/// The loop: feed one event to `agent::step`, execute the returned effects,
/// append every resulting event to the log (I8), repeat until the agent
/// emits no further effects (quiescent — awaiting the next external event).
/// This is the ONLY caller of `step` at runtime, so the wall between
/// thinking and doing has exactly one door.
pub fn pump<'a>(app: &'a mut App, event: Event) -> BoxFuture<'a, Result<(), CoreError>> {
    let _ = (app, event);
    todo!("G4")
}
