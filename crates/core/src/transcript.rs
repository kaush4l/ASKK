//! One agent's conversation, folded out of the event log. Split from `chat.rs`
//! (the module and the route) so both hold the 200-line rule (I12). Nothing
//! outside the named agent's conversation is projected (07), its log id too (§7).

use kernel::{EventKind, Response};
use module::view::FragmentBuilder;

use crate::dispatch::{html, Ctx};
use crate::failure::failure;
use crate::fold::{belongs_to, driven, msg, spent, tail};
use crate::{calls::Calls, repeat::Seen};

/// The whole conversation with ONE agent, in log order. A turn is in flight
/// when the last message-shaped fact is a `UserMessage` — also the `x-turn:
/// pending` header, so the UI watches without parsing HTML.
/// The one announcement a run of tool-calling replies leaves behind (R7-15).
fn announced(list: FragmentBuilder, calls: &mut Calls, who: &str, count: &mut usize) -> FragmentBuilder {
    let Some(one) = calls.take() else { return list };
    *count += 1;
    // `Calls::take` owns the tense (R16-P1-1): the run has ENDED by the time
    // this is written, so it reads `main called write_file`.
    list.child(msg("msg system", "", &format!("{who} {one}"), &[]))
}

pub(crate) fn transcript(ctx: &Ctx, who: &str, appended: Option<&str>) -> Response {
    let mut list = FragmentBuilder::new("div")
        .id(&format!("chat-log-{who}"))
        .attr("role", "log")
        .attr("aria-live", "polite");
    let (mut awaiting, mut count) = (false, 0usize);
    let mut tools = 0usize;
    // Every failure written out IN FULL, and what folded onto it (`repeat::Seen`).
    let mut said = Seen::default();
    let mut calls = Calls::default(); // one announcement per run (R7-15)
    // The last thing the PERSON said here. The pane could only remember what it
    // had sent itself, so a reload left a recovery with nothing to press (R3-5).
    let mut last_said = String::new();
    // What the workspace holds, so a file the agent NAMES can be opened from
    // the sentence that names it (R9-4).
    let files = crate::filerows::names(ctx);
    // WHICH of these messages were STEERS and not new turns (R18-P0-1), by log
    // position, off the `core.steered` fact `step` writes when it takes one.
    let steers = crate::steered::steers(ctx, who);
    // A CLEARED CONVERSATION STARTS LATER, not shorter (`clear::from`).
    for (nth, kind) in ctx.recent.iter().enumerate().skip(crate::clear::from(ctx, who)) {
        if !belongs_to(kind, &ctx.me, who) {
            continue;
        }
        // A run of announcements ends at the next fact that RENDERS: the
        // `ToolInvoked` facts between two rounds render nothing here, so they
        // do not break the run (R7-15).
        let quiet = matches!(kind, EventKind::ToolInvoked { .. })
            || matches!(kind, EventKind::ModelReplied { text, .. } if agent::has_calls(text));
        if !quiet {
            list = announced(list, &mut calls, who, &mut count);
        }
        match kind {
            // …AND WHAT THE PAGE SAYS ABOUT THE TURN IT LANDED IN is
            // `steered::said`'s, for both readers at once (R18-P0-1): a message
            // over an open turn was drawn as a turn a RELOAD had abandoned, and
            // a steer has exactly that shape.
            EventKind::UserMessage { text, from, .. } => {
                let open = awaiting.then(|| steers.contains(&nth));
                list = crate::steered::said(list, who, from, text, &files, open);
                if from.is_empty() {
                    last_said = text.clone();
                }
                count += 1;
            }
            // A reply that CALLS tools has not answered anything: the turn is
            // still running, and the pane must keep watching. The Tool trace
            // panel owns what was called — BESIDE this, never "below" (R3-17).
            // …AND WHICH ONES (R5-20): the names are parsed by this arm's own
            // guard, and gathered until the run of them ends (R7-15).
            EventKind::ModelReplied { text, .. } if agent::has_calls(text) => calls.push(text),
            // …AND A REPLY THAT IS MACHINE OUTPUT IS NOT AN ANSWER (R17-P0-2).
            // `exec({"command": "cat a.md"}, {"command": "cat b.md"}, …)` was
            // an `msg assistant` bubble in the agent's own name, with the
            // Dashboard's `Read the reply` button pointing at it. Which of the
            // two this is, is `ending::reply`'s to decide — the same predicate
            // `step` ended the turn by, so the bubble and the card agree.
            EventKind::ModelReplied { text, .. } => {
                list = list.child(crate::ending::reply(who, text, &files));
                count += 1;
            }
            // This arm sets NO wait: a command a person typed into the terminal
            // is a `ToolInvoked` too, and asserting `awaiting` here left the
            // composer disabled over a turn nobody had started. It is COUNTED —
            // the pane's patience is silence-based — and its OUTCOME goes to the
            // run's announcement (R9-3), which sat above a reply read as an
            // unqualified answer over a trace whose first row was red.
            // `Calls::note` only counts inside an open run, so a typed command
            // is never the agent's turn failing.
            EventKind::ToolInvoked { tool, args, ok, output } => {
                tools += 1;
                calls.note(&tool.0, args, *ok, output);
            }
            // HOW THE TURN ENDED, IN ONE ARM (R17-P0-2). The stop, the round
            // ceiling and the stopped wait were three arms with three wordings,
            // and a fourth ending — a turn that stopped without answering — had
            // no wording anywhere. Every sentence about an ending is
            // `ending::machine_note`'s, beside the fold the row and card read.
            EventKind::Custom { kind, payload_json } if crate::ending::is_note(kind) => {
                if let Some((speaker, note)) = crate::ending::machine_note(kind, payload_json, who) {
                    list = list.child(msg("msg pending", &speaker, &note, &[]));
                    count += 1;
                }
            }
            // The same card as a failure on this page's own agent: one failure,
            // one presentation, and the cause reachable from either.
            EventKind::Custom { kind, payload_json } if kind == "core.agent_error" => {
                // Folded on the failure INSIDE the envelope, by the same rule
                // this page's own failures fold by: a sub-agent refused five
                // times was five identical cards (R3-4).
                let detail = crate::told::detail_of(payload_json);
                list = list.child(match said.fold(&detail) {
                    Some(again) => again,
                    None => crate::told::agent_failure(payload_json, who),
                });
                count += 1;
            }
            // A background summarisation that failed. It is NOT this turn's
            // failure — the turn carried on with the full history — so it is
            // not a failure card and does not end the wait. Saying nothing at
            // all was the bug: one request went out, it was not the user's,
            // and the transcript showed their question failing (09 walk).
            EventKind::Custom { kind, payload_json } if kind == "core.compaction_failed" => {
                list = list.child(crate::failure::compaction_failed(payload_json));
            }
            EventKind::Custom { kind, payload_json } if kind == "core.error" => {
                list = list.child(match said.fold(payload_json) {
                    Some(again) => again,
                    None => failure(payload_json),
                });
                count += 1;
            }
            _ => {}
        }
        // WHETHER THE TURN IS STILL OPEN is `fold::awaits` and nothing else:
        // the board asks it of the same facts, and two copies of this rule is
        // how the two surfaces started disagreeing (R7-3).
        if let Some(open) = crate::fold::awaits(kind) {
            awaiting = open;
        }
    }
    list = announced(list, &mut calls, who, &mut count);
    if let Some(text) = appended {
        // THE FIRST FRAME OF A STEER. This message has not been pumped yet, so
        // no `core.steered` fact exists to read: what decides it here is whether
        // the turn it landed in is really being DRIVEN — the same predicate
        // `abandoned_run` uses, asked of the moment the sentence arrived.
        let open = awaiting.then(|| driven(ctx, who, false));
        list = crate::steered::said(list, who, "", text, &files, open);
        last_said = text.to_string();
        (awaiting, count) = (true, count + 1);
    }
    let pending = awaiting && driven(ctx, who, appended.is_some());
    if let Some(tail) = tail(pending, awaiting, count, who) {
        list = list.child(tail);
    }
    // How many tool calls this conversation has behind it: not rendered, but it
    // CHANGES when one lands, which is what tells the pane it is working.
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
    // What this page has spent, on a projection the pane already polls every
    // 400 ms: the meter earns no route of its own and no second clock, so it
    // rides here. Every agent's spend, not this one's.
    response.headers.push(("x-tokens".into(), spent(ctx).to_string()));
    // …and the last thing the person said, so the way out of a failed turn is
    // the same whichever way it failed (R3-5). A header, so the pane never
    // reads it back out of the HTML it was just handed.
    response.headers.push(("x-last-said".into(), last_said));
    if pending {
        response.headers.push(("x-turn".into(), "pending".into()));
    }
    // WHETHER THIS RUN CAN BE STOPPED AT ALL. Only the page's own agent runs in
    // this loop; a sub-agent's turn is in its own Worker, which no fact written
    // here reaches. A header rather than a sentence, so the pane offers the
    // control exactly where it works instead of guessing at whose turn it is.
    if pending && who == ctx.me {
        response.headers.push(("x-stoppable".into(), "yes".into()));
    }
    // …AND, WHEN IT CANNOT BE STOPPED, WHAT DOES END IT (R17-P0-1). The pane
    // pointed at the Commands view, which is false twice over. The ceiling in
    // the agent's own file is true of every run, so the copy states it.
    if let Some(spec) = ctx.agents.iter().find(|s| s.name == who) {
        response.headers.push(("x-max-rounds".into(), spec.max_rounds.to_string()));
    }
    // `x-orphaned` was here (R5-18), for a second notice the Dashboard drew
    // under its form. R9-1 moved that truth INTO the launch card, off the board
    // row's own `data-orphaned` — so this header had no reader left.
    response
}