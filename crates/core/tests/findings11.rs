//! R11: A COMMAND THAT WILL NOT END, and everything that was said about it.
//!
//! One ordinary first task — "start a background process that appends the date
//! to pulse.log every second" — became a FOREGROUND `while true`, the shell
//! never returned, and for seven minutes every status on the page said the
//! product was fine: the header green, two panes describing a fetch that had
//! not been sent, and a trace claiming no tool had ever run while the very call
//! it was not showing was writing the file.
//!
//! `FakeShell::wedging` is that command on the host (I3): a `while true` the
//! port never answers. Nothing here needs a browser.

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{
    DenyAllNet, FakeShell, FixedClock, MemKv, MemStore, ScriptedAgents, ScriptedModel, SeededRng,
};
use core::{boot, drive, handle, install_agents, App, Ports};
use kernel::{Interrupt, Request, Timestamp};

const MAIN: &str = "---\nname: main\ndescription: the lead\ntools: []\nspace: research\n---\nbody";
const WEDGE: &str = "while true; do date >> pulse.log; sleep 1; done";

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

/// Poll a future that is NOT going to finish, far enough that everything before
/// the wedge has happened. This is the browser's real shape: `drive` borrows the
/// app only between awaits, so the page stays answerable while one call hangs —
/// which is exactly why a second `drive` can carry a Stop in.
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

fn typed(app: &Rc<RefCell<App>>, command: &str) {
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/terminal", &[("command", command)]),
    );
}

/// R11-1a and R11-4, in one wedge: every surface that described a world in
/// which nothing was happening now names the command that is happening.
#[test]
fn a_command_that_never_answers_is_named_by_every_pane_queued_behind_it() {
    let shell = Rc::new(FakeShell::new().wedging("while true"));
    let app = booted(&[&format!("exec({{\"command\": \"{WEDGE}\"}})")], Rc::clone(&shell));
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", "keep a pulse log")]),
    );
    let _turn = wedged(drive(Rc::clone(&app)));

    // COMMANDS, which said "Nothing has been run yet" for seven minutes while
    // this call was writing the file (R11-4). The shell has one home since
    // R15-P1-4; the pane that shows it is the pane that must not deny it.
    let trace = body(&app, "/terminal");
    assert!(trace.contains("running"), "the pane says it is inside one: {trace}");
    assert!(trace.contains("while true; do date &gt;&gt; pulse.log"), "the pane names the command it is inside: {trace}");
    assert!(!trace.contains("No shell command has been run here yet"), "{trace}");

    // THE PANES QUEUED BEHIND IT (R11-1a), which described a request that had
    // not been sent and could not be answered.
    let files = body(&app, "/files");
    assert!(files.contains("Linux is busy running"), "{files}");
    assert!(!files.contains("Nothing listed yet"), "{files}");
    let procs = body(&app, "/processes");
    assert!(procs.contains("Linux is busy running"), "{procs}");
    assert!(!procs.contains("Nothing has been asked yet"), "{procs}");

    // THE COMMANDS PANE, which never showed an agent's command at all.
    let pane = body(&app, "/terminal");
    assert!(pane.contains("data-running=\"1\""), "{pane}");
    assert!(pane.contains("main ran "), "the agent's in-flight command is its own: {pane}");

    // …AND WHAT THE TURN IS OUTSTANDING ON (R11-3): a tool call, not the model.
    let board = body(&app, "/board");
    assert!(board.contains("data-doing=\"running a command in the Linux\""), "{board}");
}

/// R11-3, the other half: with nothing in the workspace, the same attribute
/// says the model — so the Chat strip's phrase is a fact and not a constant.
#[test]
fn a_turn_with_no_call_in_flight_says_it_is_waiting_for_the_model() {
    let shell = Rc::new(FakeShell::new());
    let app = booted(&["thinking"], Rc::clone(&shell));
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", "hello")]),
    );
    let board = body(&app, "/board");
    assert!(board.contains("data-doing=\"waiting for the model\""), "{board}");
}

/// R11-5. Two `drive`s, which is the browser's own shape — the seam spawns one
/// per request — so the second command really runs while the first is wedged.
/// The typed request that never became a call used to sit at the head of the
/// queue and steal the attribution of every command typed after it: `main ran $
/// id; echo marker-from-user`, for something the person typed themselves.
#[test]
fn a_command_you_typed_stays_yours_after_an_earlier_one_was_abandoned() {
    let shell = Rc::new(FakeShell::new().wedging("while true"));
    let app = booted(&[], Rc::clone(&shell));
    typed(&app, WEDGE);
    let _wedge = wedged(drive(Rc::clone(&app)));

    typed(&app, "id; echo marker-from-user");
    block_on(drive(Rc::clone(&app))).expect("the second command runs");

    let trace = body(&app, "/terminal");
    let marker = trace
        .split("marker-from-user")
        .next()
        .expect("the second command is in the trace");
    assert!(
        marker.rsplit("data-by=\"").next().is_some_and(|s| s.starts_with("you\"")),
        "anything the person types is theirs: {trace}"
    );
    let pane = body(&app, "/terminal");
    assert!(
        pane.contains("you ran ") && !pane.contains("main ran $ id"),
        "and the scrollback agrees with the trace: {pane}"
    );
}

/// R11-1b. The press is a fact, the interrupt happens in the async half, and a
/// workspace that cannot deliver one SAYS so rather than swallowing the press.
#[test]
fn stop_reaches_the_workspace_and_a_refusal_is_recorded() {
    let can = Rc::new(FakeShell::new().wedging("while true").interruptible(Interrupt::Kill));
    let app = booted(&[], Rc::clone(&can));
    typed(&app, WEDGE);
    let _wedge = wedged(drive(Rc::clone(&app)));

    let pressed = handle(&mut app.borrow_mut(), Request::post_form("/terminal/stop", &[]));
    assert_eq!(pressed.status, 200, "there is something to stop");
    assert!(
        pressed.headers.iter().any(|(k, v)| k == "x-interrupt" && v == "kill"),
        "the pane is told what a stop would DO here, before it offers one"
    );
    block_on(drive(Rc::clone(&app))).expect("the stop is delivered");
    assert_eq!(can.stops(), 1, "the press reached the port");

    // …and the engine that cannot: the refusal is a fact in the log, not a
    // silence (`terminal::STOP_FAILED`).
    let cannot = Rc::new(FakeShell::new().wedging("while true"));
    let app = booted(&[], Rc::clone(&cannot));
    typed(&app, WEDGE);
    let _wedge = wedged(drive(Rc::clone(&app)));
    let offered = handle(&mut app.borrow_mut(), Request::get("/terminal"));
    assert!(
        offered.headers.iter().any(|(k, v)| k == "x-interrupt" && v == "none"),
        "a workspace with no way in offers no control at all"
    );
}

/// …and with nothing running, the control has nothing to do and says so rather
/// than emitting a press that would interrupt whatever came next.
#[test]
fn stop_with_nothing_running_is_refused_in_words() {
    let shell = Rc::new(FakeShell::new().interruptible(Interrupt::Kill));
    let app = booted(&[], Rc::clone(&shell));
    let pressed = handle(&mut app.borrow_mut(), Request::post_form("/terminal/stop", &[]));
    assert_eq!(pressed.status, 400, "{}", pressed.body);
    assert!(pressed.body.contains("Nothing is running"), "{}", pressed.body);
    assert_eq!(shell.stops(), 0, "and nothing was asked of the workspace");
}
