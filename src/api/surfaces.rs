//! Surfaces: what each face of a shell shows, and the live numbers the faces carry.
use crate::core::surfaces::{Glance, Surfaces};
use dioxus::prelude::*;

// The answers are plain functions in `answers`; these are their Dioxus form (see `wire!`).
#[cfg(any(feature = "server", feature = "local"))]
mod answers;
#[cfg(feature = "local")]
pub use answers::*;

wire! {
    surfaces() -> Surfaces;
    glance() -> Glance;
}
