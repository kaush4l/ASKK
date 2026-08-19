//! The files pane on the host (I3): opening a folder and opening a file are
//! two different tools, the pane projects whichever ran last, and a failure is
//! shown rather than swallowed. A sub-agent's spend lands on the same page as
//! `x-tokens`, which is the only thing the header in the frame reads.
//!
//! It is a projection of the log and nothing else (I8): no counter in a
//! signal, no total kept beside the events it came from.

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{DenyAllNet, FixedClock, MemStore, ScriptedAgents, ScriptedModel, SeededRng};
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

/// An agent whose file names no space — the one case with no folder at all.
fn booted_without_space() -> Rc<RefCell<App>> {
    booted_as(
        "---\nname: main\ndescription: the lead\ntools: []\n---\nbody",
        adapters_test::FakeShell::new(),
    )
}

const LEAD: &str = "---\nname: main\ndescription: the lead\nspace: research\ntools: []\n---\nbody";

fn booted(replies: Vec<String>) -> Rc<RefCell<App>> {
    let _ = replies;
    booted_as(LEAD, adapters_test::FakeShell::new())
}

fn booted_holding(files: &[(&str, &str)]) -> Rc<RefCell<App>> {
    booted_as(LEAD, adapters_test::FakeShell::holding(files))
}

fn booted_as(file: &str, shell: adapters_test::FakeShell) -> Rc<RefCell<App>> {
    let ports = Ports {
        model: Rc::new(ScriptedModel::with_replies(vec![])),
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(adapters_test::MemKv::new()),
        workspace: Rc::new(shell),
        agents: Rc::new(ScriptedAgents::none()),
    };
    let mut app = block_on(boot(ports)).expect("boot succeeds");
    install_agents(
        &mut app,
        vec![(
            "main".to_string(),
            file.to_string(),
        )],
    );
    Rc::new(RefCell::new(app))
}

/// Open a path the way the pane does.
fn open(app: &Rc<RefCell<App>>, path: &str, kind: &str) {
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/files", &[("path", path), ("kind", kind)]),
    );
    block_on(drive(Rc::clone(app))).expect("the listing runs");
}

/// The pane, and the entries it named in `x-entries`.
fn files(app: &Rc<RefCell<App>>) -> (String, String) {
    let res = handle(&mut app.borrow_mut(), Request::get("/files"));
    let entries = res
        .headers
        .iter()
        .find(|(k, _)| k == "x-entries")
        .map(|(_, v)| v.clone())
        .unwrap_or_default();
    (res.body, entries)
}


/// `ls` on a FILE succeeds and prints the file, so "list, and read only if the
/// listing failed" opens nothing, ever. The caller says which it is.
#[test]
fn a_folder_is_listed_and_a_file_is_read() {
    let app = booted_holding(&[("/root/spaces/research/hello.txt", "hi there")]);
    open(&app, ".", "folder");
    let (body, entries) = files(&app);
    assert!(body.contains("data-path=\".\""), "{body}");
    assert_eq!(
        entries, "hello.txt\thello.txt",
        "one row: the name to show, and the path opening it means"
    );

    open(&app, "hello.txt", "file");
    // THE BYTES RIDE THE HEADER, NOT THE BODY (R5-9). The panel used to append
    // a read-only `<pre class="file-view">` holding exactly what the pane's own
    // `<textarea>` below it holds, so the open file was on screen twice and the
    // editable copy was the second one. `x-file` is `path\ncontents` and is
    // what the pane has always taken the editor's value from; the assertion
    // moves to it rather than to a rendering that duplicated it.
    let res = handle(&mut app.borrow_mut(), Request::get("/files"));
    let file = res
        .headers
        .iter()
        .find(|(k, _)| k == "x-file")
        .map(|(_, v)| v.clone())
        .unwrap_or_default();
    assert_eq!(file, "hello.txt\nhi there", "path and contents, once: {file}");
}

/// A listing that could not run used to be skipped by the projection, which
/// left the pane saying "nothing listed yet" forever — a silent failure in the
/// one pane whose whole job is to show what the machine said.
#[test]
fn a_refused_path_is_shown_not_swallowed() {
    let app = booted(vec![]);
    open(&app, "../etc", "folder");
    let (body, _) = files(&app);
    assert!(body.contains("Could not list"), "{body}");
    assert!(body.contains("data-failed"), "{body}");
}

/// An agent with no space has no folder, and the pane names the PANEL that
/// fixes it by the title printed on that panel (R15-P0-2). It used to name
/// `agent.md`, a file this page never shows (R10-10); then it named "its agent
/// file on the Agents view", which is nothing a reader can see there — the
/// visible cards are read-only disclosures and the editor is titled `Write an
/// agent`. It also handed over a YAML key to type, in the one sentence whose
/// whole job is to be followable.
#[test]
fn an_agent_that_works_alone_is_told_why_there_is_nothing_to_browse() {
    let app = booted_without_space();
    let res = handle(
        &mut app.borrow_mut(),
        Request::post_form("/files", &[("path", "."), ("kind", "folder")]),
    );
    assert_eq!(res.status, 400);
    assert!(res.body.contains("Agents view"), "the fix is reachable: {}", res.body);
    assert!(res.body.contains("Write an agent"), "named as the reader sees it: {}", res.body);
    assert!(!res.body.contains("agent.md"), "{}", res.body);
    assert!(!res.body.contains("space:"), "no YAML key in user-facing prose: {}", res.body);
}

/// A sub-agent's work reaches the page, or it is a black box with an answer.
///
/// Its tool calls happen in its own Worker's loop, so they are not
/// `ToolInvoked` facts in this log — the Worker reports them and they arrive
/// as `core.agent_activity`, carrying the name that `ToolInvoked` does not
/// have. The Trace view of that agent, and the meter, are then the same
/// projections they are for this page's own agent.
#[test]
fn a_workers_tool_calls_and_spend_reach_the_page() {
    let app = booted(vec![]);
    core::report_activity(
        &mut app.borrow_mut(),
        "researcher",
        r#"[{"tool":"now","args":"{}","ok":true,"output":"12:00"},{"spent":250}]"#,
    );

    let trace = handle(
        &mut app.borrow_mut(),
        Request::get("/tools").with_header("x-agent", "researcher"),
    )
    .body;
    assert!(trace.contains("now("), "the sub-agent's own call: {trace}");
    assert!(trace.contains("12:00"), "and what came back: {trace}");
    assert!(trace.contains("data-calls=\"1\""), "{trace}");

    // Not attributed to whoever happens to be selected.
    let mine = handle(&mut app.borrow_mut(), Request::get("/tools")).body;
    assert!(!mine.contains("12:00"), "not this page's trace: {mine}");

    let spent = handle(&mut app.borrow_mut(), Request::get("/chat"))
        .headers
        .iter()
        .find(|(k, _)| k == "x-tokens")
        .map(|(_, v)| v.clone())
        .expect("the meter");
    assert_eq!(spent, "250", "a sub-agent's tokens are the page's tokens");
}
