//! Increment 07 on the host, with in-memory ports (I3): every agent is
//! separately addressable, no two conversations cross, a delegated turn lands
//! in the sub-agent's OWN history, and every conversation survives a reload.
//! The status half of the increment is `lifecycle.rs`.

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

fn agent_files() -> Vec<(String, String)> {
    let file = |name: &str, desc: &str, tools: &str| {
        (
            name.to_string(),
            format!("---\nname: {name}\ndescription: {desc}\ntools: {tools}\n---\nbody"),
        )
    };
    vec![
        file("main", "the lead", "[now, researcher]"),
        file("researcher", "finds things out", "[]"),
    ]
}

/// One booted app over a store the caller can keep — which is what makes
/// "reload the page" expressible: boot a second app on the same store.
fn booted_on(
    store: Rc<MemStore>,
    replies: &[&str],
    agents: Rc<ScriptedAgents>,
) -> Rc<RefCell<App>> {
    let ports = Ports {
        model: Rc::new(ScriptedModel::with_replies(
            replies.iter().map(|r| ScriptedModel::text_reply(r)).collect(),
        )),
        store,
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

fn booted(replies: &[&str], agents: Rc<ScriptedAgents>) -> Rc<RefCell<App>> {
    booted_on(Rc::new(MemStore::default()), replies, agents)
}

/// Say something to ONE agent, the way the pane does: `x-agent` names it.
fn say_to(app: &Rc<RefCell<App>>, agent: &str, message: &str) {
    let req = Request::post_form("/chat", &[("message", message)]).with_header("x-agent", agent);
    handle(&mut app.borrow_mut(), req);
    block_on(drive(Rc::clone(app))).expect("the turn drives");
}

/// One agent's transcript, as its own pane sees it.
fn chat_with(app: &Rc<RefCell<App>>, agent: &str) -> String {
    handle(
        &mut app.borrow_mut(),
        Request::get("/chat").with_header("x-agent", agent),
    )
    .body
}

fn board(app: &Rc<RefCell<App>>) -> String {
    handle(&mut app.borrow_mut(), Request::get("/board")).body
}

/// Talk to a sub-agent directly: it answers, in its OWN pane, and `main` never
/// hears about it. Two conversations on one page, neither visible to the other.
#[test]
fn a_message_to_one_agent_never_appears_in_anothers_transcript() {
    let agents = Rc::new(ScriptedAgents::with(vec![("researcher", Ok("Tin is $34,000/t."))]));
    let app = booted(&["Hello from the lead."], Rc::clone(&agents));
    say_to(&app, "main", "hello");
    say_to(&app, "researcher", "what does tin cost?");

    let theirs = chat_with(&app, "researcher");
    assert!(theirs.contains("what does tin cost?"), "{theirs}");
    assert!(theirs.contains("Tin is $34,000/t."), "it answered: {theirs}");
    assert!(!theirs.contains("hello"), "the lead's question is not here: {theirs}");

    let lead = chat_with(&app, "main");
    assert!(lead.contains("Hello from the lead."), "{lead}");
    assert!(!lead.contains("tin"), "the researcher's question is not here: {lead}");
    assert_eq!(
        agents.seen.borrow().as_slice(),
        ["researcher: what does tin cost?"],
        "the message went to the researcher's own Worker, unchanged"
    );
}

/// The pane titles itself from the seam, not from a guess: `x-agent` on the
/// response says whose conversation came back.
#[test]
fn the_response_names_the_agent_it_is_a_conversation_with() {
    let app = booted(&[], Rc::new(ScriptedAgents::none()));
    let res = handle(
        &mut app.borrow_mut(),
        Request::get("/chat").with_header("x-agent", "researcher"),
    );
    let named = res.headers.iter().find(|(k, _)| k == "x-agent").map(|(_, v)| v.clone());
    assert_eq!(named.as_deref(), Some("researcher"));
    assert!(res.body.contains("finds things out"), "and says so: {}", res.body);
}

/// A DELEGATED turn belongs to the sub-agent's history too — the lead asked,
/// but the researcher is the one who took the turn.
#[test]
fn a_delegated_turn_lands_in_the_sub_agents_own_history() {
    let agents = Rc::new(ScriptedAgents::with(vec![("researcher", Ok("It is 42."))]));
    let app = booted(
        &[r#"researcher({"query": "what is the price?"})"#, "Forty-two."],
        agents,
    );
    say_to(&app, "main", "ask the researcher");

    let theirs = chat_with(&app, "researcher");
    assert!(theirs.contains("what is the price?"), "the goal is its message: {theirs}");
    assert!(
        theirs.contains(r#"<span class="speaker">main: </span>"#),
        "…attributed to the lead that asked, not to the reader: {theirs}"
    );
    assert!(theirs.contains("It is 42."), "its answer is its reply: {theirs}");
    let lead = chat_with(&app, "main");
    assert!(lead.contains("Forty-two."), "{lead}");
    assert!(
        !lead.contains("It is 42."),
        "the sub-agent's own turn is not in the lead's transcript: {lead}"
    );
}

/// Every conversation is a projection of the log (I8), so a reload rebuilds
/// all of them — not only the one the page happens to open on.
#[test]
fn every_conversation_survives_a_reload() {
    let store = Rc::new(MemStore::default());
    let agents = Rc::new(ScriptedAgents::with(vec![("researcher", Ok("Tin is $34,000/t."))]));
    let app = booted_on(Rc::clone(&store), &["Hello."], Rc::clone(&agents));
    say_to(&app, "main", "hello");
    say_to(&app, "researcher", "what does tin cost?");
    drop(app);

    let reloaded = booted_on(store, &[], Rc::new(ScriptedAgents::none()));
    let lead = chat_with(&reloaded, "main");
    assert!(lead.contains("Hello."), "the lead's turn came back: {lead}");
    let theirs = chat_with(&reloaded, "researcher");
    assert!(theirs.contains("Tin is $34,000/t."), "and so did theirs: {theirs}");
    assert!(!lead.contains("tin"), "still not crossed after a reload: {lead}");
}

/// The turn counter is a fact about the past and comes back with the
/// transcript. Before this, two panels on one screen disagreed about how many
/// turns `main` had taken the moment you refreshed (`ux-walker`, increment 06).
#[test]
fn the_turn_count_survives_a_reload_because_the_transcript_does() {
    let store = Rc::new(MemStore::default());
    let app = booted_on(Rc::clone(&store), &["one", "two"], Rc::new(ScriptedAgents::none()));
    say_to(&app, "main", "first");
    say_to(&app, "main", "second");
    assert!(board(&app).contains("2 turns"), "{}", board(&app));
    drop(app);

    let reloaded = booted_on(store, &[], Rc::new(ScriptedAgents::none()));
    assert!(board(&reloaded).contains("2 turns"), "{}", board(&reloaded));
}

