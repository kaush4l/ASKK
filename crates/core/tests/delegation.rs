//! One delegation through the whole seam, on the host with in-memory ports
//! (I3): the lead calls a sub-agent by name, the board moves Working → Idle
//! while it runs, the answer comes back as the tool result the model reads,
//! and a failed sub-agent lands on the board WITH its message.

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

/// `main` names `researcher` and `summarizer` in its `tools:` list, so both
/// are sub-agent tools — which is the whole point of increment 06's honest
/// fix: the file decides, not a hardcoded phase list.
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

fn board(app: &Rc<RefCell<App>>) -> String {
    handle(&mut app.borrow_mut(), Request::get("/board")).body
}

/// A fresh page: every agent has a row, the entry agent is waiting on the
/// person and everybody else is STARTING — its Worker is coming up (Python
/// `_start`: register STARTING, then IDLE once the engine is built). Both
/// words appear, because the board is the only place a person can see the
/// difference, and "idle — nobody has called it" was what an agent with no
/// Worker at all used to say (increment 07).
#[test]
fn every_loaded_agent_has_a_row_and_the_entry_agent_is_waiting() {
    let app = booted(&[], Rc::new(ScriptedAgents::none()));
    let html = board(&app);
    assert!(html.contains(r#"data-agent="main""#), "{html}");
    assert!(html.contains(r#"data-agent="researcher""#), "{html}");
    assert!(html.contains(r#"data-agent="summarizer""#), "{html}");
    assert!(html.contains(r#"data-status="waiting""#), "the lead waits on you");
    assert!(html.contains(r#"data-status="starting""#), "a peer's Worker is coming up");
    assert!(html.contains("ready"), "in words, not only a colour");
    assert!(html.contains("starting up"), "in words: {html}");
}

/// The lead delegates: the sub-agent's answer becomes the tool result the
/// model reads, and the lead answers the user with it. The board ends with the
/// sub-agent Idle (one turn taken) and the lead Waiting (one turn taken).
#[test]
fn the_lead_calls_a_sub_agent_by_name_and_answers_from_what_it_returned() {
    let agents = Rc::new(ScriptedAgents::with(vec![("researcher", Ok("The price is 42."))]));
    let replies = [r#"researcher({"query": "what is the price?"})"#, "It is 42."];
    let app = booted(&replies, Rc::clone(&agents));
    ask(&app, "ask the researcher for the price");

    assert_eq!(
        agents.seen.borrow().as_slice(),
        ["researcher: what is the price?"],
        "the goal reached the sub-agent as one string"
    );
    let chat = handle(&mut app.borrow_mut(), Request::get("/chat")).body;
    assert!(chat.contains("It is 42."), "{chat}");
    let trace = handle(&mut app.borrow_mut(), Request::get("/tools")).body;
    assert!(trace.contains("The price is 42."), "the answer is in the trace: {trace}");

    let html = board(&app);
    assert!(html.contains("researcher"), "{html}");
    assert!(html.contains("1 turn"), "the sub-agent took one turn: {html}");
    assert!(!html.contains(r#"data-status="working""#), "nobody is left working");
}

/// The status moved through Working, and the LOG says so — the board is a fold
/// of those facts, so what a person watched and what happened cannot differ.
#[test]
fn the_sub_agent_goes_working_then_idle_and_the_log_records_both() {
    let agents = Rc::new(ScriptedAgents::with(vec![("researcher", Ok("done"))]));
    let app = booted(&[r#"researcher({"query": "go"})"#, "ok"], agents);
    ask(&app, "delegate");

    let statuses: Vec<(String, kernel::Status)> = core::log_kinds(&app.borrow())
        .into_iter()
        .filter_map(|k| match k {
            kernel::EventKind::AgentStatus { agent, status, .. } => Some((agent, status)),
            _ => None,
        })
        .collect();
    let of = |who: &str| -> Vec<kernel::Status> {
        statuses.iter().filter(|(a, _)| a == who).map(|(_, s)| *s).collect()
    };
    assert_eq!(
        of("researcher"),
        [kernel::Status::Working, kernel::Status::Idle],
        "working while it ran, idle after — never waiting: {statuses:?}"
    );
    assert_eq!(
        of("main"),
        [kernel::Status::Working, kernel::Status::Waiting],
        "the entry agent waits on the person, not idle: {statuses:?}"
    );
}

/// A sub-agent whose turn raised is `Failed` on the board WITH its message,
/// and the lead is told in words it can act on rather than left hanging.
#[test]
fn a_failed_sub_agent_is_failed_on_the_board_with_its_message() {
    let agents = Rc::new(ScriptedAgents::with(vec![("researcher", Err("unreachable endpoint"))]));
    let app = booted(&[r#"researcher({"query": "go"})"#, "I could not."], agents);
    ask(&app, "delegate");

    let html = board(&app);
    assert!(html.contains(r#"data-status="failed""#), "{html}");
    assert!(html.contains("unreachable endpoint"), "{html}");
    let trace = handle(&mut app.borrow_mut(), Request::get("/tools")).body;
    assert!(trace.contains("researcher failed"), "{trace}");
    assert!(trace.contains("— failed"), "a failed call reads as one: {trace}");
}

/// A call with no readable goal is REFUSED, never delivered: a sub-agent
/// handed an empty goal answers it regardless, which is worse than a refusal
/// the model can correct.
#[test]
fn a_delegation_with_no_goal_is_refused_and_the_sub_agent_never_runs() {
    let agents = Rc::new(ScriptedAgents::with(vec![("researcher", Ok("should not run"))]));
    let app = booted(&["researcher({})", "I need to give it a goal."], Rc::clone(&agents));
    ask(&app, "delegate badly");

    assert!(agents.seen.borrow().is_empty(), "the sub-agent was never called");
    let trace = handle(&mut app.borrow_mut(), Request::get("/tools")).body;
    assert!(trace.contains("no goal given"), "{trace}");
    let html = board(&app);
    assert!(!html.contains(r#"data-status="working""#), "{html}");
}

/// The layout rule as an assertion over ONE timeline: line 1's two delegations
/// overlap, and line 2's runs after BOTH of their answers. Each half is an
/// ORDER between the `entered` and `resolved` sequences, so this reads their
/// indices and never their contents — the names, and the order those names
/// arrived in, are identical with the rule and without it (T60). Each failure
/// says WHICH claim broke: they are two rules with two different causes.
fn layout_rule_holds(timeline: &[String]) {
    let at = |word: &'static str| -> Vec<usize> {
        let hit = |(i, e): (usize, &String)| e.starts_with(word).then_some(i);
        timeline.iter().enumerate().filter_map(hit).collect()
    };
    let (entered, resolved) = (at("entered"), at("resolved"));
    assert_eq!((entered.len(), resolved.len()), (3, 3), "three delegations ran: {timeline:?}");
    assert!(
        entered[1] < resolved[0],
        "CLAIM 1 (one line is one batch) BROKE: line 1's second delegation was entered only \
         after something had already answered, so the line ran serially: {timeline:?}"
    );
    assert!(
        entered[2] > resolved[1],
        "CLAIM 2 (a new line runs after everything above it) BROKE: line 2's delegation was \
         entered with only {} of line 1's two delegations resolved, so it joined line 1's \
         batch — the boundary in `core::batch::run_effects` is gone: {timeline:?}",
        resolved.iter().filter(|r| **r < entered[2]).count()
    );
}

/// Calls on ONE line are one batch: both sub-agents receive their goals before
/// either result comes back, which is what "at the same time" means when each
/// runs in its own Worker. A call on the NEXT line runs after them.
///
/// It is the TIMELINE that earns that first sentence, not `seen`. Arrivals in
/// the order the model wrote them are exactly what a serial `for … .await`
/// produces, so asserting only their order proved nothing (T59). The
/// rendezvous fake holds every delegation open until both have been ENTERED:
/// under `join_all` both entries land and the gate opens, and under a serial
/// loop the first `await` never returns and this test hangs into `block_on`'s
/// panic.
///
/// The SECOND sentence needs its own assertion, and asserting arrival order or
/// "the last thing that happened" does not give it one: a boundary-free batch
/// produces both by construction, so deleting the `batch == line` guard at
/// `core::batch::run_effects` left the whole workspace green (T60). What
/// separates the two worlds is WHERE line 2's entry falls among line 1's
/// ANSWERS — after both of them with the boundary, in the middle of them
/// without it. That is `entered[2] > resolved[1]`.
#[test]
fn one_line_of_delegations_is_one_batch_and_the_next_line_follows_it() {
    let agents = Rc::new(
        ScriptedAgents::with(vec![
            ("researcher", Ok("found it")),
            ("summarizer", Ok("compressed")),
        ])
        .rendezvous(2),
    );
    let app = booted(
        &[
            "researcher({\"query\": \"a\"}), summarizer({\"query\": \"b\"})\n\
             researcher({\"query\": \"c\"})",
            "all done",
        ],
        Rc::clone(&agents),
    );
    ask(&app, "do three things");
    assert_eq!(
        agents.seen.borrow().as_slice(),
        ["researcher: a", "summarizer: b", "researcher: c"],
        "the second line ran after the first line's two"
    );

    let timeline = agents.timeline();
    layout_rule_holds(&timeline);
    assert_eq!(
        timeline.last().map(String::as_str),
        Some("resolved researcher"),
        "the next line's call is the last thing to happen: {timeline:?}"
    );
}

/// A turn that RAISED leaves the entry agent `Failed` WITH the message, never
/// stuck in `working` — the one status a person reads as "still going". A
/// hosted failed turn left it there for a whole session before this.
#[test]
fn a_failed_turn_leaves_the_entry_agent_failed_not_working() {
    // No replies queued: the scripted model is exhausted, which is a
    // transport failure — the same shape as an unreachable endpoint.
    let app = booted(&[], Rc::new(ScriptedAgents::none()));
    ask(&app, "anything");
    let html = board(&app);
    assert!(!html.contains(r#"data-status="working""#), "not left working: {html}");
    assert!(html.contains(r#"data-status="failed""#), "{html}");
    assert!(
        html.contains("the endpoint was unreachable"),
        "the reason is on the row, not just the status: {html}"
    );
    // …in ONE LINE, and not the transcript's five-line explanation a second
    // time. The board is in the rail beside the transcript, and the identical
    // paragraph appeared twice on one screen with no recovery from either (F11).
    assert!(
        !html.contains("could not be reached"),
        "the row explains nothing the transcript already explained: {html}"
    );
}
