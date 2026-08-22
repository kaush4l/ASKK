//! WHAT IS GOING ON — the module and its one route.
//!
//! IT ADDS NOTHING TO THE LOG. Every fact this pane draws was already being
//! emitted and persisted, and every one of them had zero readers: the route the
//! strategy stage voted and the clause behind it (`core.route_chosen`), the
//! stage the turn entered (`STAGE_ENTERED` — read by the board's live line only
//! since 28, and never with the right list to count against), the Document each
//! model call was sent (`ModelCalled::document_hash`), the writes that failed
//! (`StoreFailed`), and what the model said in the rounds where it called a
//! tool instead of answering. So this module owns no capability, emits no
//! event, and makes no request of anything: it is a projection and only that
//! (I8).
//!
//! ONE ROUTE, GET ONLY, for the same reason — there is nothing here to press.

use kernel::{ModuleId, Request, Response, Version};
use module::{DataSchema, Manifest, RouteSpec, Tier};

use crate::dispatch::{html, Ctx};

pub(crate) fn manifest() -> Manifest {
    Manifest {
        id: ModuleId("debug".into()),
        name: "Debug".into(),
        version: Version(1),
        description: "What each turn decided, what it cost, and what broke.".into(),
        // NONE. A pane that reads the log needs nothing granted: `Ctx::recent`
        // and `Ctx::at` are handed to every built-in, and a clock is not needed
        // because every time drawn here is the time the FACT happened (I7),
        // which rides on the event and not on now.
        capabilities: vec![],
        routes: vec![RouteSpec {
            method: "GET".into(),
            path: "/debug".into(),
        }],
        slots: vec![],
        section: None,
        schema: DataSchema {
            kv_prefix: "mod/debug/".into(),
            version: 1,
        },
        tier: Tier::T0Rust,
        tests: vec![],
    }
}

/// Named ONLY from `dispatch::builtin_entry` (ADR-004).
pub(crate) fn debug(req: &Request, ctx: &mut Ctx) -> Response {
    let who = match req.header("x-agent").unwrap_or_default() {
        "" => ctx.me.clone(),
        named => named.to_string(),
    };
    let (body, counts) = crate::debug::render::panel(ctx, &who);
    let mut response = html(200, body);
    for (name, value) in [
        ("x-debug-turns", counts.turns.to_string()),
        ("x-model-calls", counts.calls.to_string()),
        ("x-store-failed", counts.store_failed.to_string()),
        // WHETHER THIS LOG IS THE ONE THAT RAN THE TURNS. A sub-agent runs in
        // its own Worker, so its route, stage and model-call facts are in ITS
        // log; this one holds only what came back. The pane says so rather than
        // drawing a turn that cost nothing (I16).
        ("x-own-log", (who == ctx.me).to_string()),
    ] {
        response.headers.push((name.into(), value));
    }
    response
}
