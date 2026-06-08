//! JSON-RPC 2.0 + MCP serde types and helpers.
//!
//! Pure data: no platform dependencies, host-compilable, and unit-tested with
//! `cargo test`. These types are the frozen wire contract shared with the JS MCP
//! server, the engine integration, and the headless test.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A JSON-RPC 2.0 request. The client owns `id` allocation; the transport
/// correlates the response by this id.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: u64,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

impl JsonRpcRequest {
    /// Build a request with `jsonrpc` fixed to `"2.0"`.
    pub fn new(id: u64, method: impl Into<String>, params: Option<Value>) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            method: method.into(),
            params,
        }
    }
}

/// A JSON-RPC 2.0 response: exactly one of `result` / `error` is populated.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: u64,
    #[serde(default)]
    pub result: Option<Value>,
    #[serde(default)]
    pub error: Option<JsonRpcError>,
}

/// A JSON-RPC 2.0 error object.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
    #[serde(default)]
    pub data: Option<Value>,
}

/// An MCP tool definition as advertised by `tools/list`. Note `inputSchema` is
/// camelCase on the wire.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct McpToolDef {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(rename = "inputSchema")]
    pub input_schema: Value,
}

/// The result of a `tools/list` call.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ListToolsResult {
    #[serde(default)]
    pub tools: Vec<McpToolDef>,
}

/// A single MCP content block. We only need the text variant for the prototype.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ContentBlock {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub text: String,
}

/// The result of a `tools/call` call.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct CallToolResult {
    #[serde(default)]
    pub content: Vec<ContentBlock>,
    #[serde(default, rename = "isError")]
    pub is_error: Option<bool>,
}

impl CallToolResult {
    /// Concatenate all text content blocks into a single string (the engine's
    /// `ToolResult.content`).
    pub fn text(&self) -> String {
        self.content
            .iter()
            .filter(|b| b.kind == "text")
            .map(|b| b.text.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn request_serializes_with_jsonrpc_version_and_round_trips() {
        let req = JsonRpcRequest::new(7, "tools/list", None);
        let text = serde_json::to_string(&req).expect("serialize request");
        let parsed: Value = serde_json::from_str(&text).expect("parse json");
        assert_eq!(parsed["jsonrpc"], "2.0");
        assert_eq!(parsed["id"], 7);
        assert_eq!(parsed["method"], "tools/list");
        // params is None, so the field must be omitted entirely.
        assert!(parsed.get("params").is_none());

        let round: JsonRpcRequest = serde_json::from_str(&text).expect("round-trip request");
        assert_eq!(round, req);
    }

    #[test]
    fn request_with_params_round_trips() {
        let req = JsonRpcRequest::new(2, "tools/call", Some(json!({ "name": "add" })));
        let text = serde_json::to_string(&req).expect("serialize");
        let round: JsonRpcRequest = serde_json::from_str(&text).expect("round-trip");
        assert_eq!(round, req);
        assert_eq!(round.params, Some(json!({ "name": "add" })));
    }

    #[test]
    fn success_response_round_trips() {
        let resp = JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id: 3,
            result: Some(json!({ "tools": [] })),
            error: None,
        };
        let text = serde_json::to_string(&resp).expect("serialize");
        let round: JsonRpcResponse = serde_json::from_str(&text).expect("round-trip");
        assert_eq!(round, resp);
        assert!(round.error.is_none());
        assert!(round.result.is_some());
    }

    #[test]
    fn error_response_round_trips() {
        let resp = JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id: 4,
            result: None,
            error: Some(JsonRpcError {
                code: -32601,
                message: "Method not found".to_string(),
                data: None,
            }),
        };
        let text = serde_json::to_string(&resp).expect("serialize");
        let round: JsonRpcResponse = serde_json::from_str(&text).expect("round-trip");
        assert_eq!(round, resp);
        let err = round.error.expect("error present");
        assert_eq!(err.code, -32601);
        assert_eq!(err.message, "Method not found");
    }

    #[test]
    fn response_without_error_field_deserializes() {
        // The server may omit `error` entirely on success; `#[serde(default)]`
        // must fill in `None`.
        let text = r#"{ "jsonrpc": "2.0", "id": 9, "result": 42 }"#;
        let resp: JsonRpcResponse = serde_json::from_str(text).expect("parse");
        assert_eq!(resp.id, 9);
        assert_eq!(resp.result, Some(json!(42)));
        assert!(resp.error.is_none());
    }

    #[test]
    fn tool_def_deserializes_from_camelcase_input_schema() {
        let text = r#"{
            "name": "add",
            "description": "Add two numbers",
            "inputSchema": { "type": "object", "properties": { "a": { "type": "number" } } }
        }"#;
        let def: McpToolDef = serde_json::from_str(text).expect("parse tool def");
        assert_eq!(def.name, "add");
        assert_eq!(def.description, "Add two numbers");
        assert_eq!(def.input_schema["type"], "object");
    }

    #[test]
    fn tool_def_defaults_missing_description() {
        let text = r#"{ "name": "echo", "inputSchema": {} }"#;
        let def: McpToolDef = serde_json::from_str(text).expect("parse");
        assert_eq!(def.name, "echo");
        assert_eq!(def.description, "");
    }

    #[test]
    fn call_tool_result_text_concatenates_text_blocks() {
        let result = CallToolResult {
            content: vec![
                ContentBlock {
                    kind: "text".to_string(),
                    text: "hello".to_string(),
                },
                ContentBlock {
                    kind: "image".to_string(),
                    text: "ignored".to_string(),
                },
                ContentBlock {
                    kind: "text".to_string(),
                    text: "world".to_string(),
                },
            ],
            is_error: None,
        };
        assert_eq!(result.text(), "hello\nworld");
    }

    #[test]
    fn call_tool_result_deserializes_is_error_camelcase() {
        let text = r#"{
            "content": [ { "type": "text", "text": "boom" } ],
            "isError": true
        }"#;
        let result: CallToolResult = serde_json::from_str(text).expect("parse");
        assert_eq!(result.is_error, Some(true));
        assert_eq!(result.text(), "boom");
    }
}
