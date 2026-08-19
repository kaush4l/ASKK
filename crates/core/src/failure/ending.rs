//! HOW THE LAST TURN ENDED — ONE FOLD, THREE SURFACES (R17-P0-2).
//!
//! A critic gave `main` a six-part task from the Dashboard and walked away. It
//! came back to `main finished "…"` with a `Read the reply` button, `main ready
//! · 2 turns in all` on the board, `index.md` never written, and a reply that
//! was the model's own malformed tool call. *"The walk-away report was wrong in
//! both directions: it claimed completion, and it offered prose that was machine
//! output."*
//!
//! The machine knew. `step` ends a turn on the answered path, at the round
//! ceiling and at the stop boundary, and every one of those was reported as an
//! absence of a task — which every summary read as success. `agent::ENDED` makes
//! the ending a fact with a kind; this is the ONE fold of it, and the row, the
//! card and the conversation read it rather than each deciding. Round 16 was
//! spent on that class of bug; `failure::within_turn::note` is the precedent.

use kernel::EventKind;
use module::view::Fragment;

use crate::dispatch::Ctx;
pub(crate) use crate::failure::ending_kind::Ending;

/// How this agent's most recent turn ended. `None` is a turn that has not ended
/// — or a log written before this fact existed, which reads as it always did.
pub(crate) fn of(ctx: &Ctx, who: &str) -> Option<Ending> {
    ctx.recent
        .iter()
        .filter(|k| crate::chat::fold::belongs_to(k, &ctx.me, who))
        .filter_map(one)
        .next_back()
        .flatten()
}

/// WHAT ONE FACT SAYS ABOUT THE ENDING: names it (`Some(Some(_))`), opens a new
/// turn over whatever ended before it (`Some(None)`), or says nothing (`None`).
/// The same three-way shape as `fold::awaits`, which answers the neighbouring
/// question over the same facts — and for the same reason: a second copy of
/// this rule is how two surfaces start telling two stories about one turn.
fn one(kind: &EventKind) -> Option<Option<Ending>> {
    match kind {
        EventKind::UserMessage { .. } => Some(None),
        // A reply that CALLS tools has ended nothing.
        EventKind::ModelReplied { text, .. } if agent::has_calls(text) => None,
        // …and one that does not is read the way `step` read it.
        EventKind::ModelReplied { text, .. } => Some(Some(match agent::malformed_call(text) {
            true => Ending::NoAnswer,
            false => Ending::Answered,
        })),
        EventKind::Custom { kind, payload_json } => match kind.as_str() {
            k if k == agent::ENDED => Some(Some(Ending::named(&agent::ended_why(payload_json)))),
            // A NUDGE MEANS THE TURN DID NOT END. The prose reply above it
            // reads as `Answered` on the arm before this one — that is how a
            // reply with no calls in it has always read — and the gate held it.
            // Same three-way answer as a `UserMessage`, and for the same
            // reason: what came before is over, and nothing has ended yet.
            k if k == agent::VERIFY_NUDGED => Some(None),
            // …and a stage opening, for the same reason: what came before is
            // over, and nothing has ended (`agent::stages`). A pass spent is
            // the same shape one level up (22): a new lap, nothing ended.
            k if k == agent::STAGE_ENTERED || k == agent::PASS_SPENT => Some(None),
            k if k == agent::STOPPED => Some(Some(Ending::StoppedByYou)),
            "core.error" | "core.agent_error" => Some(Some(Ending::Failed)),
            _ => None,
        },
        _ => None,
    }
}

/// Which `Custom` facts the conversation renders as a notice about the ending.
/// One list, so `machine_note` cannot be reached with a kind it has no sentence
/// for.
pub(crate) fn is_note(kind: &str) -> bool {
    matches!(kind, "core.note")
        || kind == agent::ENDED
        || kind == agent::STOPPED
        || kind == agent::VERIFY_NUDGED
        || kind == agent::STAGE_ENTERED
        || kind == agent::PASS_SPENT
        || kind == crate::chat::pane::TURN_STOPPED
}

/// THE CONVERSATION'S LINE FOR AN ENDING — who says it, and what. `None` where
/// the facts around it already say it: a turn that answered is its own record,
/// and a turn that ended on machine output has that output rendered in full
/// directly above, so a notice repeating either would be two records of one
/// ending — the split this file exists to prevent.
pub(crate) fn machine_note(kind: &str, payload_json: &str, who: &str) -> Option<(String, String)> {
    // The agent's own name, not `NOTICE`: a stop is the agent's turn ending,
    // and `halted` owns both this wording and the Tool trace's row (R16-P0-2).
    if kind == agent::STOPPED {
        return Some((who.to_string(), crate::failure::stopped_notice::note(payload_json)));
    }
    // THE ROUND THE MACHINE ADDED, AS THE MACHINE'S (`agent::verify`). Without
    // it the transcript shows the model answering, then answering again, with
    // nothing on screen saying who asked the second time — a model talking to
    // itself, and a token meter charging for a turn nobody can see. The
    // sentence says what was observed and offers no verdict on the work.
    if kind == agent::VERIFY_NUDGED {
        return Some((
            crate::chat::fold::NOTICE.to_string(),
            "It changed a file and nothing had run since, so this page asked it to run \
             something that would show what happened before answering."
                .to_string(),
        ));
    }
    // The loop's own two notices — which stage (20, 21) and which lap (22).
    // Both wordings live in `ending_kind` beside the endings' because they are
    // the same job: what the page SAYS about a turn the machine moved on by
    // itself.
    if kind == agent::STAGE_ENTERED {
        return Some(crate::failure::ending_kind::stage_note(payload_json));
    }
    if kind == agent::PASS_SPENT {
        return Some(crate::failure::ending_kind::pass_note(payload_json));
    }
    if kind == crate::chat::pane::TURN_STOPPED {
        return Some((crate::chat::fold::NOTICE.to_string(), crate::chat::fold::STOPPED.to_string()));
    }
    // Every log written before R17 recorded the ceiling as a plain `core.note`,
    // and replays it as the sentence it was written with.
    if kind == "core.note" {
        let said = serde_json::from_str::<String>(payload_json)
            .unwrap_or_else(|_| payload_json.to_string());
        return Some((crate::chat::fold::NOTICE.to_string(), said));
    }
    match Ending::named(&agent::ended_why(payload_json)) {
        // The answer is directly above and is shown in full. What the notice
        // adds is the thing the answer cannot: nothing read the change back.
        Ending::Unchecked => Some((
            crate::chat::fold::NOTICE.to_string(),
            "It changed a file and no command ran afterwards, so nothing here can say \
             whether it worked. The Tool trace has what it did."
                .to_string(),
        )),
        // A DIFFERENT AGENT LOOKED AND SAID NO (25). The answer is directly
        // above; what the notice adds is that it was reviewed by something
        // other than itself, and that the review did not clear it. The page
        // takes no side — it says who disagreed and where to read them.
        Ending::CriticFaulted => Some((
            crate::chat::fold::NOTICE.to_string(),
            "It handed the finished work to the critic — a separate agent that did not do \
             the work and cannot see this conversation — and the critic did not clear it. \
             The critic's reply is in the Tool trace, and in the critic's own conversation."
                .to_string(),
        )),
        Ending::RoundCeiling => Some((
            crate::chat::fold::NOTICE.to_string(),
            format!(
                "Stopped after {} of tool calls without an answer. Raise `max_rounds:` in \
                 this agent's file if the work needs more.",
                match agent::ended_rounds(payload_json) {
                    1 => "1 round".to_string(),
                    n => format!("{n} rounds"),
                }),
        )),
        // THE BUDGET STOPPED IT, NOT THE WORK (22). Named beside the round
        // ceiling for R17-P0-2's reason — a six-part task was abandoned and
        // reported as finished — and the sentence says which of the two
        // budgets ran out, because they are raised in two different lines.
        Ending::PassCeiling => Some((
            crate::chat::fold::NOTICE.to_string(),
            format!(
                "It ran out of passes after {} of tool calls and was still changing things \
                 on the last one, so the work is unfinished. Its reply above says what it \
                 did and what it did not; raise `passes:` in this agent's file, or ask it \
                 to carry on.",
                match agent::ended_rounds(payload_json) {
                    1 => "1 round".to_string(),
                    n => format!("{n} rounds"),
                }
            ),
        )),
        _ => None,
    }
}

/// ONE MODEL REPLY: the agent's words, or the machine output that is not them.
/// `exec({"command": "cat a.md"}, {"command": "cat b.md"}, …)` was an `msg
/// assistant` bubble under the agent's own name, which is how `Read the reply`
/// came to land on a raw tool call. It is still shown in full — what the model
/// actually sent is the most useful thing on screen when a run strands — but as
/// the page's notice about a failed step, not as speech.
///
/// AND IT POINTS NOWHERE. The call never parsed, so no tool ran, so there is no
/// row for it in the Tool trace or in Commands. Naming either would be the
/// R17-P1-3 mistake in a new place; the text itself is the whole record.
pub(crate) fn reply(who: &str, text: &str, files: &[String]) -> Fragment {
    if !agent::malformed_call(text) {
        return crate::chat::fold::msg("msg assistant", who, text, files);
    }
    let said = format!(
        "{who} did not answer. Its last reply was a tool call this page could not read, so \
         nothing ran and there is no tool row for it anywhere. This is what it sent, in \
         full:\n\n```\n{}\n```",
        text.trim()
    );
    crate::chat::fold::msg("msg pending", crate::chat::fold::NOTICE, &said, &[])
}
