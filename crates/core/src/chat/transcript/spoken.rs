//! The message-shaped facts: what the person said, what the model replied, and
//! the tool calls a reply set off. A whole RUN of tool-calling replies leaves
//! one announcement behind, so this module also owns when such a run ends.

use kernel::EventKind;

use super::{Walk, Woven};
use crate::chat::call_announcement::Calls;
use crate::chat::fold::msg;

/// Whether this fact draws NOTHING here. A run of tool calls ends at the next
/// fact that renders, and the `ToolInvoked` facts between two rounds render
/// nothing, so they must not break the run (R7-15).
pub(super) fn renders_nothing(kind: &EventKind) -> bool {
    matches!(kind, EventKind::ToolInvoked { .. })
        || matches!(kind, EventKind::ModelReplied { text, .. } if agent::has_calls(text))
}

/// The one announcement a run of tool-calling replies leaves behind (R7-15).
/// Nothing at all when no run is open.
pub(super) fn announced(mut woven: Woven, calls: &mut Calls, who: &str) -> Woven {
    let Some(one) = calls.take() else { return woven };
    // `Calls::take` owns the tense (R16-P1-1): the run has ENDED by the time
    // this is written, so it reads `main called write_file`.
    woven.list = woven.list.child(msg("msg system", "", &format!("{who} {one}"), &[]));
    woven.count += 1;
    woven
}

/// One message-shaped fact, rendered. `Custom` facts are `noted`'s.
pub(super) fn spoken(
    woven: Woven,
    walk: &mut Walk,
    who: &str,
    nth: usize,
    kind: &EventKind,
) -> Woven {
    match kind {
        EventKind::UserMessage { text, from, .. } => person(woven, walk, who, nth, text, from),
        EventKind::ModelReplied { text, .. } if agent::has_calls(text) => calling(woven, walk, text),
        EventKind::ModelReplied { text, .. } => answered(woven, walk, who, text),
        EventKind::ToolInvoked { tool, args, ok, output } => {
            invoked(woven, walk, &tool.0, args, *ok, output)
        }
        _ => woven,
    }
}

/// What the person said — AND WHAT THE PAGE SAYS ABOUT THE TURN IT LANDED IN,
/// which is `chat::steer_notice::said`'s for both readers at once (R18-P0-1): a message
/// over an open turn was drawn as a turn a RELOAD had abandoned, and a steer
/// has exactly that shape.
fn person(mut woven: Woven, walk: &Walk, who: &str, nth: usize, text: &str, from: &str) -> Woven {
    let open = woven.awaiting.then(|| walk.steers.contains(&nth));
    woven.list = crate::chat::steer_notice::said(woven.list, who, from, text, &walk.files, open);
    if from.is_empty() {
        woven.last_said = text.to_string();
    }
    woven.count += 1;
    woven
}

/// A reply that CALLS tools has not answered anything: the turn is still
/// running, and the pane must keep watching. The Tool trace panel owns what was
/// called — BESIDE this, never "below" (R3-17). …AND WHICH ONES (R5-20): the
/// names are parsed here and gathered until the run of them ends (R7-15).
fn calling(woven: Woven, walk: &mut Walk, text: &str) -> Woven {
    walk.calls.push(text);
    woven
}

/// …AND A REPLY THAT IS MACHINE OUTPUT IS NOT AN ANSWER (R17-P0-2).
/// `exec({"command": "cat a.md"}, {"command": "cat b.md"}, …)` was an
/// `msg assistant` bubble in the agent's own name, with the Dashboard's
/// `Read the reply` button pointing at it. Which of the two this is, is
/// `ending::reply`'s to decide — the same predicate `step` ended the turn by,
/// so the bubble and the card agree.
fn answered(mut woven: Woven, walk: &Walk, who: &str, text: &str) -> Woven {
    woven.list = woven.list.child(crate::failure::ending::reply(who, text, &walk.files));
    woven.count += 1;
    woven
}

/// A tool call: COUNTED, and drawn nowhere. This sets NO wait, because a
/// command a person typed into the terminal is a `ToolInvoked` too and
/// asserting `awaiting` here left the composer disabled over a turn nobody had
/// started. The pane's patience is silence-based instead, and the call's
/// OUTCOME goes to the run's announcement (R9-3) — which sat above a reply read
/// as an unqualified answer over a trace whose first row was red. `Calls::note`
/// only counts inside an open run, so a typed command is never the agent's turn
/// failing.
fn invoked(
    mut woven: Woven,
    walk: &mut Walk,
    tool: &str,
    args: &str,
    ok: bool,
    output: &str,
) -> Woven {
    woven.tools += 1;
    walk.calls.note(tool, args, ok, output);
    woven
}
