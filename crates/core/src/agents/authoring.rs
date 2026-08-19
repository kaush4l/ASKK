//! The three routes that let a PERSON author an agent in the browser: write
//! one, delete one, and read one back as the file it is. The rule they serve —
//! precedence, the fold, installing without a reload — is `agents/roster.rs`.
//!
//! Reached only from `agents::agents`, which is reached only from
//! `dispatch::builtin_entry` (ADR-004).

use kernel::{Request, Response};
use module::view::FragmentBuilder;

use crate::dispatch::{error_fragment, html, Ctx};
use crate::builtins::form_value;
use agent::AgentSpec;

use crate::agents::authored::{AUTHORED, DELETED};

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

/// `POST /agents` — write or replace an agent from a whole `agent.md`. The text
/// is parsed BEFORE it is recorded: a file that will not load is refused where
/// the person who typed it is looking, not as red text after the next reload.
pub(crate) fn write(req: &Request, ctx: &mut Ctx) -> Response {
    let text = form_value(&req.body, "text").unwrap_or_default();
    let hint = form_value(&req.body, "name").unwrap_or_default();
    let hint = hint.trim();
    let spec = match agent::parse_agent_file(hint, &text) {
        Ok(spec) => spec,
        Err(agent::AgentError::MalformedAgentFile { message, .. }) => {
            return error_fragment(400, &format!("This agent.md could not be read: {message}"))
        }
        Err(other) => {
            return error_fragment(400, &format!("This agent.md could not be read: {other:?}"))
        }
    };
    if let Some(refusal) = misnamed(hint, &spec) {
        return refusal;
    }
    // Stored CANONICAL — what `render_agent_file` produces — so what is kept,
    // what is exported and what would round-trip through the parser are one
    // string that cannot drift apart. The author is empty: a PERSON typed this
    // form, and `write_agent` records the agent's own name there (11b walk).
    let payload =
        serde_json::to_string(&(spec.name.clone(), agent::render_agent_file(&spec), ""))
            .unwrap_or_default();
    // WHAT A SAVE OVER A SHIPPED NAME DID (R17-P1-7). The form arrives holding
    // an agent, so the commonest first save is a REPLACEMENT of a shipped one,
    // and the receipt said only "Saved main" — the same sentence a brand new
    // agent gets. The undo is `delete`, and this is the moment to say so.
    let replacing = replaces_shipped(ctx, &spec.name);
    // WHAT THE FILE ASKED FOR AND DID NOT GET (R18-P1-7). `tools: [nope_tool]`
    // saved with no word about it and the card then read `No tools` as a fact.
    // Said HERE because this is the moment the person is looking at the line
    // they typed; the card says it too, for everyone who arrives later.
    let dropped = dropped_tools(ctx, &spec);
    if let Err(refusal) = record(ctx, AUTHORED, payload) {
        return refusal;
    }
    match replacing {
        true => said(&format!(
            "Saved {0}.{dropped} It replaces the {0} shipped with this site for as long as this \
             browser keeps it — deleting it here brings the shipped one back. It is installed at \
             the end of the current turn — no reload.",
            spec.name
        )),
        false => said(&format!(
            "Saved {}.{dropped} It is installed in this browser at the end of the current turn \
             — no reload.",
            spec.name
        )),
    }
}

/// The `tools:` names nothing in this browser answers to, as a clause for the
/// receipt — empty when every name resolved. NOT a refusal: a name may be a
/// peer agent written a minute from now, and refusing would make the order you
/// type two agents in a rule about capability (`agent::unresolved_tools`).
fn dropped_tools(ctx: &Ctx, spec: &AgentSpec) -> String {
    let missing = agent::unresolved_tools(spec, &ctx.agents);
    match missing.is_empty() {
        true => String::new(),
        false => format!(
            " Nothing here is called {}, so {} has no such tool — check the spelling, or write \
             the agent of that name first.",
            missing.join(" or "),
            spec.name
        ),
    }
}

/// Is this name one the DEPLOY shipped, with nothing of this browser's already
/// standing in front of it? Both halves matter: re-saving your own edit of
/// `main` replaces your copy, not the shipped file, and saying otherwise twice
/// would be a warning that stops meaning anything.
pub(crate) fn replaces_shipped(ctx: &Ctx, name: &str) -> bool {
    ctx.agents.iter().any(|s| s.name == name) && !ctx.authored.iter().any(|(n, _)| n == name)
}

/// The two ways the name can be wrong. The field is not decoration: it is the
/// folder, and it is what an empty `name:` falls back to — so when both are
/// filled and they DISAGREE, neither may quietly win. Typing one name and
/// saving another is exactly what the field looked like it did nothing about
/// (11b walk).
fn misnamed(hint: &str, spec: &AgentSpec) -> Option<Response> {
    if !hint.is_empty() && hint != spec.name {
        return Some(error_fragment(
            400,
            &format!(
                "The folder name says '{hint}' but the frontmatter says name: {}. They must \
                 agree — change one, or clear the frontmatter's name: to use the folder.",
                spec.name
            ),
        ));
    }
    (!agent::usable_agent_name(&spec.name)).then(|| {
        error_fragment(
            400,
            &format!(
                "'{}' cannot be an agent name: it becomes a folder name when you export it. \
                 Letters, digits, - and _ only.",
                spec.name
            ),
        )
    })
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
    if !ctx.authored.iter().any(|(n, _)| *n == name) {
        return error_fragment(
            400,
            &format!(
                "{name} was not written here — it is shipped with this site, so there is \
                 nothing in this browser to remove."
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
/// view-scraping this codebase refuses everywhere else. Same bytes shipped or
/// authored, which is what makes the export droppable into `public/agents/` (I9).
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
