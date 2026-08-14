//! `Terminal` — the Alpine workspace, watchable (plan, "UI shape": the one
//! component with no Python counterpart). It shows every command run in this
//! agent's workspace and what came back, and lets a PERSON run one.
//!
//! It is a projection of the `ToolInvoked` facts (I8), so a command the agent
//! ran and a command you typed appear in the same list — each saying which it
//! was — and both survive a reload. Typing one emits a fact and runs through
//! `WorkspacePort` in the async half: the seam is synchronous by design.

use kernel::{CapabilityId, EventKind, ModuleId, Request, Response, Version};
use module::{DataSchema, Manifest, RouteSpec, Tier};

use crate::dispatch::{error_fragment, html, Ctx};
use crate::form::form_value;

/// The fact a typed command becomes. Its own kind, so the transcript never
/// mistakes a command for something a person said to the agent.
pub(crate) const EXEC_REQUEST: &str = "core.exec_request";

/// A press on Stop. Its own fact for the same reason `EXEC_REQUEST` is one: the
/// press is synchronous and the interrupt is not, so what the person did is
/// recorded where a projection can see it and the runtime does it after (R11-1b).
pub(crate) const STOP_REQUEST: &str = "core.stop_request";

/// …and a stop the engine could not deliver. Recorded rather than swallowed:
/// pressing a button and being told nothing is the shape of this whole finding.
pub(crate) const STOP_FAILED: &str = "core.stop_failed";

pub(crate) fn manifest() -> Manifest {
    Manifest {
        id: ModuleId("terminal".into()),
        name: "Terminal".into(),
        version: Version(1),
        description: "The folder's shell: what has been run in it, and a prompt.".into(),
        // Clock, because an in-flight command's AGE is the fact this pane was
        // missing (R11-1a): `Running…` read the same at four seconds and at
        // seven minutes. Injected, never read (I7).
        capabilities: vec![CapabilityId::Clock, CapabilityId::Emit, CapabilityId::Workspace],
        routes: vec![
            RouteSpec {
                method: "GET".into(),
                path: "/terminal".into(),
            },
            RouteSpec {
                method: "POST".into(),
                path: "/terminal".into(),
            },
            RouteSpec {
                method: "POST".into(),
                path: "/terminal/stop".into(),
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
    // WHOSE workspace (10 walk, finding 3): the one per-agent read that took no
    // `x-agent`, so it described another agent's space under summarizer's name.
    let who = match req.header("x-agent").unwrap_or_default() {
        "" => ctx.me.clone(),
        named => named.to_string(),
    };
    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/terminal") => typeable(html(200, crate::scrollpanel::panel(ctx, &who)), ctx, &who),
        ("POST", "/terminal") => run(req, ctx, &who),
        ("POST", "/terminal/stop") => stop(ctx, &who),
        _ => error_fragment(404, "terminal: unknown subroute"),
    }
}

/// Whether a command typed here would run in the workspace this pane NAMES. It
/// runs in this process's agent's space and nowhere else, so with anyone else
/// selected the box was main's shell wearing another agent's label (11b walk).
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
    // …and, when it is "0", WHY — on a header for the same reason the flag is
    // on one (R16-P1-3).
    if let Some(why) = crate::scrollpanel::no_box_why(ctx, who) {
        response.headers.push(("x-typeable-why".into(), why));
    }
    // WHAT A STOP WOULD DO HERE, so the pane can label one control with two
    // different promises (R11-1b). A fact on a header rather than a fragment to
    // parse — the rule `x-turn`, `x-busy` and `x-typeable` already follow.
    response.headers.push((
        "x-interrupt".into(),
        match ctx.interrupt {
            kernel::Interrupt::Kill => "kill",
            kernel::Interrupt::Abandon => "abandon",
            kernel::Interrupt::None => "none",
        }
        .into(),
    ));
    response
}

/// Queue one typed command. It leaves as a fact and runs in the async half; the
/// answer to THIS request is the pane with the command already in it, so
/// nothing appears swallowed while the VM boots.
fn run(req: &Request, ctx: &mut Ctx, who: &str) -> Response {
    let Some(command) = form_value(&req.body, "command").filter(|c| !c.trim().is_empty()) else {
        return error_fragment(400, "terminal: empty command");
    };
    // Only the foreign-agent case is refused here. An agent of this page's own
    // with no space is refused by the workspace GATE, which names the missing
    // `space: <name>` in the scrollback where the person typing can read it.
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
    // The request is in `ctx.emit`, not yet in the log or in `App::running`, so
    // this answer carries the pending line; later GETs project it (R2-8).
    let mut response = html(200, crate::scrollpanel::panel_with(ctx, who, Some(&command)));
    response.headers.push(("x-running".into(), "1".into()));
    typeable(response, ctx, who)
}

/// END THE COMMAND THAT IS RUNNING (R11-1b). The press leaves as a fact and the
/// interrupt happens in the async half, exactly as a typed command does; the
/// answer to THIS request is the pane, so the row that was running is already
/// wearing whatever the engine could do about it by the next projection.
fn stop(ctx: &mut Ctx, who: &str) -> Response {
    if who != ctx.me {
        return error_fragment(400, &refusal(ctx, who));
    }
    if ctx.calling.is_empty() && ctx.running.is_empty() {
        return error_fragment(400, "Nothing is running in the Linux to stop.");
    }
    match ctx.emit.as_mut() {
        Some(buf) => buf.push(EventKind::Custom {
            kind: STOP_REQUEST.into(),
            payload_json: "null".into(),
        }),
        None => return error_fragment(500, "terminal: Emit capability not granted"),
    }
    typeable(html(200, crate::scrollpanel::panel(ctx, who)), ctx, who)
}

/// Why this box cannot take a command, in the words that name the way round.
fn refusal(ctx: &Ctx, who: &str) -> String {
    match who == ctx.me {
        true => format!("{who} is in no space, so it has no folder to run a command in."),
        // (…and the literal fourteen spaces it carried mid-word are gone.)
        false => format!(
            "A command typed here runs in {me}'s folder, not {who}'s — {who} runs its own \
             commands separately from this page. Select {me} to type one, or ask {who} in \
             the chat.",
            me = ctx.me
        ),
    }
}
