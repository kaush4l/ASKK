//! HOW LONG A COMMAND GETS, and what an answer looks like when it did not get
//! enough. Declared here for the same reason the binary inventory is declared
//! next door: the fact lives in a file Rust cannot import, so it is written
//! down where a test can hold it (I16).

/// HOW LONG ONE COMMAND GETS, in seconds, and THE ONE DEFINITION OF IT.
///
/// The watchdog runs in `adapters_web/src/c2w.js` (`RUN_MS`), which is
/// JavaScript loaded by the browser inside the one crate the pure core may not
/// depend on (I3) — so Rust cannot import the number and the model cannot be
/// told it without somebody typing it a second time. A number typed twice is a
/// number that will drift, so it is DECLARED here, exactly as the guest's
/// binary inventory is declared here rather than left in the Dockerfile
/// comment that used to hold it, and `tests/environment.rs` reads the .js and
/// fails when the two disagree.
///
/// It is a ceiling, not a budget, and it is not per-tool: `start_process`,
/// `find_files`, `observe` and every file operation are one `exec` underneath
/// (`kernel::WorkspacePort`'s defaults) and all share it.
pub const RUN_LIMIT_SECS: u64 = 180;

/// WHAT A CUT-OFF ANSWER IS MARKED WITH, and the same one string in both
/// directions: `c2w.js` writes it onto the end of a timed-out command's output
/// and the sentence below tells the model to look for it. Declared here for
/// the reason [`RUN_LIMIT_SECS`] is, and pinned against the .js by the same
/// test — a mark the model watches for and the engine no longer writes would
/// be a lie told at the one moment a model cannot catch it, when an answer
/// looks complete and is not.
pub const PARTIAL_MARK: &str = "[PARTIAL:";

/// THE CEILING, AND WHAT REACHING IT LOOKS LIKE (T53). Two facts in one line
/// because they are one situation: a command that cannot finish in the time it
/// has, and the answer it leaves behind. Neither was ever said, and the second
/// is the dangerous one — a model handed truncated output with nothing marking
/// it truncated reads it as the whole answer and reasons on from there.
///
/// Generated from [`RUN_LIMIT_SECS`] and [`PARTIAL_MARK`] rather than written
/// out, so the sentence the model reads cannot fall behind the watchdog the
/// engine runs; the test that pins those two to `c2w.js` therefore pins this
/// sentence to it as well.
pub(super) fn deadline() -> String {
    format!(
        "deadline: every command gets {RUN_LIMIT_SECS} seconds and there is no way to ask \
         for more — the same ceiling for a listing, a search and a long build. At \
         {RUN_LIMIT_SECS} seconds the command is interrupted and you are handed what it had \
         printed by then, ending in {PARTIAL_MARK} …]. An answer ending that way is NOT the \
         whole answer: do the work in smaller pieces, or send the output to a file and read \
         the file back a piece at a time."
    )
}
