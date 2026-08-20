//! THE RECORD OF ONE CHECK — the fact a person reads, and the line the model
//! reads. Its own file beside the mechanism for the same reason
//! `core::failure::stopped_notice` is its own file beside the endings: what
//! HAPPENED and what is SAID ABOUT IT are two jobs, and the second one has an
//! audience the first does not.
//!
//! Both readers are served from the same three values — the command, the exit
//! code as a bit, and what it printed — so the sentence in the conversation and
//! the sentence in the prompt cannot come apart and tell two stories about one
//! command. That is the rule this codebase keeps paying for elsewhere.

use kernel::EventKind;

use crate::effect::Effect;

/// THE CHECK RAN, AND WHAT IT SAID (I8). The machine ran a command the person
/// never asked for; a round nobody can see is a token meter running behind a
/// spinner. Payload: `{"command": …, "ok": bool, "output": …}`, the shape rule
/// `passes::PASS_SPENT` and `stages::STAGE_ENTERED` already follow.
pub const GOAL_CHECKED: &str = "core.goal_checked";

/// How much of the output the fact carries. Enough to read the failure in the
/// conversation without putting a whole build log in an append-only store.
const KEPT: usize = 2_000;

/// ONE FACT PER CHECK, and one rather than two. A fact when the command is
/// ISSUED would say only that something is about to happen — and the
/// `ToolInvoked` the runtime appends already records that much — while this one
/// can say what it was for and how it came out. A check is one event to a
/// reader, so it is one record.
pub(crate) fn checked(command: &str, ok: bool, output: &str) -> Effect {
    let kept: String = output.trim().chars().take(KEPT).collect();
    Effect::Emit {
        kind: EventKind::Custom {
            kind: GOAL_CHECKED.into(),
            payload_json: serde_json::json!({
                "command": command, "ok": ok, "output": kept,
            })
            .to_string(),
        },
    }
}

/// Which command ran, whether it passed, and what it printed — for the
/// projections. An unreadable record reads as no check at all, like every other
/// payload in this crate: a log written before this fact existed says nothing
/// rather than guessing.
pub fn checked_of(payload_json: &str) -> (String, bool, String) {
    let read = |v: &serde_json::Value, k: &str| {
        v.get(k).and_then(|s| s.as_str()).unwrap_or_default().to_string()
    };
    serde_json::from_str::<serde_json::Value>(payload_json)
        .map(|v| {
            let ok = v.get("ok").and_then(serde_json::Value::as_bool).unwrap_or_default();
            (read(&v, "command"), ok, read(&v, "output"))
        })
        .unwrap_or_default()
}

/// What the MODEL reads back, into `observations`. It QUOTES THE COMMAND, which
/// is how the model comes to know what it is being measured by — and
/// `components::goal` holds why being shown the result is the honest order to
/// learn that in, rather than being handed the command up front as a target.
pub(crate) fn said(command: &str, ok: bool, output: &str) -> String {
    let verdict = match ok {
        true => "It passed.",
        false => "It did not pass.",
    };
    format!("The goal check ran: $ {command}\n{verdict}\n{}", output.trim())
}
