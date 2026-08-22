//! THE one dispatch point (ADR-004 Option B): route → registry lookup →
//! manifest → invoke by tier. No code outside this file may call module
//! logic — built-in or forged — and no manifest field records origin, so I9
//! erosion is unrepresentable. The CI check is one grep: only this file
//! names built-in handler fns.

use kernel::{CapabilityId, EventKind, ModuleId, Request, Response};
use module::view::FragmentBuilder;
use module::Logic;

use crate::app::App;
use crate::builtins;

// `dispatch::Ctx` is the name the whole crate reaches for and the name ADR-004
// uses; `ctx.rs` next door defines the SHAPE, this file is its one address.
pub use crate::ctx::{BuiltinHandler, Ctx, KvHandle};

/// A 200/4xx/5xx HTML fragment response — the seam's one output shape.
pub(crate) fn html(status: u16, body: String) -> Response {
    Response {
        status,
        headers: vec![("content-type".into(), "text/html; charset=utf-8".into())],
        body,
    }
}

/// The shared error fragment (escaped through the view primitives).
pub(crate) fn error_fragment(status: u16, message: &str) -> Response {
    html(
        status,
        FragmentBuilder::new("div")
            .class("error")
            .text(message)
            .build()
            .into_html(),
    )
}

/// The tier-0 dispatch table (ADR-004: "populated in exactly one file in
/// core"). This function IS that file's contract: module id in, handler out;
/// an unregistered built-in does not exist.
pub fn builtin_entry(id: &ModuleId) -> Option<BuiltinHandler> {
    match id.0.as_str() {
        "dashboard" => Some(builtins::dashboard),
        "chat" => Some(crate::chat::pane::chat),
        "agents" => Some(crate::agents::pane::agents),
        "tools" => Some(crate::tools::tools),
        "board" => Some(crate::board::pane::board),
        "space" => Some(crate::space::pane::space),
        "terminal" => Some(crate::terminal::pane::terminal),
        "files" => Some(crate::files::pane::files),
        "processes" => Some(crate::proc::pane::processes),
        "debug" => Some(crate::debug::pane::debug),
        "status" => Some(builtins::status),
        _ => None,
    }
}

/// Route one request: registry lookup, effective-grant `Ctx` construction,
/// tier match (T0 → `builtin_entry`; T1 lands with the forge), 404 as an
/// HTML fragment otherwise. Drains module-emitted events into the log and
/// the pump queue. Called only by `core::handle`.
pub fn dispatch(app: &mut App, req: &Request) -> Response {
    let Some(hit) = app.registry.resolve_route(&req.method, &req.path) else {
        return error_fragment(404, &format!("no route: {} {}", req.method, req.path));
    };
    let manifest = hit.manifest.clone();
    let logic = hit.logic.clone();

    let me = app.me().to_string();
    let queued: Vec<String> = app
        .pending
        .iter()
        .filter_map(|e| match &e.kind {
            EventKind::UserMessage { agent, .. } if agent.is_empty() => Some(me.clone()),
            EventKind::UserMessage { agent, .. } => Some(agent.clone()),
            _ => None,
        })
        .collect();

    // One question per DISTINCT `model:` key, not one per agent: the whole
    // roster usually names the same one, and resolving it re-reads the
    // catalogue each time.
    let mut asked: Vec<String> = app.agents.iter().map(|s| s.model.clone()).collect();
    asked.sort();
    asked.dedup();
    let resolved_models = asked
        .into_iter()
        .filter_map(|key| {
            app.ports
                .model
                .resolves(&key)
                .map(|(entry, model)| (key, entry, model))
        })
        .collect();

    let mut ctx = Ctx {
        wipe: false,
        kv: None, // no G4 module declares Kv
        clock: manifest
            .capabilities
            .contains(&CapabilityId::Clock)
            .then(|| app.ports.clock.now()),
        emit: manifest
            .capabilities
            .contains(&CapabilityId::Emit)
            .then(Vec::new),
        recent: app.log.iter().map(|e| e.kind.clone()).collect(),
        at: app.log.iter().map(|e| e.at.0).collect(),
        running: app.running.clone(),
        calling: app.calling.clone(),
        interrupt: app.ports.workspace.interrupt(),
        queued,
        agents: app.agents.clone(),
        agent_problems: app.agent_problems.clone(),
        resolved_models,
        authored: app
            .authored
            .iter()
            .map(|(n, _, by)| (n.clone(), by.clone()))
            .collect(),
        board: app.board.snapshot().to_vec(),
        me,
        window: crate::log::store::window(app),
        space: app.agent.space.clone(),
        durable: app.ports.workspace.durable(),
        booted: app.booted,
        writership: crate::log::writership::of(app),
    };

    let response = match logic {
        Logic::BuiltIn => match builtin_entry(&manifest.id) {
            Some(handler) => handler(req, &mut ctx),
            None => error_fragment(500, "registered built-in has no dispatch entry"),
        },
        Logic::Script { .. } => error_fragment(501, "tier-1 script modules land with the forge"),
    };
    // A handler that asked for the conversation to be cleared could not reach
    // it: `Ctx` carries a projection of the window, and clearing means writing
    // the real one. Here is the one place that holds both (`clear::wipe`).
    if ctx.wipe {
        crate::chat::clear::wipe(app);
    }

    // Module-emitted facts: into the log now (I8) and into the pump queue.
    for kind in ctx.emit.take().into_iter().flatten() {
        let event = app.append(kind);
        app.pending.push(event);
    }
    response
}
