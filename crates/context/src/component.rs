//! The component contract. Everything the model is ever told is one of these.
//!
//! Ported from `PythonProject1/core/components.py`, whose docstring states the
//! analogy this file exists to make true in Rust:
//!
//! ```text
//! Component
//! ├─ render()    the object as instructions for the model   (its "toString")
//! ├─ key()       content hash — identical key means identical bytes
//! ├─ applies()   cheap emptiness check; empty components vanish
//! └─ slot()      where in the prompt this component belongs
//! ```
//!
//! A component is a value, not a place: it is rebuilt from live state each
//! turn and holds none of its own. That immutability is what makes [`key`]
//! honest — the fields are fixed, so a hash of the fields is a hash of the
//! rendered bytes.
//!
//! [`key`]: Component::key

use kernel::{ModuleId, SectionId, Timestamp, Version};

use crate::slot::Slot;
use crate::types::{Fidelity, Part, Provenance, Section, Stability};

/// One part of the prompt, able to write itself down.
///
/// `slot` is a method rather than an associated const so the trait stays
/// object-safe: the prompt is assembled from a heterogeneous list, and a
/// `dyn Component` is the whole point. Implementors return their type's
/// constant and nothing else.
///
/// Only three methods have no sensible default. The rest are the inherited
/// behaviour every component gets for free — the reason this is a trait and
/// not a convention.
pub trait Component {
    /// Stable address of this component in the paper.
    fn id(&self) -> SectionId;

    /// Where this belongs in the prompt.
    fn slot(&self) -> Slot;

    /// THE toString: this component as instructions for the model.
    ///
    /// Returns parts rather than a string because the paper is multimodal and
    /// collapsing it to text is the documented failure mode (§8.1). An empty
    /// vector means "nothing to say" and the assembler drops it.
    fn render(&self) -> Vec<Part>;

    /// One sentence: the question this component answers for the model.
    /// Mandatory and not decoration — it is the mechanism that stops prompts
    /// from accreting, and `validate` rejects an empty one as an error.
    fn intent(&self) -> String;

    /// Tiebreak within one slot. Lower renders first.
    fn priority(&self) -> u8 {
        0
    }

    /// How often this content changes — a declared cache class, and no longer
    /// the sort key. See [`Slot`] for why the two questions are separate.
    fn stability(&self) -> Stability {
        Stability::Dynamic
    }

    /// The lowest fidelity this component supports. A phase may pin higher,
    /// never lower.
    fn floor(&self) -> Fidelity {
        Fidelity::Summarized
    }

    /// Budget rank: LOWER survives longer when the budget bites.
    fn budget_priority(&self) -> u8 {
        5
    }

    /// Whether the rendered bytes may be reused across turns. False for
    /// anything derived from the clock: a cached clock is a wrong clock.
    fn cacheable(&self) -> bool {
        true
    }

    /// Cheap pre-check. The assembler also drops anything that renders to
    /// nothing, so this is an optimisation, not the guarantee.
    fn applies(&self) -> bool {
        true
    }

    /// Content hash: identical key means identical rendered bytes.
    ///
    /// Prefixed with the component's own name so two types carrying identical
    /// fields can never collide — `soul` and a system block with the same text
    /// are different components that happen to say the same thing.
    fn key(&self) -> String {
        let mut hash = FNV_OFFSET;
        for part in self.render() {
            hash = fnv(hash, part_bytes(&part).as_bytes());
        }
        format!("{}:{hash:016x}", self.id().0)
    }

    /// The assembled section. This is the provided default — the inherited
    /// method that makes every component usable by `assemble` without writing
    /// the same conversion eleven times.
    fn section(&self, at: Timestamp) -> Section {
        Section {
            id: self.id(),
            intent: self.intent(),
            slot: self.slot(),
            stability: self.stability(),
            priority: self.budget_priority(),
            fidelity: Fidelity::Full,
            floor: self.floor(),
            budget_hint: 0, // assemble recomputes from the real parts
            provenance: Provenance {
                module: ModuleId(format!("builtin.{}", self.id().0)),
                version: Version(1),
                input_hash: self.key(),
                // A cacheable component reports time zero so its bytes stay
                // identical across turns and boots — that byte-stability IS
                // the cache-prefix property. Anything uncacheable is dated,
                // because a section claiming it was produced at time zero
                // would be a stale fact about a freshly built one.
                produced_at: match self.cacheable() {
                    true => Timestamp(0),
                    false => at,
                },
            },
            parts: self.render(),
        }
    }
}

/// One text part, the shape most components want.
pub fn text(s: impl Into<String>) -> Vec<Part> {
    let text: String = s.into();
    match text.is_empty() {
        true => Vec::new(),
        false => vec![Part::Text { text }],
    }
}

const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;

fn fnv(mut hash: u64, bytes: &[u8]) -> u64 {
    for b in bytes {
        hash ^= u64::from(*b);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// The bytes that identify a part. Not its rendering — its identity.
fn part_bytes(part: &Part) -> String {
    match part {
        Part::Text { text } => format!("t{text}"),
        Part::Image { media_type, data_base64 } => format!("i{media_type}{data_base64}"),
        Part::Audio { media_type, data_base64 } => format!("a{media_type}{data_base64}"),
        Part::File { name, media_type, data_base64 } => {
            format!("f{name}{media_type}{data_base64}")
        }
        Part::Fragment { id, html } => format!("g{id}{html}"),
    }
}
