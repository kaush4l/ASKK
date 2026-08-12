//! WHICH facts a conversation is made of, and what the log says ABOUT itself:
//! whose message is whose, whether a turn is really being driven, what the
//! last line should say, and what the page has spent. Split from
//! `transcript.rs`, which renders the conversation, so both hold the 200-line
//! rule (I12).

use kernel::EventKind;
use module::view::Fragment;

use crate::dispatch::Ctx;
use crate::transcript::{msg, ORPHANED};

/// Which conversation one fact belongs to. Tool calls, notes and errors happen
/// inside THIS process's loop, so they belong to its own agent; a message or a
/// reply carries its own name, and an empty one means the same thing.
pub(crate) fn belongs_to(kind: &EventKind, me: &str, who: &str) -> bool {
    let named = |agent: &str| match agent.is_empty() {
        true => who == me,
        false => who == agent,
    };
    match kind {
        EventKind::UserMessage { agent, .. } | EventKind::ModelReplied { agent, .. } => {
            named(agent)
        }
        EventKind::ToolInvoked { .. } => who == me,
        EventKind::Custom { kind, payload_json } => match kind.as_str() {
            "core.note" | "core.error" | "core.compaction_failed" => who == me,
            // Whose wait ended. Empty is this process's own agent, which is
            // every record written before a pane could stop waiting on a turn
            // running in somebody else's Worker (12b).
            k if k == crate::chat::TURN_STOPPED => match crate::chat::stopped_agent(payload_json) {
                name if name.is_empty() => who == me,
                name => who == name,
            },
            "core.agent_error" => crate::told::agent_of(payload_json) == who,
            _ => false,
        },
        _ => false,
    }
}

/// Whether something is really DRIVING this agent's turn. `awaiting` is only
/// the shape of the log — the last thing said was a person's — and a reload
/// replays that shape with no fetch behind it: the pane sat disabled on
/// "thinking…" with a frozen clock while the board beside it correctly read
/// idle, and only wiping storage recovered it (12 walk, finding 1).
///
/// Three sources, all of them state this process really holds: the utterance
/// this request just accepted, the pump queue it is about to enter, and the
/// board — itself the fold of `AgentStatus` facts, so this is the log asking the
/// log. None of them survives a reload, which is the whole point.
pub(crate) fn driven(ctx: &Ctx, who: &str, accepted: bool) -> bool {
    accepted
        || ctx.queued.iter().any(|a| a == who)
        || ctx.board.iter().any(|r| r.name == who && r.status.is_busy())
}

/// The last line of a conversation, when the conversation itself does not
/// finish the story: a turn still running, a turn nothing is running any more,
/// or an agent nobody has said anything to yet.
pub(crate) fn tail(pending: bool, awaiting: bool, count: usize, who: &str) -> Option<Fragment> {
    match (pending, awaiting, count) {
        (true, _, _) => Some(msg("msg pending", "", "thinking…")),
        (false, true, _) => Some(msg("msg pending", "", ORPHANED)),
        (false, false, 0) => Some(msg(
            "msg pending",
            "",
            &format!("No messages yet — ask {who} something."),
        )),
        _ => None,
    }
}

/// Every token this page has spent, from the log alone (I8): the sum of every
/// `ModelCalled` fact, which is the only place a provider's accounting block
/// lands. Turns whose provider reported nothing contribute nothing — the
/// number is a floor, and the meter says so rather than inventing an estimate.
pub(crate) fn spent(ctx: &Ctx) -> u64 {
    ctx.recent
        .iter()
        .filter_map(|kind| match kind {
            EventKind::ModelCalled { spent_tokens, .. } => Some(u64::from(*spent_tokens)),
            _ => None,
        })
        .sum()
}

