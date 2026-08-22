//! The paper (§8, ADR-009). Nothing reaches a model except through one
//! assembled `Document` (I13); assembly is pure and golden-tested (I14).
//! Two deliberate stages: `assemble` decides WHAT is said, `render` decides
//! HOW this provider hears it — collapsing them is the known failure mode
//! (§8.1). Vocabulary mirrors Spike C, corrected by its four frictions.
//!
//! G3 interface freeze: types and signatures only; bodies are `todo!()`.

mod args;
mod assemble;
mod component;
mod degrade;
mod error;
mod form;
mod law;
mod openai;
mod render;
mod slot;
mod state;
mod types;

pub use args::{ArgError, Args};
pub use assemble::assemble;
pub use law::validate;
pub use component::{text, Component};
pub use error::ContextError;
pub use form::Form;
pub use slot::Slot;
// PROVISIONAL (G4): the provider wire writer/reader — see openai.rs.
pub use openai::{openai_reply_text, openai_request_body, openai_usage};
pub use render::{content_hash, render, ContentPart, Message, ProviderFormat, Role};
pub use state::{SectionSource, State};
pub use types::{
    Budget, CompactionReport, CompactionStep, Document, Fidelity, Part, Provenance, Section,
    Stability,
};
