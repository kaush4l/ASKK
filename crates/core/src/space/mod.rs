//! A SPACE — the shared memory an agent and its sub-agents both reach.
//!
//! `shared` is where that state actually lives and the three tools that write
//! to it; `sense` renders it for the prompt through the faculty port; `pane`
//! is the Space inspector, the same facts as a person sees them. `artifact` is
//! the group's SHELF — what it has produced rather than what it has said — in
//! the same store, under the same space key, behind its own faculty.

pub(crate) mod artifact;
pub(crate) mod pane;
pub(crate) mod sense;
pub(crate) mod shared;

use std::cell::RefCell;
use std::rc::Rc;

/// Whether this tool name belongs to a SPACE — its own three, or its shelf's
/// two. One predicate, because `tools::tool_entry` routes by subject and the
/// shelf is part of the space's subject even though it is its own faculty.
pub(crate) fn is_space_call(name: &str) -> bool {
    agent::is_space_tool(name) || agent::is_artifact_tool(name)
}

/// Run whichever of the space's tools this is. `None` is a name neither half
/// claims, or an agent with no space at all — the local table answers it, and
/// refuses it, in both cases.
pub(crate) async fn run(
    app: &Rc<RefCell<crate::app::App>>,
    tool: &kernel::ToolId,
    args_json: &str,
) -> Option<kernel::EventKind> {
    match agent::is_artifact_tool(&tool.0) {
        true => artifact::host::run(app, tool, args_json).await,
        false => shared::run(app, tool, args_json).await,
    }
}
