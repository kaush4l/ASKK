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
use crate::fold::{belongs_to, driven, spent, tail};

/// What a stopped turn leaves on the transcript.
const STOPPED: &str = "You stopped waiting, so the turn ended here. A reply that arrives \
                       after this is in the log; anything you saved takes effect now.";

/// What an ABANDONED turn leaves on it. The log's shape says a question was
/// asked and never answered; nothing in this process is driving it, so it is
/// over — and saying "thinking…" about it locked the composer forever behind a
/// clock that could not tick (12 walk, finding 1).
pub(crate) const ORPHANED: &str = "That turn is not running any more — the page was reloaded while it \
                        was in flight, so nothing is driving it. Nothing was lost; ask again.";

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
    let mut tools = 0usize;
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
            // A tool result inside a TURN means another model call is coming,
            // and inside a turn `awaiting` is already true — so this arm has
            // nothing to set. It must not set it: a command a person typed
            // into the terminal is a `ToolInvoked` too, and asserting it here
            // left the chat pane saying "Sending…" with the composer disabled
            // for the rest of the session, over a turn nobody had started.
            //
            // It is COUNTED, though (see `tools` below). The pane's patience
            // is silence-based, and a transcript that renders nothing at all
            // for a tool call is silent through the exact workload this
            // product exists for — an `apk add`, a build — so the watcher
            // would call a working agent dead partway through it.
            EventKind::ToolInvoked { .. } => tools += 1,
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
                list = list.child(crate::told::agent_failure(payload_json, who, failures));
                (awaiting, count) = (false, count + 1);
            }
            // A background summarisation that failed. It is NOT this turn's
            // failure — the turn carried on with the full history — so it is
            // not a failure card and does not end the wait. Saying nothing at
            // all was the bug: one request went out, it was not the user's,
            // and the transcript showed their question failing (09 walk).
            EventKind::Custom { kind, payload_json } if kind == "core.compaction_failed" => {
                failures += 1;
                list = list.child(crate::failure::compaction_failed(payload_json, failures));
            }
            // The person pressed Stop waiting. The turn ended; nothing is
            // owed, so the pane must not keep saying "thinking…".
            EventKind::Custom { kind, .. } if kind == crate::chat::TURN_STOPPED => {
                list = list.child(msg("msg pending", "", STOPPED));
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
    let pending = awaiting && driven(ctx, who, appended.is_some());
    if let Some(tail) = tail(pending, awaiting, count, who) {
        list = list.child(tail);
    }
    // How many tool calls this conversation has behind it. The number is not
    // rendered — the tool trace is where a person reads them — but it CHANGES
    // when one lands, and a projection that changes is what tells the pane the
    // agent is still working.
    let body = format!(
        "{}{}",
        crate::identity::header(ctx, who),
        list.attr("data-tools", &tools.to_string()).build().into_html()
    );
    let mut response = html(200, body);
    // WHO this conversation is with, as a header rather than a sentence in the
    // body: the pane must be able to title itself without parsing the fragment
    // or leaning on an editable `description` line (`ux-walker`, increment 03).
    response.headers.push(("x-agent".into(), who.to_string()));
    // What this page has spent, as a header on a projection the pane already
    // polls every 400 ms. A meter is the one thing present in the permanent
    // chrome of every console with a real agent behind it, and VIEWS.md §6
    // names its absence "the tell for a console built by someone who does not
    // run agents" — but it does not earn a route of its own or a second clock,
    // so it rides here. Every agent's spend, not this one's: the number in the
    // frame is the page's, and a per-agent breakdown is the Trace view's job.
    response.headers.push(("x-tokens".into(), spent(ctx).to_string()));
    if pending {
        response.headers.push(("x-turn".into(), "pending".into()));
    }
    response
}
