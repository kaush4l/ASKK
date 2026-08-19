//! The Alpine workspace, on the host with no browser and no Linux (I3). The
//! port is a trait, so the exec tool, its capability gate, its path rule and
//! its degradation all test here against `FakeShell` — what the real Linux
//! does with the command is the browser's business and nobody else's.

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
const ALONE: &str = "---\nname: main\ndescription: the lead\ntools: []\n---\nbody";

/// A booted app whose model says these things, whose agent file is `file`, and
/// whose workspace is `shell` — held by the test so it can be interrogated.
fn booted(replies: &[&str], file: &str, shell: Rc<FakeShell>) -> Rc<RefCell<App>> {
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
    install_agents(&mut app, vec![("main".to_string(), file.to_string())]);
    Rc::new(RefCell::new(app))
}

fn ask(app: &Rc<RefCell<App>>, message: &str) {
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", message)]),
    );
    block_on(drive(Rc::clone(app))).expect("the turn runs");
}

fn body(app: &Rc<RefCell<App>>, path: &str) -> String {
    handle(&mut app.borrow_mut(), Request::get(path)).body
}

/// The increment, in one turn: the agent runs a command in the folder its
/// SPACE names, and reads the output back.
#[test]
fn the_agent_runs_a_command_in_its_own_spaces_folder() {
    let shell = Rc::new(FakeShell::new());
    let app = booted(
        &[r#"exec({"command": "uname -a"})"#, "It is Linux."],
        MAIN,
        Rc::clone(&shell),
    );
    ask(&app, "what kernel is in the workspace?");

    assert_eq!(
        shell.ran(),
        vec![("/root/spaces/research".to_string(), "uname -a".to_string())],
        "the cwd comes from the GRANT, which comes from the space"
    );
    // COMMANDS, the shell's one home since R15-P1-4.
    let trace = body(&app, "/terminal");
    assert!(trace.contains("uname -a"), "{trace}");
    assert!(trace.contains("data-outcome=\"ok"), "{trace}");
}

/// The gate (ADR-006, I6): no space, no workspace. Default deny is
/// STRUCTURAL — an agent with no space is never handed the tool at all, so the
/// refusal is the ordinary unknown-tool one and nothing ran. The second line
/// of defence (`core::workspace::grant`) is what the terminal route below
/// meets, since a person types a command without a toolbox.
#[test]
fn an_agent_with_no_space_is_refused_a_workspace() {
    let shell = Rc::new(FakeShell::new());
    let app = booted(
        &[r#"exec({"command": "rm -rf /"})"#, "I cannot."],
        ALONE,
        Rc::clone(&shell),
    );
    ask(&app, "wipe the disk");

    assert!(shell.ran().is_empty(), "the command never ran: {:?}", shell.ran());
    let trace = body(&app, "/terminal");
    assert!(trace.contains("Tool not found"), "{trace}");
    assert!(!trace.contains("data-outcome=\"ok\""), "{trace}");

    // …and the same agent's terminal, where a person types the command
    // directly, is refused by the gate itself and told how to grant it.
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/terminal", &[("command", "rm -rf /")]),
    );
    block_on(drive(Rc::clone(&app))).expect("the command is refused");
    assert!(shell.ran().is_empty(), "still nothing ran: {:?}", shell.ran());
    let terminal = body(&app, "/terminal");
    assert!(terminal.contains("no folder"), "{terminal}");
    assert!(
        terminal.contains("name a space in its agent file"),
        "the fix is named: {terminal}"
    );
}

/// A path that would leave the workspace is REFUSED, not clamped — and the
/// refusal is what the model reads next.
#[test]
fn a_path_out_of_the_workspace_is_refused() {
    let shell = Rc::new(FakeShell::new());
    let app = booted(
        &[r#"read_file({"path": "../../etc/shadow"})"#, "I cannot."],
        MAIN,
        Rc::clone(&shell),
    );
    ask(&app, "read the shadow file");

    assert!(shell.files().is_empty());
    let trace = body(&app, "/tools");
    assert!(trace.contains("walks out of the workspace"), "{trace}");
}

/// Write then read: the two tools agree about where a file is, which is the
/// property an agent building something depends on.
#[test]
fn what_the_agent_writes_is_what_it_reads_back() {
    let shell = Rc::new(FakeShell::new());
    let app = booted(
        &[
            r#"write_file({"path": "notes/today.md", "contents": "port increment 10"})"#,
            r#"read_file({"path": "notes/today.md"})"#,
            "It says: port increment 10.",
        ],
        MAIN,
        Rc::clone(&shell),
    );
    ask(&app, "write a note and read it back");

    assert_eq!(
        shell.files(),
        vec![(
            "/root/spaces/research/notes/today.md".to_string(),
            "port increment 10".to_string()
        )]
    );
    let trace = body(&app, "/tools");
    assert!(trace.contains("port increment 10"), "{trace}");
}

/// I15: a browser with no workspace at all. The tool says so in words the
/// model can act on, and the TURN still finishes with an answer.
#[test]
fn a_browser_with_no_workspace_says_so_and_the_turn_survives() {
    let shell = Rc::new(FakeShell::unavailable("this page is not cross-origin isolated"));
    let app = booted(
        &[r#"exec({"command": "ls"})"#, "There is no workspace here."],
        MAIN,
        Rc::clone(&shell),
    );
    ask(&app, "list the workspace");

    let trace = body(&app, "/terminal");
    assert!(trace.contains("No folder is available here"), "{trace}");
    assert!(trace.contains("not cross-origin isolated"), "the reason: {trace}");
    let chat = body(&app, "/chat");
    assert!(chat.contains("There is no workspace here."), "{chat}");
}

/// A command a PERSON types runs in the same workspace under the same grant,
/// and lands in the same scrollback the agent's commands do (I8).
#[test]
fn a_typed_command_runs_and_joins_the_scrollback() {
    let shell = Rc::new(FakeShell::new());
    let app = booted(&[], MAIN, Rc::clone(&shell));
    let pane = handle(
        &mut app.borrow_mut(),
        Request::post_form("/terminal", &[("command", "echo hello")]),
    );
    assert_eq!(pane.status, 200);
    block_on(drive(Rc::clone(&app))).expect("the command runs");

    assert_eq!(
        shell.ran(),
        vec![("/root/spaces/research".to_string(), "echo hello".to_string())]
    );
    let terminal = body(&app, "/terminal");
    assert!(terminal.contains("ran: echo hello"), "{terminal}");
    assert!(terminal.contains("data-commands=\"1\""), "{terminal}");
    assert!(
        terminal.contains("data-workspace=\"/root/spaces/research\""),
        "the pane names the folder it is a window onto: {terminal}"
    );
    // …and it is not a TURN. Running a command yourself must not make the chat
    // pane claim the agent is thinking: it did, and the composer stayed
    // disabled for the rest of the session (found by walking this increment).
    let chat = handle(&mut app.borrow_mut(), Request::get("/chat"));
    assert!(
        !chat.headers.iter().any(|(k, _)| k == "x-turn"),
        "no turn is pending: {chat:?}"
    );
    assert!(!chat.body.contains("thinking…"), "{}", chat.body);
}
