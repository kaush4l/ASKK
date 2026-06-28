//! Composes the `## WORKSPACE` prompt block from the agent's shared workspace view.
//!
//! The block is **projection-by-reference**: the open-set ([`WorkspaceView`]) stores
//! only path refs, and every turn this module pulls each open file's CURRENT content
//! fresh from OPFS, renders the folder tree, and appends the terminal tail — so an
//! edit the agent made last turn always shows, and the run state stays small.
//!
//! Split in two:
//! - [`compose_workspace_block`] is the **pure** renderer (host-testable): given the
//!   view, the tree entries, the resolved `(path, content)` pairs, and the terminal
//!   tail, it produces the block body. Returns `""` when the view is empty so the
//!   prompt stays byte-identical to the pre-workspace form.
//! - [`build_workspace_block`] is the **wasm** seam the shell calls in `before_turn`:
//!   it reads OPFS + the live-output ring, then defers to the pure renderer. Off-wasm
//!   it is a no-op (no OPFS), so host builds compile and the loop is unaffected.

use crate::state::WorkspaceView;

/// One open file resolved to its current content for the block.
pub struct OpenFile {
    pub path: String,
    /// `None` when the file does not exist on disk (opened-then-deleted, or a path
    /// the agent opened speculatively); rendered as a "(missing)" note.
    pub content: Option<String>,
}

/// Render the `## WORKSPACE` block body from already-resolved inputs. Pure and
/// platform-free (the renderer in [`crate::agent_prompt`] wraps it in the header).
///
/// Layout: the folder tree first (so the agent sees the project shape), then each
/// open file's current content in a fenced block (the focused file marked), then the
/// terminal tail. An empty view (no open files, no root) yields `""` — the signal to
/// omit the whole block.
pub fn compose_workspace_block(
    view: &WorkspaceView,
    tree: &[String],
    open_files: &[OpenFile],
    terminal_tail: &str,
) -> String {
    if view.is_empty() {
        return String::new();
    }

    let mut out = String::new();

    // The folder tree.
    out.push_str("### Files\n");
    if tree.is_empty() {
        out.push_str("(workspace is empty)\n");
    } else {
        for entry in tree {
            out.push_str(entry);
            out.push('\n');
        }
    }

    // Each open file's fresh content.
    if !open_files.is_empty() {
        out.push_str("\n### Open files\n");
        for file in open_files {
            let focused = view.active_file.as_deref() == Some(file.path.as_str());
            let marker = if focused { " (focused)" } else { "" };
            match &file.content {
                Some(content) => {
                    out.push_str(&format!(
                        "\n#### {}{} ({} line(s))\n```\n{}\n```\n",
                        file.path,
                        marker,
                        content.lines().count(),
                        content,
                    ));
                }
                None => {
                    out.push_str(&format!("\n#### {}{} (missing)\n", file.path, marker));
                }
            }
        }
    }

    // The terminal tail.
    let tail = terminal_tail.trim_end();
    if !tail.is_empty() {
        out.push_str(&format!(
            "\n### Terminal (recent output)\n```\n{tail}\n```\n"
        ));
    }

    out.trim_end().to_string()
}

/// Build the `## WORKSPACE` block body for a live run: read the OPFS tree, each open
/// file's current content, and the live-output tail, then render via
/// [`compose_workspace_block`]. Returns `""` when the view is empty.
///
/// The shell calls this in `before_turn` and stashes the result on
/// [`BaseEngine::workspace_context`](crate::core::BaseEngine::workspace_context).
#[cfg(target_arch = "wasm32")]
pub async fn build_workspace_block(run_id: &str, view: &WorkspaceView) -> String {
    use crate::storage::opfs_vfs::OpfsVfs;

    if view.is_empty() {
        return String::new();
    }

    let vfs = OpfsVfs::new();

    // The folder tree (folders marked with a trailing slash, sorted by path).
    let tree: Vec<String> = match vfs.list_all().await {
        Ok(entries) => entries
            .into_iter()
            .map(|e| {
                if e.is_dir {
                    format!("{}/", e.path)
                } else {
                    e.path
                }
            })
            .collect(),
        Err(_) => Vec::new(),
    };

    // Each open file's CURRENT content (fresh every turn).
    let mut open_files = Vec::with_capacity(view.open_files.len());
    for path in &view.open_files {
        let content = vfs.read_file(path).await.ok().flatten();
        open_files.push(OpenFile {
            path: path.clone(),
            content,
        });
    }

    // The terminal tail (a bounded slice of THIS run's captured output).
    let terminal_tail = crate::engine::output_capture::tail(run_id, 40);

    compose_workspace_block(view, &tree, &open_files, &terminal_tail)
}

/// Host build: no OPFS to read content/tree from, so each open file resolves to no
/// content. The block still composes from the view (open-set + focus) so off-wasm
/// callers and tests share the one pure renderer; with no OPFS there is no fresh
/// content, but an empty view still yields `""` exactly as on wasm.
#[cfg(not(target_arch = "wasm32"))]
pub async fn build_workspace_block(_run_id: &str, view: &WorkspaceView) -> String {
    let open_files: Vec<OpenFile> = view
        .open_files
        .iter()
        .map(|path| OpenFile {
            path: path.clone(),
            content: None,
        })
        .collect();
    compose_workspace_block(view, &[], &open_files, "")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn view(open: &[&str], active: Option<&str>) -> WorkspaceView {
        WorkspaceView {
            open_files: open.iter().map(|s| s.to_string()).collect(),
            active_file: active.map(|s| s.to_string()),
            root: String::new(),
        }
    }

    #[test]
    fn empty_view_renders_nothing() {
        let v = WorkspaceView::default();
        assert_eq!(compose_workspace_block(&v, &[], &[], ""), "");
        // A root alone (no open files) still renders — it is not "empty".
        let rooted = WorkspaceView {
            root: "src".to_string(),
            ..WorkspaceView::default()
        };
        assert!(!rooted.is_empty());
    }

    #[test]
    fn renders_tree_open_files_and_terminal_in_order() {
        let v = view(&["src/lib.rs"], Some("src/lib.rs"));
        let tree = vec!["src/".to_string(), "src/lib.rs".to_string()];
        let files = vec![OpenFile {
            path: "src/lib.rs".to_string(),
            content: Some("fn main() {}\nlet x = 1;".to_string()),
        }];
        let block = compose_workspace_block(&v, &tree, &files, "PASS: all good\nexit 0");

        // Section order: Files → Open files → Terminal.
        let files_at = block.find("### Files").unwrap();
        let open_at = block.find("### Open files").unwrap();
        let term_at = block.find("### Terminal").unwrap();
        assert!(files_at < open_at && open_at < term_at);

        // The tree is listed.
        assert!(block.contains("src/lib.rs"));
        // The focused file is marked and its FRESH content is shown.
        assert!(block.contains("#### src/lib.rs (focused) (2 line(s))"));
        assert!(block.contains("fn main() {}"));
        assert!(block.contains("let x = 1;"));
        // The terminal tail is shown.
        assert!(block.contains("PASS: all good"));
        assert!(block.contains("exit 0"));
    }

    #[test]
    fn non_focused_open_file_has_no_focus_marker() {
        let v = view(&["a.rs", "b.rs"], Some("a.rs"));
        let files = vec![
            OpenFile {
                path: "a.rs".to_string(),
                content: Some("AAA".to_string()),
            },
            OpenFile {
                path: "b.rs".to_string(),
                content: Some("BBB".to_string()),
            },
        ];
        let block =
            compose_workspace_block(&v, &["a.rs".to_string(), "b.rs".to_string()], &files, "");
        assert!(block.contains("#### a.rs (focused)"));
        assert!(block.contains("#### b.rs ("));
        assert!(!block.contains("#### b.rs (focused)"));
    }

    #[test]
    fn missing_file_is_noted_not_fenced() {
        let v = view(&["gone.rs"], Some("gone.rs"));
        let files = vec![OpenFile {
            path: "gone.rs".to_string(),
            content: None,
        }];
        let block = compose_workspace_block(&v, &["gone.rs".to_string()], &files, "");
        assert!(block.contains("#### gone.rs (focused) (missing)"));
        // No code fence for a missing file.
        assert!(!block.contains("```"));
    }

    #[test]
    fn empty_terminal_omits_the_terminal_section() {
        let v = view(&["a.rs"], Some("a.rs"));
        let files = vec![OpenFile {
            path: "a.rs".to_string(),
            content: Some("x".to_string()),
        }];
        let block = compose_workspace_block(&v, &["a.rs".to_string()], &files, "   \n  ");
        assert!(!block.contains("### Terminal"));
    }
}
