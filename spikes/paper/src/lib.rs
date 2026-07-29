//! Spike C — the Context Document ("the paper"), PROMPT.md §8.
//! Two pure stages: `assemble` (what is said) and `render` (how this
//! provider hears it). The integration tests ARE the e2e for this crate.

mod assemble;
mod render;
mod sections;
mod state;
mod types;

pub use assemble::assemble;
pub use render::{render, ContentPart, Message, ProviderFormat};
pub use state::State;
pub use types::{
    Budget, Compaction, Degradation, Document, Part, Phase, Provenance, Section, Stability,
};
