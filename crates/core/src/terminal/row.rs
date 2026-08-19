//! The scrollback's rendering: the note that says whose workspace this is and
//! what the tools reaching it can really do, one finished command, one command
//! still running. `pane.rs` owns the module and the route; this file owns the
//! pixels.

use module::view::{Fragment, FragmentBuilder};

use crate::dispatch::Ctx;

/// The command just typed, shown before it has run. Without it the pane would
/// look identical for however long the first boot takes.
///
/// …AND HOW LONG IT HAS BEEN (R11-1a). `running…` reads the same after four
/// seconds and after seven minutes, and was the only thing on screen through
/// both. `by` because the AGENT's in-flight command belongs here too, and it
/// was the one nothing showed at all (`terminal::row_selection::in_flight`).
///
/// THE BOOT SENTENCE IS DELETED (R11-13). This row used to add *"this first
/// command also boots the Linux, which takes a moment"* to the first command a
/// workspace ever ran. That was true when the Linux booted lazily; since the
/// page PREWARMS it (`ui::shell::warmth::WorkspaceWarmth` calls `prewarm` at paint), the
/// first command a person types usually meets a machine the header has read
/// `ready` for minutes, and the pane said otherwise. Boot is a status, the
/// header pill is where statuses live, and that pill never drops at any width.
pub(crate) fn echoed(command: &str, by: &str, seconds: Option<i64>) -> Fragment {
    let waiting = match seconds {
        None => "running…".to_string(),
        Some(n) => format!("running for {n}s…"),
    };
    FragmentBuilder::new("div")
        .class("term-run pending")
        .attr("role", "status")
        .attr("data-by", by)
        .child(prompt_line(command, by, None))
        .child(FragmentBuilder::new("pre").text(&waiting).build())
        .build()
}

/// A COMMAND THE RELOAD ABANDONED (R12-5). A command in flight when the page
/// was reloaded left a request in the log and no call, and this pane dropped it
/// whole — while the resolved rows around it survived, correctly annotated `—
/// failed, on an earlier page's Linux`. Losing work silently, in the pane whose
/// neighbours label the same loss, is the one thing this product refuses. The
/// mark is `ran`'s: the same word, the same dotted row, the same channel.
pub(crate) fn abandoned(command: &str, by: &str) -> Fragment {
    let word = "abandoned when the page reloaded";
    FragmentBuilder::new("div")
        .class("term-run earlier")
        .attr("data-outcome", word)
        .attr("data-by", by)
        .child(prompt_line(command, by, Some(word)))
        .child(
            FragmentBuilder::new("pre")
                .class("said")
                .text(
                    "This command was still running when the page was reloaded. Nothing came \
                     back, so there is no output and no exit status: the Linux it was running \
                     in was rebuilt with the page.",
                )
                .build(),
        )
        .build()
}

/// The shared space one agent's own file names, if any. `pub(crate)` because
/// the pane above the note asks the same question (R5-1) and two answers to
/// "does this agent have a workspace folder" is how the panes disagreed.
pub(crate) fn space_of(ctx: &Ctx, who: &str) -> Option<agent::Space> {
    ctx.agents
        .iter()
        .find(|s| s.name == who)
        .and_then(|s| agent::Space::named(&s.space))
}

/// The command out of the JSON the tool was called with; the raw arguments if
/// it was something else, because a trace that hides what was asked is not one.
pub(crate) fn command_of(args_json: &str) -> String {
    serde_json::from_str::<serde_json::Value>(args_json)
        .ok()
        .and_then(|v| Some(v.get("command")?.as_str()?.to_string()))
        .unwrap_or_else(|| args_json.to_string())
}

/// The prompt, and WHO typed at it. The trace attributed every call and this
/// pane attributed none — `$ sleep 20` sat in the scrollback with nothing
/// saying whether a person or the agent had run it, in the one pane where both
/// land in the same list (R3-18). Same two facts, same words, both places.
fn prompt_line(command: &str, by: &str, outcome: Option<&str>) -> Fragment {
    let mut line = FragmentBuilder::new("p")
        .class("term-command")
        .child(
            FragmentBuilder::new("span")
                .class("term-by")
                .text(&format!("{by} ran "))
                .build(),
        )
        .child(FragmentBuilder::new("span").class("term-prompt").text("$ ").build())
        .child(FragmentBuilder::new("span").text(command).build());
    if let Some(word) = outcome {
        line = line.child(
            FragmentBuilder::new("span")
                .class("term-outcome")
                .text(&format!(" — {word}"))
                .build(),
        );
    }
    line.build()
}

/// One finished command. The outcome is a WORD beside the colour, the same
/// rule the tool trace follows — and now the same two words, `ok` and
/// `failed`, said after the command rather than only in an attribute.
///
/// `earlier` is the R10-5 mark: this command ran on a previous page load, so its
/// output describes a Linux that was rebuilt since and may not even be the same
/// engine. A stale answer shown as a current one is the defect; the word says so
/// on the row itself, beside the outcome it qualifies.
pub(crate) fn ran(command: &str, ok: bool, output: &str, by: &str, earlier: bool) -> Fragment {
    // A COMMAND THAT PRINTED NOTHING IS NOT A COMMAND THAT ANSWERED (R13-2),
    // AND THIS IS NOW THE ONLY PANE THAT SAYS SO (R15-P1-4): the tool trace
    // used to carry that qualification on its own copy of the same row, and it
    // no longer holds shell rows at all. The word moves with the fact.
    // …AND A STOP YOU ASKED FOR IS NOT A FAILURE (R17-P1-6). Pressing the
    // pane's own Stop rendered `you ran $ sleep 40; echo done — failed` in red
    // over an explanation that was honest and complete. `failed` is what
    // happens TO you. `workspace::was_stopped` is the one predicate, so the
    // word and the colour cannot disagree about which ending this was.
    let stopped = crate::workspace::gate::was_stopped(output);
    // Neutral, not red: it belongs with the endings nobody has to fix.
    let ok = ok || stopped;
    let word = match (ok, earlier) {
        (true, false) if stopped => "stopped",
        (true, false) if crate::chat::call_announcement::says_nothing(output) => "ok, and it printed nothing",
        (true, false) => "ok",
        (false, false) => "failed",
        (true, true) if stopped => "stopped, on an earlier page's Linux",
        (true, true) => "ok, on an earlier page's Linux",
        (false, true) => "failed, on an earlier page's Linux",
    };
    FragmentBuilder::new("div")
        .class(match (ok, earlier) {
            (true, false) => "term-run",
            (false, false) => "term-run error",
            (true, true) => "term-run earlier",
            (false, true) => "term-run error earlier",
        })
        .attr("data-outcome", word)
        .attr("data-by", by)
        .child(prompt_line(command, by, Some(word)))
        .child(output_block(command, output))
        .build()
}

/// A SENTENCE WE WROTE WRAPS; A MACHINE'S COLUMNS DO NOT (R12-4).
/// `workspace::is_prose` is the one place that knows which of the two this is,
/// and `workspace.css` keys the wrapping off the class it puts here.
/// …AND THE REFUSAL WE WROTE FOR THE MODEL IS NEITHER (R15-P1-5). Measured at
/// 4973px on one line in this pane, and wrapping in the Tool trace — the same
/// string, two treatments. `trace::trustworthy::folded` is the one box both panes now use.
fn output_block(command: &str, output: &str) -> Fragment {
    if let Some(folded) = crate::trace::trustworthy::folded(output) {
        return folded;
    }
    let block = FragmentBuilder::new("pre");
    match crate::workspace::gate::is_prose(output) {
        true => block.class("said"),
        false => block,
    }
    .attr("tabindex", "0")
    .attr("role", "region")
    .attr("aria-label", &format!("output of {command}"))
    .text(output)
    .build()
}
