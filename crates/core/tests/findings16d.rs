//! Round 4's two projection findings, through the seam on the host (I3).
//!
//! The verdict was that what is left is TRUST, and both of these are the same
//! failure of it: a pane saying something the log does not hold.

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
const OTHER: &str =
    "---\nname: researcher\ndescription: the reader\ntools: []\nspace: research\n---\nbody";

fn booted() -> Rc<RefCell<App>> {
    let mut app = block_on(boot(Ports {
        model: Rc::new(ScriptedModel::with_replies(Vec::new())),
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: Rc::new(FakeShell::new()),
        agents: Rc::new(ScriptedAgents::none()),
    }))
    .expect("boot succeeds");
    install_agents(
        &mut app,
        vec![
            ("main".to_string(), MAIN.to_string()),
            ("researcher".to_string(), OTHER.to_string()),
        ],
    );
    Rc::new(RefCell::new(app))
}

fn get(app: &Rc<RefCell<App>>, path: &str, header: (&str, &str)) -> String {
    handle(
        &mut app.borrow_mut(),
        Request::get(path).with_header(header.0, header.1),
    )
    .body
}

/// R4-1, the worst defect four rounds found. A command typed in the Workspace
/// was rendered under whichever agent the page had SELECTED: the same row read
/// `main ran $ sleep 20` or `researcher ran $ sleep 20` depending on a
/// dropdown. The proof it was fabricated is in this test — with `researcher`
/// selected the Tool trace said researcher had called nothing, while the
/// Workspace showed it running commands. The actor comes from the RECORD now,
/// so the two panes tell one story.
#[test]
fn the_workspace_and_the_tool_trace_never_disagree_about_a_command() {
    let app = booted();
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/terminal", &[("command", "sleep 20")]),
    );
    block_on(drive(Rc::clone(&app))).expect("the command runs");

    // This page's own pane: the person typed it, and the pane that holds the
    // shell says so. THE TRACE NO LONGER SHOWS IT AT ALL (R15-P1-4) — the two
    // could not disagree about a command they do not both render, which is the
    // stronger form of this finding rather than a retreat from it.
    let mine = get(&app, "/terminal", ("x-agent", "main"));
    let my_trace = get(&app, "/tools", ("x-agent", "main"));
    assert!(mine.contains("you ran "), "{mine}");
    assert!(!my_trace.contains("sleep 20"), "the shell has one home: {my_trace}");

    // The other agent's panes. It ran nothing, and NEITHER pane may say it did.
    let theirs = get(&app, "/terminal", ("x-agent", "researcher"));
    let their_trace = get(&app, "/tools", ("x-agent", "researcher"));
    assert!(
        !theirs.contains("researcher ran"),
        "the selected agent is not the actor: {theirs}"
    );
    assert!(
        !theirs.contains("sleep 20"),
        "this page's own command is not researcher's record: {theirs}"
    );
    assert!(
        theirs.contains("has not run a shell command yet"),
        "an empty record reads as empty: {theirs}"
    );
    assert!(their_trace.contains("has not called a tool yet"), "{their_trace}");
}

/// R4-2. `artifacts/` does not exist until an agent writes into it, and the
/// shelf listing it printed `Could not list artifacts: ls: artifacts: No such
/// file or directory (exit status 1)` — an expected empty condition rendered
/// as a failure, and rendered into the FILES pane, which had not failed.
#[test]
fn an_absent_folder_is_an_empty_state_and_stays_in_its_own_pane() {
    let app = booted();
    // The Files pane lists the root first, as it does on mount.
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/files", &[("path", "."), ("kind", "folder")]),
    );
    block_on(drive(Rc::clone(&app))).expect("the root is listed");
    // …then the artifacts shelf asks for its own folder, which is not there.
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/files", &[("path", "artifacts"), ("kind", "folder")]),
    );
    block_on(drive(Rc::clone(&app))).expect("the shelf's listing runs");

    let shelf = get(&app, "/files", ("x-at", "artifacts"));
    assert!(
        // R14-P1-3: the pane reports what its listing SAW, and does not assert
        // what does or does not exist on a disk it last looked at some time ago.
        shelf.contains("artifacts was not there when this listing ran"),
        "an absent folder is an empty state: {shelf}"
    );
    assert!(!shelf.contains("exit status"), "no raw shell error: {shelf}");
    assert!(!shelf.contains(r#"class="error""#), "not a failure: {shelf}");

    let files = get(&app, "/files", ("x-at", "."));
    assert!(
        !files.contains("artifacts"),
        "another pane's folder does not land in this one: {files}"
    );

    // …and the trace does not hand a pane's listing to the agent (R4-1 again)
    // — nor to the PERSON (R6-10), and by default not to the READER either
    // (R7-1): a log named for the agent holds the agent's work, and these two
    // are the Files pane and the artifacts shelf listing folders on their own.
    let trace = get(&app, "/tools", ("x-agent", "main"));
    assert!(
        !trace.contains("main ran list_files"),
        "the agent did not ask for these listings: {trace}"
    );
    assert_eq!(trace.matches(r#"class="tool-call"#).count(), 0, "{trace}");
    let counted = handle(
        &mut app.borrow_mut(),
        Request::get("/tools").with_header("x-agent", "main"),
    );
    assert_eq!(
        counted
            .headers
            .iter()
            .find(|(k, _)| k == "x-app-calls")
            .map(|(_, v)| v.as_str()),
        Some("2"),
        "hidden is counted, never silent",
    );
    // …and asked for, they are there, still wearing the pane's name.
    let shown = handle(
        &mut app.borrow_mut(),
        Request::get("/tools")
            .with_header("x-agent", "main")
            .with_header("x-app-activity", "1"),
    )
    .body;
    assert_eq!(shown.matches(r#"data-by="this page""#).count(), 2, "{shown}");
    assert!(!shown.contains(r#"data-by="you""#), "nobody typed anything: {shown}");
}
