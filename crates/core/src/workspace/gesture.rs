//! WHAT A PERSON'S GESTURE RUNS. `gate.rs` next door owns the capability check
//! and the single place a command actually runs; this file is only the
//! translation from a press into a call.
//!
//! Every function here is one press or one keystroke turned into the agent's
//! OWN tool, through the same gate, recorded as the same `ToolInvoked` fact:
//! the panes expose capabilities that already exist rather than growing ones,
//! which is why one trace can show what you did beside what the agent did.

use std::cell::RefCell;
use std::rc::Rc;

use kernel::{EventKind, ToolId};

use crate::app::App;
use crate::workspace::gate::run;

/// STOP THE COMMAND THAT IS RUNNING (R11-1b). The one gesture here that is NOT
/// one of the agent's tools, because there is no tool for it: a command already
/// inside the Linux is not reachable by running another one, so the port grows
/// the one method that can reach it (`WorkspacePort::stop`).
///
/// What actually happens is the ENGINE's answer and differs between the two —
/// `WorkspacePort::interrupt` states which, and the pane's button says so
/// before it is pressed. Either way the interrupted call's own `exec` future is
/// what carries the outcome: it comes back a failed `ToolInvoked`, in the trace
/// and in the scrollback, like any other call that did not work out.
///
/// A refusal is recorded as a fact of its own rather than swallowed: pressing
/// Stop and being told nothing is the defect this whole finding is about.
pub(crate) async fn stop_command(app: &Rc<RefCell<App>>) {
    let port = Rc::clone(&app.borrow().ports.workspace);
    if let Err(e) = port.stop().await {
        let said = crate::workspace::gate::unavailable(e);
        app.borrow_mut().append(EventKind::Custom {
            kind: crate::terminal::pane::STOP_FAILED.into(),
            payload_json: serde_json::to_string(&said).unwrap_or_default(),
        });
    }
}

/// A path a PERSON opened in the files pane: `list_files` for a folder and
/// `read_file` for a file — the same two tools the agent has, through the same
/// gate, recorded as the same facts.
///
/// Which of the two comes from the CALLER, because it cannot be inferred here:
/// `ls` on a file succeeds and prints the file, so "list, and read only if the
/// listing failed" opens nothing, ever. The listing that offered this path
/// already knew (a trailing slash from `ls -1Ap`), and a refusal is recorded
/// like any other — it is how a person learns the path was wrong.
pub(crate) async fn open_typed(app: &Rc<RefCell<App>>, path: &str, folder: bool) {
    let args = serde_json::json!({ "path": path }).to_string();
    let tool = match folder {
        true => "list_files",
        false => "read_file",
    };
    if let Some(kind) = run(app, &ToolId(tool.into()), &args).await {
        app.borrow_mut().append(kind);
    }
}

/// What a person typed into the editor, written through the agent's own
/// `write_file` and then read back — the read is what makes the pane show what
/// is ON DISK rather than what was typed, which is the difference between a
/// save and a hope.
pub(crate) async fn save_typed(app: &Rc<RefCell<App>>, path: &str, contents: &str) {
    let args = serde_json::json!({ "path": path, "contents": contents }).to_string();
    if let Some(kind) = run(app, &ToolId("write_file".into()), &args).await {
        let wrote = matches!(&kind, EventKind::ToolInvoked { ok: true, .. });
        app.borrow_mut().append(kind);
        if wrote {
            open_typed(app, path, false).await;
        }
    }
}

/// What the Processes PANE asked for: the agent's own `list_processes`, through
/// the same gate, recorded as the same fact. No arguments, so the pane's calls
/// and the agent's are told apart by the request queue in `asked`, exactly as
/// two identical `exec`s are.
pub(crate) async fn list_processes(app: &Rc<RefCell<App>>) {
    if let Some(kind) = run(app, &ToolId("list_processes".into()), "{}").await {
        app.borrow_mut().append(kind);
    }
}

/// STOP, from the pane's own button (R10-6). The agent's `stop_process`, through
/// the same gate and recorded as the same fact — the pane exposes a capability
/// that already exists rather than growing one, exactly as `save_typed` exposes
/// `write_file`. Before this the only way to stop something you had watched
/// start was to type an English sentence to a model and hope.
pub(crate) async fn stop_process(app: &Rc<RefCell<App>>, name: &str) {
    let args = serde_json::json!({ "name": name }).to_string();
    if let Some(kind) = run(app, &ToolId("stop_process".into()), &args).await {
        app.borrow_mut().append(kind);
    }
}

/// A command a PERSON typed into the terminal pane, run in this agent's own
/// workspace. Recorded as the same `ToolInvoked` fact the agent's own calls
/// produce, so one pane projects both and a person can see what the agent did
/// beside what they did (I8).
pub(crate) async fn run_typed(app: &Rc<RefCell<App>>, command: &str) {
    let args = serde_json::json!({ "command": command }).to_string();
    let Some(kind) = run(app, &ToolId("exec".into()), &args).await else {
        return;
    };
    app.borrow_mut().append(kind);
}
