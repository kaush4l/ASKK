//! THE VERDICT OF A SEPARATE AGENT, READ MECHANICALLY (25).
//!
//! `critique` is a STAGE: the working model, in its own window, asked to read
//! back the turn it just took. It is the same model marking its own homework,
//! and it holds every belief it held while doing the work. This file is the
//! other thing — an agent with `role: critic`, its own prompt, its own Worker,
//! no sight of the caller's conversation and no way to change anything — and
//! the one rule that stops its answer being decoration.
//!
//! THE RULE: a caller cannot report a turn as ANSWERED over a verdict that was
//! not a pass. The critic's reply comes back to the caller as an ordinary tool
//! result (`core::batch::delegate`), `verify::observe` folds it in log order
//! like every other result, and `answer.rs` reads the fold when it names the
//! ending. Nothing here asks the model whether it agrees — the same reason
//! `passes` never asks a model whether it is finished.
//!
//! IT FAILS TOWARDS THE FAULT. Only the exact word `PASS` on the first line is
//! a pass; a rambling verdict, a refusal, a sub-agent whose turn raised, or a
//! critic that is not loaded at all are all "not passed". A false fault costs a
//! word on a board row that a person can read the reply and disagree with; a
//! false pass is the thing this whole file exists to prevent.

/// Whether this verdict cleared the work. The first non-empty line must be the
/// word and nothing else — a prefix test would let "PASSING on the tests would
/// be nice" through, which is the opposite of what it says. Case is ignored and
/// nothing else is: `Pass` from a small local model is the same answer, while a
/// sentence containing the word is not an answer at all.
pub fn passed(verdict: &str) -> bool {
    verdict
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .is_some_and(|line| line.eq_ignore_ascii_case(PASS))
}

/// The two words the critic's prompt asks for. `FAULT` is not tested against —
/// anything that is not `PASS` is not a pass — but it is named here because the
/// agent file and this file have to agree on the vocabulary.
pub const PASS: &str = "PASS";
pub const FAULT: &str = "FAULT";

#[cfg(test)]
mod tests {
    /// The word, alone, on the first line — and nothing else counts.
    #[test]
    fn only_the_bare_word_is_a_pass() {
        assert!(super::passed("PASS\nThe check output shows the file was written."));
        assert!(super::passed("\n  PASS  \nreasons"), "leading blank lines and spaces");
        for not_a_pass in [
            "FAULT\nindex.md was never written.",
            "PASSING would need the test to run first.",
            "The work looks fine to me, so PASS.",
            "",
            "critic failed: No agent called 'critic' is loaded in this browser.",
        ] {
            assert!(!super::passed(not_a_pass), "should not pass: {not_a_pass:?}");
        }
    }
}
