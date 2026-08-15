//! Increment 27's tile strip, through the seam on the host (I3).
//!
//! The tiles are four sentences about the whole fleet and they are the
//! shortest thing on the page, which is why they are the easiest to get wrong
//! and the last thing anybody re-checks. Three properties are asserted
//! mechanically here, because prose in a doc comment does not survive an edit
//! and an assertion does:
//!
//! 1. **A tile with no data renders the WORDS.** No `—`, no `…`, no `LIVE`
//!    badge over a value the log cannot supply. A placeholder in the value
//!    slot is a promise that a number is coming, and for an empty log nothing
//!    is coming.
//! 2. **The tiles and the board cannot disagree.** The count of working agents
//!    is the length of the same list the `x-busy` header is made of, so a
//!    projection that says two while the header names one is a compile-time
//!    impossibility rather than a thing somebody notices later.
//! 3. **No tile reports health.** A failure is stated and named; the absence
//!    of one is never rendered as a verdict on the page.

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{
    DenyAllNet, FakeShell, FixedClock, MemKv, MemStore, ScriptedAgents, ScriptedModel, SeededRng,
};
use core::{boot, drive, handle, install_agents, App, Ports};
use kernel::{Request, Response, Timestamp};

fn block_on<F: Future>(fut: F) -> F::Output {
    let mut fut = pin!(fut);
    let mut cx = Context::from_waker(Waker::noop());
    for _ in 0..10_000 {
        if let Poll::Ready(v) = fut.as_mut().poll(&mut cx) {
            return v;
        }
    }
    panic!("future not ready under in-memory ports");
}

fn spec(name: &str) -> (String, String) {
    (
        name.to_string(),
        format!("---\nname: {name}\ndescription: one\ntools: []\nspace: research\n---\nbody"),
    )
}

fn booted(replies: &[&str], agents: &[&str]) -> Rc<RefCell<App>> {
    let mut app = block_on(boot(Ports {
        model: Rc::new(ScriptedModel::with_replies(
            replies.iter().map(|s| ScriptedModel::text_reply(s)).collect(),
        )),
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: Rc::new(FakeShell::new()),
        agents: Rc::new(ScriptedAgents::none()),
    }))
    .expect("boot succeeds");
    install_agents(&mut app, agents.iter().map(|n| spec(n)).collect());
    Rc::new(RefCell::new(app))
}

fn get(app: &Rc<RefCell<App>>, path: &str) -> Response {
    handle(&mut app.borrow_mut(), Request::get(path).with_header("x-agent", "main"))
}

fn tiles(app: &Rc<RefCell<App>>) -> String {
    get(app, "/tiles").body
}

/// How many agents the board holds — counted off the board's own projection
/// rather than off the list this test installed, because a build ships agents
/// of its own and the denominator in the tile is every agent that is loaded.
fn loaded(app: &Rc<RefCell<App>>) -> usize {
    get(app, "/board").body.matches("class=\"agent-row").count()
}

/// A cold page has a log with nothing in it, and every tile says so in the
/// words that describe ITS OWN absence — not one shared "no data", and not a
/// dash. `no agents are loaded` and `none of 3 agents` are different facts
/// with different fixes and the strip must not render them the same.
#[test]
fn a_tile_with_nothing_to_report_says_so_in_words() {
    let cold = booted(&[], &["main", "scout", "builder"]);
    let body = tiles(&cold);
    let all = format!("none of {} agents", loaded(&cold));
    for said in [all.as_str(), "no turns yet", "nothing spent yet"] {
        assert!(body.contains(said), "expected {said:?} in {body}");
    }

    // The one absence this harness cannot stage is a board with no rows at
    // all: every build ships agents, and `install_agents` adds to them rather
    // than replacing them. `tiles::working` renders `no agents are loaded` for
    // it — a different fact from `none of N agents`, with a different fix —
    // and it is the branch the board's own empty state (`board::table`) is
    // asserted on elsewhere.
    assert!(
        !body.contains("none of 0 agents"),
        "an empty roster is not an idle roster: {body}"
    );
}

/// The honesty rule as a grep. A placeholder in the value slot promises a
/// number that an empty log has no way to produce, and a `LIVE` badge over one
/// is the reference screenshot's own defect — it wears the word on tiles whose
/// value is a dash.
#[test]
fn nothing_stands_in_for_a_number_the_log_does_not_have() {
    let body = tiles(&booted(&[], &["main"]));
    for placeholder in ["…", "&hellip;", "—", "--", "LIVE", "N/A", "TBD"] {
        assert!(
            !body.contains(placeholder),
            "{placeholder:?} is a value pretending to be on its way: {body}"
        );
    }
}

/// No tile may infer that the page is well. The failure tile reports a failure
/// and names whose; with no failure in the log it reports the log's contents,
/// which is a count and not a verdict, and it never reaches for the vocabulary
/// of a green summary.
#[test]
fn no_tile_says_everything_is_fine() {
    let body = tiles(&booted(&[], &["main"])).to_lowercase();
    assert!(body.contains("no turn has failed yet"), "{body}");
    for claim in [
        "all systems", "all good", "healthy", "everything is", "operational",
        "nominal", "no problems", "verified",
    ] {
        assert!(!body.contains(claim), "{claim:?} is a verdict, not a fact: {body}");
    }
}

/// THE ONE THAT CANNOT BE ALLOWED TO DRIFT. `x-busy` is the header the chrome
/// wears and its value is the list of names; the tile is a count of the same
/// list. If they were computed twice they would eventually differ by a
/// `queued` agent — a task accepted whose Worker has not entered the turn yet
/// — and the page would carry two numbers for one fact.
#[test]
fn the_tile_count_and_the_boards_own_header_are_one_answer() {
    let app = booted(&["done"], &["main", "scout"]);

    // Nothing running: no header at all, and the tile says none of two.
    let all = loaded(&app);
    let idle = get(&app, "/board");
    assert!(!idle.headers.iter().any(|(k, _)| k == "x-busy"));
    assert!(
        tiles(&app).contains(&format!("none of {all} agents")),
        "{}",
        tiles(&app)
    );

    // A task ACCEPTED and not yet pumped is work in progress in both places.
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", "go")]),
    );
    let busy = get(&app, "/board")
        .headers
        .iter()
        .find(|(k, _)| k == "x-busy")
        .map(|(_, v)| v.clone())
        .expect("an accepted utterance is a working agent");
    let named = busy.split(", ").count();
    assert_eq!(named, 1, "one agent was given the task: {busy}");
    assert!(
        tiles(&app).contains(&format!("{named} of {all} agents")),
        "the tile counts what the header names: {busy} / {}",
        tiles(&app)
    );

    block_on(drive(Rc::clone(&app))).expect("the turn drives");
}

/// Turns and tokens are counted off the log, never estimated. One turn against
/// a provider that reported no usage is one turn and nothing spent — the tile
/// does not invent a figure for a reply that came with no accounting block,
/// and it does not report the turn as free either.
#[test]
fn the_numbers_are_counted_from_the_log() {
    let app = booted(&["done"], &["main"]);
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", "go")]),
    );
    block_on(drive(Rc::clone(&app))).expect("the turn drives");

    let body = tiles(&app);
    assert!(body.contains("1 turn"), "one turn was taken: {body}");
    assert!(
        body.contains("nothing spent yet"),
        "the scripted provider reports no usage, and a floor is not an estimate: {body}"
    );
}

/// Every card is a door, and both doors name their destination rather than an
/// action — nothing on this board starts a turn (R5-3). The attribute is the
/// one the roster already uses, because a second mechanism for "a press inside
/// core-rendered markup" is a second thing to keep working.
#[test]
fn every_board_card_carries_its_two_doors() {
    let body = get(&booted(&[], &["main", "scout"]), "/board").body;
    for door in [
        "data-open=\"chat\"", "data-open=\"trace\"",
        "Talk to main", "What main has run",
        "Talk to scout", "What scout has run",
    ] {
        assert!(body.contains(door), "expected {door:?} in {body}");
    }
    assert!(!body.contains("Start "), "no door on this board starts a turn");
}
