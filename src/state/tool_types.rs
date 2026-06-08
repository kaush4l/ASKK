//! The data types that flow through a tool call: the advertised [`ToolSpec`], a
//! requested [`ToolCall`], and its [`ToolResult`]. Plus the canonical list of
//! built-in tool names used to seed agent allowlists.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ToolCall {
    pub id: String,
    pub agent_id: String,
    pub tool_name: String,
    pub arguments: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ToolResult {
    pub call_id: String,
    pub ok: bool,
    pub content: String,
}

/// The names of every built-in compiled tool, in display order. Used as the default
/// agent allowlist and to validate `tools:` manifest entries.
pub fn default_tool_names() -> Vec<String> {
    vec![
        "run_js".to_string(),
        "web_search".to_string(),
        "web_fetch".to_string(),
        "run_command".to_string(),
        "run_in_sandbox".to_string(),
        "fs_read".to_string(),
        "fs_write".to_string(),
        "fs_list".to_string(),
        "file_read".to_string(),
        "file_write".to_string(),
        "file_list".to_string(),
    ]
}
