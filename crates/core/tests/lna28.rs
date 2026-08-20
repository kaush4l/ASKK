//! 28. Our own default entry is `127.0.0.1` and the hosted page is not, so the
//! first turn most people take is a cross-address-space call. It failed as a
//! generic transport error and told them to start a server that was already
//! running. This is the copy that names Local Network Access, both engines, and
//! a fix — held under `cargo test` on the host (I3) because it is words, not
//! browser behaviour.

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{
    DenyAllNet, FakeShell, FixedClock, MemKv, MemStore, ScriptedAgents, ScriptedModel, SeededRng,
};
use core::{boot, drive, handle, install_agents, App, Ports};
use kernel::{ModelError, ModelPort, Request, Timestamp};

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

fn booted(model: Rc<dyn ModelPort>) -> Rc<RefCell<App>> {
    let mut app = block_on(boot(Ports {
        model,
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(AT)),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: Rc::new(FakeShell::new()),
        agents: Rc::new(ScriptedAgents::none()),
    }))
    .expect("boot succeeds");
    install_agents(&mut app, vec![("main".to_string(), LEAD.to_string())]);
    Rc::new(RefCell::new(app))
}

/// One turn against an endpoint that refuses with `error`, and the chat it left.
fn chat_after(error: ModelError) -> String {
    let app = booted(Rc::new(ScriptedModel::refusing(error)));
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", "say hello")]),
    );
    let _ = block_on(drive(Rc::clone(&app)));
    let answered = handle(&mut app.borrow_mut(), Request::get("/chat"));
    answered.body
}

/// The predicate is one definition at the leaf, because the sentence and the
/// adapter that declares a fetch's address space must not disagree about what
/// "local" means.
#[test]
fn the_one_definition_of_a_local_address() {
    for local in [
        "http://127.0.0.1:8873/v1/chat/completions",
        "http://localhost:8873/v1",
        "http://[::1]:8873/v1",
        "http://0.0.0.0:8873/v1",
    ] {
        assert!(kernel::is_loopback(local), "{local}");
    }
    // …AND 127/8 IS ALL OF IT: a server on 127.0.0.2 is the same machine.
    assert!(kernel::is_loopback("http://127.0.0.2:1234/v1"));
    for public in ["https://api.openai.com/v1", "https://kaush4l.github.io/ASKK/"] {
        assert!(!kernel::is_loopback(public), "{public}");
    }
}

/// THE HOST, NOT THE URL — the test that would have caught it. This predicate
/// began as `url.contains("localhost")`, which was survivable while it only
/// chose a paragraph of advice. T28 made it decide a NETWORK DECLARATION: the
/// adapter sets `targetAddressSpace: "loopback"` from it, so a name that merely
/// CONTAINS a loopback spelling would have had a call to somebody else's public
/// host declared as local.
///
/// Every case below passed the old substring test and is not this machine.
#[test]
fn a_name_that_merely_contains_a_local_spelling_is_not_this_machine() {
    for impostor in [
        "https://localhost.evil.example/v1",
        "https://127.0.0.1.evil.example/v1",
        "https://api.example.com/proxy?to=localhost",
        "https://user@localhost.example.com/v1",
        "https://not-localhost.example.com/v1",
    ] {
        assert!(!kernel::is_loopback(impostor), "{impostor}");
    }
    // …and userinfo does not hide a real one either, in the other direction.
    assert!(kernel::is_loopback("http://user:pw@127.0.0.1:8873/v1"));
}

/// THE CLOSING CONDITION: a person on either engine is told the truth, and the
/// truth names the fix. Neither browser is sniffed to choose which half to
/// print — both are said, because the only thing that could answer the question
/// is the fetch that already failed.
#[test]
fn both_engines_are_named_and_so_is_a_fix() {
    let chat = chat_after(ModelError::LocalNetwork {
        url: "http://127.0.0.1:8873/v1/chat/completions".into(),
        origin: "https://kaush4l.github.io".into(),
    });
    assert!(chat.contains("Local Network Access"), "searchable by name: {chat}");
    assert!(chat.contains("Chrome 142+ asks permission"), "{chat}");
    assert!(chat.contains("only if it is granted"), "{chat}");
    assert!(chat.contains("exactly as a closed port does"), "{chat}");
    assert!(chat.contains("Safari has never allowed"), "{chat}");
    assert!(chat.contains("does not ask"), "{chat}");
    assert!(chat.contains("localhost"), "the fix that works everywhere: {chat}");
    assert!(chat.contains("Settings"), "the other fix: {chat}");
    assert!(chat.contains("Worker"), "the structural limit is told: {chat}");
    assert!(chat.contains("user activation"), "{chat}");
    // The house rule: Chrome asks, it never blocks (R8-8).
    assert!(!chat.contains("blocks"), "Chrome does not block, it asks: {chat}");
    // …and it is not the sentence for a server that is simply not running.
    assert!(
        !chat.contains("the server must be running"),
        "it stopped borrowing the unreachable remedy: {chat}"
    );
}

/// A LOCAL PAGE CALLING A LOCAL SERVER CROSSES NOTHING. `crossing_into_loopback`
/// in the adapter never raises this variant there, so the copy must not be what
/// a plain unreachable endpoint gets — that reader has no permission to grant
/// and no origin to move.
#[test]
fn a_local_page_calling_a_local_server_gets_the_ordinary_remedy() {
    let chat = chat_after(ModelError::Transport {
        message: "http://127.0.0.1:8873/v1 unreachable: Failed to fetch".into(),
        url: "http://127.0.0.1:8873/v1/chat/completions".into(),
    });
    assert!(chat.contains("could not be reached"), "{chat}");
    assert!(chat.contains("the server must be running"), "{chat}");
    assert!(!chat.contains("Safari"), "no second engine in this one: {chat}");
    assert!(!chat.contains("Local Network Access"), "{chat}");
}

/// …and a PUBLIC endpoint keeps the sentence it had: nothing about a local
/// address, nothing about a permission, because neither is true of it.
#[test]
fn a_public_endpoint_still_gets_the_ordinary_unreachable_sentence() {
    let chat = chat_after(ModelError::Transport {
        message: "https://api.openai.com/v1 unreachable: Failed to fetch".into(),
        url: "https://api.openai.com/v1/chat/completions".into(),
    });
    assert!(chat.contains("the host must resolve"), "{chat}");
    assert!(!chat.contains("Local Network Access"), "{chat}");
    assert!(!chat.contains("Chrome"), "{chat}");
    assert!(!chat.contains("Safari"), "{chat}");
}

/// The board row names it in two or three words, and they are the words to
/// search for — not "unreachable", which sends a person to the wrong fix.
#[test]
fn the_row_names_the_access_rule_and_not_unreachability() {
    let app = booted(Rc::new(ScriptedModel::refusing(ModelError::LocalNetwork {
        url: "http://127.0.0.1:8873/v1/chat/completions".into(),
        origin: "https://kaush4l.github.io".into(),
    })));
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", "say hello")]),
    );
    let _ = block_on(drive(Rc::clone(&app)));
    let board = handle(&mut app.borrow_mut(), Request::get("/board")).body;
    assert!(board.contains("Local Network Access"), "{board}");
    assert!(!board.contains("unreachable"), "{board}");
}
