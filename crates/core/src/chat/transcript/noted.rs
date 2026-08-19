//! What the MACHINE wrote about a turn, as against what was said in it: how the
//! turn ended, a sub-agent's failure, a background summarisation that failed,
//! and this page's own errors. Every one of them arrives as a `Custom` fact,
//! and the kinds this page has no sentence about draw nothing.

use kernel::EventKind;

use super::{Walk, Woven};
use crate::failure::card::failure;
use crate::chat::fold::msg;

/// One `Custom` fact, rendered.
pub(super) fn noted(woven: Woven, walk: &mut Walk, fact: &EventKind, who: &str) -> Woven {
    let EventKind::Custom { kind, payload_json } = fact else {
        return woven;
    };
    if crate::failure::ending::is_note(kind) {
        return ended(woven, kind, payload_json, who);
    }
    match kind.as_str() {
        "core.agent_error" => agent_failure(woven, walk, payload_json, who),
        "core.compaction_failed" => compaction_failed(woven, payload_json),
        "core.error" => error(woven, walk, payload_json),
        _ => woven,
    }
}

/// HOW THE TURN ENDED, IN ONE ARM (R17-P0-2). The stop, the round ceiling and
/// the stopped wait were three arms with three wordings, and a fourth ending —
/// a turn that stopped without answering — had no wording anywhere. Every
/// sentence about an ending is `ending::machine_note`'s, beside the fold the
/// row and card read.
fn ended(mut woven: Woven, kind: &str, payload_json: &str, who: &str) -> Woven {
    if let Some((speaker, note)) = crate::failure::ending::machine_note(kind, payload_json, who) {
        woven.list = woven.list.child(msg("msg pending", &speaker, &note, &[]));
        woven.count += 1;
    }
    woven
}

/// A sub-agent's failure, on the same card as a failure on this page's own
/// agent: one failure, one presentation, and the cause reachable from either.
/// It folds on the failure INSIDE the envelope, by the same rule this page's
/// own failures fold by — a sub-agent refused five times was five identical
/// cards (R3-4).
fn agent_failure(mut woven: Woven, walk: &mut Walk, payload_json: &str, who: &str) -> Woven {
    let detail = crate::failure::from_worker::detail_of(payload_json);
    woven.list = woven.list.child(match walk.said.fold(&detail) {
        Some(again) => again,
        None => crate::failure::from_worker::agent_failure(payload_json, who),
    });
    woven.count += 1;
    woven
}

/// A background summarisation that failed. It is NOT this turn's failure — the
/// turn carried on with the full history — so it is not a failure card, it does
/// not end the wait, and it counts toward nothing. Saying nothing at all was
/// the bug: one request went out, it was not the user's, and the transcript
/// showed their question failing (09 walk).
fn compaction_failed(mut woven: Woven, payload_json: &str) -> Woven {
    woven.list = woven.list.child(crate::failure::card::compaction_failed(payload_json));
    woven
}

/// This page's own failure, written out IN FULL the first time and folded onto
/// that first copy every time after (`failure::dedupe::Seen`).
fn error(mut woven: Woven, walk: &mut Walk, payload_json: &str) -> Woven {
    woven.list = woven.list.child(match walk.said.fold(payload_json) {
        Some(again) => again,
        None => failure(payload_json),
    });
    woven.count += 1;
    woven
}
