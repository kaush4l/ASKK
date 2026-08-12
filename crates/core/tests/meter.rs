//! The token meter, end to end on the host (I3): a provider's accounting
//! block becomes a `ModelCalled` fact, and the chat projection carries the
//! running total as `x-tokens` — which is the only thing the header in the
//! frame reads.
//!
//! It is a projection of the log and nothing else (I8): no counter in a
//! signal, no total kept beside the events it came from.

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

/// A completion body with a `usage` block, the shape every OpenAI-compatible
/// server sends. `text_reply` deliberately has none — a provider that reports
/// nothing is the other half of this test.
fn reply_costing(text: &str, prompt: u32, completion: u32) -> String {
    format!(
        "{{\"choices\":[{{\"message\":{{\"role\":\"assistant\",\"content\":\"{text}\"}}}}],\
          \"usage\":{{\"prompt_tokens\":{prompt},\"completion_tokens\":{completion}}}}}"
    )
}

fn booted(replies: Vec<String>) -> Rc<RefCell<App>> {
    let ports = Ports {
        model: Rc::new(ScriptedModel::with_replies(replies)),
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(adapters_test::MemKv::new()),
        workspace: Rc::new(adapters_test::FakeShell::new()),
        agents: Rc::new(ScriptedAgents::none()),
    };
    let mut app = block_on(boot(ports)).expect("boot succeeds");
    install_agents(
        &mut app,
        vec![(
            "main".to_string(),
            "---\nname: main\ndescription: the lead\nspace: research\ntools: []\n---\nbody"
                .to_string(),
        )],
    );
    Rc::new(RefCell::new(app))
}

fn ask(app: &Rc<RefCell<App>>, message: &str) -> String {
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", message)]),
    );
    block_on(drive(Rc::clone(app))).expect("the turn drives");
    let res = handle(&mut app.borrow_mut(), Request::get("/chat"));
    res.headers
        .iter()
        .find(|(k, _)| k == "x-tokens")
        .map(|(_, v)| v.clone())
        .expect("every chat projection carries the meter")
}

#[test]
fn the_projection_carries_what_the_provider_said_the_turn_cost() {
    let app = booted(vec![
        reply_costing("first", 120, 30),
        reply_costing("second", 200, 45),
    ]);
    assert_eq!(ask(&app, "one"), "150", "prompt + completion of turn one");
    assert_eq!(
        ask(&app, "two"),
        "395",
        "it accumulates across turns — the meter is the page's, not the turn's"
    );
}

/// A provider that reports nothing contributes nothing, and the meter says
/// zero rather than inventing an estimate. Zero is what the header renders as
/// no meter at all, which is the honest answer to "we were not told".
#[test]
fn an_endpoint_that_reports_no_usage_is_counted_as_nothing_not_as_free() {
    let app = booted(vec![ScriptedModel::text_reply("no usage block here")]);
    assert_eq!(ask(&app, "one"), "0");
}

/// A tool landing CHANGES the chat projection, even though the transcript
/// renders nothing for it.
///
/// The pane's patience is silence-based: a projection that is byte-identical
/// tick after tick is how it recognises a hang. A tool call renders nothing in
/// the transcript by design — a command a person typed into the terminal is a
/// `ToolInvoked` too — so without a counter on the log element, the exact
/// workload this product exists for (an `apk add`, a build) is indistinguishable
/// from a dead endpoint, and a working agent gets declared dead partway through.
#[test]
fn a_tool_result_changes_the_projection_even_though_it_renders_nothing() {
    let app = booted(vec![ScriptedModel::text_reply("thinking")]);
    let before = handle(&mut app.borrow_mut(), Request::get("/chat")).body;
    assert!(before.contains("data-tools=\"0\""), "{before}");

    handle(
        &mut app.borrow_mut(),
        Request::post_form("/terminal", &[("command", "sleep 1")]),
    );
    block_on(drive(Rc::clone(&app))).expect("the command runs");

    let after = handle(&mut app.borrow_mut(), Request::get("/chat")).body;
    assert_ne!(before, after, "the projection moved");
    assert!(after.contains("data-tools=\"1\""), "{after}");
}
