//! ONE ROW of the tool trace. `pane.rs` decides which calls a trace holds and
//! in what order; this file decides what one of them looks like.
//!
//! A log needs three things this row did not have (R2-18): the TIME the fact
//! happened, arguments a person can read rather than the JSON the model wrote,
//! and output that can be read to the end. The first is on the event (`Event::
//! at`, injected via `ClockPort` — I7); the second is `args`; the third
//! is the stylesheet's.

use agent::ToolResult;
use kernel::Timestamp;
use module::view::{Fragment, FragmentBuilder};

// The arguments' own rendering: a row's shape and an argument's spelling
// are two subjects, and `inflight` wants only the second of them.
pub(super) mod args;

/// WHEN A ROW SAYS A CALL HAPPENED (R13-4). `02:41:51 main ran $ sleep 90` for
/// a command that STARTED at 02:40:21: `ToolInvoked` is appended when the call
/// comes back, so its injected timestamp (I7) is the completion and every row
/// read it as the start — a silent off-by-duration on the one view whose job is
/// reconstructing what happened when (measured twice, `sleep 60` and 90). The
/// log holds a START only where a REQUEST preceded the call (`trace::requested_by::Asked`,
/// the same queue the actor comes off); without one it has the ending and
/// nothing else, so the row says `ended` rather than inventing a start.
fn when(at: i64, started: Option<i64>) -> String {
    let (mark, stamp) = started.map_or(("ended ", at), |start| ("", start));
    format!("{mark}{}", agent::clock(Timestamp(stamp)))
}

/// One call. The result line is rendered by the same `ToolResult::line` the
/// model reads, so the user sees what the model saw.
///
/// The outcome is a WORD, not a colour. A refused call and a successful one
/// used to differ by hue alone: identical with the stylesheet off, identical to
/// a screen reader, and unreadable to anyone who does not see red (`ux-walker`,
/// increment 05). The output block is focusable, because a scrolling region no
/// keyboard can reach holds content some people cannot get to.
///
/// WHO RAN IT and HOW IT ENDED are two facts, and one word was carrying both:
/// `you refused $ notacommand --foo` over `/bin/sh: notacommand: not found`
/// (R3-18). Nobody refused it — the shell could not find it. So the actor keeps
/// the verb true of every call (`ran`), and the ending is said after the
/// arguments in the shell's own words: `ok`, or `failed`. …and `ok` STOPS
/// VOUCHING FOR WHAT IT DID NOT CHECK (R13-2): `crate::trace::trustworthy` owns which
/// successful calls this page can stand behind, and the conversation's clause
/// reads the same predicate, so the two cannot disagree one click apart.
/// …AND WHETHER IT IS THE RETRY THAT RECOVERED ONE (R15-P1-5): `retry` comes
/// off `trace::trustworthy::Retries`, fed the same calls in the same order.
pub(crate) fn row(
    tool: &str,
    args: &str,
    ok: bool,
    output: &str,
    by: &str,
    at: i64,
    started: Option<i64>,
    retry: bool,
) -> Fragment {
    let result = ToolResult {
        tool: tool.to_string(),
        ok,
        output: output.to_string(),
        error: output.to_string(),
    };
    // A FOLDER THAT IS NOT THERE IS NOT A FAILURE (R5-11). The artifacts shelf
    // lists `artifacts/` on its own, before anything has written to it, and the
    // shell reports that the only way it can — exit 1, "No such file or
    // directory". The trace painted that red, called it `failed`, and put it
    // under the person's own name: the product's housekeeping, rendered as the
    // user's error, for the most ordinary state an empty workspace has. The
    // FACT is unchanged and still shown, in the words the Files pane uses.
    // …and only for a call ABOUT a path: `files::listing::missing` holds why (R14-P0-3).
    let missing = !ok && crate::files::listing::missing(tool, output);
    let word = match (ok, missing) {
        (true, _) => crate::trace::trustworthy::word(crate::trace::trustworthy::doubt(tool, args, ok, output)),
        (false, true) => "not there yet",
        (false, false) => "failed",
    };
    let when = when(at, started);
    // …AND THE OUTPUT SAYS THE SAME THING (R7-1). The word said "not there yet"
    // while the block under it printed `ls: artifacts: No such file or directory
    // (exit status 1)` — a shell error with an exit code, for the most ordinary
    // state an empty workspace has. `files/empty_states` owns that sentence for both panes;
    // every other output is the model's own, verbatim.
    let said = match missing {
        true => crate::files::empty_states::not_there(&crate::files::listing::path_of(args)),
        false => result.line(),
    };
    FragmentBuilder::new("div")
        .class(match ok || missing {
            true => "tool-call",
            false => "tool-call error",
        })
        .attr("data-tool", tool)
        .attr("data-outcome", word)
        .attr("data-by", by)
        .attr("data-at", &at.to_string())
        .child(
            FragmentBuilder::new("p")
                .class("tool-args")
                // WHEN, then WHO, then what. The row read `ran exec(…)` whether
                // the agent chose it or a person typed it (F14), and carried no
                // time at all (R2-18) — which is the one thing that makes a
                // list of calls a log rather than a pile.
                .child(FragmentBuilder::new("time").class("tool-time").text(&when).build())
                .child(
                    FragmentBuilder::new("span")
                        .class("tool-by")
                        .text(&format!(" {by} ran"))
                        .build(),
                )
                .child(
                    FragmentBuilder::new("span")
                        .text(&format!(" {}", args::said_args(tool, args)))
                        .build(),
                )
                .child(
                    FragmentBuilder::new("span")
                        .class("tool-outcome")
                        .text(&format!(" — {word}{}", match retry {
                            true => ", and this is the retry after the refused call",
                            false => "",
                        }))
                        .build(),
                )
                .build(),
        )
        .child(crate::trace::trustworthy::folded(&said).unwrap_or_else(|| {
            FragmentBuilder::new("pre")
                .attr("tabindex", "0")
                .attr("role", "region")
                .attr("aria-label", &format!("what {tool} returned"))
                .text(&said)
                .build()
        }))
        .build()
}

