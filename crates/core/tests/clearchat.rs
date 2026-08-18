//! CLEARING A CONVERSATION, through the seam, on the host with in-memory ports.
//!
//! The three things a clear has to do are the three things it is easy to do two
//! of: the screen, the window the model sees, and the log a reload restores
//! from. Clearing the first two and not the third looks like it worked until
//! the next refresh, which is the worst shape a bug can have — so each is
//! asserted separately here.

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

fn ports(replies: &[&str]) -> Ports {
    Ports {
        model: Rc::new(ScriptedModel::with_replies(
            replies.iter().map(|r| ScriptedModel::text_reply(r)).collect(),
        )),
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(adapters_test::MemKv::new()),
        workspace: Rc::new(adapters_test::FakeShell::new()),
        agents: Rc::new(ScriptedAgents::none()),
    }
}

/// A booted app with one plain agent — no `stages:`, so a reply is an answer
/// and this file tests clearing rather than the strategy loop.
fn booted(replies: &[&str]) -> Rc<RefCell<App>> {
    let mut app = block_on(boot(ports(replies))).expect("boot succeeds");
    install_agents(
        &mut app,
        vec![(
            "main".to_string(),
            "---\nname: main\ndescription: the lead\nrole: entry\ntools: []\n---\nbody".to_string(),
        )],
    );
    Rc::new(RefCell::new(app))
}

fn ask(app: &Rc<RefCell<App>>, message: &str) {
    handle(&mut app.borrow_mut(), Request::post_form("/chat", &[("message", message)]));
    block_on(drive(Rc::clone(app))).expect("the turn runs");
}

fn get(app: &Rc<RefCell<App>>, path: &str) -> String {
    handle(&mut app.borrow_mut(), Request::get(path)).body
}

/// THE SCREEN, THE PROMPT AND THE LOG, all three.
#[test]
fn clearing_empties_the_conversation_the_window_and_the_stored_log() {
    let app = booted(&["Paris is the capital of France.", "Berlin."]);
    ask(&app, "what is the capital of France");
    assert!(get(&app, "/chat").contains("Paris"), "a conversation to clear");
    assert!(
        core::window(&app.borrow()).iter().any(|l| l.contains("Paris")),
        "…and the model can see it"
    );

    let cleared = handle(&mut app.borrow_mut(), Request::post_form("/chat/clear", &[])).body;
    assert!(!cleared.contains("Paris"), "the answer to the press is already empty: {cleared}");
    assert!(!get(&app, "/chat").contains("what is the capital"), "and the question with it");
    // The window the model sees is back to what a fresh agent holds — not to
    // nothing, which would be a section with no parts.
    assert_eq!(core::window(&app.borrow()), vec![agent::SESSION_STARTED.to_string()]);

    // …AND THE NEXT TURN IS NOT ASKED ABOUT PARIS. This is the assertion the
    // whole route exists for: clearing the screen while the prompt still
    // carried the thread would have been the expensive version of doing
    // nothing.
    ask(&app, "and the capital of Germany");
    let window = core::window(&app.borrow());
    assert!(!window.iter().any(|l| l.contains("Paris")), "{window:?}");
    assert!(window.iter().any(|l| l.contains("Germany")), "{window:?}");
}

/// THE LOG IS REWRITTEN, so a reload does not bring the conversation back.
/// Clearing only what is in memory would survive exactly until the next
/// refresh, and a person who cleared a thread and found it waiting for them
/// would be right to conclude the control does nothing.
#[test]
fn a_cleared_conversation_does_not_come_back_on_reload() {
    let store = Rc::new(MemStore::default());
    let mut first = ports(&["Paris is the capital of France."]);
    first.store = Rc::clone(&store) as Rc<dyn kernel::StorePort>;
    let mut app = block_on(boot(first)).expect("boot succeeds");
    install_agents(
        &mut app,
        vec![(
            "main".to_string(),
            "---\nname: main\ndescription: the lead\nrole: entry\ntools: []\n---\nbody".to_string(),
        )],
    );
    let app = Rc::new(RefCell::new(app));
    ask(&app, "what is the capital of France");
    handle(&mut app.borrow_mut(), Request::post_form("/chat/clear", &[]));
    block_on(drive(Rc::clone(&app))).expect("the writes drain");

    // A NEW PROCESS over the SAME store: what `restore_log` reads back is the
    // cleared window, because the clear queued a rewrite rather than an append.
    let mut second = ports(&[]);
    second.store = Rc::clone(&store) as Rc<dyn kernel::StorePort>;
    let reloaded = block_on(boot(second)).expect("boot succeeds");
    let window = core::window(&reloaded);
    assert!(
        !window.iter().any(|l| l.contains("Paris")),
        "the store still holds the old conversation: {window:?}"
    );
}

/// THE LOG ITSELF IS NOT REWRITTEN — the event log is append-only and stays
/// that way. Nothing is deleted; the projection starts later. The Trace view
/// is the fold that proves it: it reads the same facts and is not scoped to a
/// conversation, so what the cleared turn RAN is still on the record.
#[test]
fn nothing_is_deleted_from_the_record() {
    let app = booted(&["now()", "It is just gone ten."]);
    ask(&app, "what time is it");
    assert!(get(&app, "/tools").contains("now("), "a tool ran in the cleared turn");
    handle(&mut app.borrow_mut(), Request::post_form("/chat/clear", &[]));
    assert!(!get(&app, "/chat").contains("gone ten"), "the conversation is gone");
    assert!(
        get(&app, "/tools").contains("now("),
        "…and the record of what was done is not: {}",
        get(&app, "/tools")
    );
}
