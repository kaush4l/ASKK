//! Everything `assemble` reads. All content arrives as data — providers ran
//! earlier, clocks were injected — which is what keeps assembly pure (§8.1).

use serde::{Deserialize, Serialize};

use crate::form::Form;
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
    /// The notation this paper is being written in. It lives on the paper so
    /// that whoever rebuilds a section reads the request from the paper it is
    /// already holding, rather than every call site having to carry one —
    /// which is why adding the request changed no `set_component` caller.
    /// A component that cannot honour it says so through `Component::forms`.
    ///
    /// `#[serde(default)]` because a paper persisted before the field existed
    /// was written in the default notation and still is.
    #[serde(default)]
    pub form: Form,
}
