//! Tool surface (MAP hop 7): ONE registry (ADR-004), a rust-fn adapter, and
//! the builtins. `ToolSet` membership is the run's allowlist; unknown names
//! fail loud at build time. MCP / agent-as-tool / JS adapters arrive in
//! later waves behind the same `dyn Tool` seam.

pub mod artifact;
pub mod board;
pub mod builtin;
pub mod knowledge;
pub mod mcp;
pub mod memory_tools;
mod news;
pub mod registry;
pub mod search;
pub mod shell;
pub mod skills;
pub mod spawn;
pub mod workspace;

pub use artifact::register_artifacts;
pub use board::register_board;
pub use builtin::{register_builtins, register_echo};
pub use knowledge::register_knowledge;
pub use mcp::{parse_server_list, register_mcp};
pub use memory_tools::register_memory_tools;
pub use registry::{RegistryError, RustTool, ToolRegistry};
pub use search::register_web_search;
pub use shell::{register_shell, ShellExec};
pub use skills::register_skills;
pub use workspace::register_workspace;

#[cfg(test)]
pub(crate) use crate::testutil;
