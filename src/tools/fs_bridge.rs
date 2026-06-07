//! `fs_read` / `fs_write` / `fs_list` — the real on-disk workspace under the bridge
//! run root, the same files `run_command` and bun see. Use these (not the `file_*`
//! VFS tools) when working on a runnable project.

use crate::state::{AppSnapshot, ToolSpec};
use serde_json::{Value, json};

use super::bridge::{bridge_endpoint, bridge_tool_request};
use super::common::{merge_optional_string, string_arg};
use super::{ToolDescriptor, ToolFuture};

pub(crate) fn read_descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: read_spec(),
        handler: read_handler,
    }
}

pub(crate) fn write_descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: write_spec(),
        handler: write_handler,
    }
}

pub(crate) fn list_descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: list_spec(),
        handler: list_handler,
    }
}

fn read_spec() -> ToolSpec {
    ToolSpec {
        name: "fs_read".to_string(),
        description: "Read a file from the project run root — the real on-disk workspace that run_command and bun also see. Use this (not file_read) when working on a runnable project.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Path relative to the run root, e.g. 'src/index.ts'." }
            },
            "required": ["path"]
        }),
    }
}

fn write_spec() -> ToolSpec {
    ToolSpec {
        name: "fs_write".to_string(),
        description: "Create or overwrite a file in the project run root so run_command and bun can see it on disk. Parent directories are created automatically. Use this to scaffold and edit a runnable project.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Path relative to the run root, e.g. 'package.json'." },
                "content": { "type": "string", "description": "Full file contents to write." }
            },
            "required": ["path", "content"]
        }),
    }
}

fn list_spec() -> ToolSpec {
    ToolSpec {
        name: "fs_list".to_string(),
        description: "List files and directories in the project run root (the on-disk workspace). Optionally scope to a subdirectory.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Optional subdirectory of the run root to list." }
            }
        }),
    }
}

fn read_handler<'a>(snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let path = string_arg(args, "path")?;
        let endpoint = bridge_endpoint(&snapshot.tool_config.web_search, "fs_read")?;
        bridge_tool_request("fs_read", &endpoint, json!({ "path": path })).await
    })
}

fn write_handler<'a>(snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let path = string_arg(args, "path")?;
        let content = args
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let endpoint = bridge_endpoint(&snapshot.tool_config.web_search, "fs_write")?;
        bridge_tool_request(
            "fs_write",
            &endpoint,
            json!({ "path": path, "content": content }),
        )
        .await
    })
}

fn list_handler<'a>(snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let mut body = json!({});
        merge_optional_string(args, &mut body, "path", None);
        let endpoint = bridge_endpoint(&snapshot.tool_config.web_search, "fs_list")?;
        bridge_tool_request("fs_list", &endpoint, body).await
    })
}
