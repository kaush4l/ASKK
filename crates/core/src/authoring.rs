//! The three routes that let a PERSON author an agent in the browser: write
//! one, delete one, and read one back as the file it is. The rule they serve —
//! precedence, the fold, installing without a reload — is `roster.rs`.
//!
//! Reached only from `agents::agents`, which is reached only from
//! `dispatch::builtin_entry` (ADR-004).

use kernel::{Request, Response};
use module::view::FragmentBuilder;

use crate::dispatch::{error_fragment, html, Ctx};
use crate::form::form_value;
use agent::AgentSpec;

use crate::roster::{AUTHORED, DELETED};

/// One authored record as the fact it is. Emitted, never written directly:
/// this route has `Emit` and nothing else, exactly like every other module.
fn record(ctx: &mut Ctx, kind: &str, payload_json: String) -> Result<(), Response> {
    match ctx.emit.as_mut() {
        Some(buf) => {
            buf.push(kernel::EventKind::Custom {
                kind: kind.into(),
                payload_json,
            });
            Ok(())
        }
        None => Err(error_fragment(500, "agents: Emit capability not granted")),
    }
}

fn said(message: &str) -> Response {
    html(
        200,
        FragmentBuilder::new("p")
            .class("pending")
            .attr("role", "status")
            .text(message)
            .build()
            .into_html(),
    )
}

/// `POST /agents` — write or replace an agent from a whole `agent.md`. The
/// text is parsed BEFORE it is recorded: a file that will not load is refused
/// here, where the person who typed it is looking, rather than becoming a
/// skipped agent and a line of small red text after the next reload.
pub(crate) fn write(req: &Request, ctx: &mut Ctx) -> Response {
    let text = form_value(&req.body, "text").unwrap_or_default();
    let hint = form_value(&req.body, "name").unwrap_or_default();
    let spec = match agent::parse_agent_file(hint.trim(), &text) {
        Ok(spec) => spec,
        Err(agent::AgentError::MalformedAgentFile { message, .. }) => {
            return error_fragment(400, &format!("This agent.md could not be read: {message}"))
        }
        Err(other) => {
            return error_fragment(400, &format!("This agent.md could not be read: {other:?}"))
        }
    };
    if !agent::usable_agent_name(&spec.name) {
        return error_fragment(
            400,
            &format!(
                "'{}' cannot be an agent name: it becomes a folder under public/agents/ when \
                 you export it. Letters, digits, - and _ only.",
                spec.name
            ),
        );
    }
    // Stored CANONICAL — what `render_agent_file` produces — so what is kept,
    // what is exported and what would round-trip through the parser are one
    // string that cannot drift apart.
    let payload =
        serde_json::to_string(&(spec.name.clone(), agent::render_agent_file(&spec))).unwrap_or_default();
    if let Err(refusal) = record(ctx, AUTHORED, payload) {
        return refusal;
    }
    said(&format!(
        "Saved {}. It is installed in this browser at the end of the current turn — no reload.",
        spec.name
    ))
}

/// `POST /agents/delete` — remove an authored record. A shipped agent cannot
/// be deleted from the browser, and says so: that file belongs to the deploy,
/// not to this browser. Deleting an authored OVERRIDE reverts to the shipped
/// file, which is what makes a live prompt edit undoable (I10).
pub(crate) fn delete(req: &Request, ctx: &mut Ctx) -> Response {
    let name = form_value(&req.body, "name")
        .unwrap_or_default()
        .trim()
        .to_string();
    if !ctx.authored.contains(&name) {
        return error_fragment(
            400,
            &format!(
                "{name} was not authored in this browser — it comes from this deploy's \
                 public/agents/ folder, so there is nothing here to remove."
            ),
        );
    }
    let payload = serde_json::to_string(&name).unwrap_or_default();
    if let Err(refusal) = record(ctx, DELETED, payload) {
        return refusal;
    }
    said(&format!(
        "Removed {name} from this browser. Its conversation is still in the log; writing an \
         agent of that name again picks it back up."
    ))
}

/// `GET /agents/file` — one agent as the `agent.md` it is, addressed by
/// `x-agent`. The body is the FILE, not a fragment: the editor and the export
/// need the text itself, and reading it back out of rendered HTML would be the
/// view-scraping this codebase refuses everywhere else. Same bytes for a
/// shipped agent and an authored one, which is what makes the export
/// droppable into `public/agents/` and the reverse true too (I9).
pub(crate) fn file(req: &Request, ctx: &Ctx) -> Response {
    let who = match req.header("x-agent").unwrap_or_default() {
        "" => ctx.me.as_str(),
        named => named,
    };
    let Some(spec) = ctx.agents.iter().find(|s| s.name == who) else {
        return error_fragment(404, &format!("No agent called '{who}' is loaded."));
    };
    Response {
        status: 200,
        headers: vec![
            ("content-type".into(), "text/markdown; charset=utf-8".into()),
            ("x-agent".into(), who.to_string()),
        ],
        body: agent::render_agent_file(spec),
    }
}

/// WHO wrote this agent, and what it can therefore do (increment 11). A model
/// can now author an agent that runs with real capabilities, so the page
/// states which agents are this browser's rather than leaving it to be
/// inferred — and states the grant honestly: the space IS the grant, `exec` is
/// an unrestricted shell, and the path check on `read_file` is legibility, not
/// containment. The VM is the sandbox.
pub(crate) fn origin_line(spec: &AgentSpec, mine: bool) -> String {
    let origin = match mine {
        true => "Authored in this browser".to_string(),
        false => format!("Shipped in this deploy, as public/agents/{}/agent.md", spec.name),
    };
    match agent::Space::named(&spec.space) {
        None => format!("{origin}. No space, so no workspace: it cannot run commands."),
        Some(space) => format!(
            "{origin}. Its space '{}' grants exec, read_file, write_file and list_files in {} \
             — exec is a full shell, so the path check on the other three is legibility rather \
             than containment: the Linux in this tab is the sandbox.",
            space.name,
            space.path()
        ),
    }
}
