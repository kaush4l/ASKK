//! The twelfth walk, on the MODEL side: an endpoint that takes the request and
//! never answers is a timeout, not an unreachable host, and it does not borrow
//! the other one's remedy. `findings12w.rs` holds the workspace half.

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

fn body(app: &Rc<RefCell<App>>, req: Request) -> String {
    handle(&mut app.borrow_mut(), req).body
}

fn ask(app: &Rc<RefCell<App>>, text: &str) {
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", text)]),
    );
    let _ = block_on(drive(Rc::clone(app)));
}

/// R12-2. A model that took the request and never answered is a TIMEOUT. It
/// was reported as `the endpoint was unreachable`, with a remedy about CORS and
/// Chrome's local-address prompt, over a request the network log showed
/// answering 200 — the product's first impression, blaming the reader's
/// configuration for a slow model.
#[test]
fn a_model_that_never_answers_is_a_timeout_and_not_an_unreachable_endpoint() {
    let app = booted(
        Rc::new(ScriptedModel::timing_out(300)),
        Rc::new(MemStore::default()),
        Rc::new(FakeShell::new()),
    );
    ask(&app, "say hello");

    let board = body(&app, Request::get("/board"));
    assert!(board.contains("the model ran out of time"), "{board}");
    assert!(!board.contains("unreachable"), "the row names the timeout only: {board}");

    let chat = body(&app, Request::get("/chat"));
    assert!(chat.contains("had not answered 5 minutes later"), "{chat}");
    // The three things the unreachable remedy says, and the timeout must not.
    for wrong in ["CORS", "Chrome 142+", "could not be reached"] {
        assert!(!chat.contains(wrong), "the timeout borrowed {wrong}: {chat}");
    }
    // …and it still says what to do, in its own terms.
    assert!(chat.contains("ask for less"), "{chat}");
}

/// …and the unreachable copy is untouched for the case it describes.
#[test]
fn an_unreachable_endpoint_still_gets_the_endpoint_remedy() {
    let app = booted(
        Rc::new(ScriptedModel::with_replies(Vec::new())),
        Rc::new(MemStore::default()),
        Rc::new(FakeShell::new()),
    );
    ask(&app, "say hello");
    let chat = body(&app, Request::get("/chat"));
    assert!(chat.contains("could not be reached"), "{chat}");
    assert!(chat.contains("Chrome 142+"), "the loopback remedy survives: {chat}");
}
