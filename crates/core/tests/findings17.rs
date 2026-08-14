//! R17-P0-2: A RUN THAT ABANDONED ITS TASK REPORTED "finished".
//!
//! A fresh-context critic gave `main` a six-part task from the Dashboard and
//! walked away. On return: the card read `main finished "In the workspace,
//! create five files a.md b.md c.md d.md e.md … and write a summary file
//! index.md …"` with a `Read the reply` button; the board read `main ready · 2
//! turns in all`; `index.md` was never written; and `Read the reply` landed on a
//! final assistant message that was a raw malformed tool call —
//! `exec({"command": "cat a.md"}, {"command": "cat b.md"}, …)`.
//!
//! *"A product whose whole promise is 'give it a task and walk away' cannot be
//! trusted until its ending is true."*
//!
//! The endings are enumerated in `core::ending`, off ONE fact (`agent::ENDED`)
//! that the pure step function writes at every ending it owns. These tests
//! assert on the projections all three surfaces read: the board row's own
//! attributes — which is literally what the Dashboard card renders — and the
//! conversation.
//!
//! …and R17-P1-3: the clause that points at a view names the view the failing
//! call is really in. R15 moved every shell row out of the Tool trace and into
//! Commands, and the sentence still said "the Tool trace has both".

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

const MAIN: &str = "---\nname: main\ndescription: the lead\ntools: []\nspace: research\n---\nbody";
/// The same agent with room for exactly one round of tool calls.
const TIGHT: &str =
    "---\nname: main\ndescription: the lead\ntools: []\nspace: research\nmax_rounds: 1\n---\nbody";

/// THE REPLY THE RUN REALLY ENDED ON, verbatim from the critic's session. It is
/// not a call — a call takes one argument object, and the `,` where the `)`
/// belongs is where this stops being one — so `parse_batches` finds nothing in
/// it, which used to mean "the model answered".
const STRANDED: &str =
    r#"exec({"command": "cat a.md"}, {"command": "cat b.md"}, {"command": "cat c.md"})"#;

fn booted(agent: &str, replies: &[&str], shell: Rc<FakeShell>) -> Rc<RefCell<App>> {
    let ports = Ports {
        model: Rc::new(ScriptedModel::with_replies(
            replies.iter().map(|r| ScriptedModel::text_reply(r)).collect(),
        )),
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: shell,
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

/// One `data-*` value off the row, exactly as `runstatus::cell` reads it: the
/// Dashboard card has no other source, so asserting here asserts the card.
fn cell(board: &str, attr: &str) -> String {
    let at = board.find("data-agent=\"main\"").expect("main has a row");
    let (_, rest) = board[at..].split_once(&format!("{attr}=\"")).expect("the attribute");
    rest.split_once('"').map(|(v, _)| v.to_string()).unwrap_or_default()
}

/// THE WHOLE FINDING, on the run that produced it.
#[test]
fn a_run_that_stopped_without_answering_says_so_on_every_surface() {
    let app = booted(
        MAIN,
        &[r#"write_file({"path": "a.md", "contents": "a"})"#, STRANDED],
        Rc::new(FakeShell::new()),
    );
    ask(&app, "create five files a.md b.md c.md d.md e.md and write a summary index.md");

    // THE BOARD ROW. `ready` is what the status fact says about a turn that
    // abandoned its task — true about who owes the next move, useless about how
    // the last one went.
    let board = body(&app, "/board");
    assert!(
        board.contains("stopped without answering"),
        "the row says how the turn ended: {board}"
    );
    assert!(!board.contains(">ready · "), "and does not say ready: {board}");

    // THE DASHBOARD CARD, which is these two attributes and nothing else. An
    // empty `data-ending` is what makes `Read the reply` appear, so a run that
    // produced no reply must not have one.
    assert_eq!(cell(&board, "data-ending"), "stopped without answering");
    assert!(
        cell(&board, "data-line").contains("a tool call this page could not read"),
        "the card's sentence says what happened: {}",
        cell(&board, "data-line")
    );

    // THE CONVERSATION. The text is still shown in full — what the model
    // actually sent is the most useful thing on screen when a run strands — but
    // as a notice about a failed step, not as the agent's words to you.
    let chat = body(&app, "/chat");
    assert!(chat.contains("main did not answer"), "{chat}");
    assert!(chat.contains("cat a.md"), "the machine output is still shown in full: {chat}");
    assert!(
        !chat.contains("msg assistant"),
        "a malformed tool call is not an assistant reply: {chat}"
    );
    // …AND IT POINTS NOWHERE. Nothing ran, so there is no row for it in either
    // pane, and naming one would be R17-P1-3 in a new place.
    assert!(chat.contains("no tool row for it anywhere"), "{chat}");
}

/// A turn that DID answer is untouched: the row keeps the status word, the card
/// keeps `Read the reply` (an empty `data-ending`), and the reply is a reply.
#[test]
fn a_turn_that_answered_still_reads_as_finished() {
    let app = booted(MAIN, &["The five files are written."], Rc::new(FakeShell::new()));
    ask(&app, "create five files");
    let board = body(&app, "/board");
    assert_eq!(cell(&board, "data-ending"), "", "an answered turn offers the reply");
    assert!(board.contains("ready · 1 turn in all"), "{board}");
    let chat = body(&app, "/chat");
    assert!(chat.contains("msg assistant"), "the answer is the agent's own words: {chat}");
    assert!(!chat.contains("did not answer"), "{chat}");
}

/// THE CEILING IS AN ENDING TOO, and a different one to act on: the act is to
/// raise `max_rounds:`, which no other ending asks for. It used to be a
/// `core.note` — the kind the machine uses for anything it wants to say — so
/// the only surface that could tell it from an answer was the conversation.
#[test]
fn the_round_ceiling_is_an_ending_the_board_and_the_card_can_see() {
    let app = booted(
        TIGHT,
        &[
            r#"write_file({"path": "a.md", "contents": "a"})"#,
            r#"write_file({"path": "b.md", "contents": "b"})"#,
        ],
        Rc::new(FakeShell::new()),
    );
    ask(&app, "create five files and summarise them");

    let board = body(&app, "/board");
    assert_eq!(cell(&board, "data-ending"), "stopped at its round ceiling");
    assert!(cell(&board, "data-line").contains("max_rounds"), "{board}");
    let chat = body(&app, "/chat");
    assert!(chat.contains("Stopped after 1 round of tool calls without an answer"), "{chat}");
    assert!(chat.contains("Raise <code>max_rounds:</code> in this agent"), "{chat}");
}

/// R17-P1-3. THE POINTER NAMES THE VIEW THE CALL IS ACTUALLY IN. The failing
/// call here is a shell command, and R15 moved shell rows OUT of the Tool trace
/// and into Commands — the trace says so on its own empty state — so the
/// sentence was wrong precisely because of a change made two rounds earlier.
#[test]
fn the_pointer_names_commands_when_the_failing_call_was_a_shell_command() {
    let app = booted(
        MAIN,
        &[
            r#"exec({"command": "wc -l primes.txt"})"#,
            "There is no such file.",
        ],
        Rc::new(FakeShell::new().answering("wc -l", 2, "/bin/sh: syntax error")),
    );
    ask(&app, "how many lines in primes.txt");

    for (view, page) in [("board", body(&app, "/board")), ("chat", body(&app, "/chat"))] {
        assert!(
            page.contains("a tool call in that turn failed — Commands has it"),
            "{view} points at the view the row is in: {page}"
        );
        assert!(
            !page.contains("the Tool trace has it"),
            "{view} must not point at a pane that filters this row out: {page}"
        );
    }
    // …and the Tool trace agrees that it does not have it.
    let trace = body(&app, "/tools");
    assert!(trace.contains("No tool other than the shell"), "{trace}");
}
