//! WHICH MESSAGES WERE STEERS, and what the conversation says about one
//! (R18-P0-1). The reader half of `agent::steer`, beside `halted.rs` and
//! `ending.rs` for the same reason: one payload, one wording, and the
//! projections cannot come apart from the machine that wrote the fact.
//!
//! The bug this closes: a message typed into a running turn and a message typed
//! over a turn a reload had killed are the SAME shape in the log — an utterance
//! with no answer beneath it — so the conversation drew the reload note for
//! both. The turn was running; nothing had been reloaded.

use std::collections::HashSet;

use kernel::EventKind;
use module::view::FragmentBuilder;

use crate::dispatch::Ctx;
use crate::fold::{belongs_to, msg, NOTICE};

/// WHERE this agent's steers are, by log position. A `core.steered` fact is
/// written by `step` when it takes a message as a steer, and belongs to the
/// message it read — the nearest one before it in this conversation. Matched
/// that way rather than "the fact directly after", because the turn already in
/// flight can land a reply between the two.
pub(crate) fn steers(ctx: &Ctx, who: &str) -> HashSet<usize> {
    let (mut last, mut found) = (None, HashSet::new());
    for (nth, kind) in ctx.recent.iter().enumerate() {
        if !belongs_to(kind, &ctx.me, who) {
            continue;
        }
        match kind {
            EventKind::UserMessage { .. } => last = Some(nth),
            EventKind::Custom { kind, .. } if kind == agent::STEERED => found.extend(last.take()),
            _ => {}
        }
    }
    found
}

/// ONE MESSAGE FROM A PERSON, with whatever the page has to say about the turn
/// it landed in. `open` is `None` when no turn was open, `Some(true)` when one
/// was and READ it, `Some(false)` when one was and nothing was driving it.
///
/// Both readers come through here: the replayed log, and the message the
/// request being answered just accepted. They were two copies of this rule, and
/// the second copy had no steer case at all — which is why the answer to the
/// press said the page had been reloaded.
pub(crate) fn said(
    list: FragmentBuilder,
    who: &str,
    from: &str,
    text: &str,
    files: &[String],
    open: Option<bool>,
) -> FragmentBuilder {
    // A new message over a turn NOTHING was driving: that turn was abandoned,
    // and the note belongs here rather than only at the bottom of the log
    // (R6-11, `fold::abandoned`).
    let list = match open {
        Some(false) => list.child(crate::fold::abandoned()),
        _ => list,
    };
    let said_by = match from.is_empty() {
        true => "You",
        false => from,
    };
    let list = list.child(msg("msg user", said_by, text, files));
    // …and a steer's own sentence, BELOW the message rather than above it:
    // unlike the reload note it is about what you just sent, not about the turn
    // over the top of it.
    match open {
        Some(true) => list.child(msg("msg pending", NOTICE, &carried(who), &[])),
        _ => list,
    }
}

/// The sentence that stands where the reload note used to.
fn carried(who: &str) -> String {
    format!(
        "{who} was already working when you sent this, so it went to the run in flight — {who} \
         reads it on its next step. No new turn was started, and nothing was interrupted."
    )
}
