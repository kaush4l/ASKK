//! Minimal MCP (Model Context Protocol) client: JSON-RPC 2.0 over a pluggable transport.
//!
//! This module's one responsibility is speaking MCP to a server: it defines the
//! JSON-RPC + MCP wire types ([`protocol`]), a transport seam ([`transport`]), the
//! browser Web Worker transport ([`worker_transport`], wasm-only), and a tiny client
//! ([`client`]) that allocates request ids and parses the handful of MCP methods we
//! use. JSON-RPC is hand-rolled — no `rmcp`, no `async_trait`.
//!
//! The [`registry`] (wasm-only) consumes this surface to bring up servers and route
//! tool calls from the engine. On the host build there is no browser MCP path, so
//! these items read as dead code there — matching the `#![allow(dead_code)]`
//! convention used by other browser-only modules (`worker_runtime`, `execution`,
//! `responses::critic`).
#![allow(dead_code)]
#![allow(unused_imports)]

pub mod client;
pub mod protocol;
/// Live MCP connections + engine routing (browser only).
#[cfg(target_arch = "wasm32")]
pub mod registry;
pub mod transport;
#[cfg(target_arch = "wasm32")]
pub mod worker_transport;

// Convenience re-exports forming this module's public surface, consumed by the
// engine integration (the registry unit, added later).
pub use client::McpClient;
pub use protocol::{
    CallToolResult, ContentBlock, JsonRpcError, JsonRpcRequest, JsonRpcResponse, ListToolsResult,
    McpToolDef,
};
pub use transport::{McpTransport, ResponseFuture};
#[cfg(target_arch = "wasm32")]
pub use worker_transport::WorkerMcpTransport;

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
