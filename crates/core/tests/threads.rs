//! THREADS: more than one conversation in one document (docs/THREADS.md §7,
//! "Duplicate ids").
//!
//! The thread list puts a second agent's conversation on the Chat view, so the
//! two panes are in the same document at the same time. The core wrote
//! `id="chat-log"` as a FIXED string, and `route::newest_turn` scrolls
//! `#chat-log > :last-child` — with two logs in the document that selector
//! matches the first one, whichever conversation the person is reading. The id
//! is the agent's now, so a per-agent selector can exist at all.

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

fn file(name: &str) -> String {
    format!("---\nname: {name}\ndescription: one of the fleet\ntools: []\n---\nbody")
}

fn booted() -> Rc<RefCell<App>> {
    let ports = Ports {
        model: Rc::new(ScriptedModel::with_replies(vec![])),
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
            ("main".to_string(), file("main")),
            ("researcher".to_string(), file("researcher")),
        ],
    );
    Rc::new(RefCell::new(app))
}

/// One agent's conversation, asked for the way the pane asks (increment 07).
fn chat(app: &Rc<RefCell<App>>, who: &str) -> String {
    handle(
        &mut app.borrow_mut(),
        Request::get("/chat").with_header("x-agent", who),
    )
    .body
}

/// The log element is named after the agent whose log it is. Two panes, two
/// ids, so `#chat-log-researcher > :last-child` cannot land in `main`'s
/// conversation.
#[test]
fn each_conversation_names_its_own_log() {
    let app = booted();
    let (mine, theirs) = (chat(&app, "main"), chat(&app, "researcher"));
    assert!(
        mine.contains(r#"id="chat-log-main""#),
        "main's log is main's: {mine}"
    );
    assert!(
        theirs.contains(r#"id="chat-log-researcher""#),
        "researcher's log is researcher's: {theirs}"
    );
    // The failure this exists to prevent: one selector matching both.
    assert!(
        !mine.contains(r#"id="chat-log""#) && !theirs.contains(r#"id="chat-log""#),
        "no conversation keeps the fixed id"
    );
}

/// …and the two documents are genuinely distinguishable — the same assertion
/// stated as the selector the UI builds, so a rename that keeps both ids equal
/// still fails here.
#[test]
fn two_conversations_in_one_document_do_not_share_a_scroll_target() {
    let app = booted();
    let ids = |html: &str| -> String {
        let at = html.find("id=\"chat-log").expect("a log id");
        html[at..].split_once('"').unwrap().1.split_once('"').unwrap().0.to_string()
    };
    assert_ne!(
        ids(&chat(&app, "main")),
        ids(&chat(&app, "researcher")),
        "two panes in one document need two scroll targets"
    );
}
