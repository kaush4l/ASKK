//! WHICH facts a conversation is made of, and what the log says ABOUT itself:
//! whose message is whose, whether a turn is really being driven, what the
//! last line should say, and what the page has spent. Split from
//! `transcript.rs`, which renders the conversation, so both hold the 200-line
//! rule (I12).

use kernel::EventKind;
use module::view::{Fragment, FragmentBuilder};

use crate::dispatch::Ctx;

/// One message, with WHO SAID IT in words: carried by the class alone, a
/// question and its answer were two identical paragraphs with the stylesheet
/// off (`ux-walker`, increment 06).
pub(crate) fn msg(class: &str, speaker: &str, text: &str, files: &[String]) -> Fragment {
    let mut row = FragmentBuilder::new("div").class(class);
    if !speaker.is_empty() {
        row = row.child(
            FragmentBuilder::new("span")
                .class("speaker")
                .text(&format!("{speaker}: "))
                .build(),
        );
    }
    // Markdown-lite from here (R4-11): inline spans, fenced blocks, paragraph
    // breaks. Same `.said` span, same escaping primitives.
    row.child(crate::markdown::said(text, files)).build()
}

/// WHAT AN ABANDONED TURN LEAVES on the conversation: "thinking…" locked the
/// composer behind a clock that could not tick (12 walk, finding 1). Here
/// rather than in `transcript.rs` because the fold that decides it is here
/// (`abandoned_run`), and the board says the same thing off the same fold.
pub(crate) const ORPHANED: &str = "That turn is not running any more — the page was reloaded while it \
                        was in flight, so nothing is driving it. Nothing was lost; ask again.";

/// What a stopped turn leaves on the transcript. It said "the turn ended
/// here", which reads as "I cancelled it" (R3-6). Nothing here cancels.
pub(crate) const STOPPED: &str = "You stopped waiting. Nothing was cancelled — the agent \
                       carries on working, a command already running in the Linux runs to the end, and a \
                       reply that arrives later is in the log. This conversation is yours again, \
                       and anything you saved takes effect now.";

/// WHO a notice is from, when it is not speech. `You stopped waiting…` and the
/// tool loop's own word rendered with no prefix at all, in a column where every
/// other line carried one (R3-17). It is not the agent and it is not you: it is
/// this page, in the same slot, in a word that is plainly not a name.
pub(crate) const NOTICE: &str = "Note";

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
            // A stop happens at a boundary of THIS loop, like the note above
            // it — and so do the ending (R17-P0-2), the steer (R18-P0-1), the
            // verify nudge (19) and the stage (20): all of them this process's.
            k if k == agent::STOPPED || k == agent::ENDED => who == me,
            k if k == agent::STEERED || k == agent::VERIFY_NUDGED => who == me,
            k if k == agent::STAGE_ENTERED => who == me,
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

/// WHAT ONE FACT DOES TO THE WAIT: opens it (`Some(true)`), closes it
/// (`Some(false)`), or says nothing about it (`None`).
///
/// ONE RULE, TWO READERS (R7-3). The transcript folded this inline while the
/// board read only the `AgentStatus` fact, so a run killed by a reload had
/// Chat saying "that turn is not running any more" and the board beside it
/// saying `main ready · 26 turns` — reporting an abandoned run as a finished
/// one. A `ToolInvoked` is deliberately absent: a command a person typed into
/// the terminal is one too.
pub(crate) fn awaits(kind: &EventKind) -> Option<bool> {
    match kind {
        EventKind::UserMessage { .. } => Some(true),
        // A reply that CALLS tools has answered nothing: the turn is still up.
        // A reply that does not is the answer, and closes it.
        EventKind::ModelReplied { text, .. } => Some(agent::has_calls(text)),
        EventKind::Custom { kind, .. } => match kind.as_str() {
            "core.note" | "core.error" | "core.agent_error" => Some(false),
            k if k == agent::STOPPED => Some(false), // the turn ended, by you
            k if k == agent::ENDED => Some(false),   // …and this one says how
            k if k == agent::VERIFY_NUDGED => Some(true), // …and this reopens it
            k if k == agent::STAGE_ENTERED => Some(true), // …and so does this
            k if k == crate::chat::TURN_STOPPED => Some(false),
            _ => None,
        },
        _ => None,
    }
}

/// Whether this agent's last turn was ABANDONED: the log is still waiting for
/// an answer and nothing in this process is driving it. Exactly the condition
/// the transcript renders `ORPHANED` for, as one function, so the board and the
/// conversation cannot tell two stories about one turn (R7-3).
pub(crate) fn abandoned_run(ctx: &Ctx, who: &str) -> bool {
    let awaiting = ctx
        .recent
        .iter()
        .filter(|k| belongs_to(k, &ctx.me, who))
        .filter_map(awaits)
        .next_back()
        .unwrap_or(false);
    awaiting && !driven(ctx, who, false)
}

/// THE NOTE AN ABANDONED TURN KEEPS (R6-11). `tail` renders this only for the
/// LAST turn, which was true of the only turn anybody had noticed it on — and
/// then a second message landed and the note vanished, leaving a `YOU:` in the
/// transcript with no reply and no explanation, for ever. A turn is abandoned
/// the moment a later fact starts a new one over the top of it, and that never
/// stops being true afterwards, so `transcript` writes this at the point in the
/// log where the abandonment actually happened. History has to stay true after
/// new events land; a projection that only explains its own last row is a
/// projection that un-explains itself.
pub(crate) fn abandoned() -> Fragment {
    msg("msg pending", NOTICE, ORPHANED, &[])
}

/// The last line of a conversation, when the conversation itself does not
/// finish the story: a turn still running, a turn nothing is running any more,
/// or an agent nobody has said anything to yet.
pub(crate) fn tail(pending: bool, awaiting: bool, count: usize, who: &str) -> Option<Fragment> {
    match (pending, awaiting, count) {
        // The agent IS the one thinking, so the agent's name is the honest
        // prefix; the other two are the page's own word about the log, and
        // wear `NOTICE` (R3-17). Every line in this column now has one.
        (true, _, _) => Some(msg("msg pending", who, "thinking…", &[])),
        (false, true, _) => Some(msg("msg pending", NOTICE, ORPHANED, &[])),
        (false, false, 0) => Some(msg(
            "msg pending",
            NOTICE,
            &format!("No messages yet — ask {who} something."),
            &[],
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
            // A sub-agent's turns are paid for out of the same key, and its
            // spend reaches this log only because its Worker reports it. The
            // meter says "every token this page has spent"; a number that
            // counted one agent of four was not that.
            EventKind::Custom { kind, payload_json } if kind == crate::told::AGENT_ACTIVITY => {
                crate::told::activity(payload_json)?
                    .1
                    .get("spent")?
                    .as_u64()
            }
            _ => None,
        })
        .sum()
}

