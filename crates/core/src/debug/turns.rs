//! WHAT ONE TURN DID, folded out of the log (I8). Nothing here is new
//! instrumentation: every field below is a fact the harness has been persisting
//! and nobody has been reading.
//!
//! THE UNIT IS THE TURN, because that is the unit a person asks about. "Why did
//! this take four model calls" is not a question about an event, it is a
//! question about the message that set the four off — so the fold opens a turn
//! at each `UserMessage` and hangs everything after it on that turn.
//!
//! A ROUND IS A MODEL CALL AND THE REPLY IT GOT, paired. `effects.rs` emits
//! `ModelCalled` FIRST and the reply second, deliberately ("a reader folding
//! the log sees the cost of a reply before the reply"), so the cost and the
//! document hash are held for exactly one reply and attached to it. A call that
//! never came back leaves `called` ahead of `rounds`, which is itself the
//! answer to "where did the turn go".

use kernel::EventKind;

use crate::debug::route::{self, Chosen};
use crate::dispatch::Ctx;

/// One model call and the reply it produced.
pub(crate) struct Round {
    pub(crate) at: i64,
    /// `ModelCalled::document_hash` — the assembled Document this round was
    /// sent, which had no reader anywhere in the tree. Two rounds with the same
    /// hash are two identical prompts, and that is a loop.
    pub(crate) hash: String,
    pub(crate) spent: u32,
    /// The tools this reply called, `agent::named`'s folding. Empty means the
    /// reply was prose.
    pub(crate) tools: Vec<String>,
    /// WHICH STAGE ASKED FOR IT. The stage entered immediately before the call
    /// (`stages::step_into` emits the fact, then makes the call), so a round can
    /// say it was the vote rather than being read as an answer nobody saw.
    pub(crate) stage: String,
    pub(crate) text: String,
}

/// One turn: what opened it, what it decided, what it spent, what broke.
#[derive(Default)]
pub(crate) struct Turn {
    pub(crate) said: String,
    pub(crate) from: String,
    pub(crate) at: i64,
    pub(crate) route: Option<Chosen>,
    pub(crate) entered: Vec<String>,
    /// `PhaseEntered` — the ADR-010 phase machine underneath the stages, whose
    /// moves have been logged since G4 and read by nothing. Consecutive
    /// repeats are folded: what is worth seeing is the WALK.
    pub(crate) phases: Vec<String>,
    pub(crate) rounds: Vec<Round>,
    pub(crate) called: u32,
    pub(crate) tokens: u32,
    pub(crate) failures: Vec<(String, String)>,
}

/// Every turn in the log for `who`, oldest first — the pane reverses it.
pub(crate) fn turns(ctx: &Ctx, who: &str) -> Vec<Turn> {
    let mut out: Vec<Turn> = Vec::new();
    let mut pending: Option<(String, u32)> = None;
    for (nth, kind) in ctx.recent.iter().enumerate() {
        if !route::mine(kind, ctx, who) {
            continue;
        }
        let at = ctx.at.get(nth).copied().unwrap_or_default();
        if let EventKind::UserMessage { text, from, .. } = kind {
            pending = None;
            out.push(Turn {
                said: text.trim().to_string(),
                from: from.clone(),
                at,
                ..Turn::default()
            });
            continue;
        }
        if let Some(turn) = out.last_mut() {
            note(turn, kind, at, &mut pending);
        }
    }
    out
}

/// One fact onto the open turn.
fn note(turn: &mut Turn, kind: &EventKind, at: i64, pending: &mut Option<(String, u32)>) {
    match kind {
        EventKind::ModelCalled { document_hash, spent_tokens } => {
            turn.called += 1;
            turn.tokens += spent_tokens;
            *pending = Some((document_hash.clone(), *spent_tokens));
        }
        EventKind::ModelReplied { text, .. } => {
            let (hash, spent) = pending.take().unwrap_or_default();
            turn.rounds.push(Round {
                at,
                hash,
                spent,
                stage: turn.entered.last().cloned().unwrap_or_default(),
                tools: agent::named(text),
                text: text.trim().to_string(),
            });
        }
        EventKind::PhaseEntered { phase } => {
            let name = format!("{phase:?}").to_lowercase();
            if turn.phases.last() != Some(&name) {
                turn.phases.push(name);
            }
        }
        EventKind::ToolInvoked { tool, args, ok: false, output } => {
            turn.failures.push((tool.0.clone(), format!("{args} — {output}")));
        }
        EventKind::Custom { kind: k, payload_json } if k == agent::ROUTE_CHOSEN => {
            turn.route = Some(route::read(payload_json));
        }
        EventKind::Custom { kind: k, payload_json } if k == agent::STAGE_ENTERED => {
            let stage = agent::stage_of(payload_json);
            if !stage.is_empty() {
                turn.entered.push(stage);
            }
        }
        _ => {}
    }
}

/// WHAT THE TURN COST. A turn that quietly became four model calls instead of
/// one is the thing this pane exists for.
///
/// THE COUNT IS A LOWER BOUND AND SAYS SO WHEN IT IS ONE. `ModelCalled` is
/// emitted only where the provider reported usage (`effects.rs`), so an
/// endpoint that reports none leaves a turn with replies and no calls. A reply
/// cannot exist without a call, so the honest figure is whichever of the two is
/// larger, and the tokens line says the endpoint gave no numbers rather than
/// printing a nought that reads as free.
pub(crate) fn calls_in(turn: &Turn) -> usize {
    (turn.called as usize).max(turn.rounds.len())
}

/// EVERY STORAGE WRITE THAT FAILED, whoever was talking. `StoreFailed` has been
/// in the closed vocabulary since G2 and has had ZERO readers: ADR-005 promised
/// a quota error would surface and never be silent, and the fact was recorded
/// and shown to nobody. It is not scoped to an agent because it is not about
/// one — it means this browser stopped persisting the conversation, for
/// everybody in it.
pub(crate) fn store_failures(ctx: &Ctx) -> Vec<(String, String)> {
    ctx.recent
        .iter()
        .filter_map(|kind| match kind {
            EventKind::StoreFailed { key, message } => Some((key.clone(), message.clone())),
            _ => None,
        })
        .collect()
}

#[cfg(test)]
#[path = "projected.rs"]
mod projected;
