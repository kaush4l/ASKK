//! WHAT A ROW READS OFF THE LOG about one agent, before any markup exists:
//! which status to show, the word for it, and the sentence under the name —
//! plus the second line `live.rs` writes, and at the bottom the vocabulary it
//! all reaches for — one short label per lifecycle state, and the one thing
//! worth saying about where an agent came from. Every field is a fold, nothing
//! is stored, and the card next to the board (`board/tiles.rs`) quotes these
//! strings rather than deciding the same questions a second time.

use agent::AgentRow;
use kernel::Status;

use crate::board::offer::Offer;
use crate::dispatch::Ctx;
use crate::failure::ending::Ending;

/// One agent as the board reads it.
pub(super) struct Reading {
    /// The status the row SHOWS, which is the status fact plus what this
    /// process has accepted but not yet pumped.
    pub(super) status: Status,
    /// That status in one word — the row differs from its neighbour by a word
    /// and not only a hue, so it still says something with the stylesheet off.
    pub(super) word: &'static str,
    /// `word · turns · origin`, with the offer clause on the end.
    pub(super) shown: String,
    /// The whole row in one string, for a surface that has no room for two.
    pub(super) line: String,
    /// The second line: what is running now, or what the last ending left.
    pub(super) live: Option<String>,
    pub(super) orphaned: bool,
    pub(super) ended: Option<&'static str>,
    /// The failure clause and the count of calls the last turn made.
    pub(super) hurt: Option<String>,
    pub(super) ran: usize,
    /// What there is to GIVE this agent — a standing fact, not a run's report.
    pub(super) offer: Offer,
}

impl Reading {
    pub(super) fn of(agent: &AgentRow, ctx: &Ctx) -> Reading {
        let status = shown_status(agent, ctx);
        let orphaned = orphaned(status, ctx, &agent.name);
        let ending = last_ending(status, ctx, &agent.name);
        let ended = ending.and_then(Ending::word);
        let word = word_for(orphaned, ended, status);
        let said = format!("{word} · {}{}", turns(agent), origin_clause(agent, ctx));
        let offer = crate::board::offer::offer(ctx, &agent.name);
        let (hurt, ran) = crate::failure::within_turn::clause(ctx, &agent.name);
        let live = super::live::second_line(agent, ctx, orphaned, ending, &hurt);
        Reading {
            shown: with_offer(&said, &offer),
            line: whole_row(&said, &live),
            status,
            word,
            live,
            orphaned,
            ended,
            hurt,
            ran,
            offer,
        }
    }
}

/// TURNS, because turns is what the number is: the count rises when an agent
/// ENTERS Working (`Board::set`), so it counts jobs taken, not answers given —
/// called "replies" it was a fabrication (R3-13). And "IN ALL", because it is a
/// LIFETIME total (R16-3): `working · 2 turns` beside a running task reads as
/// "this task has taken 2", and the number is every turn this agent has ever
/// taken, replayed out of its own log.
fn turns(agent: &AgentRow) -> String {
    match agent.turns {
        0 => "no turns yet".to_string(),
        1 => "1 turn in all".to_string(),
        n => format!("{n} turns in all"),
    }
}

/// The status fact, PLUS a task this process has accepted for this agent but
/// not yet pumped. The launcher on the Dashboard already reads that state — it
/// says "{who} is on it" the moment you press — and the board, reading only the
/// status fact, said "ready" in the card beside it at the same instant (R3-2).
/// One signal, `ctx.queued`, now drives both, so they cannot disagree.
fn shown_status(agent: &AgentRow, ctx: &Ctx) -> Status {
    match !agent.status.is_busy() && ctx.queued.contains(&agent.name) {
        true => Status::Working,
        false => agent.status,
    }
}

/// WHERE it came from, when that is worth saying at all. Every row used to end
/// in "from public/agents/" — a repository path (F25). The one origin worth
/// saying on the board is the one that is not on disk anywhere.
fn origin_clause(agent: &AgentRow, ctx: &Ctx) -> String {
    match origin(agent, &ctx.authored) {
        o if o.is_empty() => String::new(),
        o => format!(" · {o}"),
    }
}

/// A RUN THE RELOAD KILLED IS NOT A RUN THAT FINISHED (R7-3). The status fact
/// says `Idle` after a reload, truthfully, and the row printed `main ready · 26
/// turns` beside a conversation saying that turn is not running any more. The
/// word is `fold::abandoned_run`'s — Chat's own note's word.
fn orphaned(status: Status, ctx: &Ctx, who: &str) -> bool {
    !status.is_busy() && crate::chat::fold::abandoned_run(ctx, who)
}

/// …AND A RUN THAT ABANDONED ITS TASK IS NOT ONE THAT FINISHED (R17-P0-2).
/// Same shape, one ending along: the status fact says `ready` after a turn that
/// stopped without answering, because "ready" is a fact about who owes the next
/// move and not about how the last one went. `ending::of` is the one fold that
/// knows, and the Dashboard card reads it off this row.
fn last_ending(status: Status, ctx: &Ctx, who: &str) -> Option<Ending> {
    match status.is_busy() {
        true => None,
        false => crate::failure::ending::of(ctx, who),
    }
}

/// The one word for the status, preferring the two endings the status fact
/// cannot see over the plain gloss of it.
fn word_for(orphaned: bool, ended: Option<&'static str>, status: Status) -> &'static str {
    match (orphaned, ended) {
        (true, _) => "stopped mid-turn",
        (false, Some(said)) => said,
        (false, None) => gloss(status),
    }
}

/// …AND WHETHER THERE IS ANYTHING TO GIVE IT (32). Eight cards differed by name
/// and status word alone, so the board — the one place a person compares agents
/// — said nothing about the difference that decides whether the Dashboard will
/// even show a Start control. It is NOT part of the live line: that is a
/// launched RUN's report, and this is a standing fact about the agent, true
/// before the run and after it.
fn with_offer(said: &str, offer: &Offer) -> String {
    match offer.said.is_empty() {
        true => said.to_string(),
        false => format!("{said} · {}", offer.said),
    }
}

/// THE WHOLE ROW IN ONE STRING (R6-6). The Dashboard's launcher replaces its
/// own invitation with what this row knows; the alternative was a second
/// wording or a parser over the fragment. Written once, read twice.
fn whole_row(said: &str, live: &Option<String>) -> String {
    match live {
        Some(rest) => format!("{said} · {rest}"),
        None => said.to_string(),
    }
}

/// Where this agent came from, WHEN that is not the ordinary case. An agent
/// shipped with the site is what a person expects and says nothing; the two
/// that are worth a word are the one this browser wrote and the one compiled
/// in. "from public/agents/" was a repository path on every ordinary row.
fn origin(agent: &AgentRow, authored: &[(String, String)]) -> String {
    match (authored.iter().find(|(n, _)| *n == agent.name), agent.builtin) {
        (Some((_, by)), _) if by.is_empty() => "written here".to_string(),
        (Some((_, by)), _) => format!("written here by {by}"),
        (None, true) => "built in to this build".to_string(),
        (None, false) => String::new(),
    }
}

/// The status in words a stranger already knows — ONE short label per state
/// (R3-12). One list held three wordings for one lifecycle state at once, and
/// the long ones wrapped: ragged heights as well as three vocabularies. `Idle`
/// and `Waiting` differ only in who is owed the next move, a fact about the
/// runtime, not the agent. The count beside it does the rest of the work:
/// "ready · 3 turns in all" says it has worked and is free now.
fn gloss(status: Status) -> &'static str {
    match status {
        Status::Starting => "starting up",
        Status::Idle | Status::Waiting => "ready",
        Status::Working => "working",
        Status::Failed => "failed",
        Status::Closed => "stopped",
    }
}
