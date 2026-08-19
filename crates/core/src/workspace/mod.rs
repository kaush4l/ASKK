//! THE WORKSPACE, RUN. `agent::workspace` declares the tools and the path rule;
//! this is where a command actually runs.
//!
//! `gate` is the capability check and the single place `WorkspacePort::exec` is
//! called; `gesture` turns one press or keystroke by a PERSON into the agent's
//! own tool, through that same gate.

pub(crate) mod gate;
pub(crate) mod gesture;
