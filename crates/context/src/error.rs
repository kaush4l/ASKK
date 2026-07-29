//! Typed contract violations for the paper. These are install-time and
//! test-time errors: by the time `assemble` runs, none can exist (ADR-004
//! rejects offending providers), which is why `assemble` itself is total.

use serde::{Deserialize, Serialize};

use kernel::SectionId;

/// What `validate` can reject. One variant per law in DOMAIN §2–3, so a test
/// failure names the rule broken, not just "invalid document".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ContextError {
    /// §8.2: a section that cannot state its intent does not belong in
    /// the paper. Empty intent is an error, not a blank.
    EmptyIntent { section: SectionId },
    /// DOMAIN §2: nothing is empty by default — an empty `soul` is a bug.
    EmptySection { section: SectionId },
    /// §8.3: classes never interleave; one misplaced Dynamic section
    /// invalidates the cache for everything after it.
    InterleavedStability { section: SectionId },
    /// ADR-009: a phase pinned a section below its declared floor.
    BelowFloor { section: SectionId },
    /// Two sections claim the same id; the paper's addressing would be
    /// ambiguous everywhere (compaction report, provenance, goldens).
    DuplicateSection { section: SectionId },
}
