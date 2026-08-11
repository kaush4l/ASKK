//! The tool executor. The trace the user reads is `trace.rs`.
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

use kernel::{EventKind, ModuleId, Request, Response, ToolId, Version};
use module::{DataSchema, Manifest, RouteSpec, Tier};

use crate::app::App;
use crate::dispatch::{error_fragment, Ctx};

pub(crate) fn manifest() -> Manifest {
    Manifest {
        id: ModuleId("tools".into()),
        name: "Tools".into(),
        version: Version(1),
        description: "What the agent called, with what arguments, and what came back.".into(),
        capabilities: vec![],
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
        ("GET", "/tools") => crate::trace::trace(ctx),
        _ => error_fragment(404, "tools: unknown subroute"),
    }
}

/// Run ONE tool. Sync and total: every failure comes back as a result, never
/// as an error return, because that text is what lets the model correct itself
/// on the next pass (Python `core/tools.py`: "nothing here raises").
///
/// ponytail: sync because every tool this build ships is local (the clock, the
/// loaded agents). The first tool that needs the network or the VM goes
/// through `execute_effect`'s async path instead — same event either way.
pub(crate) fn run(app: &App, tool: &ToolId, args_json: &str) -> EventKind {
    let result = match tool.0.as_str() {
        "now" => Ok(format!("{} ms since the Unix epoch", app.ports.clock.now().0)),
        "list_agents" => Ok(list_agents(app)),
        "read_agent" => read_agent(app, args_json),
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
    let asked = serde_json::from_str::<serde_json::Value>(args_json)
        .ok()
        .and_then(|v| v.get("name")?.as_str().map(str::to_string))
        .unwrap_or_default();
    if asked.trim().is_empty() {
        return Err("no agent named. Call it as read_agent({\"name\": \"<agent>\"})".into());
    }
    match app.agents.iter().find(|s| s.name == asked.trim()) {
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
            asked.trim(),
            app.agents
                .iter()
                .map(|s| s.name.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        )),
    }
}
