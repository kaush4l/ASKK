//! What an agent still HOLDS, which after a compaction is not what is on
//! screen. Split from `transcript.rs` for the 200-line rule (I12), and because
//! four separate findings from the increment-08 walk all land in this one line:
//!
//! 1. the summary the summarizer wrote was in the log and rendered NOWHERE —
//!    compaction's one reassuring artifact, withheld. It is now behind the same
//!    disclosure the failure card uses;
//! 2. a sub-agent had no indicator at all, so an increment about per-agent
//!    memory showed one agent out of three. Its Worker now reports its window
//!    with every answer, and the pane prints THAT, or says it has not been told;
//! 3. "2 entries" had no unit anyone could anticipate the drop from. The line
//!    now names what triggers a compaction and how much survives it;
//! 4. nothing said that nothing was lost. The transcript still holds every turn
//!    and the copy now connects the two;
//! 5. it changed silently. `role="status"` makes it a live region, so a
//!    compaction is announced instead of just happening.

use kernel::EventKind;
use module::view::{Fragment, FragmentBuilder};

use crate::dispatch::Ctx;

/// One agent's reported window: how many entries, and whether the first is a
/// summary. Reported by the composition root when a Worker answers.
fn reported(ctx: &Ctx, who: &str) -> Option<(usize, Option<String>)> {
    ctx.recent
        .iter()
        .filter_map(|kind| match kind {
            EventKind::Custom { kind, payload_json } if kind == "core.agent_memory" => {
                let v = serde_json::from_str::<serde_json::Value>(payload_json).ok()?;
                (v.get("agent")?.as_str()? == who).then(|| {
                    (
                        v.get("window").and_then(|w| w.as_u64()).unwrap_or(0) as usize,
                        v.get("summary")
                            .and_then(|s| s.as_str())
                            .map(str::to_string),
                    )
                })
            }
            _ => None,
        })
        .last()
}

/// What this agent HOLDS: its own window, or — for a sub-agent — the last
/// window its Worker reported.
fn held(ctx: &Ctx, who: &str) -> Option<(usize, Option<String>)> {
    if who != ctx.me {
        // A sub-agent's window lives in its Worker; this is what that Worker
        // last said about it, never a guess made on this side.
        return reported(ctx, who);
    }
    Some((
        ctx.window.len(),
        ctx.window
            .first()
            .filter(|line| line.contains(agent::SUMMARY_HEADING))
            .cloned(),
    ))
}

/// The sentence itself: how much is held out of how much triggers a
/// compaction, what a compaction does to it, and that nothing was lost.
///
/// Two halves, because only the first one CHANGES: the count is what moves
/// every turn and the rule behind it is fixed by the agent file. `line` makes
/// the first half the live region and leaves the other twenty words out of it
/// — a `role="status"` around the whole sentence re-announced all of it every
/// turn to say one number had gone up (12b walk, finding 3).
fn said(who: &str, spec: &agent::AgentSpec, entries: usize, compacted: bool) -> (String, String) {
    // WHOSE rule, and where it is written. The numbers differ per agent —
    // `researcher` compacts at 6, `main` at 8 — and nothing said why one pane
    // disagreed with the next (R3-14). They are a setting in that agent's own
    // file, which is a fact a reader can act on.
    let rule = match spec.compact_at {
        0 => format!("{who}'s agent file asks for no compaction, so it keeps every turn"),
        at => format!(
            "{who}'s agent file compacts at {at} entries and keeps the newest {}",
            spec.keep_recent
        ),
    };
    // The denominator is the TRIGGER, never `max(entries)`: raising it to the
    // count made the line read "10 of 10 entries … compaction runs at 8" —
    // two numbers contradicting each other in one sentence, always reading
    // full, and never showing how close the next compaction was (09 walk,
    // finding 2). An agent that never compacts has no denominator at all,
    // because there is nothing to be a fraction of.
    //
    // And it is a TRIGGER, not a capacity, so the fraction has to stop when the
    // count passes it: an older session read "Working memory: 11 of 8 entries",
    // eleven of eight, a sentence that refutes itself (R3-14). Over the mark is
    // a real state and not a bug in the count — compaction is checked at the
    // top of a turn and before each model call, so a round can push the window
    // past the trigger, and it is SKIPPED entirely when no summarizer agent is
    // loaded or when the summarisation itself fails (`window::compaction`,
    // `step`'s `core.compaction_failed` arm: a compaction costs a compaction
    // and never a conversation). Past the mark the line says so in words.
    let held = match spec.compact_at {
        0 => format!("{entries} entries"),
        at if entries > at => format!("{entries} entries, past the {at} that triggers one"),
        at => format!("{entries} of {at} entries"),
    };
    let rest = match compacted {
        true => format!(
            " — working memory is what {who} still has in front of it when it thinks. The \
             oldest turns are now a summary the summarizer wrote; {rule}. Nothing was lost: \
             the transcript still holds every turn."
        ),
        false => format!(
            ", every turn in full — working memory is what {who} still has in front of it \
             when it thinks, and {rule}."
        ),
    };
    (format!("Working memory: {held}"), rest)
}

/// The memory line for one agent, and — when it has compacted — the summary
/// itself. Empty for an agent with no file loaded. FRAGMENTS, not a string of
/// HTML: `identity` hangs these inside its own disclosure now (R3-14), and a
/// fragment is the only thing this codebase lets one build another out of.
pub(crate) fn memory(ctx: &Ctx, who: &str) -> Vec<Fragment> {
    let Some(spec) = ctx.agents.iter().find(|s| s.name == who) else {
        return Vec::new();
    };
    let Some((entries, summary)) = held(ctx, who) else {
        let unknown = format!("Working memory: {who} has not reported it yet");
        let why = " — working memory is what an agent still has in front of it when it \
                    thinks. This one runs on its own, and says how much it holds when it \
                    answers.";
        return vec![line(&unknown, why, 0, false)];
    };
    let compacted = summary.is_some();
    let (count, rest) = said(who, spec, entries, compacted);
    let mut out = vec![line(&count, &rest, entries, compacted)];
    // The summary itself, whether this agent is the page's or a Worker's: one
    // compaction, one presentation, and the artifact readable in both.
    if let Some(summary) = &summary {
        out.push(disclosure(who, summary));
    }
    out
}

/// The line itself. `role="status"` is the fix for a memory that changed with
/// no announcement: `.agent-memory` sits OUTSIDE the transcript's
/// `role="log" aria-live="polite"` region, so a compaction was silent to a
/// screen-reader user watching the one number it moves.
///
/// It wraps the COUNT only. The rule after it does not change while the page
/// is open, and announcing it again on every turn buried the one word that
/// did move under nineteen that did not.
fn line(count: &str, rest: &str, entries: usize, compacted: bool) -> Fragment {
    FragmentBuilder::new("p")
        .class("agent-memory")
        .attr("data-window", &entries.to_string())
        .attr("data-compacted", &compacted.to_string())
        .child(
            FragmentBuilder::new("span")
                .class("wm-count")
                .attr("role", "status")
                .text(count)
                .build(),
        )
        .child(FragmentBuilder::new("span").class("wm-rest").text(rest).build())
        .build()
}

/// The summary, readable. It was written by a model, it replaced turns a
/// person can no longer see in the window, and until now the only place it
/// existed was `log/<agent>/00000000`.
fn disclosure(who: &str, summary: &str) -> Fragment {
    FragmentBuilder::new("details")
        .class("agent-summary")
        .child(
            // Named per agent, for the same reason every other disclosure on
            // this page is: two controls called "the summary" are one control
            // to a screen reader.
            FragmentBuilder::new("summary")
                .text(&format!("The summary that replaced the oldest turns for {who}"))
                .build(),
        )
        .child(FragmentBuilder::new("pre").text(summary).build())
        .build()
}
