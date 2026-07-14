//! Tool surface (MAP hop 7): ONE registry (ADR-004), a rust-fn adapter, and
//! the builtins. `ToolSet` membership is the run's allowlist; unknown names
//! fail loud at build time. MCP / agent-as-tool / JS adapters arrive in
//! later waves behind the same `dyn Tool` seam.

pub mod artifacts;
pub mod board;
pub mod builtin;
pub mod knowledge;
pub mod mcp;
pub mod memory;
pub use memory as memory_tools; // old path `tools::memory_tools::*` stays valid
pub mod registry;
pub mod search;
pub mod skills;
pub mod vm;

// Shims: keep pre-move `tools::shell::*` / `tools::workspace::*` paths resolving.
pub use vm::{shell, workspace};

// Path shim: spawn moved to the engine side (run/delegation/spawn.rs); the
// old `tools::spawn` path stays valid.
pub use crate::run::delegation::spawn;

pub use artifacts as artifact; // ponytail: path shim, retire once callers say `artifacts`
pub use artifacts::register_artifacts;
pub use board::register_board;
pub use builtin::{register_builtins, register_echo};
pub use knowledge::register_knowledge;
pub use mcp::{parse_server_list, register_mcp};
pub use memory::register_memory_tools;
pub use registry::{RegistryError, RustTool, ToolRegistry};
pub use search::register_web_search;
pub use shell::{register_shell, ShellExec};
pub use skills::register_skills;
pub use workspace::register_workspace;

#[cfg(test)]
pub(crate) use crate::testutil;
