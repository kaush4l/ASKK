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

use context::Args;
use kernel::{CapabilityGrant, EventKind, Execution, ToolId, WorkspaceError};

use crate::app::App;

/// This agent's workspace grant, or the reason it has none. One definition,
/// so the tool, the terminal pane and the prompt cannot disagree about who may
/// run a command.
pub(crate) fn grant(app: &App) -> Result<CapabilityGrant, String> {
    match &app.agent.space {
        Some(space) => Ok(CapabilityGrant::Workspace { root: space.path() }),
        None => Err(format!(
            "{ALONE}name a space in its agent file and it gets one."
        )),
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

/// Run one workspace tool. Reached through `tools::tool_entry`, which routes
/// every name `agent::is_workspace_tool` claims here; `None` is the answer to
/// a name it does not, which is how a direct caller (`workspace/gesture.rs`) learns it
/// asked for something else. Total, like every tool: a refusal and a failure
/// both come back as a result the model can read and act on.
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
    // ONE READER, PARSED ONCE, and handed down to the two dispatches below.
    // It was a `&dyn Fn(&str) -> String` closure duplicated here, in
    // `proc/convention.rs` and in `observe.rs`; the CHOICE between its two
    // halves is what each call site below states.
    let args = Args::parse(args_json);
    // IN FLIGHT, WHERE A PROJECTION CAN SEE IT (R11-4). Every workspace call —
    // the agent's, the file panes', the Processes pane's, and yours — passes
    // through here, so this is the one place that has to know. A refused call
    // never reaches the port and is never in flight.
    let outcome = match grant {
        Err(denied) => Err(denied),
        Ok(grant) => {
            let root = root_of(&grant).to_string();
            let call = crate::trace::inflight::Inflight {
                tool: tool.0.clone(),
                args: args_json.to_string(),
                at: app.borrow().ports.clock.now().0,
            };
            app.borrow_mut().calling.push(call.clone());
            let ran = perform(port.as_ref(), &root, &tool.0, &args).await;
            let mut a = app.borrow_mut();
            if let Some(i) = a.calling.iter().position(|c| *c == call) {
                a.calling.remove(i);
            }
            ran
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
    args: &Args,
) -> Result<Execution, String> {
    // The environment tools first, and through the SAME port: a process, an
    // observation and a search are all one `exec` with a shape we defined on
    // top of it, never a second door into the Linux (ADR-013).
    if let Some(ran) = crate::proc::convention::run(port, root, tool, args).await {
        return ran;
    }
    if let Some(ran) = crate::observe::run(port, root, tool, args).await {
        return ran;
    }
    // `path` is a NAME: an identifier for a place, where surrounding space is a
    // typo — and `agent::relative_path` already trims it
    // (`crates/agent/src/workspace.rs:153`), so the reader agrees with the
    // validator instead of disagreeing with it silently.
    let path = || agent::relative_path(args.name("path").unwrap_or_default());
    let ran = match tool {
        // `command` is a NAME: blank must be refused, which is the check that
        // was here by hand, and a shell does not care about the space around it.
        "exec" => match args.name("command") {
            Err(_) => {
                return Err("no command given. Call it as exec({\"command\": \"ls -l\"})".into())
            }
            Ok(command) => port.exec(root, command).await,
        },
        "read_file" => port.read(root, &path()?).await,
        // `contents` is TEXT, and this is the line the split exists for. A
        // reader that trimmed here would strip the trailing newline off every
        // file an agent ever wrote, silently, with the gate green
        // (`crates/core/tests/roundtrip.rs`).
        "write_file" => port.write(root, &path()?, args.text("contents").unwrap_or_default()).await,
        _ => port.list(root, &path()?).await,
    };
    ran.map_err(unavailable)
}

/// A port failure in the words a model — or a person — can act on. An absent
/// workspace is a fact about this browser (I15), not a broken tool.
pub(crate) fn unavailable(e: WorkspaceError) -> String {
    match e {
        WorkspaceError::Unavailable { reason } => format!("{UNAVAILABLE}{reason}"),
        // A STOP A PERSON ASKED FOR IS NOT A FAILURE (R17-P1-6). A stopped
        // command ends through the same `Err` as a crash, and the row read
        // `you ran $ sleep 40 — failed`, in red, over an explanation that
        // began *"The workspace failed: you stopped it"*. `failed` is what
        // happens TO you; this was a deliberate act. The engine writes the lead
        // (it is the one that knows what its own stop did), and that is the
        // only thing this file has to recognise.
        WorkspaceError::Failed { message } if message.starts_with(STOPPED) => message,
        WorkspaceError::Failed { message } => format!("{FAILED}{message}"),
    }
}

/// The openings of a sentence THIS PRODUCT wrote into a tool result, where
/// everything else in that field is bytes the guest printed.
pub(crate) const UNAVAILABLE: &str = "No folder is available here: ";
pub(crate) const FAILED: &str = "The Linux failed: ";
pub(crate) const ALONE: &str = "This agent works alone, so it has no folder: ";
/// What the engine writes when the ending was a person pressing Stop. Only the
/// opening is the contract — the rest of the sentence belongs to the adapter,
/// which is the half that knows what its own stop did — and it is the whole
/// test.
pub(crate) const STOPPED: &str = "You stopped ";

/// Whether this ending was asked for. One predicate, so the row's word, its
/// colour and its wrapping cannot disagree about what happened.
pub(crate) fn was_stopped(output: &str) -> bool {
    output.starts_with(STOPPED)
}

/// Whether this tool output is our own prose rather than the guest's stdout
/// (R12-4). It decides how the row WRAPS, and nothing else. The scrollback
/// renders output with `white-space: pre` so that `ls -la` keeps its columns —
/// deliberately, and right for a machine's output. It is wrong for a sentence
/// we wrote: *"The workspace failed: you stopped it. The shell takes the next
/// command when…"* was 2208px of explanation clipped inside a 644px box, and
/// the hidden remainder was the only place the product explains why the
/// workspace is still occupied. The distinction is by ORIGIN, not by width, so
/// the two prefixes above are the test rather than a guess about the bytes.
pub(crate) fn is_prose(output: &str) -> bool {
    [UNAVAILABLE, FAILED, ALONE, STOPPED].iter().any(|said| output.starts_with(said))
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
