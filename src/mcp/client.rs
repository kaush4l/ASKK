//! A minimal MCP client generic over the transport.
//!
//! The client owns request-id allocation and knows the handful of MCP methods the
//! prototype uses (`initialize`, `tools/list`, `tools/call`). It depends only on the
//! [`McpTransport`] trait and the [`protocol`](crate::mcp::protocol) types, so it is
//! host-compilable and unit-tested against a mock transport.

use crate::mcp::protocol::{
    CallToolResult, JsonRpcRequest, ListToolsResult, MCP_PROTOCOL_VERSION, McpToolDef,
};
use crate::mcp::transport::McpTransport;
use crate::state::AppResult;
use serde_json::{Value, json};
use std::cell::Cell;

/// An MCP client speaking JSON-RPC over a [`McpTransport`]. Generic over the
/// transport so the engine can swap in a worker, HTTP, or mock backend.
pub struct McpClient<T: McpTransport> {
    transport: T,
    next_id: Cell<u64>,
}

impl<T: McpTransport> McpClient<T> {
    /// Wrap a transport. Ids start at 1 and increase by one per request.
    pub fn new(transport: T) -> Self {
        Self {
            transport,
            next_id: Cell::new(1),
        }
    }

    /// Borrow the underlying transport. Used by tests to inspect what was sent.
    #[cfg(test)]
    pub fn transport(&self) -> &T {
        &self.transport
    }

    /// Allocate the next request id, advancing the counter.
    pub fn alloc_id(&self) -> u64 {
        let id = self.next_id.get();
        self.next_id.set(id + 1);
        id
    }

    /// Send a JSON-RPC request and return its `result`, mapping a JSON-RPC error
    /// into a human-readable `Err`.
    pub async fn request(&self, method: &str, params: Option<Value>) -> AppResult<Value> {
        let request = JsonRpcRequest::new(self.alloc_id(), method, params);
        let response = self.transport.send(request).await?;
        if let Some(error) = response.error {
            return Err(format!(
                "MCP {method} error {}: {}",
                error.code, error.message
            ));
        }
        Ok(response.result.unwrap_or(Value::Null))
    }

    /// Perform the MCP `initialize` handshake, then send the
    /// `notifications/initialized` notification.
    pub async fn initialize(&self) -> AppResult<()> {
        self.request(
            "initialize",
            Some(json!({
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": { "name": "askk", "version": "0.1.0" }
            })),
        )
        .await?;
        self.transport.notify(json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        }))?;
        Ok(())
    }

    /// List the tools the server advertises via `tools/list`.
    pub async fn list_tools(&self) -> AppResult<Vec<McpToolDef>> {
        let value = self.request("tools/list", None).await?;
        serde_json::from_value::<ListToolsResult>(value)
            .map(|result| result.tools)
            .map_err(|err| format!("Unable to parse tools/list result: {err}"))
    }

    /// Invoke a tool by name via `tools/call`.
    pub async fn call_tool(&self, name: &str, arguments: Value) -> AppResult<CallToolResult> {
        let value = self
            .request(
                "tools/call",
                Some(json!({ "name": name, "arguments": arguments })),
            )
            .await?;
        serde_json::from_value::<CallToolResult>(value)
            .map_err(|err| format!("Unable to parse tools/call result: {err}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::protocol::{JsonRpcError, JsonRpcResponse};
    use crate::mcp::transport::{McpTransport, ResponseFuture};
    use std::cell::Cell;

    /// A host-side mock that returns canned responses keyed by method, echoing the
    /// request id and recording the last id it saw.
    struct MockTransport {
        last_id: Cell<u64>,
        notified: Cell<bool>,
    }

    impl MockTransport {
        fn new() -> Self {
            Self {
                last_id: Cell::new(0),
                notified: Cell::new(false),
            }
        }

        fn canned_result(method: &str) -> Value {
            match method {
                "initialize" => json!({
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "serverInfo": { "name": "mock", "version": "0.0.0" }
                }),
                "tools/list" => json!({
                    "tools": [
                        { "name": "echo", "description": "Echo input", "inputSchema": { "type": "object" } },
                        { "name": "add", "description": "Add a and b", "inputSchema": { "type": "object" } }
                    ]
                }),
                "tools/call" => json!({
                    "content": [ { "type": "text", "text": "5" } ],
                    "isError": false
                }),
                other => panic!("MockTransport received unexpected method: {other}"),
            }
        }
    }

    impl McpTransport for MockTransport {
        fn send(&self, request: JsonRpcRequest) -> ResponseFuture<'_> {
            // The client must allocate increasing ids; record the latest.
            self.last_id.set(request.id);
            let result = MockTransport::canned_result(&request.method);
            let response = JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                // Echo the request id back — the transport correlates by it.
                id: request.id,
                result: Some(result),
                error: None,
            };
            Box::pin(async move { Ok(response) })
        }

        fn notify(&self, _notification: Value) -> AppResult<()> {
            self.notified.set(true);
            Ok(())
        }
    }

    /// A mock that always returns a JSON-RPC error, to exercise the error path.
    struct ErrorTransport;

    impl McpTransport for ErrorTransport {
        fn send(&self, request: JsonRpcRequest) -> ResponseFuture<'_> {
            let response = JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                id: request.id,
                result: None,
                error: Some(JsonRpcError {
                    code: -32601,
                    message: "Method not found".to_string(),
                    data: None,
                }),
            };
            Box::pin(async move { Ok(response) })
        }

        fn notify(&self, _notification: Value) -> AppResult<()> {
            Ok(())
        }
    }

    #[test]
    fn alloc_id_starts_at_one_and_increases() {
        let client = McpClient::new(MockTransport::new());
        assert_eq!(client.alloc_id(), 1);
        assert_eq!(client.alloc_id(), 2);
        assert_eq!(client.alloc_id(), 3);
    }

    #[test]
    fn happy_path_drives_initialize_list_and_call() {
        let client = McpClient::new(MockTransport::new());

        pollster::block_on(client.initialize()).expect("initialize");
        // initialize sends a request (id 1) and then a notification.
        assert_eq!(client.transport().last_id.get(), 1);
        assert!(
            client.transport().notified.get(),
            "expected initialized notification"
        );

        let tools = pollster::block_on(client.list_tools()).expect("list_tools");
        let names = tools.iter().map(|t| t.name.as_str()).collect::<Vec<_>>();
        assert_eq!(names, vec!["echo", "add"]);
        // list_tools used the next id (2).
        assert_eq!(client.transport().last_id.get(), 2);

        let result = pollster::block_on(client.call_tool("add", json!({ "a": 2, "b": 3 })))
            .expect("call_tool");
        assert_eq!(result.text(), "5");
        assert_eq!(result.is_error, Some(false));
        // call_tool used the next id (3) — ids strictly increase across calls.
        assert_eq!(client.transport().last_id.get(), 3);
    }

    #[test]
    fn request_maps_jsonrpc_error_into_err() {
        let client = McpClient::new(ErrorTransport);
        let outcome = pollster::block_on(client.request("tools/list", None));
        let message = outcome.expect_err("expected an error");
        assert!(
            message.contains("tools/list error -32601"),
            "unexpected message: {message}"
        );
        assert!(
            message.contains("Method not found"),
            "unexpected message: {message}"
        );
    }
}
