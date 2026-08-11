//! Increment 07b: the three things `ux-walker` found crossed or locked, pinned
//! at the seam. A pane can only be as honest as the projection it is handed —
//! so the projection is what these assert: it names ONE agent everywhere at
//! once, it reports in-flight PER AGENT, and it does not replay an older
//! build's debug syntax at the reader.

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{DenyAllNet, FixedClock, MemStore, ScriptedAgents, ScriptedModel, SeededRng};
use core::{boot, drive, handle, install_agents, App, Ports};
use kernel::{Request, Response, Status, Timestamp};

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
        agents,
    };
    let mut app = block_on(boot(ports)).expect("boot succeeds");
    install_agents(&mut app, agent_files());
    Rc::new(RefCell::new(app))
}

/// Start a turn and DO NOT drive it: the turn is in flight, which is the
/// window the walker switched tabs in.
fn start_turn(app: &Rc<RefCell<App>>, agent: &str, message: &str) -> Response {
    let req = Request::post_form("/chat", &[("message", message)]).with_header("x-agent", agent);
    handle(&mut app.borrow_mut(), req)
}

fn chat_with(app: &Rc<RefCell<App>>, agent: &str) -> Response {
    handle(
        &mut app.borrow_mut(),
        Request::get("/chat").with_header("x-agent", agent),
    )
}

fn header(res: &Response, name: &str) -> String {
    res.headers
        .iter()
        .find(|(k, _)| k == name)
        .map(|(_, v)| v.clone())
        .unwrap_or_default()
}

/// The heading and the transcript are ONE projection. Ask for `researcher`
/// while `main`'s turn is in flight and every part of the answer says
/// `researcher`: the `x-agent` header the pane titles itself from, the agent
/// header line inside the body, and the body's content. The pane that showed
/// "Chat with summarizer" over main's whole transcript, main's header line and
/// main's spinner was reading a prop and a stale log; there is no read here
/// that can produce that pair (`ux-walker`, increment 07).
#[test]
fn one_read_names_one_agent_in_the_heading_and_in_the_transcript() {
    let app = booted(&["Hello from the lead."], Rc::new(ScriptedAgents::none()));
    start_turn(&app, "main", "M1 alpha");

    let theirs = chat_with(&app, "researcher");
    assert_eq!(header(&theirs, "x-agent"), "researcher");
    assert!(
        theirs.body.contains(r#"data-agent="researcher""#),
        "the header line inside the body names the same agent: {}",
        theirs.body
    );
    assert!(
        !theirs.body.contains("M1 alpha") && !theirs.body.contains(r#"data-agent="main""#),
        "and nothing of main's conversation is in it: {}",
        theirs.body
    );
    assert!(
        theirs.body.contains("No messages yet — ask researcher something."),
        "an untouched conversation reads as one: {}",
        theirs.body
    );
}

/// In flight is PER AGENT. `main` is mid-turn and `researcher` is not, so
/// `researcher`'s projection carries no `x-turn` — which is the one bit the
/// composer disables on. A global lock made the page contradict the board
/// three inches below it, which says every agent runs in its own Worker.
#[test]
fn one_agents_turn_does_not_report_another_agent_as_busy() {
    let app = booted(&["Hello."], Rc::new(ScriptedAgents::none()));
    let started = start_turn(&app, "main", "M1 alpha");
    assert_eq!(header(&started, "x-turn"), "pending", "main is mid-turn");
    assert_eq!(
        header(&chat_with(&app, "researcher"), "x-turn"),
        "",
        "researcher is not"
    );
}

/// Two agents in flight AT ONCE — the thing "two sub-agents at once" needs and
/// the interface could not express while one turn locked every composer.
#[test]
fn two_agents_can_be_in_flight_at_the_same_time() {
    let app = booted(&["one", "two"], Rc::new(ScriptedAgents::none()));
    start_turn(&app, "main", "M1 alpha");
    start_turn(&app, "researcher", "R1 alpha");

    assert_eq!(header(&chat_with(&app, "main"), "x-turn"), "pending");
    assert_eq!(header(&chat_with(&app, "researcher"), "x-turn"), "pending");
    let theirs = chat_with(&app, "researcher").body;
    assert!(theirs.contains("R1 alpha") && !theirs.contains("M1 alpha"), "{theirs}");
}

/// A REBOOT IS NOT AN OUTCOME. A sub-agent's Worker is constructed again on
/// every load and announces itself ready; that must not overwrite the failure
/// its own transcript still shows. `main` — which has no Worker — always kept
/// its failure, and the board said two different things about two agents in
/// the same state (`ux-walker`, increment 07).
#[test]
fn a_worker_rebooting_does_not_erase_the_last_recorded_failure() {
    let app = booted(&[], Rc::new(ScriptedAgents::none()));
    core::report_agent(
        &mut app.borrow_mut(),
        "researcher",
        Status::Failed,
        "the model endpoint could not be reached",
    );
    // Exactly what a fresh page load sends: spawn, then the Worker's `ready`.
    core::report_agent(&mut app.borrow_mut(), "researcher", Status::Starting, "");
    core::report_agent(&mut app.borrow_mut(), "researcher", Status::Idle, "");

    let board = handle(&mut app.borrow_mut(), Request::get("/board")).body;
    assert!(board.contains(r#"data-status="failed""#), "{board}");
    assert!(
        board.contains("the model endpoint could not be reached"),
        "with its cause: {board}"
    );
    assert!(!board.contains("idle — it answered"), "{board}");
}

/// Records written by an earlier build replay forever. One that carried the
/// Rust debug wrapper and the agent's own name in front of its sentence —
/// `researcher: JsValue("researcher: …")` — must still render as the sentence
/// alone, attributed once by the transcript itself.
#[test]
fn an_old_record_does_not_replay_rust_debug_syntax_at_the_reader() {
    let agents = Rc::new(ScriptedAgents::with(vec![(
        "researcher",
        Err(r#"JsValue("researcher: The model endpoint could not be reached.")"#),
    )]));
    let app = booted(&[r#"researcher({"query": "price?"})"#, "no answer"], agents);
    let req = Request::post_form("/chat", &[("message", "ask the researcher")])
        .with_header("x-agent", "main");
    handle(&mut app.borrow_mut(), req);
    block_on(drive(Rc::clone(&app))).expect("the turn drives");

    let theirs = chat_with(&app, "researcher").body;
    // The SENTENCE a person reads is clean; the record itself is still shown
    // verbatim behind the disclosure, which is the point of the disclosure.
    let (sentence, detail) = theirs.split_once("<details>").expect("a failure card: {theirs}");
    assert!(!sentence.contains("JsValue"), "no debug wrapper: {sentence}");
    assert!(
        sentence.contains("<p>The model endpoint could not be reached.</p>"),
        "the sentence, named once: {sentence}"
    );
    // One failure, one presentation: the sub-agent's failure is the same card
    // with the same reachable detail as the page's own (increment 07b).
    assert!(
        detail.contains("Technical detail for failure 1"),
        "the cause is reachable: {detail}"
    );
}
