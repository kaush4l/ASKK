//! THE FLEET AT A GLANCE — the strip of tiles above the Dashboard's grid.
//!
//! Four facts about the whole fleet, each one a projection of the same fold
//! the board already renders (I8). It is a second RENDERING of that fold and
//! never a second COUNT of it: `busy_names` lives here and `board.rs` calls it
//! for its own `x-busy` header, so the number in the tile and the names in the
//! header are one computation. A tile that counted rows in its own loop is how
//! two regions on one screen end up disagreeing about how many agents are
//! working, which is the defect class `boardrow`'s `data-line` was written to
//! close.
//!
//! **What a tile says when it has nothing.** It says so, in words: `no turns
//! yet`, `nothing spent yet`, `no agents are loaded`. No ellipsis, no dash, no
//! spinner standing in for a number that is not coming — a placeholder in the
//! value slot is a promise that something is on its way, and for a log with no
//! facts in it nothing is.
//!
//! **And no tile reports health.** The failure tile says a turn failed and
//! names whose; when the log holds no failure it says that the log holds no
//! failure, which is a count and not a verdict. Nothing here infers that the
//! page is well from the absence of something going wrong, so there is no
//! green summary tile and no word like `all`, `healthy` or `fine` in this
//! file. A failure is reported; a success is not announced.

use kernel::{Response, Status};
use module::view::{Fragment, FragmentBuilder};

use crate::dispatch::{html, Ctx};

/// WHO is working right now, by name.
///
/// It was written inline in `board.rs` and is here because two readers need
/// the identical answer: that file's `x-busy` header, which the chrome wears,
/// and the tile below, which says how many of them there are. A task ACCEPTED
/// for an agent whose Worker has not entered the turn yet is work in progress
/// — `ctx.queued` is the signal the launcher announces at the press — and a
/// count that used only the status fact would read one lower than the header
/// beside it for as long as that gap lasts.
pub(crate) fn busy_names(ctx: &Ctx) -> Vec<String> {
    ctx.board
        .iter()
        .filter(|r| r.status.is_busy() || ctx.queued.contains(&r.name))
        .map(|r| r.name.clone())
        .collect()
}

/// One tile: what the fact is called, and the fact. Two elements, because the
/// name is a `--t-caption` eyebrow and the value is the thing being read, and
/// the value keeps ONE size in every state (DESIGN §5) — the words a tile with
/// nothing to report says are rendered exactly where its number would be.
fn tile(name: &str, said: &str, status: &str) -> Fragment {
    FragmentBuilder::new("div")
        .class("tile")
        // Emitted always, `idle` or `failed`, rather than omitted when there
        // is nothing wrong: an absent attribute lets a reader scanning one
        // tile fall through to the next tile's value (`agentcard`'s rule for
        // `data-space`). Only `failed` carries a colour; `idle` is the
        // stylesheet's neutral, because this product has no green for "fine".
        .attr("data-status", status)
        .child(FragmentBuilder::new("p").class("tile-name").text(name).build())
        .child(FragmentBuilder::new("p").class("tile-said").text(said).build())
        .build()
}

/// HOW MANY AGENTS ARE WORKING, OUT OF HOW MANY ARE LOADED. The denominator is
/// the fact that makes the numerator readable: `0` alone is the same picture
/// on a page running nothing and on a page that loaded nothing, and those are
/// different situations with different fixes (`board::nothing_loaded`).
fn working(ctx: &Ctx) -> Fragment {
    let loaded = ctx.board.len();
    let busy = busy_names(ctx).len();
    let said = match (loaded, busy) {
        (0, _) => "no agents are loaded".to_string(),
        (1, 0) => "the one agent is idle".to_string(),
        (n, 0) => format!("none of {n} agents"),
        (n, b) => format!("{b} of {n} agents"),
    };
    tile("Agents working", &said, "idle")
}

/// TURNS TAKEN BY THE WHOLE FLEET. `AgentRow::turns` rises when an agent
/// enters `Working`, so this counts jobs taken and not answers given — the
/// same number, and the same reading of it, that `boardrow` prints per row
/// (R3-13). Summed across the board rather than re-derived from the log,
/// because the board IS that fold.
fn turns(ctx: &Ctx) -> Fragment {
    let total: u64 = ctx.board.iter().map(|r| u64::from(r.turns)).sum();
    let said = match total {
        0 => "no turns yet".to_string(),
        1 => "1 turn".to_string(),
        n => format!("{} turns", grouped(n)),
    };
    tile("Turns taken", &said, "idle")
}

/// WHAT THE PAGE HAS SPENT — `fold::spent`, the same sum the `x-tokens` header
/// carries, so the tile and the header's meter are one number twice rendered.
/// Zero is "nothing spent yet" and not "0": a provider that reported no usage
/// contributes nothing, so the figure is a floor, and a bare zero over a turn
/// that really happened reads as a claim that the turn was free.
fn tokens(ctx: &Ctx) -> Fragment {
    let said = match crate::fold::spent(ctx) {
        0 => "nothing spent yet".to_string(),
        n => grouped(n),
    };
    tile("Tokens spent", &said, "idle")
}

/// WHETHER THE LAST TURN FAILED, AND WHOSE.
///
/// The wording is the board row's, which is the projection's own word and
/// therefore the one that survives (DESIGN §11, "one event, one name"): the
/// card reads `main's turn failed`. The reason is not in the tile — it is a
/// sentence, the failure banner already carries it whole, and a tile is a
/// glance.
///
/// With no failure in the log this says exactly that and stops. It is a count
/// of failure facts, not a verdict on the page: nothing here can know that the
/// endpoint is reachable, that the Linux booted, or that an answer was any
/// good, so nothing here says so.
fn failed(ctx: &Ctx) -> Fragment {
    match ctx.board.iter().find(|r| r.status == Status::Failed) {
        Some(row) => tile("Last failure", &format!("{}'s turn failed", row.name), "failed"),
        None => tile("Last failure", "no turn has failed yet", "idle"),
    }
}

/// The strip. Four tiles, in the order a person asks the questions: is anything
/// running, how much work has this page done, what has it cost, and did the
/// last thing break.
pub(crate) fn strip(ctx: &Ctx) -> Response {
    let strip = FragmentBuilder::new("div")
        .id("fleet-tiles")
        .class("tiles")
        .attr("role", "group")
        .attr("aria-label", "The fleet at a glance")
        .child(working(ctx))
        .child(turns(ctx))
        .child(tokens(ctx))
        .child(failed(ctx))
        .build();
    html(200, strip.into_html())
}

/// WHERE ONE AGENT'S CARD GOES (27). The board was a list of lines you could
/// read and not act on: to see what the agent it had just told you was working
/// had actually run, you went to the nav, opened Trace, and found the agent
/// strip. Two doors per card — Chat, which is that agent's conversation, and
/// Trace, which is its calls — and they are the two screens that are ABOUT one
/// agent. Here rather than in `boardrow.rs` because that file was full (I12).
///
/// The mechanism is the roster's and deliberately not a second one: a button
/// carrying `data-open`, read by one delegated handler on the deck
/// (`ui/board.rs`, mirroring `ui/roster.rs::pressed`). A component per card
/// would put a Dioxus tree inside a fragment the core renders, which is what
/// `dangerous_inner_html` exists to avoid. `editor-picks` is the existing "a
/// row of buttons in a card" class rather than a seventh nobody agreed to.
///
/// Named for the DESTINATION, never "Start": nothing here starts a turn
/// (R5-3), and a door on a row that is already inside one must not read as an
/// offer to begin another.
pub(crate) fn doors(name: &str) -> Fragment {
    let door = |to: &str, label: &str| {
        FragmentBuilder::new("button")
            .attr("type", "button")
            .class("btn-secondary")
            .attr("data-open", to)
            .text(label)
            .build()
    };
    FragmentBuilder::new("p")
        .class("editor-picks")
        .child(door("chat", &format!("Talk to {name}")))
        .child(door("trace", &format!("What {name} has run")))
        .build()
}

/// ONE FORMAT AT EVERY SIZE (R3-23): grouped digits, never a `k` suffix that
/// drops the last three of them under a reader who had learned to read the
/// number.
///
/// `ui::meter::grouped` is the same nine lines. They are not shared because
/// they are on opposite sides of a crate boundary and `meter.rs` belongs to
/// another change in flight; when someone owns both, this is the copy to keep,
/// because the format rule belongs with the projection that states the number.
pub(crate) fn grouped(n: u64) -> String {
    let digits = n.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, c) in digits.char_indices() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}
