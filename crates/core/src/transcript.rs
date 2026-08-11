//! One agent's conversation, folded out of the event log. Split from
//! `chat.rs` (which owns the module and the route) so both hold the 200-line
//! rule (I12): this file is the projection, and nothing else.
//!
//! Nothing outside the named agent's conversation is ever projected — a
//! message to `researcher` cannot appear in `main`'s transcript because the
//! fold never reaches it (increment 07).

use kernel::{EventKind, Response};
use module::view::{Fragment, FragmentBuilder};

use crate::dispatch::{html, Ctx};
use crate::failure::failure;

/// One message, with WHO SAID IT in words. The speaker used to be carried by
/// the class alone, so with the stylesheet off a question and its answer were
/// two identical paragraphs (`ux-walker`, increment 06) — the same reasoning
/// that put the word "refused" beside the colour in the tool trace.
pub(crate) fn msg(class: &str, speaker: &str, text: &str) -> Fragment {
    let mut row = FragmentBuilder::new("div").class(class);
    if !speaker.is_empty() {
        row = row.child(
            FragmentBuilder::new("span")
                .class("speaker")
                .text(&format!("{speaker}: "))
                .build(),
        );
    }
    row.child(FragmentBuilder::new("span").class("said").text(text).build())
        .build()
}

/// Which conversation one fact belongs to. Tool calls, notes and errors happen
/// inside THIS process's loop, so they belong to its own agent; a message or a
/// reply carries its own name, and an empty one means the same thing.
fn belongs_to(kind: &EventKind, me: &str, who: &str) -> bool {
    let named = |agent: &str| match agent.is_empty() {
        true => who == me,
        false => who == agent,
    };
    match kind {
        EventKind::UserMessage { agent, .. } | EventKind::ModelReplied { agent, .. } => {
            named(agent)
        }
        EventKind::ToolInvoked { .. } => who == me,
        EventKind::Custom { kind, payload_json } => match kind.as_str() {
            "core.note" | "core.error" => who == me,
            "core.agent_error" => crate::failure::agent_of(payload_json) == who,
            _ => false,
        },
        _ => false,
    }
}

/// The whole conversation with ONE agent, in log order. A turn is in flight
/// when the last message-shaped fact is a `UserMessage` — that is also the
/// `x-turn: pending` header, which is how the UI knows to keep watching
/// without parsing HTML.
pub(crate) fn transcript(ctx: &Ctx, who: &str, appended: Option<&str>) -> Response {
    let mut list = FragmentBuilder::new("div")
        .id("chat-log")
        .attr("role", "log")
        .attr("aria-live", "polite");
    let (mut awaiting, mut count, mut failures) = (false, 0usize, 0usize);
    for kind in ctx.recent.iter().filter(|k| belongs_to(k, &ctx.me, who)) {
        match kind {
            EventKind::UserMessage { text, from, .. } => {
                let said_by = match from.is_empty() {
                    true => "You",
                    false => from.as_str(),
                };
                list = list.child(msg("msg user", said_by, text));
                (awaiting, count) = (true, count + 1);
            }
            // A reply that CALLS tools has not answered anything: the turn is
            // still running, and the pane must keep watching (the trace panel
            // owns what was called).
            EventKind::ModelReplied { text, .. } if agent::has_calls(text) => {
                list = list.child(msg("msg tool", who, "calling tools — see the tool trace below"));
                (awaiting, count) = (true, count + 1);
            }
            EventKind::ModelReplied { text, .. } => {
                list = list.child(msg("msg assistant", who, text));
                (awaiting, count) = (false, count + 1);
            }
            // A tool result means another model call is coming.
            EventKind::ToolInvoked { .. } => awaiting = true,
            // The machine's own word to the user (the tool loop gave up).
            EventKind::Custom { kind, payload_json } if kind == "core.note" => {
                let note = serde_json::from_str::<String>(payload_json)
                    .unwrap_or_else(|_| payload_json.clone());
                list = list.child(msg("msg pending", "", &note));
                (awaiting, count) = (false, count + 1);
            }
            // The same card as a failure on this page's own agent: one failure,
            // one presentation, and the cause reachable from either.
            EventKind::Custom { kind, payload_json } if kind == "core.agent_error" => {
                failures += 1;
                list = list.child(crate::failure::agent_failure(payload_json, who, failures));
                (awaiting, count) = (false, count + 1);
            }
            EventKind::Custom { kind, payload_json } if kind == "core.error" => {
                failures += 1;
                list = list.child(failure(payload_json, failures));
                (awaiting, count) = (false, count + 1);
            }
            _ => {}
        }
    }
    if let Some(text) = appended {
        list = list.child(msg("msg user", "You", text));
        (awaiting, count) = (true, count + 1);
    }
    if awaiting {
        list = list.child(msg("msg pending", "", "thinking…"));
    } else if count == 0 {
        list = list.child(msg("msg pending", "", &format!("No messages yet — ask {who} something.")));
    }
    let body = format!("{}{}", header(ctx, who), list.build().into_html());
    let mut response = html(200, body);
    // WHO this conversation is with, as a header rather than a sentence in the
    // body: the pane must be able to title itself without parsing the fragment
    // or leaning on an editable `description` line (`ux-walker`, increment 03).
    response.headers.push(("x-agent".into(), who.to_string()));
    if awaiting {
        response.headers.push(("x-turn".into(), "pending".into()));
    }
    response
}

/// Whose conversation this is, as `public/agents/<who>/agent.md` declares it.
/// The MODEL is deliberately absent: this file knows what the agent file asked
/// for, not what Settings overrode it with, and printing "(model: local)" while
/// the next turn calls openrouter is a lie the pane told for a whole increment.
fn header(ctx: &Ctx, who: &str) -> String {
    let Some(spec) = ctx.agents.iter().find(|s| s.name == who) else {
        return FragmentBuilder::new("p")
            .class("agent-header pending")
            .text(&format!("No agent called {who} is loaded."))
            .build()
            .into_html();
    };
    let line = FragmentBuilder::new("p")
        .class("agent-header")
        .attr("data-agent", &spec.name)
        .text(&format!("{} — {}", spec.name, spec.description))
        .build()
        .into_html();
    format!("{line}{}", memory(ctx, who))
}

/// What this agent still HOLDS, which after a compaction is not what is on
/// screen: the transcript keeps every turn, the window keeps a summary and the
/// tail. Rendered only for this process's own agent — another agent's window
/// lives in its own Worker, and guessing at it would be a made-up number.
fn memory(ctx: &Ctx, who: &str) -> String {
    if who != ctx.me {
        return String::new();
    }
    let compacted = ctx
        .window
        .first()
        .is_some_and(|line| line.contains(agent::SUMMARY_HEADING));
    let said = match compacted {
        true => "the oldest turns are now a summary the summarizer wrote",
        false => "every turn, in full",
    };
    FragmentBuilder::new("p")
        .class("agent-memory")
        .attr("data-window", &ctx.window.len().to_string())
        .attr("data-compacted", &compacted.to_string())
        .text(&format!(
            "Working memory: {} {} — {said}.",
            ctx.window.len(),
            match ctx.window.len() {
                1 => "entry",
                _ => "entries",
            }
        ))
        .build()
        .into_html()
}
