//! INCREMENT 34 — `Route::named`, AND THE ONE THING IT MUST NOT DO.
//!
//! `as_str` turns a route into a word and nothing turned a word back into a
//! route: a projection wanting the stage list behind a recorded `core.route_chosen`
//! had to round-trip the word through the VOTE parser, which falls to `React`
//! on anything unreadable. That fallback is right for a vote — a turn has to
//! run — and wrong for a projection, which has no such duty: a surface handed a
//! word this build does not know would draw `work` and say the turn is doing one
//! thing while it does another.
//!
//! POSITIVE CONTROLS, BOTH RUN AND RECORDED (T59/I17):
//!
//! - `a_word_this_build_does_not_know_is_not_a_route` — in
//!   `crates/agent/src/strategy.rs`, change `Route::named`'s last arm from
//!   `_ => None` to `_ => Some(Route::React)`. RED on `quest`.
//! - `the_vote_still_reads_every_word_it_used_to` — in the same arm, delete the
//!   `"project"` arm. RED: `vote_in` stops reading a project vote, which is the
//!   regression the refactor could have caused.

use agent::Route;

/// EVERY WORD `as_str` WRITES, `named` READS. The two are one table read in two
/// directions; a route that could be written and not read back is a fact the
/// log holds that no surface can use.
#[test]
fn every_route_round_trips_through_its_own_word() {
    for route in [Route::Answer, Route::React, Route::Project] {
        assert_eq!(Route::named(route.as_str()), Some(route), "{}", route.as_str());
    }
}

/// THE FALLBACK IS DELIBERATELY ABSENT. `route_of` keeps it, because a vote
/// must produce a turn; `named` refuses, because a projection must not draw a
/// flow nobody chose. `quest` is the word this test uses on purpose — it is the
/// flow the roadmap says comes next, and the day it exists this assertion is
/// how the projection finds out.
#[test]
fn a_word_this_build_does_not_know_is_not_a_route() {
    for unknown in ["quest", "", "REACT", "reakt", "plan"] {
        assert_eq!(Route::named(unknown), None, "{unknown} was resolved to a route");
    }
    // …while the VOTE still fails towards the middle, which is the other half
    // of the pair and must not have changed.
    assert_eq!(agent::vote_of("I am not sure what you want."), Route::React);
}

/// THE VOTE PARSER STILL READS WHAT IT READ. `vote_in` was a match on the same
/// three words and now delegates to `named`; the decoration handling that lives
/// above it — bold labels, list markers, case — is what this pins.
#[test]
fn the_vote_still_reads_every_word_it_used_to() {
    for (reply, want) in [
        ("ROUTE: project\nWHY: it asks for a build", Route::Project),
        ("**ROUTE:** answer", Route::Answer),
        ("- ROUTE: React", Route::React),
        ("1. ROUTE: PROJECT", Route::Project),
    ] {
        assert_eq!(agent::vote_of(reply), want, "{reply:?}");
    }
}
