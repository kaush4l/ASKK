//! The twelfth walk, on the WORKSPACE side: a file the reload took, a command
//! it abandoned, and a sentence of ours in a row built for a machine's columns.
//! Its own file so both hold the 200-line rule (I12); `findings12r.rs` holds
//! the model half.

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{
    DenyAllNet, FakeShell, FixedClock, MemKv, MemStore, ScriptedAgents, ScriptedModel, SeededRng,
};
use core::{boot, drive, handle, install_agents, App, Ports};
use kernel::{ModelPort, Request, StorePort, Timestamp};

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

const AT: Timestamp = Timestamp(1_753_800_000_000);
const LEAD: &str = "---\nname: main\ndescription: the lead\nspace: research\ntools: []\n---\nbody";

/// One app over a store and a workspace the caller keeps a handle to, so a
/// SECOND boot over the same store is a page reload.
fn booted(
    model: Rc<dyn ModelPort>,
    store: Rc<dyn StorePort>,
    shell: Rc<FakeShell>,
) -> Rc<RefCell<App>> {
    let mut app = block_on(boot(Ports {
        model,
        store,
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(AT)),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: shell,
        agents: Rc::new(ScriptedAgents::none()),
    }))
    .expect("boot succeeds");
    install_agents(&mut app, vec![("main".to_string(), LEAD.to_string())]);
    Rc::new(RefCell::new(app))
}

/// Drive a turn that will not finish, and hold the future open — the same
/// helper `findings11` uses for the wedge, and the only way to have a command
/// genuinely in flight on the host.
fn wedged<F: Future>(fut: F) -> std::pin::Pin<Box<F>> {
    let mut fut = Box::pin(fut);
    let mut cx = Context::from_waker(Waker::noop());
    for _ in 0..64 {
        assert!(fut.as_mut().poll(&mut cx).is_pending(), "the wedge answered");
    }
    fut
}

fn body(app: &Rc<RefCell<App>>, req: Request) -> String {
    handle(&mut app.borrow_mut(), req).body
}

/// R12-3. Two panes on one screen contradicting each other about one file: the
/// Files pane said *census.md was written here, and nothing is left of it* and
/// four lines below the editor held census.md's bytes under "Saved — this is
/// what is on disk", with a button offering to save them back.
#[test]
fn a_file_the_reload_took_is_not_still_open_in_the_editor() {
    let store: Rc<dyn StorePort> = Rc::new(MemStore::default());
    let before = booted(
        Rc::new(ScriptedModel::with_replies(Vec::new())),
        Rc::clone(&store),
        Rc::new(FakeShell::new()),
    );
    // Written, then read back — the page that had the file.
    body(
        &before,
        Request::post_form("/files", &[("path", "census.md"), ("contents", "HELLO-HARNESS")]),
    );
    let _ = block_on(drive(Rc::clone(&before)));
    body(
        &before,
        Request::post_form("/files", &[("path", "census.md"), ("kind", "file")]),
    );
    let _ = block_on(drive(Rc::clone(&before)));
    let open = handle(&mut before.borrow_mut(), Request::get("/files"));
    assert!(
        open.headers.iter().any(|(k, v)| k == "x-file" && v.contains("HELLO-HARNESS")),
        "the file really was open before the reload: {:?}",
        open.headers
    );

    // THE RELOAD: the same log, a Linux that kept nothing.
    let after = booted(
        Rc::new(ScriptedModel::with_replies(Vec::new())),
        store,
        Rc::new(FakeShell::new()),
    );
    let reopened = handle(&mut after.borrow_mut(), Request::get("/files"));
    let file = reopened
        .headers
        .iter()
        .find(|(k, _)| k == "x-file")
        .map(|(_, v)| v.clone())
        .unwrap_or_default();
    assert!(
        !file.contains("HELLO-HARNESS"),
        "the editor is still holding a Linux that no longer exists: {file}"
    );
}

/// R12-5. A command in flight when the page was reloaded vanished from the
/// scrollback entirely, while the resolved rows beside it survived annotated
/// `— failed, on an earlier page's Linux`. Work is not allowed to disappear
/// quietly in the pane whose neighbours label the same loss.
#[test]
fn a_command_the_reload_abandoned_is_still_on_the_page() {
    let store: Rc<dyn StorePort> = Rc::new(MemStore::default());
    let stuck = Rc::new(FakeShell::new().wedging("while true"));
    let before = booted(
        Rc::new(ScriptedModel::with_replies(Vec::new())),
        Rc::clone(&store),
        Rc::clone(&stuck),
    );
    body(
        &before,
        Request::post_form("/terminal", &[("command", "while true; do :; done")]),
    );
    let _turn = wedged(drive(Rc::clone(&before)));
    // It never came back: the pane says so, live, before the reload.
    let live = body(&before, Request::get("/terminal"));
    assert!(live.contains("running for"), "the wedge really is outstanding: {live}");
    // The seam spawns a `drive` per request, and a second one with nothing
    // pending is what writes the request through to the store — exactly as the
    // page's own poll does while the first is parked inside the command.
    block_on(drive(Rc::clone(&before))).expect("the log is persisted");

    let after = booted(
        Rc::new(ScriptedModel::with_replies(Vec::new())),
        store,
        Rc::new(FakeShell::new()),
    );
    let pane = body(&after, Request::get("/terminal"));
    assert!(pane.contains("while true; do :; done"), "the command survives: {pane}");
    assert!(pane.contains("abandoned when the page reloaded"), "{pane}");
    // …and NOT as something still running, which is the other lie available.
    assert!(!pane.contains("running for"), "{pane}");
}

/// R12-4. A sentence this product wrote is not a machine's columns: it wraps.
/// The class is what `workspace.css` keys the wrapping off, and the row that
/// carries it is the one whose hidden remainder was the only explanation of a
/// still-occupied workspace.
#[test]
fn our_own_prose_in_a_command_row_is_marked_as_prose() {
    let app = booted(
        Rc::new(ScriptedModel::with_replies(Vec::new())),
        Rc::new(MemStore::default()),
        Rc::new(FakeShell::unavailable("you stopped it. The shell takes the next command when")),
    );
    body(&app, Request::post_form("/terminal", &[("command", "echo hi")]));
    let _ = block_on(drive(Rc::clone(&app)));
    let pane = body(&app, Request::get("/terminal"));
    assert!(pane.contains("No folder is available here:"), "{pane}");
    assert!(pane.contains("<pre class=\"said\""), "the prose row wraps: {pane}");

    // …and a real command's output is NOT marked, so `ls -la` keeps its columns.
    let plain = booted(
        Rc::new(ScriptedModel::with_replies(Vec::new())),
        Rc::new(MemStore::default()),
        Rc::new(FakeShell::new()),
    );
    body(&plain, Request::post_form("/terminal", &[("command", "ls -la")]));
    let _ = block_on(drive(Rc::clone(&plain)));
    let columns = body(&plain, Request::get("/terminal"));
    assert!(columns.contains("ran: ls -la"), "{columns}");
    assert!(!columns.contains("class=\"said\""), "machine output is not prose: {columns}");
}
