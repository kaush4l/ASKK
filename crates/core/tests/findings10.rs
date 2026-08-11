//! The three findings the increment-10 walk left in the Workspace pane, pinned
//! on the host (I3). The fourth — the scrollback never scrolling to the newest
//! output — is a scroll position in the browser and is walked, not unit-tested.

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
const ALONE: &str = "---\nname: alone\ndescription: works by itself\ntools: []\n---\nbody";

fn booted() -> Rc<RefCell<App>> {
    let ports = Ports {
        model: Rc::new(ScriptedModel::with_replies(Vec::new())),
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: Rc::new(FakeShell::new()),
        agents: Rc::new(ScriptedAgents::none()),
    };
    let mut app = block_on(boot(ports)).expect("boot succeeds");
    install_agents(
        &mut app,
        vec![
            ("main".into(), MAIN.to_string()),
            ("alone".into(), ALONE.to_string()),
        ],
    );
    Rc::new(RefCell::new(app))
}

/// Type a command the way the pane does, and let it run.
fn type_command(app: &Rc<RefCell<App>>, command: &str) -> String {
    let body = handle(
        &mut app.borrow_mut(),
        Request::post_form("/terminal", &[("command", command)]),
    )
    .body;
    block_on(drive(Rc::clone(app))).expect("the command runs");
    body
}

/// FINDING 2. "the first command also boots the Linux" was printed on every
/// command, including the eleventh in an already-booted VM. A line that is
/// untrue ten times out of eleven stops being read on the one occasion it
/// explains a genuine cold boot.
#[test]
fn only_the_first_command_claims_to_be_booting_the_linux() {
    let app = booted();
    let first = type_command(&app, "uname -a");
    assert!(
        first.contains("this first command also boots the Linux"),
        "the cold boot keeps its explanation: {first}"
    );

    let second = type_command(&app, "echo hello");
    assert!(second.contains("running…"), "{second}");
    assert!(
        !second.contains("boots the Linux"),
        "the VM is already up; the pane must not say otherwise: {second}"
    );
}

/// FINDING 3. The Workspace pane was the one per-agent read that took no
/// `x-agent`, so with an agent that works alone selected it still said "the
/// agents in this space build here" — directly beneath the space pane saying
/// that agent works alone.
#[test]
fn the_workspace_pane_is_scoped_to_the_selected_agent() {
    let app = booted();
    let theirs = handle(
        &mut app.borrow_mut(),
        Request::get("/terminal").with_header("x-agent", "alone"),
    )
    .body;
    assert!(theirs.contains("data-agent=\"alone\""), "{theirs}");
    assert!(
        theirs.contains("file names no space, so it has no workspace"),
        "{theirs}"
    );
    assert!(
        !theirs.contains("/root/spaces/research — the same folder"),
        "an agent with no space is not told about somebody else's: {theirs}"
    );
    // …and it says whose commands the scrollback in this pane actually is.
    // "below" was a direction, and the note moved under the scrollback in 12c.
    assert!(theirs.contains("The commands in this pane are main"), "{theirs}");

    let mine = handle(
        &mut app.borrow_mut(),
        Request::get("/terminal").with_header("x-agent", "main"),
    )
    .body;
    assert!(mine.contains("main works in the research space"), "{mine}");
    assert!(mine.contains("/root/spaces/research"), "{mine}");
    // 12c: the signal comes first and the explanation is behind a disclosure —
    // six lines of note in front of two lines of shell output was the footnote
    // outweighing the thing it annotates (12b walk, finding D2).
    let (scrollback, disclosure) = (
        mine.find("data-commands").expect("the scrollback is there"),
        mine.find("<details class=\"panel-note\"").expect("the note is a disclosure"),
    );
    assert!(scrollback < disclosure, "the note is under the scrollback: {mine}");
    assert!(!mine.contains("The commands in this pane are"), "no aside needed: {mine}");
}

/// FINDING 4. The path rule stated honestly, wherever the UI summarises it:
/// `exec` is a full shell, `cat /etc/passwd` works from it, so the check on
/// the other three tools is legibility and the VM is the containment.
#[test]
fn the_path_rule_is_stated_as_legibility_not_containment() {
    let app = booted();
    let pane = handle(
        &mut app.borrow_mut(),
        Request::get("/terminal").with_header("x-agent", "main"),
    )
    .body;
    assert!(pane.contains("REAL shell"), "{pane}");
    assert!(pane.contains("legibility rather than containment"), "{pane}");
    assert!(pane.contains("the Linux running in this tab"), "{pane}");

    // The same sentence on the Agents card, where a space is what grants it.
    let card = handle(&mut app.borrow_mut(), Request::get("/agents")).body;
    assert!(card.contains("exec is a full shell"), "{card}");
    assert!(card.contains("legibility rather than containment"), "{card}");
}
