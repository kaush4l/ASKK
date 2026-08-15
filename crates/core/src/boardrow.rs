//! One CARD of the agent board (27): who, what it is doing, how long, where it
//! came from, and its two doors. Split from `board.rs`, which owns the module
//! and the route, and 27's own additions went on to `crates/core/src/tiles.rs`
//! — all three for the same reason, the 200-line rule (I12).

use agent::AgentRow;
use kernel::Status;
use module::view::{Fragment, FragmentBuilder};

use crate::dispatch::Ctx;

/// One agent's row. The status is a WORD, not only a colour: a row that
/// differs from its neighbour by hue alone says nothing with the stylesheet
/// off, and nothing at all to a screen reader.
pub(crate) fn row(agent: &AgentRow, ctx: &Ctx) -> Fragment {
    // TURNS, because turns is what the number is: the count rises when an agent
    // ENTERS Working (`Board::set`), so it counts jobs taken, not answers given
    // — called "replies" it was a fabrication (R3-13). And "IN ALL", because it
    // is a LIFETIME total (R16-3): `working · 2 turns` beside a running task
    // reads as "this task has taken 2", and the number is every turn this agent
    // has ever taken, replayed out of its own log.
    let turns = match agent.turns {
        0 => "no turns yet".to_string(),
        1 => "1 turn in all".to_string(),
        n => format!("{n} turns in all"),
    };
    // A task this process has ACCEPTED for this agent but not yet pumped. The
    // launcher on the Dashboard already reads this state — it says "{who} is on
    // it" the moment you press — and the board, reading only the status fact,
    // said "ready" in the card beside it at the same instant (R3-2). One
    // signal, `ctx.queued`, now drives both, so they cannot disagree.
    let queued = !agent.status.is_busy() && ctx.queued.contains(&agent.name);
    let status = match queued {
        true => Status::Working,
        false => agent.status,
    };
    // WHERE it came from is the Agents card's job. Every row used to end in
    // "from public/agents/" — a repository path (F25). The one origin worth
    // saying on the board is the one that is not on disk anywhere.
    let origin = match crate::rowwords::origin(agent, &ctx.authored) {
        o if o.is_empty() => String::new(),
        o => format!(" · {o}"),
    };
    // A RUN THE RELOAD KILLED IS NOT A RUN THAT FINISHED (R7-3). The status
    // fact says `Idle` after a reload, truthfully, and the row printed `main
    // ready · 26 turns` beside a conversation saying that turn is not running
    // any more. The word is `fold::abandoned_run`'s — Chat's own note's word.
    let orphaned = !status.is_busy() && crate::fold::abandoned_run(ctx, &agent.name);
    // …AND A RUN THAT ABANDONED ITS TASK IS NOT ONE THAT FINISHED (R17-P0-2).
    // Same shape, one ending along: the status fact says `ready` after a turn
    // that stopped without answering, because "ready" is a fact about who owes
    // the next move and not about how the last one went. `ending::of` is the
    // one fold that knows, and the Dashboard card reads it off this row.
    let ending = match status.is_busy() {
        true => None,
        false => crate::ending::of(ctx, &agent.name),
    };
    let ended = ending.and_then(crate::ending::Ending::word);
    let word = match (orphaned, ended) {
        (true, _) => "stopped mid-turn",
        (false, Some(said)) => said,
        (false, None) => crate::rowwords::gloss(status),
    };
    let said = format!("{word} · {turns}{origin}");
    // …AND WHETHER THERE IS ANYTHING TO GIVE IT (32). Eight cards differed by
    // name and status word alone, so the board — the one place a person compares
    // agents — said nothing about the difference that decides whether the
    // Dashboard will even show a Start control. It is NOT in `line` below: that
    // string is a launched RUN's report, and this is a standing fact about the
    // agent, true before the run and after it.
    let offer = crate::stage::offer(ctx, &agent.name);
    let shown = match offer.said.is_empty() {
        true => said.clone(),
        false => format!("{said} · {}", offer.said),
    };
    // The row inside a turn is the one worth looking at, so it says more (12
    // walk, "give the live row priority"). A TURN THAT ENDED WELL CAN STILL
    // HOLD A FAILED CALL (R9-3): `ready · 1 turn` was the whole row over a
    // trace whose first line was red. The clause is `failed::note`'s, written
    // once there, so this row, the card and the conversation say one thing.
    let (hurt, ran) = crate::failed::clause(ctx, &agent.name);
    let live = match (agent.status.is_busy(), orphaned) {
        (true, _) => live_line(agent, ctx),
        // The same sentence Chat gives it, short enough for a row — and not an
        // `.error`: nothing failed, the page was reloaded.
        (false, true) => Some(
            "the page was reloaded while that turn was in flight, so nothing is \
             driving it — ask again"
                .into(),
        ),
        // …and an ending with something to do about it says so, in the words
        // `ending.rs` writes once for this row and the card both.
        (false, false) => ending.and_then(crate::ending::Ending::line),
    };
    let live = match (live, hurt.clone()) {
        (Some(rest), Some(clause)) => Some(format!("{rest} · {clause}")),
        (rest, clause) => rest.or(clause),
    };
    // THE WHOLE ROW IN ONE STRING (R6-6). The Dashboard's launcher replaces its
    // own invitation with what this row knows; the alternative was a second
    // wording or a parser over this fragment. Written once, read twice.
    let line = match &live {
        Some(rest) => format!("{said} · {rest}"),
        None => said.clone(),
    };
    let mut card = FragmentBuilder::new("div")
        .class(&format!("agent-row status-{}", status.label()))
        .attr("data-agent", &agent.name)
        .attr("data-status", status.label())
        .attr("data-line", &line)
        // HOW LONG THIS TURN HAS BEEN GOING, AS A NUMBER (R6-7). The board and
        // the conversation each had a clock and they disagreed on screen. This
        // is the SAME subtraction `live_line` renders into words, unrounded.
        .attr("data-elapsed", &elapsed(agent, ctx).map(|s| s.to_string()).unwrap_or_default())
        // WHEN this status was entered. The launch confirmation watches this
        // row for the run it started, and the label alone cannot tell "failed
        // before you pressed Run" from "failed the thing you pressed" (R2-2).
        .attr("data-since", &agent.since.0.to_string())
        // …AND WHAT IT IS WAITING ON (R11-3): the Chat strip hardcoded "waiting
        // for the model" and held it four minutes after the model had answered.
        .attr("data-doing", &crate::inflight::doing(ctx, &agent.name, status.is_busy()))
        // …AND THE TWO FACTS THE CARD KEPT GETTING WRONG: a reload-killed turn
        // read `finished` while this row said `stopped mid-turn` (R9-1), and a
        // turn holding a failed call read as success everywhere (R9-3). Said
        // here, so the card quotes this row rather than re-deriving it.
        .attr("data-orphaned", match orphaned { true => "1", false => "" })
        // …AND HOW THE LAST TURN ENDED, so the card offers `Read the reply`
        // only where a reply exists (R17-P0-2). Empty is "it answered".
        .attr("data-ending", ended.unwrap_or_default())
        .attr("data-failed-note", hurt.as_deref().unwrap_or_default())
        // …AND WHETHER IT RAN ANYTHING (R18-P1-5): counted, never judged.
        .attr("data-tools-ran", &ran.to_string())
        // WHAT ITS TOOLS LET IT DO, the names they resolved to, and the pass
        // ceiling (32) — the three facts the Dashboard's starter tasks are
        // chosen from, so a task offered is one some named tool can finish.
        .attr("data-can", offer.can)
        .attr("data-toolset", &offer.toolset)
        .attr("data-laps", &offer.laps.to_string())
        .child(FragmentBuilder::new("h3").text(&agent.name).build())
        .child(
            FragmentBuilder::new("p")
                .class("agent-status")
                // The accessible name says which agent, so two agents in the
                // same status are not the same control to a screen reader.
                .attr("aria-label", &format!("{} is {word}", agent.name))
                .text(&shown)
                .build(),
        );
    if let Some(rest) = &live {
        card = card.child(FragmentBuilder::new("p").class("agent-live").text(rest).build());
    }
    // THE FAILURE BELONGS TO THE STATUS IT CAME WITH (R7-6). `detail` stays on
    // the row until the next status fact lands, so the first frame after Start
    // agent read `main working · 23 turns  the endpoint was unreachable`: a row
    // that is working, carrying the reason the LAST turn died. The status shown
    // here is `queued`-aware; the failure follows it.
    if !agent.detail.is_empty() && status == Status::Failed {
        card = card.child(
            FragmentBuilder::new("p")
                .class("error")
                .text(&agent.detail)
                .build(),
        );
    }
    card.child(crate::tiles::doors(&agent.name)).build()
}

/// How long this agent has been in its current status, in seconds — `None` when
/// this process has no clock. Words and `data-elapsed` are both this (R6-7).
fn elapsed(agent: &AgentRow, ctx: &Ctx) -> Option<i64> {
    Some(ctx.clock?.0.saturating_sub(agent.since.0) / 1000)
}

/// WHICH PART OF THE TURN is running, how long it has been, and what it last
/// called — in that reading order (28). All three are folds of the log: the
/// stage is `stage::said`, `since` is the status fact's timestamp, and the tool
/// is the last `ToolInvoked`, which this log holds only for its OWN agent.
fn live_line(agent: &AgentRow, ctx: &Ctx) -> Option<String> {
    let mut parts: Vec<String> = Vec::from_iter(crate::stage::said(ctx, &agent.name));
    if let Some(seconds) = elapsed(agent, ctx) {
        parts.push(format!("in this turn for {seconds}s"));
    }
    if agent.name == ctx.me {
        if let Some(tool) = crate::stage::last_tool(ctx) {
            parts.push(format!("last tool: {tool}"));
        }
    }
    match parts.is_empty() {
        true => None,
        false => Some(parts.join(" · ")),
    }
}
