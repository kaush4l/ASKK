//! THE STOP, through the seam (R16-P0-2). The agent crate proves the boundary
//! in the pure machine; this proves what the person sees and — the claim the
//! product is making — that nothing runs after the press.
//!
//! "You cannot stop a running agent" was named by two consecutive fresh-context
//! critics as the single thing holding this below the hosted field. Both stop
//! controls that existed meant "stop looking".

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{
    DenyAllNet, FakeShell, FixedClock, MemKv, MemStore, ScriptedAgents, ScriptedModel, SeededRng,
};
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

/// A model that keeps calling tools, then finally answers — the shape of the
/// run the critic could not get out of, with an ending so the untouched case
/// has one to reach.
fn booted() -> Rc<RefCell<App>> {
    let replies = ["now()", "now()", "It is 3pm."]
        .iter()
        .map(|r| ScriptedModel::text_reply(r))
        .collect();
    let mut app = block_on(boot(Ports {
        model: Rc::new(ScriptedModel::with_replies(replies)),
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: Rc::new(FakeShell::new()),
        agents: Rc::new(ScriptedAgents::none()),
    }))
    .expect("boot succeeds");
    install_agents(
        &mut app,
        vec![
            (
                "main".to_string(),
                "---\nname: main\ndescription: the lead\ntools: [now]\nmax_rounds: 64\n---\nP"
                    .to_string(),
            ),
            (
                "researcher".to_string(),
                "---\nname: researcher\ndescription: the reader\ntools: []\n---\nP".to_string(),
            ),
        ],
    );
    Rc::new(RefCell::new(app))
}

fn ask(app: &Rc<RefCell<App>>, message: &str) -> kernel::Response {
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", message)]),
    )
}

fn get(app: &Rc<RefCell<App>>, path: &str) -> kernel::Response {
    handle(&mut app.borrow_mut(), Request::get(path))
}

/// How many times the model answered, and how many tools ran. Off the log
/// itself (I8), which is the only record that cannot be told a story by the UI.
/// `ModelReplied` and not `ModelCalled`: the second is only written when the
/// provider reports a usage block, so a run can make it without leaving one.
fn counts(app: &Rc<RefCell<App>>) -> (usize, usize) {
    let kinds = core::log_kinds(&app.borrow());
    (
        kinds.iter().filter(|k| matches!(k, EventKind::ModelReplied { .. })).count(),
        kinds.iter().filter(|k| matches!(k, EventKind::ToolInvoked { .. })).count(),
    )
}

/// THE CONTROL. The same run, untouched, goes round the loop and answers.
/// Without this the stop could pass by breaking the agent.
#[test]
fn a_run_nobody_stops_finishes_on_its_own() {
    let app = booted();
    ask(&app, "what is the time");
    block_on(drive(Rc::clone(&app))).expect("the turn drives");

    let (called, ran) = counts(&app);
    assert_eq!((called, ran), (3, 2), "two tool rounds, then the answer");
    let chat = get(&app, "/chat").body;
    assert!(chat.contains("It is 3pm."), "the answer is in the conversation: {chat}");
    assert!(!chat.contains("stopped by you"), "nothing stopped it: {chat}");
}

/// THE PRESS. It lands while the first model call is in flight — the queue
/// holds the stop ahead of the reply — and the reply that comes back asks for a
/// tool that is never run. No second model call, no tool call, ever.
#[test]
fn a_stopped_run_makes_no_further_model_call_and_runs_no_tool() {
    let app = booted();
    let accepted = ask(&app, "what is the time");
    assert!(
        accepted.headers.iter().any(|(k, v)| k == "x-stoppable" && v == "yes"),
        "a running turn on this page's own agent can be stopped: {:?}",
        accepted.headers
    );

    let pressed = handle(&mut app.borrow_mut(), Request::post_form("/chat/halt", &[]));
    assert_eq!(pressed.status, 200, "{}", pressed.body);
    block_on(drive(Rc::clone(&app))).expect("the turn drives");

    let (called, ran) = counts(&app);
    assert_eq!(called, 1, "the call in flight answered, and nothing was asked after it");
    assert_eq!(ran, 0, "the tool that reply asked for was never run");

    // …and the person is told, in the conversation, by the agent whose turn it
    // was — with what it does NOT stop, because it cannot.
    let chat = get(&app, "/chat");
    assert!(chat.body.contains("stopped by you"), "{}", chat.body);
    assert!(chat.body.contains("nothing new is started"), "{}", chat.body);
    assert!(
        !chat.headers.iter().any(|(k, _)| k == "x-turn"),
        "a stopped turn is not still pending: {:?}",
        chat.headers
    );
    assert!(
        !chat.body.contains("thinking…"),
        "and the pane must not still be waiting on it: {}",
        chat.body
    );

    // …and the trace, which is where a run's own history lives, has the row.
    let trace = get(&app, "/tools").body;
    assert!(trace.contains("stopped by you before round 1"), "{trace}");
    assert!(trace.contains(r#"data-outcome="stopped by you""#), "{trace}");
}

/// ONE FACT, BOTH SURFACES. Round 16 was spent on the shape where two panes
/// each kept their own tally of one event; a control this new gets no chance to
/// grow that, so this pins that the two readings come from one record.
#[test]
fn the_conversation_and_the_trace_are_folds_of_the_same_one_fact() {
    let app = booted();
    ask(&app, "what is the time");
    handle(&mut app.borrow_mut(), Request::post_form("/chat/halt", &[]));
    block_on(drive(Rc::clone(&app))).expect("the turn drives");

    let stops = core::log_kinds(&app.borrow())
        .iter()
        .filter(|k| matches!(k, EventKind::Custom { kind, .. } if kind == agent::STOPPED))
        .count();
    assert_eq!(stops, 1, "one press, one fact");
    assert!(get(&app, "/chat").body.contains("stopped by you"));
    assert!(get(&app, "/tools").body.contains("stopped by you"));
}

/// A SUB-AGENT'S TURN IS NOT THIS PAGE'S TO STOP. It runs in its own Worker
/// with its own state, and no fact written here reaches it. The pane is told by
/// `x-stoppable` and never offers the button; this is the backstop, and it says
/// why rather than failing quietly.
#[test]
fn stopping_an_agent_that_runs_in_its_own_worker_is_refused_with_the_reason() {
    let app = booted();
    let refused = handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat/halt", &[]).with_header("x-agent", "researcher"),
    );
    assert_eq!(refused.status, 409, "{}", refused.body);
    assert!(refused.body.contains("its own Worker"), "{}", refused.body);
    let stops = core::log_kinds(&app.borrow())
        .iter()
        .filter(|k| matches!(k, EventKind::Custom { kind, .. } if kind == agent::STOP_REQUESTED))
        .count();
    assert_eq!(stops, 0, "a refusal records no press");
}
