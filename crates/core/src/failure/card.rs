//! What a failed turn looks like to the person reading it. The rule is what it
//! always was — the actionable sentence first, the typed error verbatim behind
//! a disclosure named for what went wrong, nothing smoothed away.

use module::view::{Fragment, FragmentBuilder};

// The two sentences a failure is read as — WHICH one it was, and WHAT to do
// about it — are chosen next door; this file only places them.
use crate::failure::what_to_do::{failure_kind, failure_line};

/// A failed turn: the sentence a person can act on FIRST, the typed error
/// folded away behind it — verbatim, never smoothed into a reply.
pub(crate) fn failure(payload_json: &str) -> Fragment {
    card(
        &failure_line(payload_json),
        failure_kind(payload_json),
        payload_json,
    )
}

/// The one failure card: the actionable sentence first, the typed error folded
/// away behind a disclosure named for WHAT WENT WRONG.
///
/// IT IS NAMED, NOT NUMBERED (R8-15). It read `Technical detail for failure 1 —
/// the endpoint was unreachable` beside `…for failure 2 — the endpoint was
/// unreachable`: two labels differing only in an ordinal, on a page with no
/// notion of a numbered failure, identical in the one respect a reader would
/// tell them apart by. The number was added to give a screen reader two
/// distinct controls and gave it two indistinguishable ones with a digit in
/// front. What separates them is the KIND — and a recurrence of an identical
/// failure folds into "Same error (×n)" (`failure::dedupe::Seen`) rather than making a
/// second card at all.
pub(crate) fn card(sentence: &str, kind: &str, detail: &str) -> Fragment {
    // …AND WHERE THE FIX IS (R18-P1-7). Every failure card offered `Open
    // Settings`, including the one whose remedy is a line in an agent's file.
    // The KIND already decides that, so the class carries it and the pane makes
    // the same one-bit read of a rendered class `last_failed` already makes —
    // no second wording, and no header the transcript would have to keep.
    let class = match kind == crate::failure::what_to_do::NO_SUCH_MODEL {
        true => "msg error fix-file",
        false => "msg error",
    };
    FragmentBuilder::new("div")
        .class(class)
        // The word ERROR, in front of the sentence: with the stylesheet off the
        // block was pink prose in a pink border, i.e. a paragraph (F18).
        .child(FragmentBuilder::new("p").class("error-head").text("⚠ Error").build())
        .child(FragmentBuilder::new("p").text(sentence).build())
        .child(
            FragmentBuilder::new("details")
                .child(
                    FragmentBuilder::new("summary")
                        .text(&format!("Technical detail — {kind}"))
                        .build(),
                )
                .child(FragmentBuilder::new("pre").text(detail).build())
                .build(),
        )
        .build()
}

/// The conversation could not be shortened, said as what it is: the older
/// turns were not compacted, the conversation continued in full, and the next
/// turn will try again. Same disclosure shape as every other failure, so the
/// cause is one click away — but no `msg error` card, because the turn the
/// person asked for did not fail.
///
/// IT IS LABELLED, AND IT NAMES NO MACHINERY (R8-14). It was the one row in the
/// column with no speaker, and it opened on "A background summarisation of the
/// older turns failed" — which asks a first-timer to know this product
/// summarises anything. It does, and it never said so. So: the `Note:` prefix
/// every other aside carries (`fold::NOTICE`), and the effect, not the machine.
pub(crate) fn compaction_failed(payload_json: &str) -> Fragment {
    FragmentBuilder::new("div")
        .class("msg pending")
        .attr("role", "status")
        .child(
            FragmentBuilder::new("span")
                .class("speaker")
                .text(&format!("{}: ", crate::chat::fold::NOTICE))
                .build(),
        )
        .child(
            FragmentBuilder::new("p")
                .text(
                    "The older messages could not be shortened to make room, so this turn was \
                     sent with the whole conversation instead. Nothing was lost, and it will \
                     be tried again on the next turn.",
                )
                .build(),
        )
        .child(
            FragmentBuilder::new("details")
                .child(
                    FragmentBuilder::new("summary")
                        .text(&format!(
                            "Technical detail — the older messages could not be shortened ({})",
                            failure_kind(payload_json)
                        ))
                        .build(),
                )
                .child(FragmentBuilder::new("pre").text(payload_json).build())
                .build(),
        )
        .build()
}

/// A failed effect, recorded. Two kinds of failure meet here:
///
/// - a failed COMPACTION is not a failed turn. Reporting it as the user's own
///   failure dropped the question they asked (09 walk, finding 1);
/// - anything else raised the TURN, and marks the agent Failed — without that
///   the entry agent stays Working forever on the board.
pub(crate) fn record(app: &mut crate::app::App, e: crate::error::CoreError) {
    let payload_json =
        serde_json::to_string(&e).unwrap_or_else(|_| "\"unserializable error\"".into());
    if app.agent.compacting {
        let event = app.append(kernel::EventKind::Custom {
            kind: "core.compaction_failed".into(),
            payload_json,
        });
        app.pending.push(event);
        return;
    }
    app.append(kernel::EventKind::Custom {
        kind: "core.error".into(),
        payload_json: payload_json.clone(),
    });
    app.agent.task = None;
    // The ONE-LINE reason, not the paragraph: the board sits beside the
    // transcript that already prints the whole explanation (F11).
    let message = reason(&payload_json);
    let me = app.me().to_string();
    app.set_status(&me, kernel::Status::Failed, &message);
}

/// The failure in ONE line — what the board row and the header's banner carry.
/// The transcript owns the explanation and prints it once; a second copy of the
/// same paragraph three inches away is noise (F11). `failure_kind` is that line
/// for every typed variant; only the untyped fallback needs words of its own.
pub(crate) fn reason(payload_json: &str) -> String {
    match failure_kind(payload_json) {
        "raw error" => "the turn failed before it produced an answer".to_string(),
        kind => kind.to_string(),
    }
}

/// WHAT A LIFECYCLE FAILURE SAYS ON THE BOARD (R13-P0-3). `report_agent` is
/// the one door a Worker's failure comes through, and what arrived there was
/// whatever the host said — an exception string, rendered verbatim as three
/// agents' status and as the header's banner.
///
/// It is the WHOLE remedy here and only the one-line `reason` on a failed
/// TURN, and the difference is not a style choice: a turn's paragraph is
/// already printed in the transcript beside it (F11), and a Worker that never
/// started has no transcript at all. This row is the only place the failure
/// is ever said, so it is said in full.
///
/// A detail that is not a typed failure is passed through untouched — the
/// missing-bundle-links case writes its own sentence and is not an error
/// payload.
pub(crate) fn lifecycle(detail: &str) -> String {
    let payload = match crate::failure::what_to_do::recognise(detail) {
        Some(typed) => serde_json::to_string(&typed).unwrap_or_default(),
        None => detail.to_string(),
    };
    match crate::failure::what_to_do::typed(&payload) {
        true => failure_line(&payload),
        false => detail.to_string(),
    }
}

/// The same sentence from the LOGGED payload (`core::last_failure`).
pub(crate) fn sentence_of(payload_json: &str) -> String {
    failure_line(payload_json)
}
