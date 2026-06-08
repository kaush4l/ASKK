//! Domain state: the serializable types that make up the app's single source of
//! truth, split one concept per module so each is easy to find:
//!
//! - [`provider`] — provider connection + model/inference profiles
//! - [`mcp`] — persisted MCP (Model Context Protocol) server configuration
//! - [`tool_config`] — web-tool backend + search provider settings
//! - [`tool_types`] — the `ToolSpec` / `ToolCall` / `ToolResult` data + tool names
//! - [`event`] — the run timeline (`AgentEvent`) + `now_iso`
//! - [`workflow`] — declarative workflow definitions + runtime state
//! - [`run`] — a single `AgentRun` and everything inside it (scratchpad, budgets, …)
//! - [`manifest`] — agents/skills and their Markdown-manifest parsing
//! - [`snapshot`] — `AppSnapshot`, the top-level aggregate, and its normalization
//!
//! Every public item is re-exported here, so the rest of the crate keeps using the
//! flat `crate::state::X` paths regardless of which submodule owns `X`.

/// The crate-wide result type: a value or a human-readable error message.
pub type AppResult<T> = Result<T, String>;

mod event;
mod manifest;
mod mcp;
mod provider;
mod run;
mod snapshot;
mod tool_config;
mod tool_types;
mod workflow;

pub use event::*;
pub use manifest::*;
// Re-exported for sibling MCP units (UI + `src/mcp/`) that consume these types;
// the glob looks unused from this crate until those units land.
#[allow(unused_imports)]
pub use mcp::*;
pub use provider::*;
pub use run::*;
pub use snapshot::*;
pub use tool_config::*;
pub use tool_types::*;
pub use workflow::*;
