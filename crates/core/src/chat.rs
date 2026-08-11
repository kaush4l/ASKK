//! The chat module: one agent's conversation, rendered as a projection of
//! the event log (I8), plus the one route that starts a turn.
//!
//! Its own file because the UI's `ChatPane` owns exactly this concept (plan,
//! "UI shape") while the dashboard owns page composition. The transcript is
//! computed from `ctx.recent` on every request and stored nowhere: reload the
//! page and the same fold over the replayed log produces the same screen.

use kernel::{CapabilityId, EventKind, ModuleId, Request, Response, Version};
use module::view::{Fragment, FragmentBuilder};
use module::{DataSchema, Manifest, RouteSpec, Tier};

use crate::dispatch::{error_fragment, html, Ctx};
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
    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/chat") => transcript(ctx, None),
        ("POST", "/chat") => submit(req, ctx),
        _ => error_fragment(404, "chat: unknown subroute"),
    }
}

fn msg(class: &str, text: &str) -> Fragment {
    FragmentBuilder::new("div").class(class).text(text).build()
}

/// Start a turn: the utterance becomes a fact, and the answer to THIS request
/// is the transcript with it already in place. `ctx.emit` is drained by the
/// dispatcher after this returns, so the new message is passed in rather than
/// read back out of `recent`.
fn submit(req: &Request, ctx: &mut Ctx) -> Response {
    let Some(message) = form_value(&req.body, "message").filter(|m| !m.trim().is_empty()) else {
        return error_fragment(400, "chat: empty message");
    };
    match ctx.emit.as_mut() {
        Some(buf) => buf.push(EventKind::UserMessage {
            text: message.clone(),
        }),
        None => return error_fragment(500, "chat: Emit capability not granted"),
    }
    transcript(ctx, Some(&message))
}

/// The whole conversation, in log order. A turn is in flight when the last
/// message-shaped fact is a `UserMessage` — that is also the `x-turn: pending`
/// header, which is how the UI knows to keep watching without parsing HTML.
fn transcript(ctx: &Ctx, appended: Option<&str>) -> Response {
    let mut list = FragmentBuilder::new("div")
        .id("chat-log")
        .attr("role", "log")
        .attr("aria-live", "polite");
    let mut awaiting = false;
    let mut count = 0usize;
    for kind in &ctx.recent {
        match kind {
            EventKind::UserMessage { text } => {
                list = list.child(msg("msg user", text));
                (awaiting, count) = (true, count + 1);
            }
            EventKind::ModelReplied { text } => {
                list = list.child(msg("msg assistant", text));
                (awaiting, count) = (false, count + 1);
            }
            EventKind::Custom { kind, payload_json } if kind == "core.error" => {
                list = list.child(msg("msg error", &failure_line(payload_json)));
                (awaiting, count) = (false, count + 1);
            }
            _ => {}
        }
    }
    if let Some(text) = appended {
        list = list.child(msg("msg user", text));
        (awaiting, count) = (true, count + 1);
    }
    if awaiting {
        list = list.child(msg("msg pending", "thinking…"));
    } else if count == 0 {
        list = list.child(msg("msg pending", "No messages yet — ask the agent something."));
    }
    let mut response = html(200, list.build().into_html());
    if awaiting {
        response.headers.push(("x-turn".into(), "pending".into()));
    }
    response
}

/// A failed turn, said plainly. The typed error is shown verbatim (never a
/// faked reply), and the one cause that actually bites in a browser — an
/// endpoint the page cannot reach — names its own fix.
fn failure_line(payload_json: &str) -> String {
    let hint = if payload_json.contains("Transport") {
        " — the model endpoint could not be reached. Check the endpoint in Settings: \
         it must send CORS headers, and Chrome 142+ asks permission before a page \
         may call a local address."
    } else {
        ""
    };
    format!("turn failed: {payload_json}{hint}")
}
