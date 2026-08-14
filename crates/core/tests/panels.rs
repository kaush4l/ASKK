//! Round 15's information-architecture findings, through the seam on the host
//! (I3). The rule the round applied: ONE PANEL, ONE HOME — every panel appears
//! on exactly one view, and everywhere else it is a link.
//!
//! Two halves of that rule are projections and so are testable here: which pane
//! holds a shell command (P1-4), and whether an agent card offers any way to act
//! on the agent it describes (P1-9). The rest is arrangement, and arrangement
//! lives in `ui` and in `scripts/layout-probe.html`.

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

const MAIN: &str = "---\nname: main\ndescription: the lead\ntools: []\nspace: research\n---\nbody";

fn booted(replies: &[&str]) -> Rc<RefCell<App>> {
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
    install_agents(&mut app, vec![("main".to_string(), MAIN.to_string())]);
    Rc::new(RefCell::new(app))
}

fn res(app: &Rc<RefCell<App>>, path: &str) -> Response {
    handle(&mut app.borrow_mut(), Request::get(path).with_header("x-agent", "main"))
}

fn header(res: &Response, name: &str) -> String {
    res.headers
        .iter()
        .find(|(k, _)| k == name)
        .map(|(_, v)| v.clone())
        .unwrap_or_default()
}

/// R15-P1-4. The Commands pane stated, in prose, that it held the shell and the
/// Tool trace held the file and process work — and every `exec` rendered
/// verbatim in both. The rule is true now: the shell has one home, and the pane
/// that no longer holds it says how many it left out rather than hiding them.
#[test]
fn a_shell_command_is_in_commands_and_a_file_call_is_in_the_trace() {
    let app = booted(&[
        r#"write_file({"path": "a.txt", "contents": "x"})"#,
        "Done.",
        "Done.",
    ]);
    // One of each: a file call the agent chose, and a command a PERSON typed.
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", "write it down")]),
    );
    block_on(drive(Rc::clone(&app))).expect("the turn runs");
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/terminal", &[("command", "uname -a")]),
    );
    block_on(drive(Rc::clone(&app))).expect("the command runs");

    let commands = res(&app, "/terminal").body;
    let trace = res(&app, "/tools");

    assert!(commands.contains("uname -a"), "the shell is in Commands: {commands}");
    assert!(!commands.contains("a.txt"), "…and only the shell is: {commands}");

    assert!(trace.body.contains("a.txt"), "the file call is in the trace: {}", trace.body);
    assert!(
        !trace.body.contains("uname -a"),
        "…and the shell is NOT doubled into it: {}",
        trace.body
    );
    assert_eq!(
        header(&trace, "x-shell-calls"),
        "1",
        "…and the trace says how many it left out, so nothing is hidden silently"
    );
}

/// …and a trace holding nothing but shell rows never claims nothing happened.
#[test]
fn a_trace_emptied_by_the_shell_says_which_nothing_it_means() {
    let app = booted(&[]);
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/terminal", &[("command", "echo hi")]),
    );
    block_on(drive(Rc::clone(&app))).expect("the command runs");

    let trace = res(&app, "/tools");
    assert!(
        trace.body.contains("No tool other than the shell"),
        "not a bare 'nothing has been called': {}",
        trace.body
    );
    assert_eq!(header(&trace, "x-shell-calls"), "1");
}

/// R15-P1-9. The Agents view was six cards you could only read: nothing on a
/// card did anything with the agent it described. Each card carries its two
/// doors now, and the name they are about, which is what the shell's one
/// delegated handler routes on.
#[test]
fn an_agent_card_offers_a_way_to_act_on_the_agent() {
    let app = booted(&[]);
    let roster = res(&app, "/agents").body;
    assert!(roster.contains("data-agent=\"main\""), "{roster}");
    assert!(roster.contains("data-open=\"chat\""), "a door to the conversation: {roster}");
    assert!(roster.contains("data-open=\"task\""), "…and one to the launcher: {roster}");
    assert!(roster.contains("Talk to main"), "named for the destination: {roster}");
}
