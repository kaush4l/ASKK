//! Tool surface (MAP hop 7): ONE registry (ADR-004), a rust-fn adapter, and
//! the builtins. `ToolSet` membership is the run's allowlist; unknown names
//! fail loud at build time. MCP / agent-as-tool / JS adapters arrive in
//! later waves behind the same `dyn Tool` seam.

pub mod builtin;
pub mod knowledge;
pub mod news;
pub mod registry;
pub mod search;
pub mod shell;
pub mod workspace;

pub use builtin::register_builtins;
pub use knowledge::register_knowledge;
pub use news::register_news;
pub use registry::{RegistryError, RustTool, ToolRegistry};
pub use search::register_web_search;
pub use shell::{register_shell, ShellExec};
pub use workspace::register_workspace;

#[cfg(test)]
pub(crate) use crate::testutil;
