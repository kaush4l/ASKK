//! Round 16's Commands-view findings, through the seam on the host (I3).
//!
//! P1-3 is one bug wearing two faces: a rail headed `workspace files · ask`
//! over three panes each printing the same paragraph about `main` and ending
//! in an instruction to undo the selection just made — and, on the same
//! screen, a command box that vanished for a read-only agent with nothing
//! saying why. The projection is what both faces come from, so it is what
//! these measure: one sentence, about the agent it names, and a reason for the
//! missing box that the pane can print where the box would have been.

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{
    DenyAllNet, FakeShell, FixedClock, MemKv, MemStore, ScriptedAgents, ScriptedModel, SeededRng,
};
use core::{boot, handle, install_agents, App, Ports};
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

const MAIN: &str = "---\nname: main\ndescription: the lead\nspace: research\ntools: []\n---\nbody";
/// The state R16 made reachable: a workspace, and a `tools:` list with no
/// shell in it. `read_file` and `list_files` alone is a read-only agent.
const READER: &str = "---\nname: ask\ndescription: answers questions\nspace: research\n\
                      tools:\n  - read_file\n  - list_files\n---\nbody";

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
        vec![("main".to_string(), MAIN.to_string()), ("ask".to_string(), READER.to_string())],
    );
    Rc::new(RefCell::new(app))
}

fn ask(app: &Rc<RefCell<App>>, path: &str, at: Option<&str>) -> kernel::Response {
    let mut req = Request::get(path).with_header("x-agent", "ask");
    if let Some(at) = at {
        req = req.with_header("x-at", at);
    }
    handle(&mut app.borrow_mut(), req)
}

/// P1-3, first face. The refusal is what all three panes in the rail render,
/// so its wording is what appeared three times in a column under a heading
/// naming the OTHER agent. It opened "This panel browses main's workspace" —
/// a body about main under a header about ask — and closed "Select main to
/// browse it", an instruction to undo the selection the reader had just made.
///
/// The rail prints it once now, so this asserts what that one printing says:
/// the selected agent is its subject, and it states the arrangement instead of
/// issuing an order.
#[test]
fn the_folder_refusal_is_about_the_agent_whose_name_is_on_the_header() {
    let app = booted();
    let said = ask(&app, "/files", Some(".")).body;

    assert!(said.contains("ask runs on its own"), "{said}");
    assert!(!said.contains("Select main"), "no order to undo the selection: {said}");
    assert!(!said.contains("This panel browses"), "not a sentence about a panel: {said}");
    // …and it is still marked as the ORDINARY condition it is, so the pane
    // renders it grey rather than red, and the shelf beside it can tell this
    // apart from "this agent has no workspace at all" (R7-4).
    assert!(said.contains(r#"class="pending""#), "{said}");
    assert!(!said.contains(r#"data-why="no-space""#), "ask has a workspace: {said}");

    // The Processes pane refuses through the same function, so the rail cannot
    // end up with two wordings to print.
    let processes = ask(&app, "/processes", None).body;
    assert!(
        processes.contains("ask runs on its own"),
        "one wording, both panes: {processes}"
    );
}

/// P1-3, second face. Switching to `ask` took the command field and the Run
/// button off the screen and said nothing at all: the only explanation of a
/// read-only agent in the product is the Agents view's origin line, which is
/// a different view. The pane can print one now, and WHICH sentence follows
/// the toolbox rather than the workspace — `ask` has a folder; what it has not
/// got is a shell.
#[test]
fn a_shell_less_agent_is_told_it_has_no_shell_where_the_box_would_be() {
    let app = booted();
    let res = ask(&app, "/terminal", None);
    let header = |name: &str| {
        res.headers.iter().find(|(k, _)| k == name).map(|(_, v)| v.clone()).unwrap_or_default()
    };

    assert_eq!(header("x-typeable"), "0", "the box is not rendered for ask");
    let why = header("x-typeable-why");
    assert!(why.contains("ask has no shell"), "{why}");
    assert!(why.contains("read this Linux but not change it"), "{why}");
    assert!(why.contains("Switch to main"), "the way to a shell is named: {why}");

    // …and THIS PAGE'S OWN agent, which has one, is told nothing: a sentence
    // about a missing control beside the control is the noise this replaces.
    let mine = handle(&mut app.borrow_mut(), Request::get("/terminal"));
    assert_eq!(mine.headers.iter().filter(|(k, _)| k == "x-typeable-why").count(), 0);
    assert!(mine.headers.iter().any(|(k, v)| k == "x-typeable" && v == "1"), "main types");
}
