//! INCREMENT 34 — THE ROUTE IS A FACT THE CORE OWNS, AND THE ROW STATES IT.
//!
//! `core.route_chosen` has been in the log since the strategy stage landed and
//! the only surface reading it was a debug pane. The board row — the one place
//! a person compares what agents are doing — could say `stage 2 of 4: work` in
//! a SENTENCE and had no machine-readable fact behind any of it, so the Flow
//! Rail (increment 7) had nothing to draw and any second surface would have had
//! to parse English out of `data-line`.
//!
//! Four facts and a fifth that is I16: the route, the walk that route takes,
//! where in it the turn is, which lap — and, for a row whose agent is not this
//! process's, `data-flow="elsewhere"`, because an empty route on a sub-agent's
//! row is otherwise indistinguishable from "it has not voted yet".
//!
//! POSITIVE CONTROLS, ALL RUN AND RECORDED (T59/I17). Each is one line:
//!
//! - `the_row_carries_the_route_and_the_walk_it_is_taking` — replace the
//!   `crate::board::flow::hang(card, …)` call at `board/row.rs:81` with `card`.
//!   RED, all four: `the row publishes no route`.
//! - `a_row_for_an_agent_this_process_is_not_says_so` — in `board/flow.rs:36`,
//!   `let mine = true;`. RED: `helper` reads `here`, not `elsewhere`.
//! - `the_lap_attribute_and_the_sentence_have_one_author` — in `board/flow.rs:89`,
//!   change `lap`'s format to `pass {n} of {of}`. RED on the value.
//! - …AND THE FORK ITSELF NEEDED ITS OWN CONTROL, because the one above moves
//!   the attribute and the sentence TOGETHER — which is the property, so it
//!   cannot falsify it. Giving `data-lap` a second author instead
//!   (`&lap.map(|l| l.replace("up to ", ""))` at `board/flow.rs:49`) is RED on
//!   `the attribute and the sentence beside it have forked`. Run, both ways.

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{
    DenyAllNet, FakeShell, FixedClock, MemKv, MemStore, ScriptedAgents, ScriptedModel, SeededRng,
};
use core::{boot, drive, handle, install_agents, App, Ports};
use kernel::{ModelPort, ModelReply, Request, Timestamp};

mod common;

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

/// Answers a script and then hangs, so the turn is still open when the row is
/// read. Every flow fact worth asserting is a fact about a turn in progress.
struct AnswersThenHangs {
    replies: RefCell<Vec<String>>,
}

impl AnswersThenHangs {
    fn with(replies: &[&str]) -> Rc<Self> {
        Rc::new(Self {
            replies: RefCell::new(replies.iter().map(|r| (*r).to_string()).collect()),
        })
    }
}

impl ModelPort for AnswersThenHangs {
    fn call<'a>(
        &'a self,
        _endpoint: &'a kernel::EndpointName,
        _body_json: &'a str,
    ) -> kernel::BoxFuture<'a, Result<ModelReply, kernel::ModelError>> {
        let mut left = self.replies.borrow_mut();
        let next = match left.is_empty() {
            true => None,
            false => Some(left.remove(0)),
        };
        drop(left);
        match next {
            None => Box::pin(std::future::pending()),
            Some(text) => Box::pin(std::future::ready(Ok(ModelReply {
                body_json: ScriptedModel::text_reply(&text),
                usage: None,
            }))),
        }
    }
}

/// The SHIPPED shape: one declared stage, and it is the vote. The list this
/// turn walks is the route's, never this line (`public/agents/main/agent.md`).
const VOTING: &str = "---\nname: main\ndescription: the lead\nspace: research\n\
     tools: [exec]\nstages: [strategy]\n---\nbody";

/// An agent that can lap and never votes — `passes:` above 1 is what makes a
/// lap fact possible at all (`board/flow.rs`, the two deliberate silences).
const LOOPER: &str = "---\nname: main\ndescription: the lead\nspace: research\n\
     tools: [exec]\nstages: [plan, work, verify]\npasses: 4\n---\nbody";

const RAN: &str = r#"exec({"command": "echo hi"})"#;

/// A SECOND AGENT ON THE BOARD. Its turns run in its own Worker, so every fact
/// this module reads is one this process structurally cannot have.
const PEER: &str = "---\nname: helper\ndescription: a peer\nstages: [strategy]\n---\nbody";

fn booted(agent: &str, model: Rc<dyn ModelPort>) -> Rc<RefCell<App>> {
    let ports = Ports {
        model,
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: Rc::new(FakeShell::new().answering("echo", 0, "hi")),
        agents: Rc::new(ScriptedAgents::none()),
    };
    let mut app = block_on(boot(ports)).expect("boot succeeds");
    install_agents(
        &mut app,
        vec![("main".to_string(), agent.to_string()), ("helper".to_string(), PEER.to_string())],
    );
    common::brief(&mut app);
    Rc::new(RefCell::new(app))
}

fn run(app: &Rc<RefCell<App>>, message: &str) {
    handle(&mut app.borrow_mut(), Request::post_form("/chat", &[("message", message)]));
    let mut turn = Box::pin(drive(Rc::clone(app)));
    let mut cx = Context::from_waker(Waker::noop());
    let _ = turn.as_mut().poll(&mut cx);
}

fn board(app: &Rc<RefCell<App>>) -> String {
    handle(&mut app.borrow_mut(), Request::get("/board")).body
}

/// One `data-*` value off ONE row — `ui::board::read_attrs::cell`'s rule, so
/// the test reads the projection exactly as the frontend does.
fn cell(board: &str, agent: &str, attr: &str) -> String {
    let at = board.find(&format!("data-agent=\"{agent}\"")).expect("that agent has a row");
    let (_, rest) = board[at..].split_once(&format!("{attr}=\"")).expect("that attribute");
    rest.split_once('"').map(|(v, _)| v.to_string()).unwrap_or_default()
}

/// A turn that voted `project` and walked into `work`.
fn a_project_turn() -> Rc<RefCell<App>> {
    let app = booted(
        VOTING,
        AnswersThenHangs::with(&[
            "ROUTE: project\nWHY: it asks for a working script",
            "OUTCOME — a script that prints the primes.",
        ]),
    );
    run(&app, "write me a primes script");
    app
}

/// THE ASSERTION THAT WAS IMPOSSIBLE BEFORE THIS INCREMENT. The row states the
/// loop this turn chose and the list that loop walks, as facts and not as
/// prose — `data-walk` is the four stages the `project` route really takes,
/// which is NOT the one stage the agent file declares.
#[test]
fn the_row_carries_the_route_and_the_walk_it_is_taking() {
    let board = board(&a_project_turn());
    assert_eq!(cell(&board, "main", "data-route"), "project", "the row publishes no route");
    assert_eq!(
        cell(&board, "main", "data-walk"),
        "plan,work,verify,critique",
        "the walk is the file's declared list and not the route's"
    );
    assert_eq!(cell(&board, "main", "data-stage"), "work", "where in the walk it is");
    assert_eq!(cell(&board, "main", "data-flow"), "here", "this process ran this turn");
}

/// …AND A TURN THAT HAS NOT VOTED PUBLISHES NO ROUTE RATHER THAN A GUESS.
/// `Route::named` has no `React` fallback for exactly this: a row drawing
/// `react` before the vote lands would be a confident sentence about a turn
/// nobody chose.
#[test]
fn a_turn_that_has_not_voted_publishes_no_route_at_all() {
    let app = booted(VOTING, AnswersThenHangs::with(&[]));
    run(&app, "hello");
    let board = board(&app);
    assert_eq!(cell(&board, "main", "data-route"), "", "a route was invented before the vote");
    assert_eq!(cell(&board, "main", "data-walk"), "", "and a walk with it");
    assert_eq!(cell(&board, "main", "data-stage"), "strategy", "the stage IS a fact by now");
}

/// I16 — A ROW SAYS WHAT THIS PROCESS CANNOT SEE. `STAGE_ENTERED`, `PASS_SPENT`
/// and `ROUTE_CHOSEN` are all emitted by the engine running the turn, so
/// another agent's are in ITS Worker's log. Rendering that as four empty
/// attributes reads as "it has not started", which is a truth the system holds
/// and does not state.
#[test]
fn a_row_for_an_agent_this_process_is_not_says_so() {
    let board = board(&a_project_turn());
    let other = "helper";
    assert_eq!(
        cell(&board, &other, "data-flow"),
        "elsewhere",
        "{other}'s flow facts are drawn as though this page could see them"
    );
    assert_eq!(cell(&board, &other, "data-route"), "", "{other} is not this process's agent");
}

/// ONE AUTHOR FOR THE LAP CLAUSE. The sentence on `data-line` and the fact on
/// `data-lap` are the same string from the same function, so no second surface
/// can fork the wording — which is the whole reason `lap` moved out of
/// `board/stage.rs` and into `board/flow.rs`.
#[test]
fn the_lap_attribute_and_the_sentence_have_one_author() {
    let app = booted(
        LOOPER,
        AnswersThenHangs::with(&["OUTCOME — index.md exists.", RAN, "Wrote it.", "`ls` shows it."]),
    );
    run(&app, "write index.md");
    let board = board(&app);
    let lap = cell(&board, "main", "data-lap");
    assert_eq!(lap, "pass 2 of up to 4", "the lap the log counted is not on the row");
    assert!(
        cell(&board, "main", "data-line").contains(&lap),
        "the attribute and the sentence beside it have forked"
    );
    // …and this agent never votes, so it has a lap and no route. Both true.
    assert_eq!(cell(&board, "main", "data-route"), "", "an unvoted turn published a route");
}
