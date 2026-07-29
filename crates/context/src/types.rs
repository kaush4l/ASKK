//! Section anatomy (§8.2) and the Document (ADR-009 schema). Every section
//! declares itself; the document records what compaction did to it.

use serde::{Deserialize, Serialize};

use kernel::{ModuleId, PhaseId, SectionId, Timestamp, Version};

/// Multimodal content parts (§8.6) — bytes, not URLs (RESEARCH: the canonical
/// Part carries data so `render` can feed any provider). A `String` pipeline
/// here would be the rewrite §8.1 warns about; this enum is the insurance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Part {
    Text {
        text: String,
    },
    Image {
        media_type: String,
        data_base64: String,
    },
    Audio {
        media_type: String,
        data_base64: String,
    },
    File {
        name: String,
        media_type: String,
        data_base64: String,
    },
    /// An htmx fragment rendered into the paper — the dashboard and the paper
    /// are one composition mechanism with two renderers (§8.4).
    Fragment {
        id: String,
        html: String,
    },
}

/// Stability classes (§8.3, DOMAIN §3). Declaration order IS the sort order
/// (derived `Ord`) — the line that makes provider prompt caching hit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Stability {
    Static,
    SemiStatic,
    Dynamic,
    Volatile,
}

/// Degradation levels (§8.5). Named `Fidelity` per ADR-009's split of
/// declared-floor vs current-level (Spike C friction 2) — `Compaction` the
/// noun now means the *process*, recorded in `CompactionReport`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Fidelity {
    Full,
    Summarized,
    Pointer,
    Elided,
}

impl Fidelity {
    /// One degradation step; `None` at the end of the ladder. Public so the
    /// compaction loop and its tests share one definition of "next".
    pub fn next(self) -> Option<Fidelity> {
        match self {
            Fidelity::Full => Some(Fidelity::Summarized),
            Fidelity::Summarized => Some(Fidelity::Pointer),
            Fidelity::Pointer => Some(Fidelity::Elided),
            Fidelity::Elided => None,
        }
    }
}

/// What produced a section, and from what (§8.7, ADR-009). Exists so "why did
/// it do that?" is answerable with receipts: the module that said it, at which
/// version, from which inputs, when.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Provenance {
    pub module: ModuleId,
    pub version: Version,
    /// Hash of the provider's inputs — the byte-identity test's witness.
    pub input_hash: String,
    /// Injected time (I7); never a wall-clock read during assembly.
    pub produced_at: Timestamp,
}

/// One declared unit of the paper (§8.2 anatomy, ADR-009 schema). `intent` is
/// mandatory and not decoration — it is the mechanism that stops prompts from
/// accreting; `validate` rejects an empty one as an error, not a blank.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Section {
    pub id: SectionId,
    /// One sentence: the question this section answers for the model.
    pub intent: String,
    pub stability: Stability,
    /// Lower survives longer when the budget bites (DOMAIN: P0 never degrades).
    pub priority: u8,
    /// What compaction chose for THIS assembly (current level).
    pub fidelity: Fidelity,
    /// The lowest level this section supports (declared floor, §8.2
    /// `compaction`); a phase may pin higher, never lower.
    pub floor: Fidelity,
    /// Declared expected token cost — the budget arithmetic's input.
    pub budget_hint: u32,
    pub provenance: Provenance,
    pub parts: Vec<Part>,
}

/// Token ceiling for one assembly (§8.5). A struct, not a bare u32, so the
/// signature reads as the §8.1 contract and can grow (e.g. reserved output
/// tokens) without touching every caller.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Budget {
    pub max_tokens: u32,
}

impl Budget {
    /// For golden snapshots: assembly with nothing degraded (Spike C pattern).
    pub fn unlimited() -> Budget {
        Budget {
            max_tokens: u32::MAX,
        }
    }
}

/// One recorded degradation step. Exists because degradation must be visible:
/// an agent that doesn't know it is missing history acts as though it has it
/// (§8.5).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompactionStep {
    pub section: SectionId,
    pub from: Fidelity,
    pub to: Fidelity,
}

/// The budget outcome for one assembly (ADR-009). Rendered into the paper as
/// a Volatile tail section AND persisted per turn in the event log — the same
/// facts tell the model and the engineer what was cut.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompactionReport {
    pub budget: Budget,
    /// Estimated spend after degradation.
    pub spent: u32,
    pub steps: Vec<CompactionStep>,
}

/// The assembled paper (ADR-009 schema): sections in stable-first order plus
/// the recorded budget outcome. This is what `render` consumes, what goldens
/// snapshot, and what the event log hashes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Document {
    pub phase: PhaseId,
    pub sections: Vec<Section>,
    pub report: CompactionReport,
}
