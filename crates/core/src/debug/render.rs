//! WHAT IS GOING ON, on screen — the Debug pane's projection.
//!
//! ORGANISED BY THE QUESTION, NOT BY THE EVENT. The failure mode of a debug
//! view is a wall of undifferentiated records nobody can read under pressure,
//! so the shape here is the four questions a person actually arrives with, in
//! the order they arrive in: WHAT BROKE (top, loud, and never a row among
//! rows), then per turn — WHAT IS IT DOING, WHY DID IT DECIDE THAT, WHAT DID IT
//! COST. Newest turn first, because the one you are asking about is the one
//! still running.
//!
//! `turns.rs` owns the fold, `spine.rs` what a turn decided and `round.rs` one
//! model call; this owns the shape they are arranged in.

use module::view::{Fragment, FragmentBuilder};

use crate::debug::round::{broke, round};
use crate::debug::spine::{phases, spine, walk};
use crate::debug::store::failed_writes;
use crate::debug::turns::{calls_in, store_failures, turns, Turn};
use crate::dispatch::Ctx;

/// How many turns, model calls and failed writes the panel drew — the pane
/// wears these on headers rather than parsing the fragment back.
pub(crate) struct Counts {
    pub(crate) turns: usize,
    pub(crate) calls: usize,
    pub(crate) store_failed: usize,
}

/// What the turn cost, as one line.
fn cost(turn: &Turn) -> Fragment {
    let calls = calls_in(turn);
    let spent = match turn.called {
        0 => "the endpoint reported no token count".to_string(),
        _ => format!("{} tokens", turn.tokens),
    };
    let waiting = match calls - turn.rounds.len() {
        0 => String::new(),
        n => format!(" · {n} with no reply yet"),
    };
    FragmentBuilder::new("p")
        .class("debug-cost")
        .text(&format!(
            "{calls} model {} · {spent}{waiting}",
            match calls {
                1 => "call",
                _ => "calls",
            }
        ))
        .build()
}

/// The line a person scans for: when, who, and what they asked.
fn head(turn: &Turn) -> Fragment {
    let who = match turn.from.is_empty() {
        true => "you".to_string(),
        false => turn.from.clone(),
    };
    FragmentBuilder::new("p")
        .class("debug-said")
        .child(
            FragmentBuilder::new("time")
                .class("debug-time")
                .text(&agent::clock(kernel::Timestamp(turn.at)))
                .build(),
        )
        .child(FragmentBuilder::new("span").text(&format!(" {who}: {}", turn.said)).build())
        .build()
}

/// One turn.
fn card(turn: &Turn, nth: usize) -> Fragment {
    let mut block = FragmentBuilder::new("div")
        .class("debug-turn")
        .attr("data-turn", &nth.to_string())
        .attr("data-route", turn.route.as_ref().map_or("", |c| c.route.as_str()))
        .attr("data-calls", &calls_in(turn).to_string())
        .attr("data-tokens", &turn.tokens.to_string())
        .child(head(turn));
    for said in spine(turn).into_iter().chain(walk(turn)).chain(phases(turn)) {
        block = block.child(said);
    }
    block = block.child(cost(turn));
    for (n, one) in turn.rounds.iter().enumerate() {
        block = block.child(round(n + 1, one));
    }
    for one in broke(turn) {
        block = block.child(one);
    }
    block.build()
}

/// The panel: the failures, then every turn newest first.
pub(crate) fn panel(ctx: &Ctx, who: &str) -> (String, Counts) {
    let failed = store_failures(ctx);
    let turns = turns(ctx, who);
    let counts = Counts {
        turns: turns.len(),
        calls: turns.iter().map(calls_in).sum(),
        store_failed: failed.len(),
    };
    let mut list = FragmentBuilder::new("div")
        .id("debug")
        .attr("data-turns", &counts.turns.to_string())
        .attr("data-store-failed", &counts.store_failed.to_string());
    if let Some(banner) = failed_writes(&failed) {
        list = list.child(banner);
    }
    for (nth, turn) in turns.iter().rev().enumerate() {
        list = list.child(card(turn, nth));
    }
    (list.build().into_html(), counts)
}
