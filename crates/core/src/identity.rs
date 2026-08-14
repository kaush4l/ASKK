//! The two lines above one agent's conversation: WHO you are talking to, and —
//! behind that name — who wrote them and what their space granted. Split from
//! `transcript.rs` for the 200-line rule (I12): that file is the conversation,
//! this one is the heading over it.

use agent::AgentSpec;
use module::view::{Fragment, FragmentBuilder};

use crate::dispatch::Ctx;

/// Whose conversation this is, as `public/agents/<who>/agent.md` declares it,
/// then what this agent still holds. The MODEL is deliberately absent: this
/// file knows what the agent file asked for, not what Settings overrode it
/// with, and printing "(model: local)" while the next turn calls openrouter is
/// a lie the pane told for a whole increment.
pub(crate) fn header(ctx: &Ctx, who: &str) -> String {
    let Some(spec) = ctx.agents.iter().find(|s| s.name == who) else {
        return FragmentBuilder::new("p")
            .class("agent-header pending")
            .text(&format!("No agent called {who} is loaded."))
            .build()
            .into_html();
    };
    let mine = ctx
        .authored
        .iter()
        .find(|(n, _)| *n == spec.name)
        .map(|(_, by)| by.as_str());
    identity(spec, mine, crate::memory::memory(ctx, who))
}

/// The agent's name, and behind it the two sentences about where it came from.
///
/// WHO WROTE IT is here because the record has always distinguished "written by
/// you in this browser" from "written by the author agent", and an agent holding
/// a `space:` has a real root shell — but that sentence lived only in the Agents
/// panel, five thousand pixels down (increment 12). The same
/// `origin::origin_line` renders in both places, so the two cannot disagree.
///
/// It is a DISCLOSURE, not a stack of paragraphs: both sentences are long and
/// neither changes while you talk, and three paragraphs of true prose before the
/// first message made the primary surface read like documentation (12 walk,
/// "density"). Nothing is lost — a `details` is open to find, to search, and to
/// a screen reader.
/// …and the WORKING MEMORY line rides inside it too (R3-14). It was the first
/// thing in every transcript: before the first message a stranger ever sent,
/// the product opened with "Working memory: 5 of 8 entries, every turn in full
/// — compaction runs at 8 entries and keeps the newest 3" — an internal of the
/// prompt assembler, in the most valuable line on the page. Not one word of it
/// is cut and nothing about it is hidden: it is one press away, under the name
/// of the agent it is about, beside the other two sentences about how this
/// agent was made.
fn identity(spec: &AgentSpec, mine: Option<&str>, memory: Vec<Fragment>) -> String {
    let held = memory
        .into_iter()
        .fold(FragmentBuilder::new("div").class("agent-held"), |b, f| b.child(f));
    let origin = match mine {
        Some("") => "authored",
        Some(_) => "authored-by-agent",
        None => "shipped",
    };
    // An agent with no `description:` used to render `note-taker — ` with
    // nothing after the dash (12 walk, finding 4). The separator belongs to the
    // second half; with no second half there is no separator.
    let named = match spec.description.trim().is_empty() {
        true => spec.name.clone(),
        false => format!("{} — {}", spec.name, spec.description),
    };
    FragmentBuilder::new("details")
        .class("agent-identity")
        .attr("data-origin", origin)
        .child(
            FragmentBuilder::new("summary")
                .class("agent-header")
                .attr("data-agent", &spec.name)
                .attr("data-origin", origin)
                .text(&named)
                .build(),
        )
        .child(
            FragmentBuilder::new("p")
                .class("agent-origin")
                .text(&crate::origin::origin_line(spec, mine))
                .build(),
        )
        .child(held.build())
        .build()
        .into_html()
}
