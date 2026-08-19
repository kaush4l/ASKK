//! WHAT WENT WRONG INSIDE A TURN THAT ENDED WELL (R9-3).
//!
//! A turn asked for a file of primes and a line count. The Tool trace held, in
//! red, `main ran $ "wc -l primes.txt"}) — failed / /bin/sh: syntax error` and,
//! four seconds later, the same command succeeding with `0 primes.txt`. The
//! chat said "The file primes.txt has 15 lines.", the launch card said `main
//! finished`, and the board said `main ready · 1 turn`. Every summary on the
//! page reported unqualified success over evidence the same log already held.
//!
//! A SUMMARY MUST CARRY THE WORST STATE IT SUMMARISES. This is the one fold
//! that decides what "worst" is, so the board row, the launch card and the
//! conversation cannot answer it three different ways — the R7-3 rule, applied
//! to the inside of a turn rather than to its end.
//!
//! WHAT IT DOES NOT SAY: whether the ANSWER is wrong. This page cannot know
//! that and does not guess. It reports that a call in this turn failed, and
//! points at the view that has it (`trace::row_location::Where`, R17-P1-3).

use kernel::EventKind;

use crate::{dispatch::Ctx, trace::requested_by::Asked, trace::row_location::Where};

/// Whether ONE tool result is a failure worth carrying upwards.
///
/// `missing` is excluded by the same argument R5-11 made for the trace's own
/// word: a folder that does not exist yet is the most ordinary state an empty
/// workspace has, the shell can only report it as exit 1, and the Files pane
/// already calls it "not there yet". One predicate, so the trace's red row and
/// the board's clause cannot disagree about what counts.
///
/// …AND THE PREDICATE TAKES THE TOOL (R14-P0-3). Without it this excused a
/// FAILED COMMAND whose output happened to hold the phrase — the `wc -l
/// primes.txt` line of a multi-command `exec` — so the turn's summary counted a
/// real failure as ordinary housekeeping, the same leak that gave the trace row
/// a file-listing outcome.
pub(crate) fn is_failure(tool: &str, ok: bool, output: &str) -> bool {
    !ok && !crate::files::listing::missing(tool, output)
}

/// Where this agent's most recent turn STARTS in `recent` — the last thing the
/// person said to it. `None` means it has never been asked anything.
fn turn_began(ctx: &Ctx, who: &str) -> Option<usize> {
    ctx.recent
        .iter()
        .enumerate()
        .filter(|(_, k)| {
            matches!(k, EventKind::UserMessage { .. }) && crate::chat::fold::belongs_to(k, &ctx.me, who)
        })
        .map(|(nth, _)| nth)
        .next_back()
}

/// This process's own agent's failed calls since `start`.
///
/// `Asked` is enqueued over the WHOLE log, because its queues are matched in
/// order, and only the calls after the boundary are counted. A command a person
/// typed into the Workspace and a listing a pane asked for are not the agent's
/// turn going wrong — the same split the trace makes to answer "who did this".
fn mine(ctx: &Ctx, who: &str, start: usize) -> (usize, usize, Where) {
    let mut asked = Asked::default();
    let (mut failed, mut cleared, mut went) = (0usize, 0usize, Where::default());
    // The SAME fold the Tool trace runs over the same calls in the same order
    // (`trace/pane.rs`), so the summary and the row cannot disagree about which
    // refusal was recovered (R16-P1-1).
    let mut retries = crate::trace::trustworthy::Retries::default();
    for (nth, kind) in ctx.recent.iter().enumerate() {
        asked.enqueue(nth, kind);
        let EventKind::ToolInvoked { tool, args, ok, output } = kind else { continue };
        let (by, _) = asked.actor(&tool.0, args, who);
        if nth > start && by == who {
            let (bad, back) = (is_failure(&tool.0, *ok, output), retries.note(&tool.0, args, *ok));
            went.note(&tool.0, bad || back);
            (failed, cleared) = (failed + usize::from(bad), cleared + usize::from(back));
        }
    }
    (failed, cleared, went)
}

/// …and another agent's, as its own Worker reported them (`told`). The same
/// records the trace renders for a name that is not this process's.
fn reported(ctx: &Ctx, who: &str, start: usize) -> (usize, usize, Where) {
    let (mut failed, mut cleared, mut went) = (0usize, 0usize, Where::default());
    let mut retries = crate::trace::trustworthy::Retries::default();
    let rows = ctx
        .recent
        .iter()
        .enumerate()
        .filter(|(nth, _)| *nth > start)
        .filter_map(|(_, kind)| match kind {
            EventKind::Custom { kind, payload_json } if kind == crate::failure::from_worker::AGENT_ACTIVITY => {
                crate::failure::from_worker::activity(payload_json)
            }
            _ => None,
        })
        .filter(|(agent, _)| agent == who);
    for (_, value) in rows {
        let Some(tool) = value.get("tool").and_then(|t| t.as_str()) else { continue };
        let args = value.get("args").and_then(|a| a.as_str()).unwrap_or("{}");
        let ok = value.get("ok").and_then(serde_json::Value::as_bool).unwrap_or(false);
        let out = value.get("output").and_then(|o| o.as_str()).unwrap_or_default();
        let (bad, back) = (is_failure(tool, ok, out), retries.note(tool, args, ok));
        went.note(tool, bad || back);
        (failed, cleared) = (failed + usize::from(bad), cleared + usize::from(back));
    }
    (failed, cleared, went)
}

/// How many of this agent's own tool calls failed in its most recent turn, and
/// how many of those refusals a retry of the same tool went on to clear.
fn in_last_turn(ctx: &Ctx, who: &str) -> (usize, usize, Where) {
    let Some(start) = turn_began(ctx, who) else { return (0, 0, Where::default()) };
    match who == ctx.me {
        true => mine(ctx, who, start),
        false => reported(ctx, who, start),
    }
}

/// That turn's clause for the row and the card, and how many calls ran (R18-P1-5).
pub(crate) fn clause(ctx: &Ctx, who: &str) -> (Option<String>, usize) {
    let (failed, cleared, went) = in_last_turn(ctx, who);
    (note(failed, cleared, went), went.ran())
}

/// THE CLAUSE, WRITTEN ONCE. The board row wears it, `data-line` carries it to
/// the Dashboard's card, and the card renders the string rather than composing
/// a second wording of the same fact (R8-8: one name for one event). Since
/// R16-P1-1 the conversation's own announcement reads it too (`chat::call_announcement::take`):
/// it had a second count and a second wording, which is how three surfaces
/// came to cry failure over a turn that had already recovered.
///
/// SAY IT, DO NOT SUPPRESS IT. A refusal the model read and retried is a true
/// fact about the turn, and hiding it would leave a red row in the trace that
/// no summary accounts for — the same disagreement one click apart, inverted.
/// So a fully recovered turn gets a sentence of its own rather than silence,
/// and it is not an alarm: nothing about the turn is outstanding.
///
/// When some failures recovered and some did not, the clause reports the ones
/// that did NOT — those are what is still owed. Each recovery is still marked
/// on its own row in the trace.
pub(crate) fn note(failed: usize, recovered: usize, went: Where) -> Option<String> {
    // …AND IT NAMES THE VIEW THE CALL IS ACTUALLY IN (R17-P1-3).
    let (view, has) = went.named();
    match (failed.saturating_sub(recovered), recovered) {
        (0, 0) => None,
        (0, 1) => Some(format!(
            "a tool call was refused and the retry after it worked — {view} {has} both"
        )),
        (0, n) => Some(format!(
            "{n} tool calls were refused and the retries after them worked — {view} {has} them"
        )),
        (1, _) => Some(format!("a tool call in that turn failed — {view} {has} it")),
        (n, _) => Some(format!("{n} tool calls in that turn failed — {view} {has} them")),
    }
}

#[cfg(test)]
mod tests {
    use crate::trace::row_location::Where;

    /// The distinction the whole file exists for: a shell syntax error counts,
    /// a folder that is not there yet does not.
    #[test]
    fn a_missing_folder_is_not_a_failure_a_syntax_error_is() {
        assert!(super::is_failure("exec", false, "/bin/sh: syntax error (exit status 2)"));
        assert!(!super::is_failure("list_files", false, "ls: artifacts: No such file or directory"));
        assert!(!super::is_failure("exec", true, ""));
    }

    /// R14-P0-3: the excuse belongs to the LISTING, not to the phrase. A failed
    /// command whose output happens to hold it is a failed command.
    #[test]
    fn a_command_that_failed_is_a_failure_whatever_its_output_says() {
        let out = "/root/spaces/research\ntotal 0\nwc: primes.txt: No such file or directory";
        assert!(
            super::is_failure("exec", false, out),
            "a command's exit status is its own, not a folder's"
        );
    }

    #[test]
    fn the_clause_counts_and_says_nothing_when_nothing_failed() {
        let w = Where::default();
        assert!(super::note(0, 0, w).is_none());
        assert!(super::note(1, 0, w).unwrap().starts_with("a tool call in that turn failed"));
        assert!(super::note(3, 0, w).unwrap().starts_with("3 tool calls in that turn failed"));
    }

    /// R16-P1-1: a refusal the model retried successfully is not a failure the
    /// turn is still carrying, and it is not silence either.
    #[test]
    fn a_refusal_the_retry_cleared_is_said_as_a_recovery_not_as_a_failure() {
        let said = super::note(1, 1, Where::default()).expect("a recovered turn still says what happened");
        assert!(said.starts_with("a tool call was refused and the retry after it worked"), "{said}");
        assert!(!said.contains("failed"), "it is not an alarm: {said}");
        assert!(super::note(2, 2, Where::default()).unwrap().starts_with("2 tool calls were refused"));
        // …and one that recovered while another stayed broken reports the one
        // that is still owed.
        assert_eq!(super::note(2, 1, Where::default()), super::note(1, 0, Where::default()));
    }
}
