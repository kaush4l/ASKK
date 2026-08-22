//! TWO CALLS TO ONE PEER ON ONE LINE, through the whole seam on the host (I3).
//!
//! The wedge this pins: `adapters_web/src/workers/spawn/reply.rs` holds ONE
//! resolver slot per peer, so a second concurrent ask used to overwrite the
//! first — the first promise never settled, `pending_tools` never reached zero,
//! and the lead's turn hung forever with no timeout and no error card. The
//! refusal that replaces it lives in `agent::step::line`, in the pure core,
//! precisely so the gate can execute the claim (I17): the adapter half is only
//! `cargo check`ed and a fix that lived only there would be unverifiable.
//!
//! Every wait here is bounded. `block_on` polls a fixed number of times and
//! PANICS rather than spinning: a hanging gate is a broken gate, so the failure
//! mode under a reverted fix has to be a red test, never a wedged one.

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{DenyAllNet, FixedClock, MemStore, ScriptedAgents, ScriptedModel, SeededRng};
use core::{boot, drive, handle, install_agents, App, Ports};
use kernel::{EventKind, Request, Timestamp};

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

/// `main` names both peers, so both are sub-agent tools; `researcher` is the
/// one this file calls twice.
fn agent_files() -> Vec<(String, String)> {
    let file = |name: &str, desc: &str, tools: &str| {
        (
            name.to_string(),
            format!("---\nname: {name}\ndescription: {desc}\ntools: {tools}\n---\nbody"),
        )
    };
    vec![
        file("main", "the lead", "[now, researcher, summarizer]"),
        file("researcher", "finds things out", "[]"),
        file("summarizer", "compresses a transcript", "[]"),
    ]
}

fn booted(replies: &[&str], agents: Rc<ScriptedAgents>) -> Rc<RefCell<App>> {
    let ports = Ports {
        model: Rc::new(ScriptedModel::with_replies(
            replies.iter().map(|r| ScriptedModel::text_reply(r)).collect(),
        )),
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(adapters_test::MemKv::new()),
        workspace: Rc::new(adapters_test::FakeShell::new()),
        agents,
    };
    let mut app = block_on(boot(ports)).expect("boot succeeds");
    install_agents(&mut app, agent_files());
    Rc::new(RefCell::new(app))
}

fn ask(app: &Rc<RefCell<App>>, message: &str) {
    handle(&mut app.borrow_mut(), Request::post_form("/chat", &[("message", message)]));
    block_on(drive(Rc::clone(app))).expect("the turn drives");
}

/// Every tool call the turn recorded, in log order: `(tool, ok, output)`. The
/// LOG, not a rendered pane — written order is a claim about the facts.
fn calls(app: &Rc<RefCell<App>>) -> Vec<(String, bool, String)> {
    core::log_kinds(&app.borrow())
        .into_iter()
        .filter_map(|k| match k {
            EventKind::ToolInvoked { tool, ok, output, .. } => Some((tool.0, ok, output)),
            _ => None,
        })
        .collect()
}

/// The first call to a peer is DELIVERED and the second on the same line is
/// REFUSED IN WORDS — and the refusal names what to do instead, because a
/// refusal the model cannot act on is a dropped call wearing words (I15).
///
/// This is the reachable half of the wedge: `agent::step::on_reply` did not
/// dedupe and `core::batch::run_effects` `join_all`s the line, so both asks
/// reached one peer's single resolver slot at once.
#[test]
fn a_peer_named_twice_on_one_line_runs_once_and_the_second_call_is_refused() {
    let agents = Rc::new(ScriptedAgents::with(vec![("researcher", Ok("The price is 42."))]));
    let replies = [
        r#"researcher({"query": "a"}), researcher({"query": "b"})"#,
        "It is 42.",
    ];
    let app = booted(&replies, Rc::clone(&agents));
    ask(&app, "ask the researcher twice at once");

    assert_eq!(
        agents.seen.borrow().as_slice(),
        ["researcher: a"],
        "only the first goal was delivered; the second never reached the peer"
    );
    let refusal = calls(&app);
    assert_eq!(refusal.len(), 2, "both calls are recorded facts (I8): {refusal:?}");
    assert!(
        refusal[1].2.contains("takes one turn at a time"),
        "the refusal says WHY: {refusal:?}"
    );
    assert!(
        refusal[1].2.contains("LATER line"),
        "…and what to do instead: {refusal:?}"
    );
}

/// Results append in the order the model WROTE them, refusal included: the
/// answer to the delivered call first, the refusal of the second call after.
/// The transcript has to be reproducible whichever finished first.
#[test]
fn the_answer_and_the_refusal_append_in_written_order() {
    let agents = Rc::new(ScriptedAgents::with(vec![("researcher", Ok("found it"))]));
    let replies = [
        r#"researcher({"query": "first"}), researcher({"query": "second"})"#,
        "done",
    ];
    let app = booted(&replies, agents);
    ask(&app, "two at once");

    let recorded = calls(&app);
    assert_eq!(recorded[0].0, "researcher", "{recorded:?}");
    assert!(recorded[0].1, "the delivered call succeeded: {recorded:?}");
    assert_eq!(recorded[0].2, "found it", "{recorded:?}");
    assert_eq!(recorded[1].0, "researcher", "the refusal is filed under the peer too");
    assert!(!recorded[1].1, "the refused call is a FAILED call: {recorded:?}");
}

/// THE COUNT RECONCILES AND THE TURN ENDS: two calls written, TWO results
/// recorded, ONE delivery — so `pending_tools` still counts down to zero and
/// the model is asked again.
///
/// The honest limit, stated because leaving it out would make this test read
/// like more than it is: `ScriptedAgents` CANNOT WEDGE. It has no single
/// resolver slot, so the hang itself is unobservable here and no host test can
/// stage it — that is the whole shape of the defect this increment names, and
/// `crates/adapters_web` is where it lives. What IS measurable is the fact the
/// wedge grew out of, and it is measured: exactly one goal reaches the peer
/// while the round still accounts for both calls the model wrote. A refusal
/// that forgot to emit its `ToolInvoked` would leave `pending_tools` one above
/// zero forever, which is the same hang by another door — so the count is
/// asserted, not just the ending.
#[test]
fn one_delivery_two_results_and_the_lead_answers_instead_of_hanging() {
    let agents = Rc::new(ScriptedAgents::with(vec![("researcher", Ok("42"))]));
    let replies = [
        r#"researcher({"query": "a"}), researcher({"query": "b"})"#,
        "The price is 42.",
    ];
    let app = booted(&replies, Rc::clone(&agents));
    ask(&app, "go");

    assert_eq!(agents.seen.borrow().len(), 1, "one goal was delivered, not two");
    assert_eq!(calls(&app).len(), 2, "both written calls came back as results");
    let chat = handle(&mut app.borrow_mut(), Request::get("/chat")).body;
    assert!(chat.contains("The price is 42."), "the turn reached its answer: {chat}");
    let html = handle(&mut app.borrow_mut(), Request::get("/board")).body;
    assert!(!html.contains(r#"data-status="working""#), "nobody is left working: {html}");
}

/// THE SAME PEER ON THE NEXT LINE IS FINE, and this is the boundary of the
/// rule: the constraint is one turn AT A TIME, not one turn per reply. A later
/// line runs after the line above it has come back, so the peer is free by
/// then — refusing it would take a real capability away.
#[test]
fn the_same_peer_on_a_later_line_is_delivered_not_refused() {
    let agents = Rc::new(ScriptedAgents::with(vec![
        ("researcher", Ok("found it")),
        ("summarizer", Ok("compressed")),
    ]));
    let replies = [
        "researcher({\"query\": \"a\"}), summarizer({\"query\": \"b\"})\n\
         researcher({\"query\": \"c\"})",
        "all done",
    ];
    let app = booted(&replies, Rc::clone(&agents));
    ask(&app, "do three things");

    assert_eq!(
        agents.seen.borrow().as_slice(),
        ["researcher: a", "summarizer: b", "researcher: c"],
        "the repeat on the NEXT line reached the peer"
    );
    let recorded = calls(&app);
    assert!(
        recorded.iter().all(|(_, ok, _)| *ok),
        "nothing was refused: {recorded:?}"
    );
}
