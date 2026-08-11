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
fn said(who: &str, spec: &agent::AgentSpec, entries: usize, compacted: bool) -> String {
    let rule = match spec.compact_at {
        0 => format!("{who} never compacts, so it keeps every turn"),
        at => format!(
            "compaction runs at {at} entries and keeps the newest {}",
            spec.keep_recent
        ),
    };
    // The denominator is the TRIGGER, never `max(entries)`: raising it to the
    // count made the line read "10 of 10 entries … compaction runs at 8" —
    // two numbers contradicting each other in one sentence, always reading
    // full, and never showing how close the next compaction was (09 walk,
    // finding 2). An agent that never compacts has no denominator at all,
    // because there is nothing to be a fraction of.
    let held = match spec.compact_at {
        0 => format!("{entries} entries"),
        at => format!("{entries} of {at} entries"),
    };
    match compacted {
        true => format!(
            "Working memory: {held} — the oldest turns are now a summary \
             the summarizer wrote; {rule}. Nothing was lost: the transcript below still \
             holds every turn."
        ),
        false => format!("Working memory: {held}, every turn in full — {rule}."),
    }
}

/// The memory line for one agent, and — when it has compacted — the summary
/// itself. Empty for an agent with no file loaded.
pub(crate) fn memory(ctx: &Ctx, who: &str) -> String {
    let Some(spec) = ctx.agents.iter().find(|s| s.name == who) else {
        return String::new();
    };
    let Some((entries, summary)) = held(ctx, who) else {
        let unknown = format!(
            "Working memory: {who} has not reported it yet — it runs in its own Worker, \
             and says how much it holds when it answers."
        );
        return line(&unknown, 0, false).into_html();
    };
    let compacted = summary.is_some();
    let mut html = line(&said(who, spec, entries, compacted), entries, compacted).into_html();
    // The summary itself, whether this agent is the page's or a Worker's: one
    // compaction, one presentation, and the artifact readable in both.
    if let Some(summary) = &summary {
        html.push_str(&disclosure(who, summary).into_html());
    }
    html
}

/// The line itself. `role="status"` is the fix for a memory that changed with
/// no announcement: `.agent-memory` sits OUTSIDE the transcript's
/// `role="log" aria-live="polite"` region, so a compaction was silent to a
/// screen-reader user watching the one number it moves.
fn line(said: &str, entries: usize, compacted: bool) -> Fragment {
    FragmentBuilder::new("p")
        .class("agent-memory")
        .attr("role", "status")
        .attr("data-window", &entries.to_string())
        .attr("data-compacted", &compacted.to_string())
        .text(said)
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
