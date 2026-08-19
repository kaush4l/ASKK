//! R15: what the interface SAYS, checked through the seam on the host (I3).
//!
//! Round 15 was a usability read, not a bug hunt, and every finding here is a
//! projection saying something the log does not hold — or saying it about the
//! wrong actor. Nothing in this file needs a browser.

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
/// the wedge has happened — the browser's real shape, where the page stays
/// answerable while one workspace call hangs.
fn wedged<F: Future>(fut: F) -> std::pin::Pin<Box<F>> {
    let mut fut = Box::pin(fut);
    let mut cx = Context::from_waker(Waker::noop());
    for _ in 0..64 {
        assert!(fut.as_mut().poll(&mut cx).is_pending(), "the wedge answered");
    }
    fut
}

fn booted(replies: &[&str], shell: Rc<FakeShell>) -> Rc<RefCell<App>> {
    let mut app = block_on(boot(Ports {
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
    }))
    .expect("boot succeeds");
    install_agents(&mut app, vec![("main".to_string(), MAIN.to_string())]);
    Rc::new(RefCell::new(app))
}

fn body(app: &Rc<RefCell<App>>, path: &str) -> String {
    handle(&mut app.borrow_mut(), Request::get(path)).body
}

fn ask(app: &Rc<RefCell<App>>, message: &str) {
    handle(&mut app.borrow_mut(), Request::post_form("/chat", &[("message", message)]));
    block_on(drive(Rc::clone(app))).expect("the turn runs");
}

/// R15-P0-1. Clicking Workspace cold, having done nothing, flipped both file
/// panes to *"Waiting on the command the workspace is already running —
/// list_files path=artifacts, for 0s … nothing else can be asked until that one
/// ends or is stopped in Commands."* The command it named was the pane's OWN
/// mount-time listing: a first act that produces a busy machine, a self-
/// inflicted contention warning, and an instruction to go stop something.
///
/// `trace::requested_by::Asked` already knows the difference — it is the boundary the tool
/// trace's "Show the app's own activity" toggle is built on — so the pane uses
/// that one rather than a second answer to the same question.
#[test]
fn a_pane_waiting_on_its_own_listing_is_not_a_busy_workspace() {
    let shell = Rc::new(FakeShell::new().wedging("artifacts"));
    let app = booted(&[], Rc::clone(&shell));
    // The pane asks for a folder, exactly as it does on mount.
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/files", &[("path", "artifacts"), ("kind", "folder")]),
    );
    let _listing = wedged(drive(Rc::clone(&app)));

    let files = body(&app, "/files");
    assert!(!files.contains("busy running"), "the pane is not queued behind itself: {files}");
    assert!(files.contains("Nothing listed yet"), "it says what it is doing: {files}");
    let procs = body(&app, "/processes");
    assert!(!procs.contains("busy running"), "and neither is the other pane: {procs}");

    // NOTHING IS HIDDEN. The call is still in flight and still in the trace,
    // under the actor it belongs to, behind the toggle that owns that question.
    let shown = handle(
        &mut app.borrow_mut(),
        Request::get("/tools").with_header("x-app-activity", "1"),
    )
    .body;
    assert!(shown.contains("data-outcome=\"running\""), "the listing is on record: {shown}");
    assert!(shown.contains("data-by=\"this page\""), "as the page's own: {shown}");
}

/// …and the sentence still fires for a command that IS in the way. Same wedge,
/// different actor: an `exec` the agent chose really does hold the one console.
#[test]
fn a_command_that_is_in_the_way_still_says_so_in_plain_english() {
    let shell = Rc::new(FakeShell::new().wedging("while true"));
    let app = booted(&[&format!("exec({{\"command\": \"{WEDGE}\"}})")], Rc::clone(&shell));
    handle(&mut app.borrow_mut(), Request::post_form("/chat", &[("message", "keep a log")]));
    let _turn = wedged(drive(Rc::clone(&app)));

    let files = body(&app, "/files");
    assert!(files.contains("Linux is busy running $ while true"), "{files}");
    assert!(files.contains("It runs one command at a time"), "{files}");
    // The instruction that sent a first-timer hunting is gone; Commands is
    // named as the panel beside this one, not as somewhere to go.
    assert!(!files.contains("nothing else can be asked"), "{files}");
    assert!(files.contains("Commands, on this view, can stop it."), "{files}");
}

/// R15-P1-5. The malformed-argument refusal is written for the MODEL and it
/// works — it reads it and writes the call again. Read by a person it was a
/// 4973px single line, and it wrapped in the Tool trace while the identical
/// string did not wrap in Commands. One box in both panes now: a sentence, and
/// the model's whole copy inside it.
#[test]
fn the_refusal_a_person_reads_is_one_sentence_with_the_model_s_copy_inside() {
    let shell = Rc::new(FakeShell::new());
    let app = booted(
        &[
            r#"write_file({"path": "budget.csv", "contents": "item,cost\ncoffee,4.50\"})"})"#,
            r#"write_file({"path": "budget.csv", "contents": "item,cost\ncoffee,4.50\n"})"#,
            "Done.",
        ],
        Rc::clone(&shell),
    );
    ask(&app, "make me a budget");

    let trace = body(&app, "/tools");
    assert!(trace.contains("<details class=\"refusal\""), "it folds: {trace}");
    assert!(
        trace.contains("<summary>Nothing ran: an argument ended with this call"),
        "one sentence on the outside: {trace}"
    );
    // AND THE MODEL'S COPY IS UNTOUCHED, inside the fold.
    assert!(trace.contains("Nothing ran: an argument ends with"), "{trace}");
    assert!(trace.contains("escaped one level too many"), "{trace}");

    // …AND THE RETRY IS MARKED (R15-P1-5). Nothing said the recovery landed.
    assert!(
        trace.contains("ok, and this is the retry after the refused call"),
        "the call that worked says so: {trace}"
    );
    assert_eq!(
        trace.matches("this is the retry after").count(),
        1,
        "once, on the one call that recovered: {trace}"
    );
}

/// …and the SAME box in Commands, which is where an `exec` refusal lands. The
/// two panes disagreed about wrapping because they built two different blocks
/// out of one string.
#[test]
fn commands_and_the_trace_render_one_refusal_the_same_way() {
    let shell = Rc::new(FakeShell::new());
    let app = booted(&[r#"exec({"command": "\"wc -l budget.csv\"})"})"#, "Done."], shell);
    ask(&app, "count the lines");

    let pane = body(&app, "/terminal");
    assert!(pane.contains("<details class=\"refusal\""), "Commands folds it too: {pane}");
    assert!(!pane.contains("<pre tabindex=\"0\" role=\"region\" aria-label=\"output of"),
        "the un-wrapping shell block is not what a sentence goes in: {pane}");
}

/// R15-P1-6. `MAIN: calling exec — 1 call failed; every call is in Tool trace`
/// and `MAIN: This is a Linux machine running kernel version 4.15…` were the
/// same label, the same bubble and the same width — the app talking ABOUT the
/// agent, dressed as the agent talking.
#[test]
fn the_app_s_note_about_a_turn_does_not_wear_the_agent_s_name() {
    let shell = Rc::new(FakeShell::new().answering("uname", 0, "Linux 6.1.0"));
    let app = booted(
        &[r#"exec({"command": "uname -a"})"#, "This is a Linux machine."],
        shell,
    );
    ask(&app, "what machine is this");

    let chat = body(&app, "/chat");
    assert!(chat.contains("class=\"msg system\""), "the note is a system row: {chat}");
    assert!(chat.contains("main called exec"), "and it names its subject: {chat}");
    // The agent's own words keep the speaker label; the note does not get one.
    let note = chat.split("msg system").nth(1).expect("the note is there");
    assert!(
        !note.split("</div>").next().unwrap_or_default().contains("class=\"speaker\""),
        "no MAIN: on the app's own note: {note}"
    );
    assert!(chat.contains("class=\"msg assistant\""), "and the reply still is one: {chat}");
}

