//! The files pane on the host (I3): opening a folder and opening a file are
//! two different tools, the pane projects whichever ran last, and a failure is
//! shown rather than swallowed. (I3): a provider's accounting
//! block becomes a `ModelCalled` fact, and the chat projection carries the
//! running total as `x-tokens` — which is the only thing the header in the
//! frame reads.
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

/// A completion body with a `usage` block, the shape every OpenAI-compatible
/// server sends. `text_reply` deliberately has none — a provider that reports
/// nothing is the other half of this test.
fn reply_costing(text: &str, prompt: u32, completion: u32) -> String {
    format!(
        "{{\"choices\":[{{\"message\":{{\"role\":\"assistant\",\"content\":\"{text}\"}}}}],\
          \"usage\":{{\"prompt_tokens\":{prompt},\"completion_tokens\":{completion}}}}}"
    )
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
    let (body, _) = files(&app);
    assert!(body.contains("file-view"), "a file read renders as a file: {body}");
    assert!(body.contains("hi there"), "with what the file says in it: {body}");
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

/// An agent with no space has no folder, and the pane says which line of which
/// file would give it one.
#[test]
fn an_agent_that_works_alone_is_told_why_there_is_nothing_to_browse() {
    let app = booted_without_space();
    let res = handle(
        &mut app.borrow_mut(),
        Request::post_form("/files", &[("path", "."), ("kind", "folder")]),
    );
    assert_eq!(res.status, 400);
    assert!(res.body.contains("space: &lt;name&gt;"), "{}", res.body);
}
