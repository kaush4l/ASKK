//! WHICH LOOP THIS TURN IS RUNNING, hung on the row as facts (34). `stage`
//! next door answers which part of a turn is running; this answers which turn
//! it is — the route the strategy stage voted for, the stage list that route
//! really walks, and which lap of it. Until now every one of those lived only
//! inside a rendered sentence, so a second surface wanting the flow had to
//! parse English out of `data-line` or re-derive the fold.
//!
//! WHO OWNS `core.route_chosen` — THE DECISION, IN WRITING. It is NOT a loop
//! note. `failure::loop_note::is_loop_fact` is read by four callers and every
//! one of them turns a fact into something a person READS in the conversation;
//! adding the vote there would put a decision ABOUT the turn into the
//! transcript OF the turn, which `agent::stages::route` states outright it must
//! not do ("the vote itself never reaches the person"). So ownership is the
//! other arm the charter offered: a `who == me` test, because `ROUTE_CHOSEN` is
//! emitted by the engine running the turn exactly as `STAGE_ENTERED` is, and a
//! sub-agent's vote is in ITS Worker's log and not in this one.
//!
//! THAT TEST IS NOT WRITTEN TWICE. `debug::route::mine` already is it, and
//! `chosen_now` applies it with the turn boundaries a route needs (it is chosen
//! ONCE, so it survives the prose reply ending each stage). This reads through
//! those rather than keeping a second opinion.
//!
//! A ROW SAYS WHAT IT CANNOT SEE (I16). An empty `data-route` on a sub-agent's
//! row is indistinguishable from "it has not voted yet" — a truth the system
//! holds and does not state. `data-flow` states it: `here` means these facts are
//! this process's to know and blank means not yet, `elsewhere` means they live
//! in another Worker's log and nothing on this page can read them.

use module::view::FragmentBuilder;

use crate::dispatch::Ctx;

/// The flow facts, hung on the card `row::shell` is building. The row is the
/// one author of the wording, so no second surface can fork it.
pub(crate) fn hang(card: FragmentBuilder, ctx: &Ctx, who: &str) -> FragmentBuilder {
    let mine = who == ctx.me;
    let route = mine.then(|| route_of(ctx, who)).flatten();
    let stage = mine.then(|| super::stage::current(ctx, who)).flatten();
    let lap = mine.then(|| lap(ctx, who)).flatten();
    card.attr("data-flow", match mine {
        true => "here",
        false => "elsewhere",
    })
    .attr("data-route", route.map(|r| r.as_str()).unwrap_or_default())
    .attr("data-walk", &route.map(|r| r.stages().join(",")).unwrap_or_default())
    .attr("data-stage", &stage.unwrap_or_default())
    // NOT `data-laps`, which is the CEILING off the roster and true before the
    // run: this is the lap the open turn is actually on, and only during one.
    .attr("data-lap", &lap.unwrap_or_default())
}

/// The route the open turn chose, `None` before the vote — or for a route word
/// this build cannot name. `Route::named` has no `React` fallback on purpose
/// (`agent::strategy`): a projection that guesses draws the wrong flow.
fn route_of(ctx: &Ctx, who: &str) -> Option<agent::Route> {
    agent::Route::named(&crate::debug::route::chosen_now(ctx, who)?.route)
}

/// The stage list the open turn is really walking — the ROUTE's and not the
/// file's `stages:`. One author, read both by the attribute above and by
/// `stage::said`'s count.
pub(crate) fn walk(ctx: &Ctx, who: &str) -> Option<Vec<String>> {
    Some(route_of(ctx, who)?.stages())
}

/// WHICH LAP OF THE STAGES THIS IS, `None` when it is the first one, when the
/// agent cannot lap at all, or between turns. Read from `PASS_SPENT` facts in
/// the CURRENT turn only and never from the `passes:` budget the file declares.
///
/// TWO SILENCES, BOTH DELIBERATE. An agent whose budget is 1 can never lap, so
/// a count for it would be noise about a loop that does not exist (I15), and
/// `of > 1` is what keeps it quiet. And the FIRST lap spends no fact, so it
/// says nothing either: a lap count is what HAS happened. "UP TO", because
/// `passes:` is a CEILING and not a plan — `agent::passes` ends the turn the
/// moment a lap changes nothing, so `pass 2 of 4` beside a running turn would
/// promise two more laps the machine may never take.
pub(crate) fn lap(ctx: &Ctx, who: &str) -> Option<String> {
    let mut lap = None;
    for kind in ctx.recent.iter().filter(|k| crate::chat::fold::belongs_to(k, &ctx.me, who)) {
        match kind {
            kernel::EventKind::Custom { kind: k, payload_json } if k == agent::PASS_SPENT => {
                lap = Some(agent::pass_of(payload_json)).filter(|(n, of)| *n > 0 && *of > 1);
            }
            kernel::EventKind::UserMessage { .. } => lap = None,
            k if crate::chat::fold::awaits(k) == Some(false) => lap = None,
            _ => {}
        }
    }
    lap.map(|(n, of)| format!("pass {n} of up to {of}"))
}
