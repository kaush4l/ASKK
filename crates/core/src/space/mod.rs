//! A SPACE — the shared memory an agent and its sub-agents both reach.
//!
//! `shared` is where that state actually lives and the three tools that write
//! to it; `sense` renders it for the prompt through the faculty port; `pane`
//! is the Space inspector, the same facts as a person sees them.

pub(crate) mod pane;
pub(crate) mod sense;
pub(crate) mod shared;
