//! `file_read` / `file_write` / `file_list` — the project's in-browser workspace
//! filesystem (OPFS, rooted at the `workspace` directory; see
//! [`crate::storage::opfs_vfs`]). These never touch disk and need no bridge; use
//! them for files that live in the tab. For a runnable on-disk project, use the
//! `fs_*` family instead.

use crate::state::{AppSnapshot, ToolSpec};
use crate::storage::opfs_vfs::{FsEntry, OpfsVfs};
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
        description: "Read a file from the project's in-browser workspace filesystem (OPFS). \
                      Paths are relative and '/'-separated, e.g. src/index.js. Returns an \
                      empty string when the file does not exist."
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
        description: "Write or overwrite a file in the project's in-browser workspace \
                      filesystem (OPFS). Paths are relative and '/'-separated; parent \
                      folders are created automatically."
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
        description: "List the project's in-browser workspace filesystem (OPFS), one entry \
                      per line, sorted by path. Folders end with '/'."
            .to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {}
        }),
    }
}

/// One line per entry, folders marked with a trailing `/`.
fn format_entries(entries: &[FsEntry]) -> String {
    if entries.is_empty() {
        return "(no files)".to_string();
    }
    entries
        .iter()
        .map(|entry| {
            if entry.is_dir {
                format!("{}/", entry.path)
            } else {
                entry.path.clone()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn read_handler<'a>(_snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let path = string_arg(args, "path")?;
        OpfsVfs::new()
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
        OpfsVfs::new()
            .write_file(&path, &content)
            .await
            .map(|_| "Success".to_string())
            .map_err(|err| format!("VFS write error: {err}"))
    })
}

fn list_handler<'a>(_snapshot: &'a mut AppSnapshot, _args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        OpfsVfs::new()
            .list_all()
            .await
            .map(|entries| format_entries(&entries))
            .map_err(|err| format!("VFS list error: {err}"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn specs_keep_their_registered_names_and_required_args() {
        assert_eq!(read_spec().name, "file_read");
        assert_eq!(write_spec().name, "file_write");
        assert_eq!(list_spec().name, "file_list");
        assert_eq!(read_spec().input_schema["required"], json!(["path"]));
        assert_eq!(
            write_spec().input_schema["required"],
            json!(["path", "content"])
        );
    }

    #[test]
    fn list_output_marks_directories_and_handles_empty() {
        assert_eq!(format_entries(&[]), "(no files)");
        let entries = vec![
            FsEntry {
                path: "src".to_string(),
                is_dir: true,
            },
            FsEntry {
                path: "src/add.js".to_string(),
                is_dir: false,
            },
        ];
        assert_eq!(format_entries(&entries), "src/\nsrc/add.js");
    }
}
