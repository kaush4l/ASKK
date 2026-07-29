//! The G4 built-in modules: manifests (registered at boot through the one
//! install path, ADR-004) and their tier-0 handlers (named ONLY from
//! `dispatch::builtin_entry`). Fragments are composed exclusively through
//! the escaping view primitives — no raw HTML strings.

use kernel::{CapabilityId, EventKind, ModuleId, Request, Response, Version};
use module::view::{Fragment, FragmentBuilder};
use module::{DataSchema, Manifest, RouteSpec, SlotSpec, Tier};

use crate::dispatch::{error_fragment, html, Ctx};
use crate::form::form_value;

/// Everything boot installs. Order is install order (and thus event order).
pub(crate) fn manifests() -> Vec<Manifest> {
    vec![
        Manifest {
            id: ModuleId("dashboard".into()),
            name: "Dashboard".into(),
            version: Version(1),
            description: "The root page: composes slotted panels and the chat box.".into(),
            capabilities: vec![CapabilityId::Emit],
            routes: vec![
                route("GET", "/"),
                route("POST", "/chat"),
                route("GET", "/chat/poll"),
            ],
            slots: vec![],
            section: None,
            schema: DataSchema {
                kv_prefix: "mod/dashboard/".into(),
                version: 1,
            },
            tier: Tier::T0Rust,
            tests: vec![],
        },
        Manifest {
            id: ModuleId("status".into()),
            name: "Status".into(),
            version: Version(1),
            description: "One panel: what is running, when, how many facts.".into(),
            capabilities: vec![CapabilityId::Clock],
            routes: vec![route("GET", "/panels/status")],
            slots: vec![SlotSpec {
                slot: "main".into(),
                order: 0,
            }],
            section: None,
            schema: DataSchema {
                kv_prefix: "mod/status/".into(),
                version: 1,
            },
            tier: Tier::T0Rust,
            tests: vec![],
        },
    ]
}

fn route(method: &str, path: &str) -> RouteSpec {
    RouteSpec {
        method: method.into(),
        path: path.into(),
    }
}

/// The status panel (the one slotted panel of the walking skeleton).
pub(crate) fn status(_req: &Request, ctx: &mut Ctx) -> Response {
    let p = |text: &str| FragmentBuilder::new("p").text(text).build();
    let clock = ctx
        .clock
        .map(|t| format!("clock: {} ms since epoch", t.0))
        .unwrap_or_else(|| "clock: not granted".into());
    let panel = FragmentBuilder::new("div")
        .id("panel-status")
        .class("panel")
        .child(FragmentBuilder::new("h3").text("Status").build())
        .child(p("HARNESS v0.1.0 — walking skeleton"))
        .child(p(&clock))
        .child(p(&format!("facts in the log: {}", ctx.recent.len())))
        .build();
    html(200, panel.into_html())
}

/// The dashboard module: root composition, chat submit, chat poll.
pub(crate) fn dashboard(req: &Request, ctx: &mut Ctx) -> Response {
    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/") => root(ctx),
        ("POST", "/chat") => chat_submit(req, ctx),
        ("GET", "/chat/poll") => chat_poll(ctx),
        _ => error_fragment(404, "dashboard: unknown subroute"),
    }
}

fn root(ctx: &mut Ctx) -> Response {
    let mut panels = FragmentBuilder::new("div").id("panels");
    for path in &ctx.panels {
        panels = panels.child(
            FragmentBuilder::new("div")
                .hx_get(path)
                .hx_trigger("load")
                .text("loading panel…")
                .build(),
        );
    }
    let chat = FragmentBuilder::new("div")
        .id("chat")
        .child(FragmentBuilder::new("div").id("chat-log").build())
        .child(
            FragmentBuilder::new("form")
                .hx_post("/chat")
                .hx_target("#chat-log")
                .hx_swap("beforeend")
                .child(
                    FragmentBuilder::new("input")
                        .attr("type", "text")
                        .attr("name", "message")
                        .attr("placeholder", "Say something…")
                        .attr("autocomplete", "off")
                        .build(),
                )
                .child(
                    FragmentBuilder::new("button")
                        .attr("type", "submit")
                        .text("Send")
                        .build(),
                )
                .build(),
        )
        .build();
    let page = FragmentBuilder::new("div")
        .id("dashboard")
        .child(FragmentBuilder::new("h1").text("HARNESS").build())
        .child(panels.build())
        .child(chat)
        .build();
    html(200, page.into_html())
}

/// The self-replacing poll placeholder — ADR-002's core-driven chaining: the
/// core decides continuation; no JS pump exists.
fn poll_placeholder() -> Fragment {
    FragmentBuilder::new("div")
        .class("msg pending")
        .hx_get("/chat/poll")
        .hx_trigger("load delay:400ms")
        .hx_swap("outerHTML")
        .text("thinking…")
        .build()
}

fn msg(class: &str, text: &str) -> Fragment {
    FragmentBuilder::new("div").class(class).text(text).build()
}

fn chat_submit(req: &Request, ctx: &mut Ctx) -> Response {
    let Some(message) = form_value(&req.body, "message").filter(|m| !m.trim().is_empty()) else {
        return error_fragment(400, "chat: empty message");
    };
    match ctx.emit.as_mut() {
        Some(buf) => buf.push(EventKind::UserMessage {
            text: message.clone(),
        }),
        None => return error_fragment(500, "chat: Emit capability not granted"),
    }
    let fragment = FragmentBuilder::new("div")
        .child(msg("msg user", &message))
        .child(poll_placeholder())
        .build();
    html(200, fragment.into_html())
}

/// Render the outcome of the turn after the LAST user message: the reply, a
/// typed error (honest, never a faked reply), or keep polling.
fn chat_poll(ctx: &mut Ctx) -> Response {
    let last_user = ctx
        .recent
        .iter()
        .rposition(|k| matches!(k, EventKind::UserMessage { .. }));
    let Some(idx) = last_user else {
        return html(200, msg("msg error", "no turn in progress").into_html());
    };
    for kind in &ctx.recent[idx + 1..] {
        match kind {
            EventKind::ModelReplied { text } => {
                return html(200, msg("msg assistant", text).into_html());
            }
            EventKind::Custom { kind, payload_json } if kind == "core.error" => {
                return html(
                    200,
                    msg("msg error", &format!("turn failed: {payload_json}")).into_html(),
                );
            }
            _ => {}
        }
    }
    html(200, poll_placeholder().into_html())
}
