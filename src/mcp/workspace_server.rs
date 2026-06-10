//! The built-in **workspace** MCP server: an in-process [`McpTransport`] that
//! exposes the Workspace page's actions — list/read/create/edit files and run
//! code — as MCP tools.
//!
//! There is no worker and no JS here: `initialize`, `tools/list`, and
//! `tools/call` are serviced directly in Rust, and every tool call DELEGATES to
//! the corresponding compiled tool handler in [`ToolRegistry`] (`file_list`,
//! `file_read`, `file_write`, `file_edit`, `run_js`, `run_command`). The MCP
//! tools and the Workspace UI therefore share one implementation: same
//! IndexedDB virtual filesystem, same sandboxed exec worker, same bridge.
//!
//! Tool descriptions spell out their arguments in prose because the prompt
//! renderer shows the model only `name` + `description`, never `input_schema`
//! (see `agent_prompt::describe_tools`).

use crate::mcp::protocol::{
    JsonRpcError, JsonRpcRequest, JsonRpcResponse, MCP_PROTOCOL_VERSION, McpToolDef,
};
use crate::mcp::transport::{McpTransport, ResponseFuture};
use crate::state::{AppResult, AppSnapshot, WebSearchToolConfig};
use crate::tools::ToolRegistry;
use serde_json::{Value, json};

/// One workspace tool: its MCP definition plus the compiled tool it delegates to.
/// Arguments pass through verbatim — the MCP argument shapes are chosen to match
/// the compiled tools' shapes exactly.
struct WorkspaceTool {
    def: McpToolDef,
    compiled_name: &'static str,
}

/// The workspace tool table. Names are `workspace_`-prefixed so they never
/// collide with the compiled built-ins (which would force the registry to
/// mangle them into less readable display names).
fn workspace_tools() -> Vec<WorkspaceTool> {
    vec![
        WorkspaceTool {
            def: McpToolDef {
                name: "workspace_list_files".to_string(),
                description: "List every file in the shared browser workspace (the same \
                    files shown on the Workspace page). Takes no arguments."
                    .to_string(),
                input_schema: json!({ "type": "object", "properties": {} }),
            },
            compiled_name: "file_list",
        },
        WorkspaceTool {
            def: McpToolDef {
                name: "workspace_read_file".to_string(),
                description: "Look at a file's contents in the shared browser workspace. \
                    Arguments: {\"path\": string}."
                    .to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": { "path": { "type": "string" } },
                    "required": ["path"]
                }),
            },
            compiled_name: "file_read",
        },
        WorkspaceTool {
            def: McpToolDef {
                name: "workspace_create_file".to_string(),
                description: "Create a new file (or overwrite an existing one) in the \
                    shared browser workspace. Arguments: {\"path\": string, \"content\": \
                    string}."
                    .to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" },
                        "content": { "type": "string" }
                    },
                    "required": ["path", "content"]
                }),
            },
            compiled_name: "file_write",
        },
        WorkspaceTool {
            def: McpToolDef {
                name: "workspace_edit_file".to_string(),
                description: "Edit a file in the shared browser workspace by exact string \
                    replacement. Arguments: {\"path\": string, \"old_string\": string (must \
                    match the file content exactly, including whitespace), \"new_string\": \
                    string, \"replace_all\": optional boolean}. Without replace_all the \
                    old_string must match exactly once. Fails if the file does not exist."
                    .to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" },
                        "old_string": { "type": "string" },
                        "new_string": { "type": "string" },
                        "replace_all": { "type": "boolean" }
                    },
                    "required": ["path", "old_string", "new_string"]
                }),
            },
            compiled_name: "file_edit",
        },
        WorkspaceTool {
            def: McpToolDef {
                name: "workspace_run_js".to_string(),
                description: "Run JavaScript in the workspace's sandboxed Web Worker (the \
                    same runner as the Workspace terminal in Browser mode). Arguments: \
                    {\"code\": string, \"timeout_ms\": optional integer}. Returns ok, \
                    result, stdout, and stderr."
                    .to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "code": { "type": "string" },
                        "timeout_ms": { "type": "integer" }
                    },
                    "required": ["code"]
                }),
            },
            compiled_name: "run_js",
        },
        WorkspaceTool {
            def: McpToolDef {
                name: "workspace_run_command".to_string(),
                description: "Run a shell command in the workspace run root via the local \
                    bridge (the same runner as the Workspace terminal in Bridge mode; \
                    requires `askk-local-bridge --allow-exec`). Arguments: {\"command\": \
                    string, \"cwd\": optional string, \"timeout_ms\": optional integer}. \
                    Returns exit_code, ok, stdout, and stderr."
                    .to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "command": { "type": "string" },
                        "cwd": { "type": "string" },
                        "timeout_ms": { "type": "integer" }
                    },
                    "required": ["command"]
                }),
            },
            compiled_name: "run_command",
        },
    ]
}

/// The MCP definitions of every workspace tool (what `tools/list` advertises).
pub fn workspace_tool_defs() -> Vec<McpToolDef> {
    workspace_tools().into_iter().map(|tool| tool.def).collect()
}

/// The compiled tool a workspace MCP tool name delegates to, or `None` when
/// `name` is not one of this server's tools. The engine uses this to scope the
/// workspace tools per agent: a workspace tool is only offered when the
/// agent's allowlist already grants its compiled delegate, so the built-in
/// server can never silently widen a deliberately restricted agent.
pub fn compiled_delegate(name: &str) -> Option<&'static str> {
    workspace_tools()
        .into_iter()
        .find(|tool| tool.def.name == name)
        .map(|tool| tool.compiled_name)
}

/// In-process MCP server for the workspace. Holds the compiled [`ToolRegistry`]
/// it delegates to plus the ONE tool setting any delegated handler reads: the
/// bridge tools URL (`run_command`). Captured narrowly so this long-lived
/// transport never holds API keys it doesn't need (invariant 6). If a future
/// workspace tool needs more config, capture that field explicitly here —
/// delegated handlers must never depend on other snapshot state, because each
/// call runs against a fresh default snapshot.
pub struct WorkspaceMcpServer {
    tools: ToolRegistry,
    bridge_tools_url: String,
}

impl WorkspaceMcpServer {
    /// Build the server, capturing the bridge URL as of connect time. The
    /// registry reconnects this server on every bring-up, so later settings
    /// edits take effect on the next run.
    pub fn new(web_search: WebSearchToolConfig) -> Self {
        Self {
            tools: ToolRegistry::new(),
            bridge_tools_url: web_search.bridge_tools_url,
        }
    }

    fn ok_response(id: u64, result: Value) -> JsonRpcResponse {
        JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id,
            result: Some(result),
            error: None,
        }
    }

    fn error_response(id: u64, code: i64, message: impl Into<String>) -> JsonRpcResponse {
        JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id,
            result: None,
            error: Some(JsonRpcError {
                code,
                message: message.into(),
                data: None,
            }),
        }
    }

    /// Build a `tools/call` result. Tool failures are reported as
    /// `isError: true` results (per MCP), NOT as JSON-RPC errors — a JSON-RPC
    /// error reads as a transport fault and would get this server evicted.
    fn call_result(text: String, is_error: bool) -> Value {
        json!({
            "content": [ { "type": "text", "text": text } ],
            "isError": is_error,
        })
    }

    async fn handle_tools_call(&self, id: u64, params: Option<Value>) -> JsonRpcResponse {
        let params = params.unwrap_or(Value::Null);
        let name = params
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let arguments = params
            .get("arguments")
            .cloned()
            .unwrap_or_else(|| json!({}));

        let Some(tool) = workspace_tools()
            .into_iter()
            .find(|tool| tool.def.name == name)
        else {
            return Self::ok_response(
                id,
                Self::call_result(
                    format!("The workspace server has no tool named `{name}`."),
                    true,
                ),
            );
        };

        // Compiled handlers read config (the bridge URL for run_command) from
        // the snapshot; give them a fresh one carrying the captured URL.
        let mut snapshot = AppSnapshot::default();
        snapshot.tool_config.web_search.bridge_tools_url = self.bridge_tools_url.clone();
        let result = self
            .tools
            .execute(
                &mut snapshot,
                format!("workspace-mcp-{id}"),
                tool.compiled_name,
                arguments,
            )
            .await;
        Self::ok_response(id, Self::call_result(result.content, !result.ok))
    }
}

impl McpTransport for WorkspaceMcpServer {
    fn send(&self, request: JsonRpcRequest) -> ResponseFuture<'_> {
        Box::pin(async move {
            let id = request.id;
            let response = match request.method.as_str() {
                "initialize" => Self::ok_response(
                    id,
                    json!({
                        "protocolVersion": MCP_PROTOCOL_VERSION,
                        "capabilities": { "tools": {} },
                        "serverInfo": {
                            "name": "askk-workspace",
                            "version": env!("CARGO_PKG_VERSION"),
                        },
                    }),
                ),
                "tools/list" => Self::ok_response(id, json!({ "tools": workspace_tool_defs() })),
                "tools/call" => self.handle_tools_call(id, request.params).await,
                other => Self::error_response(id, -32601, format!("Method not found: {other}")),
            };
            Ok(response)
        })
    }

    fn notify(&self, _notification: Value) -> AppResult<()> {
        // `notifications/initialized` (and anything else) needs no action in-process.
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::client::McpClient;

    fn server() -> WorkspaceMcpServer {
        WorkspaceMcpServer::new(WebSearchToolConfig::default())
    }

    #[test]
    fn every_workspace_tool_delegates_to_a_registered_compiled_tool() {
        let registry = ToolRegistry::new();
        for tool in workspace_tools() {
            let specs = registry.specs_for_agent(&[tool.compiled_name.to_string()]);
            assert_eq!(
                specs.len(),
                1,
                "workspace tool `{}` delegates to unknown compiled tool `{}`",
                tool.def.name,
                tool.compiled_name
            );
        }
    }

    #[test]
    fn tool_names_are_workspace_prefixed_and_described() {
        let defs = workspace_tool_defs();
        assert_eq!(defs.len(), 6);
        for def in &defs {
            assert!(
                def.name.starts_with("workspace_"),
                "unprefixed tool: {}",
                def.name
            );
            assert!(
                !def.description.trim().is_empty(),
                "tool {} has no description (the model sees only descriptions)",
                def.name
            );
        }
        let names: Vec<&str> = defs.iter().map(|def| def.name.as_str()).collect();
        for expected in [
            "workspace_list_files",
            "workspace_read_file",
            "workspace_create_file",
            "workspace_edit_file",
            "workspace_run_js",
            "workspace_run_command",
        ] {
            assert!(names.contains(&expected), "missing tool: {expected}");
        }
    }

    #[test]
    fn client_initializes_and_lists_tools_through_the_in_process_transport() {
        let client = McpClient::new(server());
        pollster::block_on(client.initialize()).expect("initialize");
        let tools = pollster::block_on(client.list_tools()).expect("list");
        assert_eq!(tools.len(), 6);
        assert!(tools.iter().any(|def| def.name == "workspace_edit_file"));
    }

    #[test]
    fn compiled_delegate_maps_workspace_tools_and_ignores_foreign_names() {
        assert_eq!(
            compiled_delegate("workspace_run_command"),
            Some("run_command")
        );
        assert_eq!(compiled_delegate("workspace_edit_file"), Some("file_edit"));
        assert_eq!(compiled_delegate("file_edit"), None);
        assert_eq!(compiled_delegate("some_other_mcp_tool"), None);
    }

    #[test]
    fn unknown_method_returns_jsonrpc_error() {
        let client = McpClient::new(server());
        let err = pollster::block_on(client.request("resources/list", None)).expect_err("unknown");
        assert!(err.contains("-32601"), "unexpected error: {err}");
    }

    #[test]
    fn unknown_tool_returns_is_error_result_not_transport_fault() {
        let client = McpClient::new(server());
        let result = pollster::block_on(client.call_tool("workspace_no_such_tool", json!({})))
            .expect("a tool-level error, not a transport error");
        assert_eq!(result.is_error, Some(true));
        assert!(result.text().contains("workspace_no_such_tool"));
    }

    #[test]
    fn tool_failures_surface_as_is_error_through_the_full_delegation_path() {
        // Exercises the real delegation chain (MCP call -> ToolRegistry ->
        // compiled handler) on the host: file_edit rejects missing arguments
        // before any I/O, and that failure must surface as an isError result
        // (never a JSON-RPC error, which would read as a transport fault).
        let client = McpClient::new(server());
        let result = pollster::block_on(client.call_tool("workspace_edit_file", json!({})))
            .expect("tool-level error expected");
        assert_eq!(result.is_error, Some(true));
        assert!(
            result.text().contains("path"),
            "error should name the missing argument: {}",
            result.text()
        );
    }
}
