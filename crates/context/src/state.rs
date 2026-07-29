//! Everything `assemble` reads. All content arrives as data — providers ran
//! earlier, clocks were injected — which is what keeps assembly pure (§8.1).

use serde::{Deserialize, Serialize};

use crate::types::{Part, Section};

/// One section provider's output, gathered before assembly. Exists because
/// pure `assemble` cannot author summaries (Spike C friction 3): the owning
/// provider precomputes its Summarized form and hands both in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SectionSource {
    /// The section at Full fidelity, as its provider produced it.
    pub section: Section,
    /// Precomputed Summarized parts; `None` means Summarized renders a
    /// mechanical truncation rather than a curated summary.
    pub summary: Option<Vec<Part>>,
}

/// Input state for one assembly. Deliberately just the gathered sources: the
/// caller (`core`, guided by the phase's `PhaseConfig`, ADR-010) chooses WHICH
/// providers contribute; `assemble` owns only order and budget — so `context`
/// never needs to know phases' section lists or the registry (layering §4).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct State {
    /// Sources in canonical §8.2 declaration order; assembly's stable sort
    /// preserves this order within each stability class.
    pub sources: Vec<SectionSource>,
}
