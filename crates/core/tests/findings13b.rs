//! R13-2 and R13-4: A CORRUPT WRITE AND A FABRICATED NUMBER, BOTH REPORTED
//! `ok` — and a log that timestamped every row with the wrong end of the call.
//!
//! Measured in a browser against gemma-4-12B, asked for a three-row CSV and the
//! sum of its cost column. What the page said:
//!
//! ```text
//! Tool trace  main ran write_file contents="item,cost\ncoffee,4.50\nrent,1800\ninternet,60"}) path=budget.csv — ok
//! Tool trace  main ran $ awk -F, 'NR>1 {sum+=$2} END {print sum}' budget.csv — ok   /   exec: (no output)
//! Chat        MAIN: The total cost is 1864.50.
//! ```
//!
//! `od -c budget.csv` held ONE line of fifty bytes with the call's own `"})` on
//! the end, `wc -l` said 0, the `awk` summed nothing, and the number was the
//! model's arithmetic alone. The parser is innocent — `agent::tools`'s own test
//! carries the model text and the proof — so the defect that is ours is the
//! interface: `ok` on a row whose argument ends in a call terminator it is
//! DISPLAYING, and `ok` on a command whose whole job was to print a number and
//! printed nothing.

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{
    DenyAllNet, FakeShell, FixedClock, MemKv, MemStore, ScriptedAgents, ScriptedModel, SeededRng,
    TickingClock,
};
use core::{boot, drive, handle, install_agents, App, Ports};
use kernel::{ClockPort, Request, Timestamp};

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

/// The reply that produced the fifty bytes, verbatim.
const SWALLOWED: &str = r#"write_file({"path": "budget.csv", "contents": "\"item,cost\\ncoffee,4.50\\nrent,1800\\ninternet,60\"})"})"#;

fn booted(replies: &[&str], shell: Rc<FakeShell>, clock: Rc<dyn ClockPort>) -> Rc<RefCell<App>> {
    let ports = Ports {
        model: Rc::new(ScriptedModel::with_replies(
            replies.iter().map(|r| ScriptedModel::text_reply(r)).collect(),
        )),
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock,
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: shell,
        agents: Rc::new(ScriptedAgents::none()),
    };
    let mut app = block_on(boot(ports)).expect("boot succeeds");
    install_agents(&mut app, vec![("main".to_string(), MAIN.to_string())]);
    Rc::new(RefCell::new(app))
}

fn ask(app: &Rc<RefCell<App>>, message: &str) {
    handle(&mut app.borrow_mut(), Request::post_form("/chat", &[("message", message)]));
    block_on(drive(Rc::clone(app))).expect("the turn runs");
}

fn body(app: &Rc<RefCell<App>>, path: &str) -> String {
    handle(&mut app.borrow_mut(), Request::get(path)).body
}

fn fixed() -> Rc<dyn ClockPort> {
    Rc::new(FixedClock::at(Timestamp(1_753_800_000_000)))
}

/// THE WHOLE DEFECT, END TO END. The `awk` really returns nothing, and NOT ONE
/// surface calls any of it `ok`.
///
/// R13 let the write LAND here — "nothing stops a tool running; that is the
/// model's call to make, and refusing it on a heuristic would be worse". R14
/// measured the cost of that sentence and it is `findings14`'s subject: the
/// bytes are garbage either way, so the write is refused now and never reaches
/// the disk. What this test still pins is R13's own finding, which stands
/// unchanged: a command that printed nothing is not a command that answered,
/// and the trace and the conversation say so with one predicate.
#[test]
fn a_write_that_swallowed_its_own_terminator_is_never_called_ok() {
    let shell = Rc::new(FakeShell::new().answering("awk", 0, ""));
    let app = booted(
        &[
            SWALLOWED,
            r#"exec({"command": "awk -F, 'NR>1 {sum+=$2} END {print sum}' budget.csv"})"#,
            "The total cost is 1864.50.",
        ],
        Rc::clone(&shell),
        fixed(),
    );
    ask(&app, "write budget.csv and sum the cost column");

    // The fifty corrupt bytes are on nobody's disk (R14-P0-2).
    assert!(shell.files().is_empty(), "the write was refused: {:?}", shell.files());

    // TWO PANES, ONE PER FACT, SINCE R15-P1-4: the write is a tool call and
    // lives in the trace; the awk is a shell command and lives in Commands.
    // Both verdicts are unchanged — only which pane carries which row is.
    let trace = body(&app, "/tools");
    // The evidence was always on screen; only the verdict was wrong.
    assert!(trace.contains("internet,60&quot;})"), "the terminator is displayed: {trace}");
    assert!(!trace.contains("data-outcome=\"ok\""), "nothing here is plain ok: {trace}");
    assert!(
        trace.contains("data-outcome=\"failed\""),
        "the write is refused, not qualified: {trace}"
    );
    let shell_pane = body(&app, "/terminal");
    assert!(
        shell_pane.contains("data-outcome=\"ok, and it printed nothing\""),
        "and the awk that answered nothing says so: {shell_pane}"
    );

    // …and the conversation, one nav click away, no longer disagrees with it.
    let chat = body(&app, "/chat");
    assert!(chat.contains("The total cost is 1864.50."), "the answer is still shown");
    // The refusal is the STRONGER thing to say about this run, and it is the
    // clause that wins: a person told a call failed has been told not to take
    // the number under it, and `vouch`'s quieter sentence would only soften it.
    assert!(
        chat.contains("a tool call in that turn failed — the Tool trace has it"),
        "the gap between the two views is surfaced: {chat}"
    );
}

/// `mkdir` printing nothing is a success and is never called anything else —
/// the distinction `calls::READS` deliberately refused to make for `exec` is
/// made here without calling either one a failure.
#[test]
fn a_command_that_did_work_silently_is_still_not_a_command_that_answered() {
    let shell = Rc::new(FakeShell::new().answering("mkdir", 0, "").answering("wc -l", 0, "3 budget.csv"));
    let app = booted(
        &[
            r#"exec({"command": "mkdir -p out"})
exec({"command": "wc -l budget.csv"})"#,
            "Done.",
        ],
        Rc::clone(&shell),
        fixed(),
    );
    ask(&app, "make a folder and count the lines");

    // Both are shell commands, so both are in Commands (R15-P1-4).
    let trace = body(&app, "/terminal");
    assert!(trace.contains("data-outcome=\"ok, and it printed nothing\""), "{trace}");
    assert!(trace.contains("data-outcome=\"ok\""), "the one that answered is plain ok: {trace}");
    assert!(!trace.contains("failed"), "neither of them failed: {trace}");
}

/// R13-4. Under a clock that MOVES, a row's time is the moment the call began
/// wherever the log holds a request for it, and says `ended` where it does not.
///
/// THE VEHICLE IS A FILE, NOT A COMMAND (R15-P1-4). It used to be `exec` both
/// ways; the shell has one home now and it is Commands, so the same rule is
/// tested with the same two shapes on the calls the trace still holds: one the
/// agent chose, and one a person's Save asked for.
#[test]
fn a_row_carries_the_start_where_the_log_has_one_and_says_ended_where_it_does_not() {
    let shell = Rc::new(FakeShell::new());
    let clock = Rc::new(TickingClock::from(Timestamp(1_753_800_000_000), 60_000));
    let app = booted(
        &[r#"write_file({"path": "kernel.txt", "contents": "linux"})"#, "Written."],
        shell,
        clock,
    );

    // The agent's own call: nothing preceded it, so the log has the ending only.
    ask(&app, "write down what kernel this is");
    let trace = body(&app, "/tools");
    assert!(trace.contains("ended "), "an unrequested call says which end it is: {trace}");

    // A file a PERSON saved: the request is in the log, one minute before the
    // call it became, and the row wears the earlier of the two.
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/files", &[("path", "notes.txt"), ("contents", "hello")]),
    );
    block_on(drive(Rc::clone(&app))).expect("the save runs");
    let trace = body(&app, "/tools");
    let started = trace.split("notes.txt").next().expect("the row is there");
    let stamp = started.rsplit("class=\"tool-time\">").next().expect("a time");
    let when = stamp.split('<').next().expect("the text").to_string();
    assert!(!when.starts_with("ended"), "the log holds this call's start: {when}");
    let ends: Vec<&str> = trace.matches("ended ").collect();
    assert_eq!(ends.len(), 1, "only the agent's own row is stamped at its end: {trace}");
}
