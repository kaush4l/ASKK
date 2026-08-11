//! The workspace, run. `agent::workspace` declares the four tools and the one
//! path rule; this file is the single place a command actually runs, exactly
//! as `tools::run` is for the local tools and `builtin_entry` is for a module.
//!
//! The GATE is here and nowhere else (ADR-006, I6). An agent's grant comes
//! from its space and from nothing it can write: no space, no root, no
//! workspace — default deny, and the refusal says which line of which file
//! grants it. The model never names the root; it names a path relative to it,
//! and `relative_path` refuses one that would leave.

use std::cell::RefCell;
use std::rc::Rc;

use kernel::{CapabilityGrant, EventKind, Execution, ToolId, WorkspaceError};

use crate::app::App;

/// This agent's workspace grant, or the reason it has none. One definition,
/// so the tool, the terminal pane and the prompt cannot disagree about who may
/// run a command.
pub(crate) fn grant(app: &App) -> Result<CapabilityGrant, String> {
    match &app.agent.space {
        Some(space) => Ok(CapabilityGrant::Workspace { root: space.path() }),
        None => Err("This agent works alone, so it has no workspace: the folder belongs to a \
                     space. Add `space: <name>` to its agent.md to put it in one."
            .into()),
    }
}

/// The root a grant permits, as a path. Private on purpose: a command's cwd
/// comes from the grant and there is no other way to obtain one.
fn root_of(grant: &CapabilityGrant) -> &str {
    match grant {
        CapabilityGrant::Workspace { root } => root,
        _ => "",
    }
}

/// Run one workspace tool, or `None` if this is not one of them (the caller
/// then tries the local table). Total, like every tool: a refusal and a
/// failure both come back as a result the model can read and act on.
pub(crate) async fn run(
    app: &Rc<RefCell<App>>,
    tool: &ToolId,
    args_json: &str,
) -> Option<EventKind> {
    if !agent::is_workspace_tool(&tool.0) {
        return None;
    }
    let (port, grant) = {
        let a = app.borrow();
        (Rc::clone(&a.ports.workspace), grant(&a))
    };
    let arg = |name: &str| -> String {
        serde_json::from_str::<serde_json::Value>(args_json)
            .ok()
            .and_then(|v| Some(v.get(name)?.as_str()?.to_string()))
            .unwrap_or_default()
    };
    let outcome = match grant {
        Err(denied) => Err(denied),
        Ok(grant) => {
            let root = root_of(&grant).to_string();
            perform(port.as_ref(), &root, &tool.0, &arg).await
        }
    };
    let (ok, output) = match outcome {
        Ok(ran) => (ran.status == 0, said(&ran)),
        Err(refusal) => (false, refusal),
    };
    Some(EventKind::ToolInvoked {
        tool: tool.clone(),
        args: args_json.to_string(),
        ok,
        output,
    })
}

/// One tool against the port. `cwd` is the grant's root, which the port
/// creates if it is not there yet — an agent whose space is new has no folder
/// yet, and "no such directory" is not a thing it can fix.
async fn perform(
    port: &dyn kernel::WorkspacePort,
    root: &str,
    tool: &str,
    arg: &dyn Fn(&str) -> String,
) -> Result<Execution, String> {
    let path = || agent::relative_path(&arg("path"));
    let ran = match tool {
        "exec" => match arg("command").trim().is_empty() {
            true => return Err("no command given. Call it as exec({\"command\": \"ls -l\"})".into()),
            false => port.exec(root, &arg("command")).await,
        },
        "read_file" => port.read(root, &path()?).await,
        "write_file" => port.write(root, &path()?, &arg("contents")).await,
        _ => port.list(root, &path()?).await,
    };
    ran.map_err(unavailable)
}

/// A port failure in the words a model — or a person — can act on. An absent
/// workspace is a fact about this browser (I15), not a broken tool.
fn unavailable(e: WorkspaceError) -> String {
    match e {
        WorkspaceError::Unavailable { reason } => {
            format!("No workspace is available here: {reason}")
        }
        WorkspaceError::Failed { message } => format!("The workspace failed: {message}"),
    }
}

/// What the caller is told. The exit status is reported in words whenever it
/// is not zero: a command that failed silently reads exactly like one that
/// printed nothing and succeeded.
pub(crate) fn said(ran: &Execution) -> String {
    let output = match ran.output.trim().is_empty() {
        true => "(no output)".to_string(),
        false => ran.output.trim_end().to_string(),
    };
    match ran.status {
        0 => output,
        status => format!("{output}\n(exit status {status})"),
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
