//! Feature surfaces (ADR-043): one module per `Stage` variant
//! (`components/manifest.rs`). Pure views over folds passed down from
//! `app.rs`; import core + the host facade + `ui::components` only, never
//! each other. `lab/` is the Features-lab stage (ADR-041) — a stage like
//! the rest, directory-shaped because it has five panels.

pub mod agents;
pub mod artifacts;
pub mod chat;
pub mod dashboard;
pub mod fleet;
pub mod lab;
pub mod settings;
pub mod vm;
