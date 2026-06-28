//! Bridge-relayed stdio MCP transport (wasm only).
//!
//! A browser tab cannot spawn an OS process, so a process-backed MCP server (e.g. a
//! Node stdio server like `chrome-devtools-mcp`) is spawned by the local ASKK bridge
//! and driven over HTTP. This transport POSTs JSON-RPC to the bridge's MCP relay
//! routes (`/askk/mcp/spawn|send|kill`), which forward newline-delimited JSON-RPC to
//! the child's stdio and correlate responses by id bridge-side. From the engine's
//! point of view it is just another [`McpTransport`], indistinguishable from the
//! in-browser worker transport.
//!
//! Lifecycle: [`BridgeMcpTransport::connect`] spawns the child (the `server_id` is the
//! relay's correlation key); [`Drop`] best-effort kills it so the process is reaped
//! when the connection is torn down (a config edit or a disabled server).

#![cfg(target_arch = "wasm32")]

use crate::mcp::protocol::JsonRpcRequest;
use crate::mcp::protocol::JsonRpcResponse;
use crate::mcp::transport::{McpTransport, ResponseFuture};
use crate::state::{AppResult, ProcessServerSpec, WebSearchToolConfig};
use crate::tools::bridge::{bridge_json_request, bridge_mcp_endpoint};
use serde_json::{Value, json};
use wasm_bindgen_futures::spawn_local;

/// A [`McpTransport`] backed by a process spawned and relayed by the local ASKK
/// bridge. Owns the pre-resolved relay endpoints and the `server_id` used as the
/// bridge's correlation key for this child.
pub struct BridgeMcpTransport {
    /// The `/askk/mcp/send` endpoint — every request and notification POSTs here.
    send_endpoint: String,
    /// The `/askk/mcp/kill` endpoint — POSTed once on drop to reap the child.
    kill_endpoint: String,
    /// The relay correlation id for this server's child process. Echoed in the body of
    /// every send/kill so the bridge routes to the right child.
    server_id: String,
}

impl BridgeMcpTransport {
    /// Spawn the process-backed MCP server via the bridge and return a connected
    /// transport. `server_id` is the relay's correlation key (the [`McpServerConfig`]
    /// id); `spec` is the parsed [`ProcessServerSpec`] (`command`/`args`/`env`/`cwd`).
    ///
    /// POSTs `/askk/mcp/spawn` with `{ id, command, args, env, cwd }`. `env` is the
    /// array-of-pairs shape the bridge reads (`Vec<(String, String)>` already
    /// serializes to `[[k, v], ...]`). A non-2xx status or a `success: false` envelope
    /// surfaces as `Err` with the bridge's error text (handled by [`bridge_json_request`]).
    ///
    /// [`McpServerConfig`]: crate::state::McpServerConfig
    pub async fn connect(
        web_search: &WebSearchToolConfig,
        server_id: String,
        spec: ProcessServerSpec,
    ) -> AppResult<Self> {
        let spawn_endpoint = bridge_mcp_endpoint(web_search, "spawn")?;
        let send_endpoint = bridge_mcp_endpoint(web_search, "send")?;
        let kill_endpoint = bridge_mcp_endpoint(web_search, "kill")?;

        let body = json!({
            "id": server_id,
            "command": spec.command,
            "args": spec.args,
            "env": spec.env,
            "cwd": spec.cwd,
        });
        // The bridge returns `{ success: true, data: { id } }` on success; a non-2xx
        // status or `success: false` is mapped to Err by bridge_json_request.
        bridge_json_request(&spawn_endpoint, body).await?;

        Ok(Self {
            send_endpoint,
            kill_endpoint,
            server_id,
        })
    }
}

/// POST a JSON-RPC `message` for `server_id` to the relay `send` endpoint and return
/// the parsed `{ success, data }` envelope. Shared by `send` (a request) and
/// `notify` (a notification): the bridge keys on the message's own id, so the same
/// route serves both.
async fn relay_send(endpoint: String, server_id: String, message: Value) -> AppResult<Value> {
    bridge_json_request(&endpoint, json!({ "id": server_id, "message": message })).await
}

impl McpTransport for BridgeMcpTransport {
    fn send(&self, request: JsonRpcRequest) -> ResponseFuture<'_> {
        let endpoint = self.send_endpoint.clone();
        let server_id = self.server_id.clone();
        Box::pin(async move {
            let message = serde_json::to_value(&request)
                .map_err(|err| format!("Unable to encode MCP request: {err}"))?;
            let envelope = relay_send(endpoint, server_id, message).await?;
            // The bridge wraps the child's JSON-RPC response object in `data`.
            let data = envelope.get("data").cloned().ok_or_else(|| {
                "Bridge MCP send response had no `data` (expected a JSON-RPC response).".to_string()
            })?;
            serde_json::from_value::<JsonRpcResponse>(data)
                .map_err(|err| format!("Bridge returned a malformed JSON-RPC response: {err}"))
        })
    }

    fn notify(&self, notification: Value) -> AppResult<()> {
        // Notifications are fire-and-forget and this trait method is synchronous, so
        // spawn the POST and return immediately. A relay error has nowhere to surface
        // (no id to await), mirroring the worker transport's best-effort notify.
        let endpoint = self.send_endpoint.clone();
        let server_id = self.server_id.clone();
        spawn_local(async move {
            if let Err(err) = relay_send(endpoint, server_id, notification).await {
                web_sys::console::warn_1(&wasm_bindgen::JsValue::from_str(&format!(
                    "Bridge MCP notification failed: {err}"
                )));
            }
        });
        Ok(())
    }
}

impl Drop for BridgeMcpTransport {
    fn drop(&mut self) {
        // Best-effort: tell the bridge to kill and reap the child so a config edit or
        // a disabled server doesn't leak a process. Fire-and-forget (Drop is sync).
        let endpoint = self.kill_endpoint.clone();
        let server_id = self.server_id.clone();
        spawn_local(async move {
            let _ = bridge_json_request(&endpoint, json!({ "id": server_id })).await;
        });
    }
}
