//! Boot: migration gate, registry replay, built-in registration — through
//! the same install path as forged modules (ADR-004; that symmetry is I9's
//! live demonstration at every startup).

use kernel::{BoxFuture, StorePort};

use crate::app::{App, Ports};
use crate::error::CoreError;

/// The storage schema version this build expects (ADR-005 `meta/
/// schema_version`). A function, not a const, so the value has one audited
/// definition site the migration ladder and tests share.
pub fn schema_version() -> u32 {
    todo!("G4")
}

/// Run the forward-only migration ladder from `from` up to
/// `schema_version()` (ADR-005): export snapshot first, one pure
/// `migrate_vN` per rung, an event per rung; refuses to run downward — a
/// newer store than the code is the refuse-and-offer-export case (ADR-007).
pub fn migrate(store: &dyn StorePort, from: u32) -> BoxFuture<'_, Result<(), CoreError>> {
    let _ = (store, from);
    todo!("G4")
}

/// Build the running App: check/migrate schema, replay registry events from
/// storage, install built-ins that aren't yet in the log, restore agent
/// state, open the event log. The ONE constructor — `App` has no `new`
/// because an App that skipped boot would be an unmigrated, unreplayed lie.
pub fn boot(ports: Ports) -> BoxFuture<'static, Result<App, CoreError>> {
    let _ = ports;
    todo!("G4")
}
