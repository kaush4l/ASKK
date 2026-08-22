//! The tool executor. The trace the user reads is `trace/pane.rs`.
//!
//! `agent::tools` DECLARES what exists (descriptors, usage lines, the refusal
//! rules); this file is the one place a tool actually runs, exactly as
//! `builtin_entry` is the one place a module's logic runs (ADR-004). A tool
//! named in the toolbox with no arm here refuses like any unknown tool — it
//! never pretends to have run.
//!
//! Every call, its arguments, its result and its errors are recorded as
//! `EventKind::ToolInvoked`, and the `/tools` route projects those events
//! (I8) — that projection is the `ToolTrace` component's whole content.

use std::cell::RefCell;
use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;

use kernel::{CapabilityId, EventKind, ModuleId, Request, Response, ToolId, Version};
use module::{DataSchema, Manifest, RouteSpec, Tier};

use crate::app::App;
use crate::dispatch::{error_fragment, Ctx};

pub(crate) fn manifest() -> Manifest {
    Manifest {
        id: ModuleId("tools".into()),
        name: "Tools".into(),
        version: Version(1),
        description: "What the agent called, with what arguments, and what came back.".into(),
        // Clock, so a call that has not come back can say HOW LONG it has been
        // (R11-4). Injected, never read (I7).
        capabilities: vec![CapabilityId::Clock],
        routes: vec![RouteSpec {
            method: "GET".into(),
            path: "/tools".into(),
        }],
        // No slot: the `ToolTrace` component mounts this route itself, the
        // way `ChatPane` mounts /chat. A slot here would only add a dashboard
        // placeholder for a panel that is already on the page.
        slots: vec![],
        section: None,
        schema: DataSchema {
            kv_prefix: "mod/tools/".into(),
            version: 1,
        },
        tier: Tier::T0Rust,
        tests: vec![],
    }
}

/// Named ONLY from `dispatch::builtin_entry` (ADR-004).
pub(crate) fn tools(req: &Request, ctx: &mut Ctx) -> Response {
    match (req.method.as_str(), req.path.as_str()) {
        // WHOSE calls (09 walk, finding 5): the pane was global, so the
        // summarizer's tab showed five calls it never made. Same `x-agent`
        // header the chat route already takes.
        // …and WHOSE WORK. `x-app-activity: 1` asks for the file panes' own
        // polling as well as the agent's calls (R7-1); absent, this log holds
        // only what the agent did, which is what a log named for it should say.
        ("GET", "/tools") => crate::trace::pane::trace(
            ctx,
            match req.header("x-agent").unwrap_or_default() {
                "" => &ctx.me,
                named => named,
            },
            req.header("x-app-activity") == Some("1"),
        ),
        _ => error_fragment(404, "tools: unknown subroute"),
    }
}

/// One handler's future. Boxed because an `async fn` has no nameable type and
/// a table has to hold all of them under one.
type Running<'a> = Pin<Box<dyn Future<Output = Option<EventKind>> + 'a>>;

/// What an entry in the table below IS: the three arguments every tool call
/// carries, and `Option` because a handler may still decline a call it was
/// routed (a space tool asked of an agent with no space) — the local table
/// answers then, exactly as it did when this was a fallthrough chain.
pub(crate) type ToolHandler = for<'a> fn(&'a Rc<RefCell<App>>, &'a ToolId, &'a str) -> Running<'a>;

fn workspace<'a>(app: &'a Rc<RefCell<App>>, tool: &'a ToolId, args: &'a str) -> Running<'a> {
    Box::pin(crate::workspace::gate::run(app, tool, args))
}
fn websearch<'a>(app: &'a Rc<RefCell<App>>, tool: &'a ToolId, args: &'a str) -> Running<'a> {
    Box::pin(crate::websearch::run(app, tool, args))
}
fn space<'a>(app: &'a Rc<RefCell<App>>, tool: &'a ToolId, args: &'a str) -> Running<'a> {
    Box::pin(crate::space::shared::run(app, tool, args))
}

/// The AWAITING tool table, the twin of `dispatch::builtin_entry`: tool name
/// in, handler out, and a name with no entry here is a local tool that `run`
/// below answers (or refuses, if it has no arm there either).
///
/// These three are here rather than in `run` for one hard reason. A space's
/// tools write to the SHARED store; a workspace tool runs a command in a
/// Linux; a search leaves the browser entirely. All three are I/O, so all
/// three are awaited — and a call awaited inside a borrow of the app holds
/// that borrow across the await, which panics the next `borrow_mut`. `run`
/// below is the sync half and the only one that may hold a borrow.
///
/// Each arm states its own membership rather than discovering it by falling
/// through: the sets are `agent::is_workspace_tool`, `agent::WEB_SEARCH` and
/// `agent::is_space_tool`. They are disjoint today, so match order states
/// precedence — workspace claims a shared name first — rather than tie-breaks.
pub(crate) fn tool_entry(tool: &ToolId) -> Option<ToolHandler> {
    match tool.0.as_str() {
        name if agent::is_workspace_tool(name) => Some(workspace),
        name if name == agent::WEB_SEARCH => Some(websearch),
        name if agent::is_space_tool(name) => Some(space),
        _ => None,
    }
}

/// Run ONE LOCAL tool. Sync and total: every failure comes back as a result,
/// never as an error return, because that text is what lets the model correct
/// itself on the next pass (Python `core/tools.py`: "nothing here raises").
///
/// Sync because every tool THIS table holds is local — the clock, the loaded
/// agents. Anything that needs I/O has an entry in `tool_entry` above, is
/// tried first, and comes back with the same `ToolInvoked` fact. That path is
/// `batch::single`, never `execute_port_effect` — `Effect::InvokeTool` is
/// `unreachable!()` there, and the old sentence sent readers to the wrong file.
pub(crate) fn run(app: &mut App, tool: &ToolId, args_json: &str) -> EventKind {
    let result = match tool.0.as_str() {
        "now" => Ok(format!("{} ms since the Unix epoch", app.ports.clock.now().0)),
        "list_agents" => Ok(list_agents(app)),
        "read_agent" => read_agent(app, args_json),
        // The only tool that writes a fact of its own before its envelope: it
        // AUTHORS an agent (increment 11), which the roster then installs at
        // the end of this turn.
        "write_agent" => crate::agents::roster::write_agent(app, args_json),
        _ => Err(format!(
            "Tool not found. Available: {}",
            agent::builtin_tools()
                .tools
                .iter()
                .map(|t| t.name.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        )),
    };
    let (ok, output) = match result {
        Ok(output) => (true, output),
        Err(error) => (false, error),
    };
    EventKind::ToolInvoked {
        tool: tool.clone(),
        args: args_json.to_string(),
        ok,
        output,
    }
}

fn list_agents(app: &App) -> String {
    if app.agents.is_empty() {
        return "No agents are loaded.".into();
    }
    app.agents
        .iter()
        .map(|s| format!("{}: {}", s.name, s.description))
        .collect::<Vec<_>>()
        .join("\n")
}

/// One agent's definition. A missing `name` is refused in the words that name
/// the fix — the same discipline as an unreadable argument.
fn read_agent(app: &App, args_json: &str) -> Result<String, String> {
    // `name`: an agent name is an identifier matched against the roster below,
    // so the reader trims it once and refuses a blank one — the check that was
    // written by hand here, and the reason `asked.trim()` appeared three times.
    let args = context::Args::parse(args_json);
    let Ok(asked) = args.name("name") else {
        return Err("no agent named. Call it as read_agent({\"name\": \"<agent>\"})".into());
    };
    match app.agents.iter().find(|s| s.name == asked) {
        Some(s) => Ok(format!(
            "{} — {}\nmodel: {}\ntools: {}\n\n{}",
            s.name,
            s.description,
            s.model,
            match s.tools.is_empty() {
                true => "none".to_string(),
                false => s.tools.join(", "),
            },
            s.prompt
        )),
        None => Err(format!(
            "No agent called '{}'. Loaded: {}",
            asked,
            app.agents
                .iter()
                .map(|s| s.name.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        )),
    }
}
