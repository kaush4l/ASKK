//! THE one dispatch point (ADR-004 Option B): route → registry lookup →
//! manifest → invoke by tier. No code outside this file may call module
//! logic — built-in or forged — and no manifest field records origin, so I9
//! erosion is unrepresentable. The CI check is one grep: only this file
//! names built-in handler fns.

use kernel::{CapabilityId, EventKind, ModuleId, Request, Response, Timestamp};
use module::view::FragmentBuilder;
use module::Logic;

use crate::app::App;
use crate::builtins;

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

/// A KV view scoped to one prefix (ADR-006: the handle physically cannot
/// form a key outside its slice). No G4 module is granted Kv yet; the
/// projection-read/write-behind design lands with the first one.
pub struct KvHandle {
    prefix: String,
}

impl KvHandle {
    /// Read one key under the module's prefix (the prefix is prepended here,
    /// not by the caller — callers never spell absolute keys).
    pub fn get(&self, key: &str) -> Option<String> {
        let _ = key;
        todo!("G5: first Kv-granted module")
    }

    /// Stage a write under the prefix; it leaves as an Effect.
    pub fn put(&mut self, key: &str, value: &str) {
        let _ = (key, value);
        todo!("G5: first Kv-granted module")
    }
}

/// The capability context a module's logic receives (§6 `ctx`). Ungranted =
/// `None` = absent, not present-but-refused (ADR-006). Constructed per
/// invocation from the module's effective grants; never stored.
pub struct Ctx {
    pub kv: Option<KvHandle>,
    /// Injected time, if granted (I7: even built-ins never read a real clock).
    pub clock: Option<Timestamp>,
    /// Emit events, if granted. PROVISIONAL (G4 discovery): a buffer the
    /// dispatcher drains, not the frozen closure — a closure borrowing App
    /// while the handler also runs against App cannot satisfy the borrow
    /// checker without interior mutability this is simpler than. Also
    /// widened from Custom-only to `EventKind`: the chat module's whole job
    /// is emitting `UserMessage`, which is not a Custom fact.
    pub emit: Option<Vec<EventKind>>,
    /// PROVISIONAL (G4): read-only projections handed to every built-in — the
    /// event kinds so far (views are projections of the log, I8). Becomes a
    /// real capability/section story at G5.
    pub recent: Vec<EventKind>,
    /// Agents with an utterance ACCEPTED but not yet pumped — `roster::accepted`'s
    /// window, widened to every agent. It lives in memory only, so a replayed
    /// log has none of it: that is exactly what tells a turn something is
    /// driving from a turn a reload abandoned (12 walk, `transcript::driven`).
    pub queued: Vec<String>,
    /// The loaded agent specs (increment 03) — a projection like `recent`.
    pub agents: Vec<agent::AgentSpec>,
    /// The agent files that would not parse — shown, never swallowed.
    pub agent_problems: Vec<String>,
    /// Which of `agents` were AUTHORED IN THIS BROWSER rather than shipped in
    /// `public/agents/`, and BY WHOM — empty for the person at the keyboard,
    /// otherwise the agent that called `write_agent` (increment 11, 11b). A
    /// model can write an agent that runs with real capabilities, so who wrote
    /// one is a fact the page states rather than a difference to infer.
    pub authored: Vec<(String, String)>,
    /// What every agent is doing (increment 06) — a projection like `recent`,
    /// cloned so a handler cannot move a status by writing to it.
    pub board: Vec<agent::AgentRow>,
    /// WHICH agent this process is (increment 07). A conversation-shaped fact
    /// with no name on it belongs to this one; `/chat` projects one agent's
    /// history and defaults to it.
    pub me: String,
    /// What THIS process's agent actually holds — its window (increment 08).
    /// A projection like `board`: the pane can say how much of the
    /// conversation the model still sees, which after a compaction is not the
    /// same thing as how much of it is on screen.
    pub window: Vec<String>,
    /// The shared space this process's agent works in, as last read from the
    /// store (increment 09) — a projection like `board`, so the inspector
    /// cannot show facts the agent's own prompt does not have.
    pub space: Option<agent::Space>,
}

/// A tier-0 built-in's logic. A plain fn pointer, not a trait object: no
/// state may hide in a built-in (state lives in the log/store like everyone
/// else's — I9), and fn pointers keep the dispatch table one flat array.
pub type BuiltinHandler = fn(&Request, &mut Ctx) -> Response;

/// The tier-0 dispatch table (ADR-004: "populated in exactly one file in
/// core"). This function IS that file's contract: module id in, handler out;
/// an unregistered built-in does not exist.
pub fn builtin_entry(id: &ModuleId) -> Option<BuiltinHandler> {
    match id.0.as_str() {
        "dashboard" => Some(builtins::dashboard),
        "chat" => Some(crate::chat::chat),
        "agents" => Some(crate::agents::agents),
        "tools" => Some(crate::tools::tools),
        "board" => Some(crate::board::board),
        "space" => Some(crate::inspector::space),
        "terminal" => Some(crate::terminal::terminal),
        "files" => Some(crate::files::files),
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

    let mut ctx = Ctx {
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
        queued,
        agents: app.agents.clone(),
        agent_problems: app.agent_problems.clone(),
        authored: app
            .authored
            .iter()
            .map(|(n, _, by)| (n.clone(), by.clone()))
            .collect(),
        board: app.board.snapshot().to_vec(),
        me,
        window: crate::logs::window(app),
        space: app.agent.space.clone(),
    };

    let response = match logic {
        Logic::BuiltIn => match builtin_entry(&manifest.id) {
            Some(handler) => handler(req, &mut ctx),
            None => error_fragment(500, "registered built-in has no dispatch entry"),
        },
        Logic::Script { .. } => error_fragment(501, "tier-1 script modules land with the forge"),
    };

    // Module-emitted facts: into the log now (I8) and into the pump queue.
    for kind in ctx.emit.take().into_iter().flatten() {
        let event = app.append(kind);
        app.pending.push(event);
    }
    response
}
