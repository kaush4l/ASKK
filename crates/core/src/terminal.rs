//! `Terminal` — the Alpine workspace, watchable (plan, "UI shape": the one
//! component with no Python counterpart). It shows every command run in this
//! agent's workspace and what came back, and it lets a PERSON run one.
//!
//! It is a projection of the `ToolInvoked` facts (I8), so a command the agent
//! ran and a command you typed appear in the same list, in the same order, and
//! are both still there after a reload. Typing one emits a fact and returns;
//! the command itself runs through `WorkspacePort` in the async half, exactly
//! like a model call, because the seam is synchronous by design.

use kernel::{CapabilityId, EventKind, ModuleId, Request, Response, Version};
use module::view::{Fragment, FragmentBuilder};
use module::{DataSchema, Manifest, RouteSpec, Tier};

use crate::dispatch::{error_fragment, html, Ctx};
use crate::form::form_value;

/// The fact a typed command becomes. Its own kind, so the transcript never
/// mistakes a command for something a person said to the agent.
pub(crate) const EXEC_REQUEST: &str = "core.exec_request";

pub(crate) fn manifest() -> Manifest {
    Manifest {
        id: ModuleId("terminal".into()),
        name: "Terminal".into(),
        version: Version(1),
        description: "The Linux workspace: what has been run in it, and a prompt.".into(),
        capabilities: vec![CapabilityId::Emit, CapabilityId::Workspace],
        routes: vec![
            RouteSpec {
                method: "GET".into(),
                path: "/terminal".into(),
            },
            RouteSpec {
                method: "POST".into(),
                path: "/terminal".into(),
            },
        ],
        slots: vec![],
        section: None,
        schema: DataSchema {
            kv_prefix: "mod/terminal/".into(),
            version: 1,
        },
        tier: Tier::T0Rust,
        tests: vec![],
    }
}

/// Named ONLY from `dispatch::builtin_entry` (ADR-004).
pub(crate) fn terminal(req: &Request, ctx: &mut Ctx) -> Response {
    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/terminal") => html(200, panel(ctx)),
        ("POST", "/terminal") => run(req, ctx),
        _ => error_fragment(404, "terminal: unknown subroute"),
    }
}

/// Queue one typed command. It leaves as a fact and runs in the async half —
/// the answer to THIS request is the pane with the command already in it, so
/// nothing appears to have been swallowed while the VM boots.
fn run(req: &Request, ctx: &mut Ctx) -> Response {
    let Some(command) = form_value(&req.body, "command").filter(|c| !c.trim().is_empty()) else {
        return error_fragment(400, "terminal: empty command");
    };
    match ctx.emit.as_mut() {
        Some(buf) => buf.push(EventKind::Custom {
            kind: EXEC_REQUEST.into(),
            payload_json: serde_json::to_string(&command).unwrap_or_default(),
        }),
        None => return error_fragment(500, "terminal: Emit capability not granted"),
    }
    let mut response = html(200, format!("{}{}", panel(ctx), echoed(&command).into_html()));
    response.headers.push(("x-running".into(), "1".into()));
    response
}

/// The command just typed, shown before it has run. Without it the pane would
/// look identical for however long the first boot takes.
fn echoed(command: &str) -> Fragment {
    FragmentBuilder::new("div")
        .class("term-run pending")
        .attr("role", "status")
        .child(prompt_line(command))
        .child(
            FragmentBuilder::new("pre")
                .text("running… the first command also boots the Linux, which takes a moment.")
                .build(),
        )
        .build()
}

/// The whole scrollback: every `exec` this agent has run, in log order.
fn panel(ctx: &Ctx) -> String {
    let mut list = FragmentBuilder::new("div").id("terminal").attr(
        "data-workspace",
        &ctx.space
            .as_ref()
            .map(|s| s.path())
            .unwrap_or_else(|| "none".into()),
    );
    let mut count = 0usize;
    for kind in &ctx.recent {
        if let EventKind::ToolInvoked { tool, args, ok, output } = kind {
            if tool.0 != "exec" {
                continue;
            }
            list = list.child(ran(&command_of(args), *ok, output));
            count += 1;
        }
    }
    if count == 0 {
        list = list.child(
            FragmentBuilder::new("p")
                .class("pending")
                .text(
                    "Nothing has been run yet. The Linux boots on the first command — it \
                     streams its disk, so the first one takes longer than the rest.",
                )
                .build(),
        );
    }
    list.attr("data-commands", &count.to_string())
        .build()
        .into_html()
}

/// The command out of the JSON the tool was called with; the raw arguments if
/// it was something else, because a trace that hides what was asked is not one.
fn command_of(args_json: &str) -> String {
    serde_json::from_str::<serde_json::Value>(args_json)
        .ok()
        .and_then(|v| Some(v.get("command")?.as_str()?.to_string()))
        .unwrap_or_else(|| args_json.to_string())
}

fn prompt_line(command: &str) -> Fragment {
    FragmentBuilder::new("p")
        .class("term-command")
        .child(FragmentBuilder::new("span").class("term-prompt").text("$ ").build())
        .child(FragmentBuilder::new("span").text(command).build())
        .build()
}

/// One finished command. The outcome is a WORD beside the colour, the same
/// rule the tool trace follows.
fn ran(command: &str, ok: bool, output: &str) -> Fragment {
    let word = match ok {
        true => "ok",
        false => "failed",
    };
    FragmentBuilder::new("div")
        .class(match ok {
            true => "term-run",
            false => "term-run error",
        })
        .attr("data-outcome", word)
        .child(prompt_line(command))
        .child(
            FragmentBuilder::new("pre")
                .attr("tabindex", "0")
                .attr("role", "region")
                .attr("aria-label", &format!("output of {command}"))
                .text(output)
                .build(),
        )
        .build()
}
