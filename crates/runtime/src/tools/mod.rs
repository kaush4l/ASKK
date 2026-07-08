//! Tool surface (MAP hop 7): ONE registry (ADR-004), a rust-fn adapter, and
//! the builtins. `ToolSet` membership is the run's allowlist; unknown names
//! fail loud at build time. MCP / agent-as-tool / JS adapters arrive in
//! later waves behind the same `dyn Tool` seam.

pub mod builtin;
pub mod registry;

pub use builtin::register_builtins;
pub use registry::{RegistryError, RustTool, ToolRegistry};

#[cfg(test)]
pub(crate) use crate::testutil;
