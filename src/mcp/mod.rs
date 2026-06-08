//! Minimal MCP (Model Context Protocol) client: JSON-RPC 2.0 over a pluggable transport.
//!
//! This module's one responsibility is speaking MCP to a server: it defines the
//! JSON-RPC + MCP wire types ([`protocol`]), a transport seam ([`transport`]), the
//! browser Web Worker transport ([`worker_transport`], wasm-only), and a tiny client
//! ([`client`]) that allocates request ids and parses the handful of MCP methods we
//! use. JSON-RPC is hand-rolled — no `rmcp`, no `async_trait`.
//!
//! The [`registry`] (wasm-only) consumes this surface to bring up servers and route
//! tool calls from the engine. On the host build there is no browser MCP path, so some
//! of these items read as dead code there.
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

pub mod client;
pub mod protocol;
/// Live MCP connections + engine routing (browser only).
#[cfg(target_arch = "wasm32")]
pub mod registry;
pub mod transport;
#[cfg(target_arch = "wasm32")]
pub mod worker_transport;

// Submodules are used via their full paths (e.g. `crate::mcp::client::McpClient`);
// there are no top-level re-exports to keep in sync.

use crate::state::{AppResult, McpServerConfig};

/// Probe an MCP server from the current thread (used by the dashboard on the main
/// thread): connect, run the initialize handshake, list its tools, then tear the
/// worker down. Returns the discovered tool names. Browser-only — on the host it
/// reports that discovery needs the browser.
pub async fn probe_tools(config: &McpServerConfig) -> AppResult<Vec<String>> {
    #[cfg(target_arch = "wasm32")]
    {
        registry::discover_tools(config).await
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = config;
        Err("MCP discovery is only available in the browser.".to_string())
    }
}
