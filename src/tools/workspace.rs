//! `workspace_open` / `workspace_close` — the agent's controls over its shared
//! workspace view (the open-set on `scratchpad.workspace`; see
//! [`crate::state::WorkspaceView`]).
//!
//! Opening a file is the agent saying "I'm working on this": it joins the open-set
//! and becomes the focused file. That single shared state (Option A) drives BOTH the
//! prompt's `## WORKSPACE` block — where the file's *fresh* content is rendered each
//! turn — AND the user's workspace IDE, where the file surfaces as a tab. Closing
//! removes it.
//!
//! **Ack, not bulk.** These tools return a SHORT acknowledgement ("opened
//! src/foo.rs (42 lines)") — never the file's content. The content reaches the model
//! through the `## WORKSPACE` block (projection-by-reference, pulled fresh at render),
//! so dumping it into the tool result too would double it in history and let it go
//! stale. To actually read a file's bytes the agent uses `file_read`.
//!
//! The handler mutates `scratchpad.workspace` on its snapshot clone; the engine's
//! dispatch path lifts the changed view back onto the live run and emits a
//! `WorkspaceChanged` delta (the same lift the artifact path uses).

use crate::state::{AppSnapshot, ToolSpec};
use serde_json::{Value, json};

use super::common::string_arg;
use super::{ToolDescriptor, ToolFuture};

pub(crate) fn open_descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: open_spec(),
        handler: open_handler,
    }
}

pub(crate) fn close_descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: close_spec(),
        handler: close_handler,
    }
}

fn open_spec() -> ToolSpec {
    ToolSpec {
        name: "workspace_open".to_string(),
        description: "Open a workspace file into your live view and focus it. The file \
                      joins your open-set: its CURRENT content is shown to you in the \
                      ## WORKSPACE block of every turn (refreshed automatically as you \
                      edit), and it appears as a tab in the user's IDE so they watch \
                      what you are working on. Returns a short ack (path + line count), \
                      NOT the file content — read the content in the ## WORKSPACE block, \
                      or use file_read for a one-off read. Open only the files you are \
                      actively working on; close the ones you are done with so the view \
                      stays tight. Paths are relative and '/'-separated, e.g. src/lib.rs."
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

fn close_spec() -> ToolSpec {
    ToolSpec {
        name: "workspace_close".to_string(),
        description: "Close a workspace file you opened: it leaves your open-set and its \
                      tab disappears from the user's IDE, and it is no longer shown in \
                      the ## WORKSPACE block. Use this when you are done with a file to \
                      keep your view focused. Returns a short ack. Paths are relative and \
                      '/'-separated."
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

fn open_handler<'a>(snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let path = string_arg(args, "path")?;

        // Read the file for the ack's line count ONLY — the content is never returned
        // (ack-not-bulk); the model sees it through the ## WORKSPACE block instead.
        let lines = read_line_count(&path).await;

        let Some(run) = snapshot.current_run_mut() else {
            return Err(
                "No active run: workspace_open is only meaningful inside a run.".to_string(),
            );
        };
        run.scratchpad.workspace.open(&path);

        Ok(match lines {
            Some(n) => format!("opened {path} ({n} line(s))"),
            None => format!("opened {path} (new/empty file)"),
        })
    })
}

fn close_handler<'a>(snapshot: &'a mut AppSnapshot, args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move {
        let path = string_arg(args, "path")?;
        let Some(run) = snapshot.current_run_mut() else {
            return Err(
                "No active run: workspace_close is only meaningful inside a run.".to_string(),
            );
        };
        if run.scratchpad.workspace.close(&path) {
            Ok(format!("closed {path}"))
        } else {
            Ok(format!("{path} was not open (nothing to close)"))
        }
    })
}

/// Read the line count of a workspace file for the open ack, or `None` when it does
/// not exist yet (or off-wasm, where OPFS is unavailable). Never returns the content.
#[cfg(target_arch = "wasm32")]
async fn read_line_count(path: &str) -> Option<usize> {
    crate::storage::opfs_vfs::OpfsVfs::new()
        .read_file(path)
        .await
        .ok()
        .flatten()
        .map(|content| content.lines().count())
}

/// Host build: no OPFS, so the ack carries no line count. The open-set mutation (the
/// part the tests exercise) is unaffected.
#[cfg(not(target_arch = "wasm32"))]
async fn read_line_count(_path: &str) -> Option<usize> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AgentRun;
    use serde_json::json;

    fn snapshot_with_run() -> AppSnapshot {
        let mut snapshot = AppSnapshot::default();
        let run = AgentRun {
            id: "run-ws-1".to_string(),
            goal: "g".into(),
            status: Default::default(),
            lane: Default::default(),
            scratchpad: Default::default(),
            messages: Vec::new(),
            events: Vec::new(),
            tool_calls: Vec::new(),
            tool_results: Vec::new(),
            final_answer: String::new(),
            created_at: String::new(),
        };
        snapshot.set_current_run(Some(run));
        snapshot
    }

    #[test]
    fn specs_keep_their_registered_names_and_required_args() {
        assert_eq!(open_spec().name, "workspace_open");
        assert_eq!(close_spec().name, "workspace_close");
        assert_eq!(open_spec().input_schema["required"], json!(["path"]));
        assert_eq!(close_spec().input_schema["required"], json!(["path"]));
    }

    #[test]
    fn open_adds_to_the_open_set_and_focuses_it() {
        let mut snapshot = snapshot_with_run();
        let ack = pollster::block_on(open_handler(&mut snapshot, &json!({"path": "src/lib.rs"})))
            .expect("open succeeds inside a run");
        // Ack-not-bulk: the result is a short ack, never the file content.
        assert!(ack.starts_with("opened src/lib.rs"));
        let ws = &snapshot.current_run().unwrap().scratchpad.workspace;
        assert_eq!(ws.open_files, vec!["src/lib.rs".to_string()]);
        assert_eq!(ws.active_file.as_deref(), Some("src/lib.rs"));
    }

    #[test]
    fn open_is_idempotent_but_refocuses() {
        let mut snapshot = snapshot_with_run();
        for path in ["a.rs", "b.rs", "a.rs"] {
            pollster::block_on(open_handler(&mut snapshot, &json!({ "path": path }))).unwrap();
        }
        let ws = &snapshot.current_run().unwrap().scratchpad.workspace;
        // `a.rs` is not duplicated, but reopening it refocuses onto it.
        assert_eq!(ws.open_files, vec!["a.rs".to_string(), "b.rs".to_string()]);
        assert_eq!(ws.active_file.as_deref(), Some("a.rs"));
    }

    #[test]
    fn close_removes_and_refocuses_the_neighbor() {
        let mut snapshot = snapshot_with_run();
        for path in ["a.rs", "b.rs", "c.rs"] {
            pollster::block_on(open_handler(&mut snapshot, &json!({ "path": path }))).unwrap();
        }
        // active is c.rs; close b.rs (not active) — active stays c.rs.
        pollster::block_on(close_handler(&mut snapshot, &json!({"path": "b.rs"}))).unwrap();
        let ws = &snapshot.current_run().unwrap().scratchpad.workspace;
        assert_eq!(ws.open_files, vec!["a.rs".to_string(), "c.rs".to_string()]);
        assert_eq!(ws.active_file.as_deref(), Some("c.rs"));

        // Now close the active c.rs — focus falls back to the remaining a.rs.
        pollster::block_on(close_handler(&mut snapshot, &json!({"path": "c.rs"}))).unwrap();
        let ws = &snapshot.current_run().unwrap().scratchpad.workspace;
        assert_eq!(ws.open_files, vec!["a.rs".to_string()]);
        assert_eq!(ws.active_file.as_deref(), Some("a.rs"));
    }

    #[test]
    fn close_of_unopened_path_is_a_noop_ack() {
        let mut snapshot = snapshot_with_run();
        let ack = pollster::block_on(close_handler(&mut snapshot, &json!({"path": "ghost.rs"})))
            .expect("close never errors");
        assert!(ack.contains("not open"));
        assert!(
            snapshot
                .current_run()
                .unwrap()
                .scratchpad
                .workspace
                .open_files
                .is_empty()
        );
    }

    #[test]
    fn errors_without_an_active_run() {
        let mut snapshot = AppSnapshot::default();
        let err = pollster::block_on(open_handler(&mut snapshot, &json!({"path": "x.rs"})))
            .expect_err("no run ⇒ error");
        assert!(err.contains("No active run"));
    }
}
