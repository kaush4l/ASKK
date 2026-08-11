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
use crate::failure::failure;
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
            // A reply that CALLS tools has not answered anything: the turn is
            // still running, and the pane must keep watching (the trace panel
            // owns what was called).
            EventKind::ModelReplied { text } if agent::has_calls(text) => {
                list = list.child(msg("msg tool", "calling tools — see the tool trace below"));
                (awaiting, count) = (true, count + 1);
            }
            EventKind::ModelReplied { text } => {
                list = list.child(msg("msg assistant", text));
                (awaiting, count) = (false, count + 1);
            }
            // A tool result means another model call is coming.
            EventKind::ToolInvoked { .. } => awaiting = true,
            // The machine's own word to the user (the tool loop gave up).
            EventKind::Custom { kind, payload_json } if kind == "core.note" => {
                let note = serde_json::from_str::<String>(payload_json)
                    .unwrap_or_else(|_| payload_json.clone());
                list = list.child(msg("msg pending", &note));
                (awaiting, count) = (false, count + 1);
            }
            EventKind::Custom { kind, payload_json } if kind == "core.error" => {
                list = list.child(failure(payload_json));
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
    let mut response = html(200, format!("{}{}", agent_header(ctx), list.build().into_html()));
    // WHO this conversation is with, as a header rather than a sentence in the
    // body: the pane must be able to title itself without parsing the fragment
    // or leaning on an editable `description` line (`ux-walker`, increment 03).
    if let Some(spec) = ctx.agents.iter().find(|s| s.name == "main") {
        response.headers.push(("x-agent".into(), spec.name.clone()));
    }
    if awaiting {
        response.headers.push(("x-turn".into(), "pending".into()));
    }
    response
}

/// Whose conversation this is: the `main` agent as `public/agents/main/agent.md`
/// declares it. Rendered from the loaded spec, so an edited file changes what
/// this says — the pane is the agent, not a generic box.
fn agent_header(ctx: &Ctx) -> String {
    let Some(spec) = ctx.agents.iter().find(|s| s.name == "main") else {
        return FragmentBuilder::new("p")
            .class("agent-header pending")
            .text("No main agent loaded — public/agents/main/agent.md did not load.")
            .build()
            .into_html();
    };
    // The MODEL is deliberately absent here: this file knows what the agent
    // file asked for, not what Settings overrode it with, and printing
    // "(model: local)" while the next turn calls openrouter is a lie the pane
    // told for a whole increment (`ux-walker`). The UI reads the broker and
    // renders the effective endpoint beside this line.
    FragmentBuilder::new("p")
        .class("agent-header")
        .attr("data-agent", &spec.name)
        .text(&format!("{} — {}", spec.name, spec.description))
        .build()
        .into_html()
}

