//! §8.1 first stage + §8.5 budget degradation. Pure, deterministic, no I/O:
//! same state + phase + budget ⇒ the same document, bit for bit (I14).

use kernel::PhaseId;

use crate::error::ContextError;
use crate::state::State;
use crate::types::{Budget, Document};

/// Build the paper for one call — the frozen §8.1 signature. Sorts sources
/// stable-first (stable sort: §8.2 order holds within a class), degrades to
/// budget by the ADR-009 loop (highest priority number first, ties to the
/// later section, one level at a time, never past a floor), and records every
/// step. Total, not fallible: malformed sections are rejected at module
/// install time (ADR-004), so by assembly they cannot exist.
pub fn assemble(state: &State, phase: PhaseId, budget: Budget) -> Document {
    let _ = (state, phase, budget);
    todo!("G4")
}

/// Enforcement of the §8.3/DOMAIN rules as a checkable contract: mandatory
/// non-empty intent, non-increasing stability order, no class interleaving.
/// Public so install-time module tests and the golden suite share one judge
/// instead of re-deriving the law.
pub fn validate(doc: &Document) -> Result<(), ContextError> {
    let _ = doc;
    todo!("G4")
}
