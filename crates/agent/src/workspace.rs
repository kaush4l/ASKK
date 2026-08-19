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

/// The tools a workspace brings with it, attached to whoever names the space,
/// exactly as the space's own three are (Python `utils.load_agent`).
///
/// ONE SET, not four tools and six bolt-ons. `exec` runs something that
/// finishes; the rest are the three things an agent in an environment cannot
/// do with a one-shot command — outlive the call, ask what the machine IS, and
/// find a file it does not already know the name of. Every one of them is the
/// same `WorkspacePort::exec` underneath (ADR-013); none of them is a second
/// way into the Linux.
pub fn workspace_tools() -> Vec<Tool> {
    [one_shot_tools(), process_tools(), discovery_tools()].concat()
}

/// The one-shot set: run something that finishes, and read or write a file.
/// Every workspace session that does anything at all uses these.
fn one_shot_tools() -> Vec<Tool> {
    vec![
        Tool::new(
            "exec",
            "Run a shell command in this space's workspace, a real Linux in this browser, and \
             wait for it to finish. Returns its output and exit status. For anything that keeps \
             running — a server, a watcher — use start_process instead.",
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

/// OUTLIVING THE CALL — the thing `exec` cannot do. A server an agent starts
/// and cannot leave running is not a server; one it cannot see is running blind;
/// one it cannot stop is a leak. Four tools, one capability, and every one of
/// them is the same `WorkspacePort::exec` underneath (ADR-013).
fn process_tools() -> Vec<Tool> {
    vec![
        Tool::new(
            "start_process",
            "Start a command in the background under a short name you choose. It keeps running \
             after this call returns and its output is captured to a file. Use it for servers, \
             watchers and long builds.",
            &["name", "command"],
        ),
        Tool::new(
            "list_processes",
            "Every process started in this workspace: its name, whether it is still running, how \
             long it has been running, and the command it runs.",
            &[],
        ),
        Tool::new(
            "read_process",
            "The most recent output of a process started here, and whether it is still running.",
            &["name"],
        ),
        Tool::new(
            "stop_process",
            "Stop a process started here. Its captured output stays readable afterwards.",
            &["name"],
        ),
    ]
}

/// ASKING RATHER THAN GUESSING — the other two things a one-shot command cannot
/// do. `observe` asks what the machine IS, which beats guessing at it with five
/// shell commands; `find_files` finds a file whose name the agent does not
/// already know, which `list_files` on an unknown folder shape is not.
fn discovery_tools() -> Vec<Tool> {
    vec![
        Tool::new(
            "observe",
            "What this machine is right now: kernel, how long it has been up, memory and disk \
             free, what the workspace folder holds, and how many processes were started here.",
            &[],
        ),
        Tool::new(
            "find_files",
            "Search the workspace. 'name' is a filename pattern like *.md; 'text' is what a line \
             in the file must contain. Give either or both.",
            &["name", "text"],
        ),
    ]
}

/// Whether this tool name is one of the workspace's own.
pub fn is_workspace_tool(name: &str) -> bool {
    matches!(
        name,
        "exec"
            | "read_file"
            | "write_file"
            | "list_files"
            | "start_process"
            | "list_processes"
            | "read_process"
            | "stop_process"
            | "observe"
            | "find_files"
    )
}

/// A process name the model chose, checked. A NAME and not a number, because a
/// number is what the model has to remember and a pid is not stable across a
/// reload: the model says `web` and means the same process next turn. It also
/// becomes a directory name under `.harness/proc/`, so it is checked the way a
/// space name is (`Space::named`) — refused, never rewritten.
pub fn process_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    let usable = !name.is_empty()
        && name.len() <= 32
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    match usable {
        true => Ok(name.to_string()),
        false => Err(format!(
            "'{name}' is not a usable process name: use letters, digits, '-' and '_', up to 32 \
             characters — like web, or build."
        )),
    }
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
    use super::{process_name, relative_path};

    #[test]
    fn a_process_name_is_a_name_and_not_a_path() {
        assert_eq!(process_name(" web ").unwrap(), "web");
        assert_eq!(process_name("build-2_a").unwrap(), "build-2_a");
        for bad in ["", "../etc", "a/b", "x".repeat(33).as_str(), "we b"] {
            let refusal = process_name(bad).unwrap_err();
            assert!(refusal.contains("not a usable process name"), "{refusal}");
        }
    }

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
