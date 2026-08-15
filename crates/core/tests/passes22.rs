//! INCREMENT 22 — THE LOOP AROUND THE LOOP, ON THE SURFACES.
//!
//! `agent::passes` decides; these assert what a person actually sees, because
//! that is where R17-P0-2 went wrong: the machine knew a six-part task had been
//! abandoned and every surface read the absence of a task as success.
//!
//! Two things have to be visible, and neither is optional. A loop nobody can
//! see is a token meter running behind a spinner, so every lap is a fact with a
//! line of its own; and running out of laps is not an answer, so it gets its own
//! ending word beside the round ceiling's.

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{
    DenyAllNet, FakeShell, FixedClock, MemKv, MemStore, ScriptedAgents, ScriptedModel, SeededRng,
};
use core::{boot, drive, handle, install_agents, App, Ports};
use kernel::{Request, Timestamp};

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

/// A looping agent, cut to the bone: one stage, two laps. The stage list is
/// what `passes:` laps, so `[work]` is the smallest legal one.
const LOOPER: &str = "---\nname: main\ndescription: the lead\nspace: research\n\
     tools: [exec]\nstages: [work]\npasses: 2\n---\nbody";

fn booted(agent: &str, replies: &[&str]) -> Rc<RefCell<App>> {
    let ports = Ports {
        model: Rc::new(ScriptedModel::with_replies(
            replies.iter().map(|r| ScriptedModel::text_reply(r)).collect(),
        )),
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: Rc::new(FakeShell::new().answering("echo", 0, "hi")),
        agents: Rc::new(ScriptedAgents::none()),
    };
    let mut app = block_on(boot(ports)).expect("boot succeeds");
    install_agents(&mut app, vec![("main".to_string(), agent.to_string())]);
    Rc::new(RefCell::new(app))
}

fn ask(app: &Rc<RefCell<App>>, message: &str) {
    handle(&mut app.borrow_mut(), Request::post_form("/chat", &[("message", message)]));
    block_on(drive(Rc::clone(app))).expect("the turn runs");
}

fn body(app: &Rc<RefCell<App>>, path: &str) -> String {
    handle(&mut app.borrow_mut(), Request::get(path)).body
}

fn cell(board: &str, attr: &str) -> String {
    let at = board.find("data-agent=\"main\"").expect("main has a row");
    let (_, rest) = board[at..].split_once(&format!("{attr}=\"")).expect("the attribute");
    rest.split_once('"').map(|(v, _)| v.to_string()).unwrap_or_default()
}

const RAN: &str = r#"exec({"command": "echo hi"})"#;

/// THE WHOLE INCREMENT ON ONE RUN. Two laps, the second one still working, the
/// budget out — and the page says so on the board, on the card and in the
/// conversation rather than reporting a finished job.
#[test]
fn a_run_that_used_up_its_passes_says_so_on_every_surface() {
    let app = booted(LOOPER, &[RAN, "Pass one done.", RAN, "Pass two done; index.md remains."]);
    ask(&app, "create five files and summarise them");

    // THE LAPS ARE VISIBLE, with their count — "still going" and "going for the
    // second time out of two" are different things to read.
    let chat = body(&app, "/chat");
    assert!(chat.contains("Pass 2 of 2"), "the lap is on screen with its number: {chat}");
    // …and the sentence says the model was never asked whether it was done.
    assert!(chat.contains("Nothing asked the model whether it was finished"), "{chat}");

    // THE ENDING IS ITS OWN, NOT AN ANSWER (R17-P0-2).
    let board = body(&app, "/board");
    assert_eq!(cell(&board, "data-ending"), "stopped when its passes ran out");
    assert!(cell(&board, "data-line").contains("passes:"), "{}", cell(&board, "data-line"));
    assert!(!board.contains(">ready · "), "and the row does not read ready: {board}");
    assert!(chat.contains("It ran out of passes after"), "{chat}");
    assert!(chat.contains("the work is unfinished"), "{chat}");

    // …AND IT IS NOT THE ROUND CEILING'S. They are raised in two different
    // lines of the file, so they cannot share a sentence.
    assert!(!chat.contains("Raise <code>max_rounds:</code>"), "{chat}");
}

/// A PASS THAT TOUCHED NOTHING IS THE LOOP'S NATURAL END. The mechanical
/// continue condition is the point of the whole design — a local 12B asked "are
/// you done?" answers "not yet" for ever — so a turn that only talked ends
/// normally, with no lap fact and the ordinary answered ending.
#[test]
fn a_pass_that_did_nothing_ends_the_turn_the_way_it_always_did() {
    let app = booted(LOOPER, &["Nothing to do — the files are already there."]);
    ask(&app, "create five files");

    let chat = body(&app, "/chat");
    assert!(!chat.contains("Pass 2 of 2"), "no lap was spent: {chat}");
    assert!(chat.contains("msg assistant"), "the answer is the agent's own words: {chat}");
    let board = body(&app, "/board");
    assert_eq!(cell(&board, "data-ending"), "", "an answered turn offers the reply");
}

/// §12'S BAN STILL HOLDS OVER THE NEW COPY (`verify19.rs`'s rule). Nothing this
/// increment renders may vouch for work: a page that says a looping agent
/// "verified" its own output is the one claim this build refuses to make.
#[test]
fn the_pass_copy_vouches_for_nothing() {
    let app = booted(LOOPER, &[RAN, "Pass one done.", RAN, "Pass two done."]);
    ask(&app, "do the work");
    for view in ["/chat", "/board"] {
        let rendered = body(&app, view).to_lowercase();
        for banned in ["verified", "unverified", "proven"] {
            assert!(!rendered.contains(banned), "{view} says `{banned}`");
        }
    }
}
