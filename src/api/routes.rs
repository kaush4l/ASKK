//! Routes: which page a URL is, and the sidebar links.
use crate::core::routes::{NavLink, Resolved};
use dioxus::prelude::*;

// The answers are plain functions in `answers`; these are their Dioxus form (see `wire!`).
#[cfg(any(feature = "server", feature = "local"))]
mod answers;
#[cfg(feature = "local")]
pub use answers::*;

wire! {
    resolve_route(path: Vec<String>) -> Option<Resolved>;
    nav_links() -> Vec<NavLink>;
}
