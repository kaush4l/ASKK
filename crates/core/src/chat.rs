//! The chat module: ONE agent's conversation, rendered as a projection of the
//! event log scoped to that agent (I8), plus the one route that starts a turn.
//!
//! Every agent is separately addressable (increment 07): `x-agent` on the
//! request says whose conversation this is, and nothing outside it is ever
//! projected — a message to `researcher` cannot appear in `main`'s transcript
//! because the fold never reaches it. The transcript is computed on every
//! request and stored nowhere: reload the page and the same fold over the
//! replayed log produces the same screen, for every agent at once.

use kernel::{CapabilityId, EventKind, ModuleId, Request, Response, Version};
use module::{DataSchema, Manifest, RouteSpec, Tier};

use crate::dispatch::{error_fragment, Ctx};
use crate::transcript::transcript;
use crate::form::form_value;

pub(crate) fn manifest() -> Manifest {
    Manifest {
        id: ModuleId("chat".into()),
        name: "Chat".into(),
        version: Version(1),
        description: "One agent's conversation: the transcript and the turn trigger.".into(),
        capabilities: vec![CapabilityId::Emit],
        routes: vec![
            RouteSpec {
                method: "GET".into(),
                path: "/chat".into(),
            },
            RouteSpec {
                method: "POST".into(),
                path: "/chat".into(),
            },
        ],
        slots: vec![],
        section: None,
        schema: DataSchema {
            kv_prefix: "mod/chat/".into(),
            version: 1,
        },
        tier: Tier::T0Rust,
        tests: vec![],
    }
}

/// Named ONLY from `dispatch::builtin_entry` (ADR-004).
pub(crate) fn chat(req: &Request, ctx: &mut Ctx) -> Response {
    let who = match req.header("x-agent").unwrap_or_default() {
        "" => ctx.me.clone(),
        named => named.to_string(),
    };
    if !ctx.agents.iter().any(|s| s.name == who) && !ctx.agents.is_empty() {
        return error_fragment(404, &format!("chat: no agent called '{who}' is loaded"));
    }
    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/chat") => transcript(ctx, &who, None),
        ("POST", "/chat") => submit(req, ctx, &who),
        _ => error_fragment(404, "chat: unknown subroute"),
    }
}

/// Start a turn: the utterance becomes a fact ADDRESSED TO ONE AGENT, and the
/// answer to THIS request is that agent's transcript with it already in place.
/// `ctx.emit` is drained by the dispatcher after this returns, so the new
/// message is passed in rather than read back out of `recent`.
fn submit(req: &Request, ctx: &mut Ctx, who: &str) -> Response {
    let Some(message) = form_value(&req.body, "message").filter(|m| !m.trim().is_empty()) else {
        return error_fragment(400, "chat: empty message");
    };
    // Empty means "this process's own agent": every log written before
    // per-agent chat says exactly that, and still reads correctly.
    let agent = match who == ctx.me {
        true => String::new(),
        false => who.to_string(),
    };
    match ctx.emit.as_mut() {
        Some(buf) => buf.push(EventKind::UserMessage {
            text: message.clone(),
            agent,
            from: String::new(), // a person typed it
        }),
        None => return error_fragment(500, "chat: Emit capability not granted"),
    }
    transcript(ctx, who, Some(&message))
}

