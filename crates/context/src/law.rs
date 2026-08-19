//! The paper's laws, as a checkable contract rather than a convention.
//!
//! Building the document and judging it are two jobs, and only the second one
//! can fail: `assemble` is total, and everything that could be wrong with what
//! it produced is named here, one rule at a time, so a rejection says WHICH
//! rule broke instead of "invalid document".

use crate::error::ContextError;
use crate::types::{Document, Fidelity};

/// Enforcement of the §8.3/DOMAIN rules: mandatory non-empty intent, no empty
/// sections (except at Elided, where empty IS the content), no degradation
/// past a floor, a stability-monotonic cacheable head, no duplicate ids, and
/// the pinned ends the slot order exists to guarantee. Public so install-time
/// module tests and the golden suite share one judge instead of re-deriving
/// the law.
pub fn validate(doc: &Document) -> Result<(), ContextError> {
    let mut seen: Vec<&kernel::SectionId> = Vec::new();
    for (i, s) in doc.sections.iter().enumerate() {
        if s.intent.trim().is_empty() {
            return Err(ContextError::EmptyIntent {
                section: s.id.clone(),
            });
        }
        if s.parts.is_empty() && s.fidelity != Fidelity::Elided {
            return Err(ContextError::EmptySection {
                section: s.id.clone(),
            });
        }
        if s.fidelity > s.floor {
            return Err(ContextError::BelowFloor {
                section: s.id.clone(),
            });
        }
        if interleaved(doc, i) {
            return Err(ContextError::InterleavedStability {
                section: s.id.clone(),
            });
        }
        if s.slot.is_tail() && i + 1 != doc.sections.len() {
            return Err(ContextError::TailNotLast {
                section: s.id.clone(),
            });
        }
        if seen.contains(&&s.id) {
            return Err(ContextError::DuplicateSection {
                section: s.id.clone(),
            });
        }
        seen.push(&s.id);
    }
    ends(doc)
}

/// Whether section `i` breaks the stability order of the cacheable head.
///
/// The head must stay monotonic because one misplaced Dynamic section
/// invalidates the provider's prefix cache for everything after it. The pinned
/// tail is exempt by construction: nothing after the transcript was ever going
/// to be cached, so static contract text sitting there costs no cache that was
/// reachable — and buys the model recency on the shape of its own reply.
fn interleaved(doc: &Document, i: usize) -> bool {
    if i == 0 || doc.sections[i].slot.is_tail() {
        return false;
    }
    let previous = &doc.sections[i - 1];
    !previous.slot.is_tail() && previous.stability > doc.sections[i].stability
}

/// The two structural laws the slot order exists to guarantee, checked rather
/// than trusted. `assemble` cannot break them — that is what a total order
/// with pinned ends buys — so a failure here names a component that declared
/// the wrong slot, which is a programming mistake and not a runtime condition
/// to paper over.
fn ends(doc: &Document) -> Result<(), ContextError> {
    let tails = doc.sections.iter().filter(|s| s.slot.is_tail()).count();
    if tails != 1 {
        return Err(ContextError::TailCount { found: tails });
    }
    match doc.sections.iter().any(|s| s.slot.is_head()) {
        // An agent must be someone before it is told anything.
        false => Err(ContextError::NoHead),
        true => Ok(()),
    }
}
