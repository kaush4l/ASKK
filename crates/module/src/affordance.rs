//! The affordance document (§6, ADR-004): the generated, always-current
//! account of what exists — rendered from the live registry, never
//! hand-written, so it cannot drift from reality.

use context::Section;
use kernel::CapabilityId;

use crate::registry::Registry;

/// Generate the `affordances` Section from the registry: for each active
/// manifest whose required capabilities are all currently available (I15),
/// emit id, description, routes/tools, and capability list. Pure — uninstall
/// or capability loss de-advertises in the same instant because the next call
/// simply reads different inputs. It is itself a section provider: the
/// registry describing itself through the mechanism it hosts (§8.4).
pub fn affordances(registry: &Registry, available: &[CapabilityId]) -> Section {
    let _ = (registry, available);
    todo!("G4")
}
