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
use module::view::FragmentBuilder;
use module::{DataSchema, Manifest, RouteSpec, Tier};

use crate::dispatch::{error_fragment, html, Ctx};
use crate::form::form_value;
use crate::scrollback::{command_of, echoed, note, ran, ran_count};

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
    // WHOSE workspace (10 walk, finding 3): this was the one per-agent read
    // that took no `x-agent`, so with `summarizer` selected the pane said "the
    // agents in this space build here" directly beneath a space pane saying
    // summarizer works alone.
    let who = match req.header("x-agent").unwrap_or_default() {
        "" => ctx.me.clone(),
        named => named.to_string(),
    };
    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/terminal") => html(200, panel(ctx, &who)),
        ("POST", "/terminal") => run(req, ctx, &who),
        _ => error_fragment(404, "terminal: unknown subroute"),
    }
}

/// Queue one typed command. It leaves as a fact and runs in the async half —
/// the answer to THIS request is the pane with the command already in it, so
/// nothing appears to have been swallowed while the VM boots.
fn run(req: &Request, ctx: &mut Ctx, who: &str) -> Response {
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
    let before = ran_count(ctx);
    let mut response = html(
        200,
        format!("{}{}", panel(ctx, who), echoed(&command, before).into_html()),
    );
    response.headers.push(("x-running".into(), "1".into()));
    response
}

/// The whole scrollback: every `exec` this page's agent has run, in log order.
fn panel(ctx: &Ctx, who: &str) -> String {
    let mut list = FragmentBuilder::new("div")
        .id("terminal")
        .attr("data-agent", who)
        .attr(
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
    // The note stays OUTSIDE `#terminal`: that element is the scroller, and it
    // is scrolled to the newest output, so anything inside it scrolls away.
    format!(
        "{}{}",
        note(ctx, who).into_html(),
        list.attr("data-commands", &count.to_string())
            .build()
            .into_html()
    )
}
