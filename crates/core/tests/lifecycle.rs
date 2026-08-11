//! The agent lifecycle on the host (I3): the two status gaps the 06 walk
//! found. `Closed` was assigned nowhere in production code and `Starting` was
//! overwritten inside the same boot pass, so neither was ever observable —
//! and a Worker that failed to start wrote no status at all, which left the
//! one row that should say "this agent is unusable" reading as idle.

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{DenyAllNet, FixedClock, MemStore, ScriptedAgents, ScriptedModel, SeededRng};
use core::{boot, drive, handle, install_agents, App, Ports};
use kernel::{Request, Status, Timestamp};

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

/// A Worker that will not start is the one row that must say the agent is
/// UNUSABLE. It used to be a bare `console.warn` and no status write, so an
/// agent with no Worker at all read as "idle — nobody has called it".
#[test]
fn a_worker_that_cannot_start_lands_in_failed_with_its_reason() {
    let app = booted(&[], Rc::new(ScriptedAgents::none()));
    core::report_agent(
        &mut app.borrow_mut(),
        "researcher",
        Status::Failed,
        "SecurityError: Worker construction was blocked",
    );
    let html = board(&app);
    assert!(html.contains(r#"data-status="failed""#), "{html}");
    assert!(html.contains("Worker construction was blocked"), "the reason: {html}");
}

/// Closing an agent stops its Worker and says so (Python `aclose`: the thread
/// stops and the row becomes CLOSED). Before this, `Closed` was a variant
/// nothing in the running system could ever assign.
#[test]
fn closing_an_agent_sets_closed_and_reopening_it_starts_again() {
    let app = booted(&[], Rc::new(ScriptedAgents::none()));
    core::report_agent(&mut app.borrow_mut(), "researcher", Status::Closed, "");
    assert!(board(&app).contains(r#"data-status="closed""#), "{}", board(&app));
    assert!(board(&app).contains("its Worker is stopped"), "in words");

    core::report_agent(&mut app.borrow_mut(), "researcher", Status::Starting, "");
    core::report_agent(&mut app.borrow_mut(), "researcher", Status::Idle, "");
    assert!(board(&app).contains(r#"data-status="idle""#), "{}", board(&app));
}

/// A sub-agent a person is talking to WAITS ON THEM, exactly as the lead does
/// — the Python's `entry` rule, which is about who speaks next, not about
/// which agent happens to be called `main`.
#[test]
fn an_agent_a_person_asked_waits_on_them_and_one_the_lead_asked_idles() {
    let agents = Rc::new(ScriptedAgents::with(vec![("researcher", Ok("done"))]));
    let app = booted(&[], Rc::clone(&agents));
    say_to(&app, "researcher", "go");
    assert!(
        board(&app).contains("waiting for you"),
        "asked by a person: {}",
        board(&app)
    );

    let app = booted(&[r#"researcher({"query": "go"})"#, "ok"], agents);
    say_to(&app, "main", "delegate");
    let statuses: Vec<Status> = core::log_kinds(&app.borrow())
        .into_iter()
        .filter_map(|k| match k {
            kernel::EventKind::AgentStatus { agent, status, .. } if agent == "researcher" => {
                Some(status)
            }
            _ => None,
        })
        .collect();
    assert_eq!(statuses, [Status::Working, Status::Idle], "asked by the lead");
}

/// A sub-agent's failure carries its CAUSE into the sub-agent's own pane and
/// onto its row — not "researcher produced no answer".
#[test]
fn a_failed_sub_agent_says_why_in_its_own_conversation() {
    let agents = Rc::new(ScriptedAgents::with(vec![(
        "researcher",
        Err("The model endpoint could not be reached: http://127.0.0.1:8873/v1"),
    )]));
    let app = booted(&[], agents);
    say_to(&app, "researcher", "go");
    let theirs = chat_with(&app, "researcher");
    assert!(theirs.contains("could not be reached"), "the cause: {theirs}");
    assert!(theirs.contains("8873"), "including which endpoint: {theirs}");
    let lead = chat_with(&app, "main");
    assert!(!lead.contains("8873"), "and not in the lead's pane: {lead}");
}

/// A message to an agent that is not loaded is refused, not misfiled into
/// somebody else's conversation.
#[test]
fn a_message_to_an_unloaded_agent_is_refused() {
    let app = booted(&[], Rc::new(ScriptedAgents::none()));
    let res = handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", "hi")]).with_header("x-agent", "nobody"),
    );
    assert_eq!(res.status, 404, "{}", res.body);
    assert!(chat_with(&app, "main").contains("No messages yet"), "nothing was filed");
}

/// The transcript says WHO is speaking in words, so a stylesheet that does not
/// load leaves a readable conversation rather than a stack of bare paragraphs.
#[test]
fn the_transcript_names_the_speaker_in_words() {
    let app = booted(&["Forty-two."], Rc::new(ScriptedAgents::none()));
    say_to(&app, "main", "what is the answer?");
    let lead = chat_with(&app, "main");
    assert!(lead.contains("You: "), "the person is named: {lead}");
    assert!(lead.contains("main: "), "and so is the agent: {lead}");
}
