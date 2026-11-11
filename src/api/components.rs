//! Created components: list them, make one.
use crate::core::node::Spec;
use dioxus::prelude::*;

// The answers are plain functions in `answers`; these are their Dioxus form (see `wire!`).
#[cfg(any(feature = "server", feature = "local"))]
mod answers;
#[cfg(feature = "local")]
pub use answers::*;

wire! {
    list_components() -> Vec<Spec>;
    create_component(args: String) -> String;
}
