//! T29 on the host: what a tab that does not own the log is allowed to do.
//!
//! The Web Lock itself is not here and cannot be — `navigator.locks` needs a
//! browser, and `adapters_web` is never `cargo test`ed. What IS here is every
//! consequence of the answer it returns, which is the whole of the behaviour a
//! person meets: whether a turn starts, whether a byte reaches the store, and
//! whether anybody is told (I3).

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{DenyAllNet, FixedClock, ScriptedAgents, ScriptedModel, SeededRng};
use core::{boot, drive, handle, install_agents_as, App, Ports, Writership};
use kernel::{KvStore, Request, Timestamp};

mod recording;
use recording::Recording;

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

fn agent_files() -> Vec<(String, String)> {
    vec![(
        "main".to_string(),
        "---\nname: main\ndescription: main does a thing\ntools: []\n---\nbody".to_string(),
    )]
}

/// A booted `main`, told what it is, with one reply waiting for it.
fn booted(store: Rc<Recording>, told: Option<Writership>) -> Rc<RefCell<App>> {
    let ports = Ports {
        model: Rc::new(ScriptedModel::with_replies(vec![ScriptedModel::text_reply("hello")])),
        store,
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(adapters_test::MemKv::new()),
        workspace: Rc::new(adapters_test::FakeShell::new()),
        agents: Rc::new(ScriptedAgents::none()),
    };
    let mut app = block_on(boot(ports)).expect("boot succeeds");
    install_agents_as(&mut app, agent_files(), "main");
    block_on(core::restore_log(&mut app)).expect("the log reads back");
    if let Some(w) = told {
        core::note_writership(&mut app, w);
    }
    Rc::new(RefCell::new(app))
}

fn say(app: &Rc<RefCell<App>>, message: &str) -> String {
    let body = handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", message)]),
    )
    .body;
    block_on(drive(Rc::clone(app))).expect("the turn drives");
    body
}

fn stored(store: &Recording, prefix: &str) -> Vec<String> {
    block_on(KvStore::list_prefix(store, prefix)).expect("the store lists")
}

/// THE HOLE THIS CLOSES. A second tab is handed `Follower`, types, and nothing
/// of it reaches the store — not the window entry that would have overwritten
/// the other tab's, and not the `events/<seq>` record that would have collided
/// with it either.
#[test]
fn a_follower_writes_no_byte_of_either_log() {
    let store = Rc::new(Recording::default());
    let app = booted(Rc::clone(&store), Some(Writership::Follower));
    say(&app, "hello?");
    assert!(store.log("main").is_empty(), "a follower wrote a window entry");
    assert!(stored(&store, "events/").is_empty(), "a follower wrote an event");
}

/// …and it does not TAKE the turn either: refusing to persist while still
/// running is the version of this that loses work silently.
#[test]
fn a_follower_does_not_start_the_turn_it_was_asked_for() {
    let store = Rc::new(Recording::default());
    let app = booted(Rc::clone(&store), Some(Writership::Follower));
    say(&app, "hello?");
    let said = core::log_kinds(&app.borrow())
        .iter()
        .any(|k| matches!(k, kernel::EventKind::UserMessage { .. }));
    assert!(!said, "a follower turned a refusal into a turn");
    assert_eq!(core::answer(&app.borrow()), None);
}

/// AND IT SAYS SO, in the conversation, in words that name what to do. Checked
/// on the answer to the press and on an ordinary read, because a notice that
/// only appears once is a notice a person can miss.
#[test]
fn a_follower_says_why_in_the_conversation_itself() {
    let store = Rc::new(Recording::default());
    let app = booted(Rc::clone(&store), Some(Writership::Follower));
    let pressed = say(&app, "hello?");
    let read = handle(&mut app.borrow_mut(), Request::get("/chat")).body;
    for body in [&pressed, &read] {
        assert!(body.contains("already open in another tab"), "no notice: {body}");
        assert!(body.contains("close the other tab, then reload this one"));
    }
}

/// THE LEADER IS UNTOUCHED — the same run, the same store, one different fact.
#[test]
fn a_leader_writes_exactly_what_it_always_did() {
    let store = Rc::new(Recording::default());
    let app = booted(Rc::clone(&store), Some(Writership::Leader));
    let body = say(&app, "hello?");
    assert!(!store.log("main").is_empty(), "the leader wrote nothing");
    assert!(!stored(&store, "events/").is_empty());
    assert!(!body.contains("already open in another tab"));
}

/// …AND SO IS A BROWSER WITH NO LOCK MANAGER (I15). `note_writership` is never
/// called, which is exactly what `adapters_web::locks` does when there is no
/// `navigator.locks` to ask: no follower state, no sentence, nothing claimed.
#[test]
fn an_unasked_browser_behaves_as_it_did_before_any_of_this() {
    let store = Rc::new(Recording::default());
    let app = booted(Rc::clone(&store), None);
    let body = say(&app, "hello?");
    assert!(!store.log("main").is_empty(), "an unguarded page wrote nothing");
    assert!(!body.contains("already open in another tab"));
    assert_eq!(core::answer(&app.borrow()).as_deref(), Some("hello"));
}

/// The fact survives a reload the way every other fact does: a leader that
/// replayed its own history and asked again reads as whatever it asked LAST,
/// not as what some earlier load recorded.
#[test]
fn the_last_answer_wins_over_every_replayed_one() {
    let store = Rc::new(Recording::default());
    let first = booted(Rc::clone(&store), Some(Writership::Leader));
    say(&first, "hello?");
    // Same store, new process, and this time somebody else holds the lock.
    let second = booted(Rc::clone(&store), Some(Writership::Follower));
    let before = store.log("main").len();
    say(&second, "and again");
    assert_eq!(store.log("main").len(), before, "the replayed leader out-voted the lock");
}
