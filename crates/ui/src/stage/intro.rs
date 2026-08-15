//! WHAT THIS THING IS, in the words the stage's head says out loud. Split from
//! `stage.rs`, which routes the centre column, so both hold the 200-line rule
//! (I12) — and because copy a first-time reader depends on is worth a file of
//! its own rather than four string literals wrapped inside a layout.

/// The one paragraph under the masthead. Nothing on the page said what this
/// product IS (F1) — three names and no sentence.
///
/// IT IS ALSO WHERE THE NOUNS ARE INTRODUCED (R18-P1-2). One word — workspace —
/// was on the Linux, on the folder and on the shared facts and notes at once.
/// This names each of them once, in the place a first-timer reads first.
///
/// …AND THE LOOP IS ONE OF THEM NOW (21). Increment 20 shipped a declared
/// plan → work → verify → critique loop and the interface never named it: the
/// only definition of the four words was three layers down, inside a collapsed
/// disclosure, on the Agents view. The word a person meets in the conversation
/// ("Plan stage:") is now introduced before they meet it.
pub(crate) const TAGLINE: &str = "This runs AI agents in your browser. An agent whose file names \
    a space also gets a folder in the Linux this page runs, where it can write files and run \
    commands, and it shares facts and notes with every other agent naming that space. Most \
    agents take a turn in stages — plan what is wanted, do the work, then verify it by running \
    something and reading what came back — and the conversation names each stage as it opens. \
    Give an agent a task and walk away, or talk to it while it works.";

/// The Commands view's one gloss. `Commands` names the panel you type into; the
/// three panels beside it are that panel's leavings, and nothing on screen said
/// so (R17-P1-9). One line, on the one view whose name does not cover it — the
/// others need no gloss and get none.
///
/// NOT "BESIDE IT" (R18-P2). On a phone that panel is not beside anything: it
/// is behind the `folder` switch in the header, and below 1100px it starts
/// folded on every screen. This names the panel and the switch that opens it,
/// which is true at every width and in both fold states.
pub(crate) const WORKSPACE_NOTE: &str = "The shell below. The folder these commands run in, what \
    is still running, and the files they finished are in the folder panel — the switch for it is \
    in the header.";
