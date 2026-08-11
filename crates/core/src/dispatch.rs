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
    /// PROVISIONAL (G4): read-only projections handed to every built-in.
    /// Slot-declaring modules' panel routes (dashboard composition) and the
    /// event kinds so far (views are projections of the log, I8). Becomes a
    /// real capability/section story at G5.
    pub panels: Vec<String>,
    pub recent: Vec<EventKind>,
    /// The loaded agent specs (increment 03) — a projection like `recent`.
    pub agents: Vec<agent::AgentSpec>,
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

    // Panel routes: slot-declaring modules in deterministic (slot, order, id)
    // order, each contributing its first GET route.
    let mut slotted: Vec<(&str, u16, &ModuleId, &str)> = Vec::new();
    for reg in app.registry.active() {
        for slot in &reg.manifest.slots {
            if let Some(route) = reg.manifest.routes.iter().find(|r| r.method == "GET") {
                slotted.push((&slot.slot, slot.order, &reg.manifest.id, &route.path));
            }
        }
    }
    slotted.sort();
    let panels: Vec<String> = slotted.into_iter().map(|(_, _, _, p)| p.into()).collect();

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
        panels,
        recent: app.log.iter().map(|e| e.kind.clone()).collect(),
        agents: app.agents.clone(),
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
