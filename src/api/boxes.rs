//! Boxes: every session as one object, for every UI (`docs/concept.md`).
use crate::core::boxes::SessionBox;
use crate::core::workspaces::Workspace;
use dioxus::prelude::*;

// The answers are plain functions in `answers`; these are their Dioxus form (see `wire!`).
#[cfg(any(feature = "server", feature = "local"))]
mod answers;
#[cfg(feature = "local")]
pub use answers::*;

wire! {
    boxes() -> Vec<SessionBox>;
    workspaces() -> Vec<Workspace>;
}
