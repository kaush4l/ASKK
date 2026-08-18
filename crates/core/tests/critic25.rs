//! INCREMENT 25 — THE SEPARATE CRITIC, ON THE SURFACES.
//!
//! `agent::critic` decides; this asserts what a person actually sees. The rule
//! being defended is R17-P0-2's, one agent along: a turn that a different agent
//! reviewed and did not clear must not reach the board reading `ready`, and the
//! caller's own summary of the verdict must not be what the page believes.

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

const CRITIC: &str = include_str!("../../agent/tests/agents/critic.md");

/// A lead that can run a command, write a file and ask the critic.
const LEAD: &str = "---\nname: main\ndescription: the lead\nspace: research\n\
     tools: [exec, write_file, critic]\n---\nbody";

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

fn booted(replies: &[&str], verdict: &str) -> Rc<RefCell<App>> {
    let ports = Ports {
        model: Rc::new(ScriptedModel::with_replies(
            replies.iter().map(|r| ScriptedModel::text_reply(r)).collect(),
        )),
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: Rc::new(FakeShell::new().answering("cat", 0, "hello")),
        agents: Rc::new(ScriptedAgents::with(vec![("critic", Ok(verdict))])),
    };
    let mut app = block_on(boot(ports)).expect("boot succeeds");
    install_agents(
        &mut app,
        vec![
            ("main".to_string(), LEAD.to_string()),
            ("critic".to_string(), CRITIC.to_string()),
        ],
    );
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

/// One run: check something, hand it to the critic, then claim success.
const RAN: &str = r#"exec({"command": "cat notes.md"})"#;
const ASKED: &str = r#"critic({"query": "I wrote notes.md and cat printed hello"})"#;
/// The laundering attempt, written out: the caller reports the review as
/// having gone its way.
const CLAIMED: &str = "Done. I checked it and the critic reviewed it and was happy.";

/// THE CALLER CANNOT LAUNDER THE VERDICT. It says the critic was happy; the
/// critic said FAULT; the board reports the fault, not the claim.
#[test]
fn a_faulted_run_cannot_report_itself_as_answered() {
    let app = booted(&[RAN, ASKED, CLAIMED], "FAULT\nnotes.md is empty — cat printed a blank line.");
    ask(&app, "write notes.md and check it");

    let board = body(&app, "/board");
    assert_eq!(cell(&board, "data-ending"), "answered, and the critic disagreed");
    // …on MAIN's row. The critic's own row reads `ready`, truthfully: it was
    // asked a question and it answered one.
    assert!(!cell(&board, "data-line").starts_with("ready"), "{board}");
    assert!(
        cell(&board, "data-line").contains("the critic did not clear it"),
        "{}",
        cell(&board, "data-line")
    );
    // …and the conversation says a SEPARATE agent looked, which is the whole
    // difference between this and the critique stage.
    let chat = body(&app, "/chat");
    assert!(chat.contains("a separate agent that did not do"), "{chat}");
    assert!(chat.contains("the critic did not clear it"), "{chat}");
}

/// …AND A CLEARED RUN IS AN ORDINARY ANSWER. The same turn, the same claim, one
/// different verdict: nothing new is said and the reply is offered to read.
#[test]
fn a_run_the_critic_cleared_answers_normally() {
    let app = booted(&[RAN, ASKED, CLAIMED], "PASS\nnotes.md holds what the goal asked for.");
    ask(&app, "write notes.md and check it");

    let board = body(&app, "/board");
    assert_eq!(cell(&board, "data-ending"), "", "an answered turn offers the reply");
    let chat = body(&app, "/chat");
    assert!(!chat.contains("the critic did not clear it"), "nothing to say: {chat}");
}

/// §12'S BAN HOLDS OVER THE NEW COPY. A review by a second model is not proof,
/// and no surface this increment touches may say it is.
#[test]
fn the_critic_copy_vouches_for_nothing() {
    let app = booted(&[RAN, ASKED, CLAIMED], "PASS\nit is fine.");
    ask(&app, "write notes.md and check it");
    for view in ["/chat", "/board", "/agents"] {
        let rendered = body(&app, view).to_lowercase();
        for banned in ["verified", "unverified", "proven", "approved"] {
            assert!(!rendered.contains(banned), "{view} says `{banned}`");
        }
    }
}

/// THE CRITIC'S CARD SAYS WHAT IT CANNOT DO. Its tool list is its whole grant,
/// so the roster must not describe it as able to change anything.
#[test]
fn the_roster_shows_the_critic_reading_and_nothing_else() {
    let app = booted(&[RAN], "PASS\nfine.");
    let agents = body(&app, "/agents");
    assert!(agents.contains("critic"), "the critic is loaded: {agents}");
    for forbidden in ["exec(", "write_file(", "write_agent(", "start_process("] {
        let at = agents.find("data-agent=\"critic\"").map(|i| &agents[i..]).unwrap_or(&agents);
        let card = at.split("data-agent=\"").next().unwrap_or(at);
        assert!(!card.contains(forbidden), "the critic's card offers `{forbidden}`: {card}");
    }
}
