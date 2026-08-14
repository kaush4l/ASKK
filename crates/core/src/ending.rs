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
//! spent on that class of bug; `failed::note` is the precedent.

use kernel::EventKind;
use module::view::Fragment;

use crate::dispatch::Ctx;
pub(crate) use crate::endword::Ending;

/// How this agent's most recent turn ended. `None` is a turn that has not ended
/// — or a log written before this fact existed, which reads as it always did.
pub(crate) fn of(ctx: &Ctx, who: &str) -> Option<Ending> {
    ctx.recent
        .iter()
        .filter(|k| crate::fold::belongs_to(k, &ctx.me, who))
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
            k if k == agent::ENDED => Some(Some(named(&agent::ended_why(payload_json)))),
            // A NUDGE MEANS THE TURN DID NOT END. The prose reply above it
            // reads as `Answered` on the arm before this one — that is how a
            // reply with no calls in it has always read — and the gate held it.
            // Same three-way answer as a `UserMessage`, and for the same
            // reason: what came before is over, and nothing has ended yet.
            k if k == agent::VERIFY_NUDGED => Some(None),
            // …and a stage opening, for the same reason: what came before is
            // over, and nothing has ended (`agent::stages`).
            k if k == agent::STAGE_ENTERED => Some(None),
            k if k == agent::STOPPED => Some(Some(Ending::StoppedByYou)),
            "core.error" | "core.agent_error" => Some(Some(Ending::Failed)),
            _ => None,
        },
        _ => None,
    }
}

/// The fact's own word, typed. A reason this build does not know reads as
/// `Answered`, which is what every surface did before any ending was named —
/// so an unknown one is no worse than the day before it existed.
fn named(why: &str) -> Ending {
    match why {
        w if w == agent::NO_ANSWER => Ending::NoAnswer,
        w if w == agent::ROUND_CEILING => Ending::RoundCeiling,
        w if w == agent::UNCHECKED => Ending::Unchecked,
        _ => Ending::Answered,
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
        || kind == crate::chat::TURN_STOPPED
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
        return Some((who.to_string(), crate::halted::note(payload_json)));
    }
    // THE ROUND THE MACHINE ADDED, AS THE MACHINE'S (`agent::verify`). Without
    // it the transcript shows the model answering, then answering again, with
    // nothing on screen saying who asked the second time — a model talking to
    // itself, and a token meter charging for a turn nobody can see. The
    // sentence says what was observed and offers no verdict on the work.
    if kind == agent::VERIFY_NUDGED {
        return Some((
            crate::fold::NOTICE.to_string(),
            "It changed a file and nothing had run since, so this page asked it to run \
             something that would show what happened before answering."
                .to_string(),
        ));
    }
    // WHICH STAGE, AND WHAT IT IS FOR (20). Without it the conversation shows
    // one agent answering three times in a row with nothing saying why — the
    // `VERIFY_NUDGED` defect, once per declared stage. The sentence names the
    // stage's job and claims nothing about the work.
    if kind == agent::STAGE_ENTERED {
        let said = match agent::stage_of(payload_json).as_str() {
            s if s == agent::STAGE_PLAN => "Turning the request into a brief — what will be \
                 true when this is done, which files, and the command that would show it. It \
                 calls nothing at this point.",
            s if s == agent::STAGE_VERIFY => "Running the check the brief named, and reading \
                 what it prints.",
            s if s == agent::STAGE_CRITIQUE => "Reading the turn back to name what is still \
                 missing, before answering.",
            _ => "Doing the work.",
        };
        return Some((crate::fold::NOTICE.to_string(), said.to_string()));
    }
    if kind == crate::chat::TURN_STOPPED {
        return Some((crate::fold::NOTICE.to_string(), crate::fold::STOPPED.to_string()));
    }
    // Every log written before R17 recorded the ceiling as a plain `core.note`,
    // and replays it as the sentence it was written with.
    if kind == "core.note" {
        let said = serde_json::from_str::<String>(payload_json)
            .unwrap_or_else(|_| payload_json.to_string());
        return Some((crate::fold::NOTICE.to_string(), said));
    }
    match named(&agent::ended_why(payload_json)) {
        // The answer is directly above and is shown in full. What the notice
        // adds is the thing the answer cannot: nothing read the change back.
        Ending::Unchecked => Some((
            crate::fold::NOTICE.to_string(),
            "It changed a file and no command ran afterwards, so nothing here can say \
             whether it worked. The Tool trace has what it did."
                .to_string(),
        )),
        Ending::RoundCeiling => Some((
            crate::fold::NOTICE.to_string(),
            format!(
                "Stopped after {} of tool calls without an answer. Raise `max_rounds:` in \
                 this agent's file if the work needs more.",
                match agent::ended_rounds(payload_json) {
                    1 => "1 round".to_string(),
                    n => format!("{n} rounds"),
                }),
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
        return crate::fold::msg("msg assistant", who, text, files);
    }
    let said = format!(
        "{who} did not answer. Its last reply was a tool call this page could not read, so \
         nothing ran and there is no tool row for it anywhere. This is what it sent, in \
         full:\n\n```\n{}\n```",
        text.trim()
    );
    crate::fold::msg("msg pending", crate::fold::NOTICE, &said, &[])
}
