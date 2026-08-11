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
        ("GET", "/terminal") => typeable(html(200, panel(ctx, &who)), ctx, &who),
        ("POST", "/terminal") => run(req, ctx, &who),
        _ => error_fragment(404, "terminal: unknown subroute"),
    }
}

/// Whether a command typed here would run in the workspace this pane NAMES.
/// It runs in this process's agent's space and nowhere else, so with anyone
/// else selected the box is main's shell wearing another agent's label — it
/// executed in main's space while the prose described the other's, and it was
/// live even for an agent the same pane said cannot run commands (11b walk).
fn can_type(ctx: &Ctx, who: &str) -> bool {
    who == ctx.me && ctx.space.is_some()
}

/// The same answer as a header, so the pane can disable the box without
/// parsing its own fragment (the rule `x-turn` and `x-busy` already follow).
fn typeable(mut response: Response, ctx: &Ctx, who: &str) -> Response {
    let flag = match can_type(ctx, who) {
        true => "1",
        false => "0",
    };
    response.headers.push(("x-typeable".into(), flag.into()));
    response
}

/// Queue one typed command. It leaves as a fact and runs in the async half —
/// the answer to THIS request is the pane with the command already in it, so
/// nothing appears to have been swallowed while the VM boots.
fn run(req: &Request, ctx: &mut Ctx, who: &str) -> Response {
    let Some(command) = form_value(&req.body, "command").filter(|c| !c.trim().is_empty()) else {
        return error_fragment(400, "terminal: empty command");
    };
    // Only the foreign-agent case is refused here. An agent of this page's own
    // with no space is refused by the workspace GATE, which names the missing
    // `space: <name>` and leaves the refusal in the scrollback where the person
    // typing can read it — a better answer than this one.
    if who != ctx.me {
        return error_fragment(400, &refusal(ctx, who));
    }
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
    typeable(response, ctx, who)
}

/// Why this box cannot take a command, in the words that name the way round.
fn refusal(ctx: &Ctx, who: &str) -> String {
    match who == ctx.me {
        true => format!("{who} names no space, so it has no workspace to run a command in."),
        false => format!(
            "A command typed here runs in {}'s workspace, not {who}'s — {who} runs its own              commands in its own Worker. Select {} to type one, or ask {who} in the chat.",
            ctx.me, ctx.me
        ),
    }
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
    // And AFTER it: the shell output is the signal, the note is its footnote,
    // and the footnote was three times the size of the thing it annotated
    // (12b walk, finding D2).
    format!(
        "{}{}",
        list.attr("data-commands", &count.to_string())
            .build()
            .into_html(),
        note(ctx, who).into_html()
    )
}
