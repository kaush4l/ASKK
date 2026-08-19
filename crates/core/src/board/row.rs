//! One CARD of the agent board (27): who, what it is doing, how long, where it
//! came from, and its two doors. `board/pane.rs` owns the module and the route,
//! `board/tiles.rs` builds the doors this card ends with, and `reading.rs` with
//! `live.rs` beside this file decide everything the card says before any markup
//! exists — the standing facts about the agent and the report on its current
//! turn. This file only lays them out.

mod live;
mod reading;

use agent::AgentRow;
use kernel::Status;
use module::view::{Fragment, FragmentBuilder};

use crate::dispatch::Ctx;
use reading::Reading;

/// One agent's row. The status is a WORD, not only a colour: a row that
/// differs from its neighbour by hue alone says nothing with the stylesheet
/// off, and nothing at all to a screen reader.
pub(crate) fn row(agent: &AgentRow, ctx: &Ctx) -> Fragment {
    let read = Reading::of(agent, ctx);
    let mut card = shell(agent, ctx, &read).child(
        FragmentBuilder::new("p")
            .class("agent-status")
            // The accessible name says which agent, so two agents in the same
            // status are not the same control to a screen reader.
            .attr("aria-label", &format!("{} is {}", agent.name, read.word))
            .text(&read.shown)
            .build(),
    );
    if let Some(rest) = &read.live {
        card = card.child(FragmentBuilder::new("p").class("agent-live").text(rest).build());
    }
    if let Some(failure) = failure(agent, &read) {
        card = card.child(failure);
    }
    card.child(crate::board::tiles::doors(&agent.name)).build()
}

/// The card itself and every FACT hung off it, so a second surface can read
/// this row without re-deriving it: the Dashboard card, the launch
/// confirmation and the Chat strip all quote these attributes.
fn shell(agent: &AgentRow, ctx: &Ctx, read: &Reading) -> FragmentBuilder {
    FragmentBuilder::new("div")
        .class(&format!("agent-row status-{}", read.status.label()))
        .attr("data-agent", &agent.name)
        .attr("data-status", read.status.label())
        .attr("data-line", &read.line)
        // HOW LONG THIS TURN HAS BEEN GOING, AS A NUMBER (R6-7). The board and
        // the conversation each had a clock and they disagreed on screen. This
        // is the SAME subtraction the live line renders into words, unrounded.
        .attr("data-elapsed", &live::elapsed(agent, ctx).map(|s| s.to_string()).unwrap_or_default())
        // WHEN this status was entered. The launch confirmation watches this
        // row for the run it started, and the label alone cannot tell "failed
        // before you pressed Run" from "failed the thing you pressed" (R2-2).
        .attr("data-since", &agent.since.0.to_string())
        // …AND WHAT IT IS WAITING ON (R11-3): the Chat strip hardcoded "waiting
        // for the model" and held it four minutes after the model had answered.
        .attr("data-doing", &crate::trace::inflight::doing(ctx, &agent.name, read.status.is_busy()))
        // …AND THE TWO FACTS THE CARD KEPT GETTING WRONG: a reload-killed turn
        // read `finished` while this row said `stopped mid-turn` (R9-1), and a
        // turn holding a failed call read as success everywhere (R9-3).
        .attr("data-orphaned", match read.orphaned { true => "1", false => "" })
        // …AND HOW THE LAST TURN ENDED, so the card offers `Read the reply`
        // only where a reply exists (R17-P0-2). Empty is "it answered".
        .attr("data-ending", read.ended.unwrap_or_default())
        .attr("data-failed-note", read.hurt.as_deref().unwrap_or_default())
        // …AND WHETHER IT RAN ANYTHING (R18-P1-5): counted, never judged.
        .attr("data-tools-ran", &read.ran.to_string())
        // WHAT ITS TOOLS LET IT DO, the names they resolved to, and the pass
        // ceiling (32) — the three facts the Dashboard's starter tasks are
        // chosen from, so a task offered is one some named tool can finish.
        .attr("data-can", read.offer.can)
        .attr("data-toolset", &read.offer.toolset)
        .attr("data-laps", &read.offer.laps.to_string())
        .child(FragmentBuilder::new("h3").text(&agent.name).build())
}

/// THE FAILURE BELONGS TO THE STATUS IT CAME WITH (R7-6). `detail` stays on the
/// row until the next status fact lands, so the first frame after Start agent
/// read `main working · 23 turns  the endpoint was unreachable`: a row that is
/// working, carrying the reason the LAST turn died. The status this row shows
/// is `queued`-aware; the failure follows it.
fn failure(agent: &AgentRow, read: &Reading) -> Option<Fragment> {
    match !agent.detail.is_empty() && read.status == Status::Failed {
        true => Some(FragmentBuilder::new("p").class("error").text(&agent.detail).build()),
        false => None,
    }
}
