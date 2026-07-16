//! Shared UI primitives (ADR-043): shell chrome, the stage manifest, fonts,
//! the markdown renderer, the pending-actions bar, and run-card helpers.
//! Imported by `app.rs` and `features/*`; never imports a feature.

pub mod actions;
pub mod fonts;
pub mod manifest;
pub mod markdown;
pub mod runcard;
pub mod shell;
