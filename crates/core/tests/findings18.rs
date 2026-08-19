//! Round 18. A sentence typed into a RUNNING turn is a steer: `agent::step`
//! appends it to the history and emits nothing, so the round in flight finishes
//! and the next call carries it. The pure machine has always done that
//! (`agent/tests/rounds.rs`) — and every one of those tests asserts on returned
//! effects, which is why none of them caught what the PROJECTION said about the
//! same act: the transcript drew "That turn is not running any more — the page
//! was reloaded while it was in flight", for a steer, with no reload anywhere.
//!
//! Same log, two readers, and the one a person reads was the false one.
//!
//! P1-3 is the same class one line down: the board row's `last tool:` counted
//! the log's `ToolInvoked` facts raw, so the Processes pane's own polling was
//! reported under the agent's name — `trace::requested_by::Asked` had already attributed it
//! to `this page` in the trace forty pixels away.

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{DenyAllNet, FakeShell, FixedClock, MemKv, MemStore, ScriptedAgents, SeededRng};
use core::{boot, drive, handle, install_agents, App, Ports};
use kernel::{ModelError, ModelPort, ModelReply, Request, Response, Timestamp};

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

/// Accepts and never answers — the only way to hold a turn open on the host.
struct HangingModel;

impl ModelPort for HangingModel {
    fn call<'a>(
        &'a self,
        _endpoint: &'a kernel::EndpointName,
        _body_json: &'a str,
    ) -> kernel::BoxFuture<'a, Result<ModelReply, ModelError>> {
        Box::pin(std::future::pending())
    }
}

fn booted(store: Rc<MemStore>) -> Rc<RefCell<App>> {
    let ports = Ports {
        model: Rc::new(HangingModel),
        store,
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: Rc::new(FakeShell::new()),
        agents: Rc::new(ScriptedAgents::none()),
    };
    let mut app = block_on(boot(ports)).expect("boot succeeds");
    install_agents(
        &mut app,
        vec![(
            "main".to_string(),
            "---\nname: main\ndescription: the lead\ntools: []\n---\nbody".to_string(),
        )],
    );
    Rc::new(RefCell::new(app))
}

fn chat(app: &Rc<RefCell<App>>) -> Response {
    handle(&mut app.borrow_mut(), Request::get("/chat").with_header("x-agent", "main"))
}

fn say(app: &Rc<RefCell<App>>, message: &str) -> Response {
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", message)]).with_header("x-agent", "main"),
    )
}

fn pending(res: &Response) -> bool {
    res.headers.iter().any(|(k, v)| k == "x-turn" && v == "pending")
}

/// The turn is genuinely in flight: a `drive` is parked on a model call that
/// never answers, exactly as the browser is parked on a slow one.
fn a_turn_in_flight() -> (Rc<RefCell<App>>, Pin) {
    let app = booted(Rc::new(MemStore::default()));
    assert!(pending(&say(&app, "count to a hundred")), "the turn starts");
    let mut turn = Box::pin(drive(Rc::clone(&app)));
    let mut cx = Context::from_waker(Waker::noop());
    assert!(
        turn.as_mut().poll(&mut cx).is_pending(),
        "the model never answers, so this drive never finishes"
    );
    (app, turn)
}

type Pin = std::pin::Pin<Box<dyn Future<Output = Result<(), core::CoreError>>>>;

/// THE DEFECT, as the reviewer met it. Nothing was reloaded and nothing was
/// abandoned: the turn is still running, and the projection must not say
/// otherwise in either direction.
#[test]
fn a_steer_is_not_an_abandoned_turn() {
    let (app, mut turn) = a_turn_in_flight();

    let steered = say(&app, "in UTC, please");
    assert!(
        !steered.body.contains("was reloaded"),
        "no reload happened; the page must not say one did: {}",
        steered.body
    );
    assert!(
        !steered.body.contains("not running any more"),
        "the turn IS running: {}",
        steered.body
    );
    assert!(pending(&steered), "…and the projection says so: {:?}", steered.headers);
    assert!(
        steered.body.contains("went to the run in flight"),
        "it says what DID happen: {}",
        steered.body
    );

    // The steer is pumped by the poll's own drive. `agent::step` appends it and
    // emits nothing, so the turn in flight is untouched.
    block_on(drive(Rc::clone(&app))).expect("the poll's own drive pumps the steer");
    let after = chat(&app);
    assert!(after.body.contains("in UTC, please"), "the sentence is in the log: {}", after.body);
    assert!(
        !after.body.contains("not running any more"),
        "and the fold of the log says the same thing: {}",
        after.body
    );
    assert!(after.body.contains("went to the run in flight"), "{}", after.body);
    assert!(pending(&after), "still running: {:?}", after.headers);

    let mut cx = Context::from_waker(Waker::noop());
    assert!(turn.as_mut().poll(&mut cx).is_pending(), "the original call is still out");
}

/// The other half: an ending that names a reload must still be reachable, and
/// only from the thing it names. A message sent over a turn NOTHING is driving
/// is the abandoned case, and that wording is correct there.
#[test]
fn a_message_over_a_turn_nothing_drives_still_says_reloaded() {
    let store = Rc::new(MemStore::default());
    {
        let app = booted(Rc::clone(&store));
        assert!(pending(&say(&app, "who is going to answer this")));
        let mut turn = Box::pin(drive(Rc::clone(&app)));
        let mut cx = Context::from_waker(Waker::noop());
        assert!(turn.as_mut().poll(&mut cx).is_pending());
        block_on(drive(Rc::clone(&app))).expect("a concurrent drive persists the log");
    }
    // A new process over the same store: the reload.
    let reloaded = booted(store);
    let after = chat(&reloaded);
    assert!(after.body.contains("was reloaded"), "{}", after.body);
    let next = say(&reloaded, "asking again");
    assert!(next.body.contains("was reloaded"), "{}", next.body);
}

/// A model that answers ONCE with a tool call and then never again — a turn
/// with one of the agent's own calls behind it and another still outstanding,
/// which is exactly the state the board row's live line describes.
#[derive(Default)]
struct OneCallThenHanging(std::cell::Cell<bool>);

impl ModelPort for OneCallThenHanging {
    fn call<'a>(
        &'a self,
        _endpoint: &'a kernel::EndpointName,
        _body_json: &'a str,
    ) -> kernel::BoxFuture<'a, Result<ModelReply, ModelError>> {
        if self.0.replace(true) {
            return Box::pin(std::future::pending());
        }
        let body = adapters_test::ScriptedModel::text_reply(
            r#"start_process({"name": "web", "command": "python3 -m http.server 8000"})"#,
        );
        Box::pin(std::future::ready(Ok(ModelReply {
            body_json: body,
            usage: None,
        })))
    }
}

/// R18-P1-3. `in this turn for 4s · last tool: list_processes` on a run that
/// never called it: the Files and Processes panes poll through the agent's own
/// tools, and the one line a person reads to see what the run is doing put the
/// agent's name on the page's housekeeping.
#[test]
fn the_live_row_names_only_the_agents_own_calls() {
    let shell = Rc::new(
        adapters_test::FakeShell::new()
            .answering("mkdir -p", 0, "RUNNING 142\n")
            .answering("for p in", 0, "web\trunning\t142\t192\tpython3 -m http.server 8000\n"),
    );
    let ports = Ports {
        model: Rc::new(OneCallThenHanging::default()),
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: shell,
        agents: Rc::new(ScriptedAgents::none()),
    };
    let mut app = block_on(boot(ports)).expect("boot succeeds");
    install_agents(
        &mut app,
        vec![(
            "main".to_string(),
            "---\nname: main\ndescription: the lead\ntools: []\nspace: research\n---\nbody"
                .to_string(),
        )],
    );
    let app = Rc::new(RefCell::new(app));

    // One turn: the agent's own call lands, and the next model call hangs, so
    // the row is a LIVE row for the rest of the test.
    say(&app, "start the server");
    let mut turn = Box::pin(drive(Rc::clone(&app)));
    let mut cx = Context::from_waker(Waker::noop());
    assert!(turn.as_mut().poll(&mut cx).is_pending(), "the second call never answers");

    let running = handle(&mut app.borrow_mut(), Request::get("/board")).body;
    assert!(running.contains("last tool: start_process"), "{running}");

    // Now the Processes pane polls — the page's own housekeeping, through the
    // agent's own tool, and the newest `ToolInvoked` fact in the log.
    handle(&mut app.borrow_mut(), Request::post_form("/processes", &[]));
    block_on(drive(Rc::clone(&app))).expect("the listing runs");
    let after = handle(&mut app.borrow_mut(), Request::get("/board")).body;
    assert!(
        !after.contains("last tool: list_processes"),
        "the pane's own poll is not the agent's work: {after}"
    );
    assert!(after.contains("last tool: start_process"), "{after}");
}
