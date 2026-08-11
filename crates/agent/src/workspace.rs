//! The workspace as the MODEL sees it (increment 10): four tools, and the one
//! rule about the paths they may name. Pure — running a command is I/O and
//! happens in `core::workspace` through `kernel::WorkspacePort`, so this file
//! tests on the host like every other decision the agent makes (I3).
//!
//! The workspace belongs to the SPACE. Increment 09 put `spaces/<name>` in
//! every prompt as a path "named; not writable from this browser yet"; this is
//! where it becomes a folder, and it is the same folder for every agent whose
//! file names that space — which is what a shared workspace has to mean.

use crate::tools::Tool;

/// The four tools a workspace brings with it, attached to whoever names the
/// space, exactly as the space's own three are (Python `utils.load_agent`).
pub fn workspace_tools() -> Vec<Tool> {
    vec![
        Tool::new(
            "exec",
            "Run a shell command in this space's workspace, a real Linux in this browser. \
             Returns its output and exit status.",
            &["command"],
        ),
        Tool::new(
            "read_file",
            "Read a file in the workspace. The path is relative to the workspace folder.",
            &["path"],
        ),
        Tool::new(
            "write_file",
            "Write a file in the workspace, creating folders as needed. Replaces what was \
             there.",
            &["path", "contents"],
        ),
        Tool::new(
            "list_files",
            "List a folder in the workspace. Use \".\" for the workspace itself.",
            &["path"],
        ),
    ]
}

/// Whether this tool name is one of the workspace's own.
pub fn is_workspace_tool(name: &str) -> bool {
    matches!(name, "exec" | "read_file" | "write_file" | "list_files")
}

/// A path the model wrote, checked against the one rule: it stays inside the
/// workspace. Absolute paths and `..` segments are REFUSED rather than
/// clamped — a silently rewritten path writes a file the agent cannot find,
/// and the refusal is what lets it correct itself. Empty means the workspace
/// folder itself.
pub fn relative_path(path: &str) -> Result<String, String> {
    let path = path.trim();
    if path.is_empty() || path == "." {
        return Ok(".".into());
    }
    let refused = |why: &str| {
        Err(format!(
            "'{path}' is not a path in this workspace: {why}. Write paths relative to the \
             workspace folder, like notes/today.md"
        ))
    };
    if path.starts_with('/') || path.starts_with('~') {
        return refused("it starts outside the workspace");
    }
    match path.split('/').any(|part| part == "..") {
        true => refused("it walks out of the workspace with .."),
        false => Ok(path.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::relative_path;

    #[test]
    fn a_path_that_leaves_the_workspace_is_refused_not_clamped() {
        assert_eq!(relative_path("notes/today.md").unwrap(), "notes/today.md");
        assert_eq!(relative_path("  ").unwrap(), ".");
        for bad in ["/etc/passwd", "../secrets", "a/../../b", "~/.ssh/id_rsa"] {
            let refusal = relative_path(bad).unwrap_err();
            assert!(refusal.contains(bad), "{refusal}");
            assert!(refusal.contains("relative to the workspace"), "{refusal}");
        }
    }
}
