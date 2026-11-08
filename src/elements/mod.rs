//! # Elements
//! Every element is a [`crate::core::Component`]: one file, its own docs (`DOC`), config, state,
//! lifecycle (`on`), prompt section and UI view. They are registered in `core::KINDS`.
pub mod alert;
pub mod artifact;
pub mod history;
pub mod notes;
pub mod phase;
pub mod response;
pub mod script;
pub mod state;
pub mod tools;

use crate::compose::Node;

/// The standard element view: a tile titled `name`, tagged `kind`, with text lines.
pub fn tile(name: &str, kind: &str, lines: impl IntoIterator<Item = String>) -> Node {
    Node::new("tile").label(name).text(kind).children(lines.into_iter().map(|l| Node::new("muted").text(&l)).collect())
}
