//! A SPACE — the shared memory an agent and its sub-agents both reach.
//!
//! `shared` is where that state actually lives and the three tools that write
//! to it; `pane` is the Space inspector, the same facts as a person sees them.

pub(crate) mod pane;
pub(crate) mod shared;
