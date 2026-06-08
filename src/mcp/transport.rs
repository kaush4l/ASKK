//! The [`McpTransport`] trait: a JSON-RPC request/response channel to an MCP server.
//!
//! Like the tool handlers in `tools/`, this uses boxed futures rather than the
//! `async_trait` crate, so the trait stays small and dependency-free while remaining
//! dyn-compatible.

use crate::mcp::protocol::JsonRpcRequest;
use crate::mcp::protocol::JsonRpcResponse;
use crate::state::AppResult;
use serde_json::Value;
use std::future::Future;
use std::pin::Pin;

/// A pinned, boxed future yielding the correlated JSON-RPC response (or an error).
pub type ResponseFuture<'a> = Pin<Box<dyn Future<Output = AppResult<JsonRpcResponse>> + 'a>>;

/// Transport seam: a JSON-RPC request/response channel to an MCP server.
///
/// `WorkerMcpTransport` (browser) implements it today; HTTP (remote) and stdio
/// (gateway-bridged) transports can be added later WITHOUT touching the engine.
pub trait McpTransport {
    /// Send a JSON-RPC *request* and await the correlated response.
    fn send(&self, request: JsonRpcRequest) -> ResponseFuture<'_>;
    /// Fire-and-forget a JSON-RPC *notification* (no id, no response expected).
    fn notify(&self, notification: Value) -> AppResult<()>;
}
