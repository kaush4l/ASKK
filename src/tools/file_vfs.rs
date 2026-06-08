//! `file_read` / `file_write` / `file_list` — the project's in-browser virtual
//! filesystem (OPFS/IndexedDB). These never touch disk and need no bridge; use them
//! for scratch files that live in the tab. For a runnable on-disk project, use the
//! `fs_*` family instead.

use crate::state::{AppSnapshot, ToolSpec};
use crate::storage::vfs::ProjectVfs;
use serde_json::{Value, json};

use super::common::string_arg;
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
        name: "file_read".to_string(),
        description: "Read the content of a file from the project's virtual filesystem."
            .to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" }
            },
            "required": ["path"]
        }),
    }
}

fn write_spec() -> ToolSpec {
    ToolSpec {
        name: "file_write".to_string(),
        description:
            "Write or overwrite the content of a file in the project's virtual filesystem."
                .to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" },
                "content": { "type": "string" }
            },
            "required": ["path", "content"]
        }),
    }
}

fn list_spec() -> ToolSpec {
    ToolSpec {
        name: "file_list".to_string(),
        description: "List all files in the project's virtual filesystem.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {}
        }),
    }
}

fn read_handler<'a>(_snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let path = string_arg(args, "path")?;
        ProjectVfs::new()
            .read_file(&path)
            .await
            .map(|content| content.unwrap_or_default())
            .map_err(|err| format!("VFS read error: {err}"))
    })
}

fn write_handler<'a>(_snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let path = string_arg(args, "path")?;
        let content = string_arg(args, "content")?;
        ProjectVfs::new()
            .write_file(&path, &content)
            .await
            .map(|_| "Success".to_string())
            .map_err(|err| format!("VFS write error: {err}"))
    })
}

fn list_handler<'a>(_snapshot: &'a mut AppSnapshot, _args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        ProjectVfs::new()
            .list_files()
            .await
            .map(|files| files.join(", "))
            .map_err(|err| format!("VFS list error: {err}"))
    })
}
