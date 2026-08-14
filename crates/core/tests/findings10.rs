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

/// FINDING 2, as R11-13 left it. The row used to add "this first command also
/// boots the Linux" to the first command a workspace ever ran. The page prewarms
/// the Linux at paint now, so that sentence sat under a header reading `ready`:
/// no command claims to be booting anything, on any run.
#[test]
fn no_command_claims_to_be_booting_the_linux() {
    let app = booted();
    let first = type_command(&app, "uname -a");
    assert!(first.contains("running"), "the row still says it is running: {first}");
    assert!(!first.contains("boots the Linux"), "{first}");

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
    // R10-11: the pane says it ONCE. The disclosure that used to repeat the
    // same fact under its own heading is not rendered for an agent with no
    // folder to disclose.
    assert!(!theirs.contains("panel-note"), "nothing to disclose: {theirs}");
    assert!(
        !theirs.contains("/root/spaces/research — the same folder"),
        "an agent with no space is not told about somebody else's: {theirs}"
    );
    // …and R4-1's attribution — "these are what {who}'s Worker reported" —
    // goes with it: an agent with no workspace has no commands to attribute,
    // which is what the one remaining sentence says.
    assert!(
        theirs.contains("alone has no folder, so it runs no commands"),
        "an agent with no record of its own has an empty pane, not main's: {theirs}"
    );

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

/// FINDING 4. The reach stated honestly, wherever the UI summarises it: `exec`
/// is a full shell, `cat /etc/passwd` works from it, and the tab's Linux is the
/// containment. R10-10 keeps the claim and drops the implementation note that
/// carried it — "the path check on the file tools is legibility rather than
/// containment" is a sentence about our code, in copy a person reads.
#[test]
fn the_reach_is_stated_honestly_and_not_in_our_own_terms() {
    let app = booted();
    let pane = handle(
        &mut app.borrow_mut(),
        Request::get("/terminal").with_header("x-agent", "main"),
    )
    .body;
    // …in the product's ordinary voice, not in capitals (R6-14): "a REAL
    // shell" was the only shouting on the page.
    assert!(pane.contains("it is a full shell"), "{pane}");
    assert!(!pane.contains("REAL shell"), "the product does not shout: {pane}");
    assert!(pane.contains("can read anything in this Linux"), "{pane}");
    assert!(pane.contains("The Linux in this tab is as far as it goes"), "{pane}");
    assert!(!pane.contains("legibility"), "not in our terms (R10-10): {pane}");

    // The same claim on the Agents card, where a space is what grants it.
    let card = handle(&mut app.borrow_mut(), Request::get("/agents")).body;
    assert!(card.contains("Its shell is a full one"), "{card}");
    assert!(card.contains("as far as it goes"), "{card}");
    assert!(!card.contains("legibility"), "{card}");
}
