//! ONE ANNOUNCEMENT PER RUN OF TOOL CALLS, and what that one line carries.
//! Not `failure/dedupe.rs`, which folds repeated FAILURES: "the same error
//! twice" and "what this round of calls did" are two folds over two different
//! facts.
//!
//! IT IS THE PAGE'S VOICE, NOT THE AGENT'S (R15-P1-6). `MAIN: calling exec — 1
//! call failed` sat above `MAIN: This is a Linux machine running kernel
//! 6.1.0…` in one label and bubble. `transcript::announced` renders
//! it as a `msg system` row: no label, no bubble, the subject named inside.

/// THE SAME ANNOUNCEMENT, AGAIN (R7-15). A tool-calling round emits one reply
/// per round, and each one rendered its own bubble: four consecutive
/// `MAIN: calling exec — every call is in Tool trace`, two of them byte
/// identical, and the answer the person asked for was the fifth bubble at the
/// same weight as the four notices above it. One announcement per RUN of them,
/// naming every tool the run called, in the order they were first called.
#[derive(Default)]
pub(crate) struct Calls {
    open: bool,
    names: Vec<String>,
    /// How many of the calls inside this run came back failed (R9-3).
    failed: usize,
    /// …how many of its READS came back empty, against how many it made (R10-13),
    empty: usize,
    reads: usize,
    /// …how many came back with nothing this page can vouch for (R13-2), and
    /// how many failures a retry cleared — `trace::trustworthy::Retries`, the same fold the
    /// trace and the board row run (R16-P1-1).
    doubted: usize,
    cleared: usize,
    retries: crate::trace::trustworthy::Retries,
    /// …AND WHICH VIEW THEIR ROWS ARE IN (R17-P1-3): `hurt` for the calls that
    /// went wrong, `all` for every call, because the two sentences below point
    /// at two different sets.
    hurt: crate::trace::row_location::Where,
    all: crate::trace::row_location::Where,
}

/// The tools whose whole job is to RETURN something. A `write_file` that prints
/// nothing did its work; a `read_process` that prints nothing did not answer.
/// `exec` is not here on purpose — `mkdir` printing nothing is a success, and a
/// predicate that cannot tell those apart is not a fact worth saying.
const READS: [&str; 6] =
    ["read_file", "list_files", "read_process", "list_processes", "find_files", "observe"];

/// Whether a tool result carried anything at all — blank output, or one of the
/// two phrases this codebase prints in place of it (R10-13). IT MOVED TO `agent::verify` (19); this is the re-export. The gate asks the
/// same question of the same output — is this command evidence? — and if the
/// two diverged the page could call a change checked over a row reading `ok,
/// and it printed nothing`: one turn, two stories, R16-17's whole class of bug.
pub(crate) use agent::says_nothing;

impl Calls {
    /// One tool-calling reply. The names are `agent::named`'s — the same fold
    /// the reply's own guard uses — and a repeat adds nothing.
    pub(crate) fn push(&mut self, text: &str) {
        self.open = true;
        for name in agent::named(text) {
            if !self.names.contains(&name) {
                self.names.push(name);
            }
        }
    }

    /// One call's RESULT, folded into the run it happened inside (R9-3). The
    /// line said `calling exec — every call is in Tool trace` over a trace
    /// whose first row was red, and the reply under it was read as an
    /// unqualified answer. `failure::within_turn::is_failure` is the same predicate the trace
    /// paints by, so the sentence and the row cannot disagree.
    /// …AND THE GAP BETWEEN THIS PANE AND THE TRACE (R13-2): `awk … — ok` over
    /// `exec: (no output)` one nav click from `The total cost is 1864.50.`
    /// `trace::trustworthy::doubt` is the predicate the trace's own word comes from.
    pub(crate) fn note(&mut self, tool: &str, args: &str, ok: bool, output: &str) {
        if !self.open {
            return;
        }
        self.all.note(tool, true);
        let (bad, back) =
            (crate::failure::within_turn::is_failure(tool, ok, output), self.retries.note(tool, args, ok));
        self.hurt.note(tool, bad || back);
        self.failed += usize::from(bad);
        self.cleared += usize::from(back);
        self.doubted += usize::from(crate::trace::trustworthy::doubt(tool, args, ok, output).is_some());
        if READS.contains(&tool) {
            self.reads += 1;
            self.empty += usize::from(says_nothing(output));
        }
    }

    /// The one sentence for the run of announcements that just ended, or
    /// `None` when there was no run. Taking it closes it.
    pub(crate) fn take(&mut self) -> Option<String> {
        if !self.open {
            return None;
        }
        // Taking the WHOLE thing closes the run and resets every count inside
        // it, `retries` included (R16-P1-1).
        let Calls { names, failed, empty, reads, doubted, cleared, hurt, all, .. } =
            std::mem::take(self);
        // PAST TENSE (R16-P1-1): `main is calling write_file` rendered on a
        // FINISHED turn. This line is written only once the run ended.
        let what = match names.is_empty() {
            true => "called tools".to_string(),
            false => format!("called {}", names.join(", ")),
        };
        // WHAT CAME BACK, WHEN NOTHING DID (R10-13). A turn asked
        // `read_process` for a heartbeat log, the trace showed `(nothing yet)`,
        // and the answer under it named a timestamp to the second. The page
        // cannot know an answer is wrong and does not guess: this says only what
        // the trace already holds — every read this run made came back empty, so
        // the words under it are the model's own. It fires ONLY when the run
        // read something and NOT ONE read returned content; a run where any read
        // answered has backing and gets nothing said about it.
        let quiet = reads > 0 && empty == reads;
        // ONE COUNT AND ONE WORDING for what went wrong in here: `failure::within_turn::note`
        // (R16-P1-1), which also owns the pointer (R17-P1-3).
        if let Some(clause) = crate::failure::within_turn::note(failed, cleared, hurt) {
            return Some(format!("{what} — {clause}"));
        }
        Some(match (quiet, doubted) {
            (true, _) => format!(
                "{what} — nothing came back from {}; anything below is the model's own \
                 words. Every call is in {}",
                match reads {
                    1 => "that read".to_string(),
                    n => format!("any of those {n} reads"),
                },
                all.named().0
            ),
            // …AND THE POINTER NAMES THE VIEW THE ROWS ARE IN (R17-P1-3): a run
            // of nothing but shell commands has no row in the Tool trace at all.
            (false, 0) => format!("{what} — every call is in {}", all.named().0),
            (false, n) => format!("{what} — {}", crate::trace::trustworthy::unbacked(n)),
        })
    }
}

#[cfg(test)]
mod call_tests {
    #[test]
    fn one_announcement_per_run_naming_every_tool() {
        let mut calls = super::Calls::default();
        assert!(calls.take().is_none(), "nothing announced, nothing said");
        calls.push("exec({\"command\": \"ls\"})");
        calls.push("exec({\"command\": \"du -sh disk.md\"})");
        calls.push("read_file({\"path\": \"disk.md\"})");
        let said = calls.take().expect("a run was open");
        assert_eq!(said, "called exec, read_file — every call is in the Tool trace");
        assert!(calls.take().is_none(), "taking it closes the run");
    }

    /// R9-3: the run's line carries the worst thing inside it — and R17-P1-3,
    /// it names the view that row is in. A refused `exec` is in Commands.
    #[test]
    fn a_failed_call_is_named_in_the_announcement() {
        let mut calls = super::Calls::default();
        calls.push("exec({\"command\": \"wc -l primes.txt\"})");
        calls.note("exec", "{}", false, "/bin/sh: syntax error: unexpected \")\" (exit status 2)");
        calls.note("exec", "{}", true, "0 primes.txt");
        let said = calls.take().unwrap();
        assert_eq!(said, "called exec — a tool call in that turn failed — Commands has it");
        // …and a folder that does not exist yet is not one (R5-11).
        let mut quiet = super::Calls::default();
        quiet.push("list_files({\"path\": \"artifacts\"})");
        quiet.note("list_files", "{}", false, "ls: artifacts: No such file or directory");
        assert!(
            quiet.take().unwrap().starts_with("called list_files — "),
            "a missing folder is not a failed call"
        );
    }

    /// R10-13: a run whose every read came back empty says so.
    #[test]
    fn a_run_whose_reads_all_came_back_empty_says_so() {
        let mut nothing = super::Calls::default();
        nothing.push("read_process({\"name\": \"heartbeat\"})");
        let tailed = "quiet is running (pid 50). 0 line(s) in .harness/proc/quiet/log; the \
                      end of it:\n(nothing yet)";
        nothing.note("read_process", "{}", true, tailed);
        let said = nothing.take().unwrap();
        assert!(said.contains("nothing came back from that read"), "{said}");
        assert!(said.contains("the model's own words"), "{said}");
        // One read that ANSWERED is backing, and the line goes away.
        let mut backed = super::Calls::default();
        backed.push("read_process({\"name\": \"heartbeat\"})");
        backed.note("read_process", "{}", true, "(nothing yet)");
        backed.note("read_file", "{}", true, "Thu Aug 13 15:16:20 UTC 2026");
        assert_eq!(backed.take().unwrap(), "called read_process — every call is in the Tool trace");

        // …and a write that printed nothing is not a read that answered nothing.
        let mut wrote = super::Calls::default();
        wrote.push("write_file({\"path\": \"a.md\"})");
        wrote.note("write_file", "{}", true, "(no output)");
        assert_eq!(wrote.take().unwrap(), "called write_file — every call is in the Tool trace");
    }
}
