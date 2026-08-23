//! **WHAT THE VOTE PARSER ACTUALLY ACCEPTS — MEASURED, THEN PINNED.**
//!
//! The router is the first decision of every turn on the shipped agent: one
//! cheap call whose reply picks `answer`, `react` or `project`, and anything
//! unreadable silently becomes `react`. Silently is the whole hazard. A build
//! whose model started decorating its labels would route every message to the
//! middle and look exactly like a build whose messages all wanted the middle.
//!
//! `e27a387` fixed the parser for bold, bullets and numbering, and
//! `tests/strategy.rs` pins the shapes that matter through the real `step`.
//! This file measures what that fix LEFT — the shapes a small model also writes
//! that nothing had checked either way — and pins the accepted ones so they
//! cannot be lost to a future tightening of `plain`. Measured 2026-08-23 over 46
//! shapes against `agent::vote_of`.
//!
//! **THE FINDING, NOW FIXED.** That measurement left two shapes dropped for
//! precisely the reason `e27a387` existed: `## ROUTE: project` and
//! `> ROUTE: project` read as `react`, because `#` and `>` were neither list
//! markers in `is_marker` nor decoration in `plain`. They are pinned ACCEPTED
//! below, and the fix was not two more characters — `unmarked` now strips the
//! CommonMark set of block prefixes and says in its header that the set is
//! closed, so the next surprising shape has to argue with a stated rule instead
//! of appending a character to a list. The refusals that BOUND that rule
//! (`>ROUTE:` unspaced, seven hashes) are pinned here too, because a grammar
//! with no stated edge is not closed, only unmeasured.
//!
//! **WHY THIS IS A UNIT TEST AND `strategy.rs` IS NOT.** That file's header is
//! right — a parser test can pass while the turn it steers ends in the wrong
//! place, so the shapes that MATTER are driven through `step` there. This is the
//! cheap breadth beside it: forty-odd shapes through `step` would be forty
//! agent-file parses to re-measure one function.

use agent::{vote_of, Route};

/// **THE SHAPES A SMALL MODEL WRITES THAT NOTHING HAD CHECKED.**
///
/// Every case here was measured accepted and none of them was pinned by any
/// test in the tree. They are accepted incidentally — `plain` trims a character
/// set and `unmarked` strips a marker set — so a future tightening of either
/// would drop them with no gate going red, which is how the bold-label defect
/// shipped in the first place.
///
/// Positive controls, each run and restored. (a) Remove the backtick from
/// `plain`'s trim set in `crates/agent/src/strategy.rs` and the two code-span
/// cases go red. (b) Drop `">"` from `is_marker`'s `matches!` and the three
/// blockquote cases go red. (c) Delete the `heading` term from `is_marker` and
/// the five heading cases go red. (d) Replace `unmarked`'s `while` with a
/// single `if` and only the two NESTED cases go red — which is the whole reason
/// they are listed separately.
#[test]
fn the_decorated_shapes_a_model_writes_are_all_read_as_the_same_vote() {
    for (reply, expected, because) in [
        // VALUE decoration. The label was fixed in `e27a387`; the value's own
        // dressing was only ever covered for a code span and a full stop.
        ("ROUTE: **project**", Route::Project, "the VALUE emphasised, not the label"),
        ("ROUTE: \"project\"", Route::Project, "the value in quotes"),
        ("ROUTE: PROJECT", Route::Project, "the value shouted"),
        ("Route: Project", Route::Project, "title case throughout"),
        // LABEL decoration beyond bold.
        ("_ROUTE_: answer", Route::Answer, "underscore emphasis"),
        ("`ROUTE`: answer", Route::Answer, "the LABEL in a code span"),
        ("**ROUTE: project**", Route::Project, "the whole line bolded"),
        ("\"ROUTE\": \"project\"", Route::Project, "written as a JSON pair on its own line"),
        // WHITESPACE the contract never mentioned.
        ("ROUTE:answer", Route::Answer, "no space after the colon"),
        ("ROUTE : project", Route::Project, "a space BEFORE the colon"),
        ("\tROUTE: answer", Route::Answer, "a tab indent"),
        // MARKERS beyond the two `e27a387` named.
        ("* ROUTE: answer", Route::Answer, "an asterisk bullet"),
        ("+ ROUTE: answer", Route::Answer, "a plus bullet"),
        ("1) ROUTE: project", Route::Project, "a numbered list closed with )"),
        ("2. **ROUTE:** answer", Route::Answer, "numbering AND bold together"),
        ("- **ROUTE**: `answer`", Route::Answer, "bullet, bold label, code-span value"),
        // POSITION. The contract asks for two lines and says nothing about
        // which comes first, or about thinking out loud above them.
        ("WHY: it needs a build\nROUTE: project", Route::Project, "WHY written first"),
        ("Reasoning...\n\nROUTE: project", Route::Project, "a preamble, then the vote"),
        // THE TWO SHAPES MEASURED DROPPED ON 2026-08-23, now accepted: a model
        // asked for two named lines turns a label into a heading, or pulls it
        // into a quote, for the same reason it bolds one.
        ("## ROUTE: project", Route::Project, "the label written as a heading"),
        ("> ROUTE: project", Route::Project, "the label pulled into a blockquote"),
        // …and the rest of the same CLOSED set, so the rule is pinned and not
        // just the two shapes that happened to be measured.
        ("# ROUTE: answer", Route::Answer, "a one-hash heading"),
        ("###### ROUTE: answer", Route::Answer, "six hashes, the deepest heading"),
        ("## **ROUTE:** project", Route::Project, "a heading AND bold together"),
        ("> - ROUTE: answer", Route::Answer, "prefixes NEST: a quoted bullet"),
        ("> 1. **ROUTE**: project", Route::Project, "quote, numbering and bold at once"),
    ] {
        assert_eq!(vote_of(reply), expected, "{reply:?} — {because}");
    }
}

/// **THE REFUSALS THAT ARE DELIBERATE, kept apart from the ones that are not.**
///
/// Everything below SHOULD fall to `react`, and each for a stated reason, so
/// that widening the grammar later has to argue with a named case rather than
/// with a silence. Since 2026-08-23 this also carries the EDGE of the block-
/// prefix rule: a set called closed with nothing pinned just outside it is not
/// closed, only unmeasured.
#[test]
fn a_reply_that_is_not_a_vote_falls_to_the_middle_route_for_a_reason() {
    for (reply, because) in [
        ("ROUTE = project", "not the separator the contract states"),
        // THE EDGE OF THE BLOCK-PREFIX SET (`strategy.rs::unmarked`).
        (">ROUTE: project", "a marker is only a marker when whitespace follows it"),
        ("#ROUTE: project", "same rule, and `#tag` is not a heading in CommonMark"),
        ("####### ROUTE: project", "seven hashes is not a heading in CommonMark"),
        ("| ROUTE: project", "a table pipe is not a block prefix"),
        ("~ ROUTE: project", "not a markdown construct at all"),
        ("ROUTE -> project", "an arrow is not a colon either"),
        ("[ROUTE] project", "a bracketed label with no separator at all"),
        ("ROUTE project", "no separator"),
        // The model was told 'one word'. A value carrying a clause is a model
        // that did not follow the contract, and guessing at which word it meant
        // is how a router starts inventing decisions.
        ("ROUTE: project (several steps)", "the value carries a parenthetical"),
        ("ROUTE: react or project", "the model hedged instead of choosing"),
        ("ROUTE: answer, WHY: trivial", "both fields crammed onto one line"),
        // Already argued in `strategy.rs`: an object is not a labelled line, and
        // no target may ask for JSON until the parser can read one.
        (r#"{"ROUTE": "project", "WHY": "x"}"#, "a one-line JSON object"),
        ("ROUTE:\nproject", "the value on the line below its label"),
    ] {
        assert_eq!(vote_of(reply), Route::React, "{reply:?} — {because}");
    }
}
