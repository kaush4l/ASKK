//! R13-1: "STOP WAITING" MADE TWO OTHER PANES CLAIM THE RUN HAD FINISHED.
//!
//! `sleep 90; echo MARKER_B` was 24 seconds old when Stop waiting was pressed.
//! In the same frame the Dashboard card read `main finished "…"` with a **Read
//! the reply** button, and the board row read `main ready · 5 turns` — 71
//! seconds before the command could possibly have ended, and neither corrected
//! itself when it did. The Tool trace, reading `App::calling`, said the whole
//! time that the call was still running.
//!
//! The card and the row are both projections of ONE fact, the agent's status,
//! and `runtime::drive` was writing that fact from an incomplete test of
//! whether the turn was over: `task.is_none()`. Stop waiting clears the task
//! (11b) so the deferred agent swap can land — so the very press that hands the
//! conversation back also told the log the turn had ended, while the call it
//! was inside was still outstanding in this same process.
//!
//! `FakeShell::wedging` is that command on the host (I3): a `sleep 90` the port
//! never answers.

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

const MAIN: &str = "---\nname: main\ndescription: the lead\ntools: []\nspace: research\n---\nbody";
const SLEEP: &str = "sleep 90; echo MARKER_B";

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

/// Poll a future that is not going to finish, far enough that everything before
/// the wedge has happened — the browser's real shape, where `drive` borrows the
/// app only between awaits and the page stays answerable.
fn wedged<F: Future>(fut: F) -> std::pin::Pin<Box<F>> {
    let mut fut = Box::pin(fut);
    let mut cx = Context::from_waker(Waker::noop());
    for _ in 0..64 {
        assert!(fut.as_mut().poll(&mut cx).is_pending(), "the wedge answered");
    }
    fut
}

fn booted(replies: &[&str], shell: Rc<FakeShell>) -> Rc<RefCell<App>> {
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
    install_agents(&mut app, vec![("main".to_string(), MAIN.to_string())]);
    Rc::new(RefCell::new(app))
}

fn body(app: &Rc<RefCell<App>>, path: &str) -> String {
    handle(&mut app.borrow_mut(), Request::get(path)).body
}

/// R13-1. The press ends the WAIT. It does not end the run, and the two panes
/// that describe the run must go on describing the one the trace is showing.
#[test]
fn stopping_the_wait_does_not_make_the_board_say_the_run_finished() {
    let shell = Rc::new(FakeShell::new().wedging("sleep 90"));
    let app = booted(&[&format!("exec({{\"command\": \"{SLEEP}\"}})")], Rc::clone(&shell));
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", "Run in the workspace exactly: sleep 90")]),
    );
    let _turn = wedged(drive(Rc::clone(&app)));

    // Commands is the surface that was right all along, and it is right here.
    // (It was the trace until R15-P1-4 moved the shell's one home there.)
    let trace = body(&app, "/terminal");
    assert!(trace.contains("running"), "{trace}");

    // 02:40:40 — the press.
    handle(&mut app.borrow_mut(), Request::post_form("/chat/stop", &[]));
    block_on(drive(Rc::clone(&app))).expect("the drive carrying the stop finishes");

    // THE CHAT PANE IS HANDED BACK. That half was never wrong and must stay.
    let chat = handle(&mut app.borrow_mut(), Request::get("/chat"));
    assert!(
        !chat.headers.iter().any(|(k, v)| k == "x-turn" && v == "pending"),
        "the wait is over: {}",
        chat.body
    );

    // …AND THE RUN IS STILL THE RUN THE TRACE IS SHOWING. `data-status` is what
    // the board row's word and the Dashboard card's `finished` / `Read the
    // reply` are both computed from (`core::board::row`, `ui::board::read_attrs::live`).
    let board = body(&app, "/board");
    assert!(
        board.contains("data-status=\"working\""),
        "the call is still in flight, so the run has not finished: {board}"
    );
    assert!(!board.contains(">ready ·"), "{board}");
    // …and the page keeps watching, so the card can correct itself when the
    // command really does come back. Nothing changed for two minutes in the
    // walk because nothing was polling any more.
    let watched = handle(&mut app.borrow_mut(), Request::get("/board"));
    assert!(watched.headers.iter().any(|(k, _)| k == "x-busy"), "still working");
    assert!(watched.headers.iter().any(|(k, _)| k == "x-watch"), "still polling");
    // Commands and the board agree, which is the whole of the finding.
    assert!(body(&app, "/terminal").contains("running"));
}

/// The other side of the same guard: with nothing outstanding, Stop waiting
/// still ends the turn. An over-correction would leave every stopped agent
/// pinned at `working` for ever.
#[test]
fn stopping_a_wait_with_nothing_in_flight_still_ends_the_turn() {
    let shell = Rc::new(FakeShell::new());
    let app = booted(&["thinking about it"], Rc::clone(&shell));
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", "hello")]),
    );
    handle(&mut app.borrow_mut(), Request::post_form("/chat/stop", &[]));
    block_on(drive(Rc::clone(&app))).expect("drive finishes");
    let board = body(&app, "/board");
    assert!(!board.contains("data-status=\"working\""), "{board}");
}
