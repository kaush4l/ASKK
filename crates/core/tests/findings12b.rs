//! Increment 12's two correctness failures, as host behaviour (I3) — no
//! browser, no reload, no CSS.
//!
//! 1. **The orphaned turn.** Reload mid-turn and that agent's pane was dead
//!    forever: composer disabled, "thinking…" on screen, a clock frozen at 2s
//!    for a minute, and "Stop waiting" doing nothing — while the board beside
//!    it correctly read `idle`. Two projections of one fact, contradicting each
//!    other on one screen. The transcript was reading the SHAPE of the log (a
//!    question with no answer after it) and calling it a turn in flight; a
//!    replayed log has that shape with nothing behind it.
//! 2. **Stop waiting on somebody else's Worker.** It refused, so the wait never
//!    ended: the counter froze at the second of the press and the composer
//!    stayed disabled for the whole timeout. The button ends the WAIT, in the
//!    log this pane projects; it never claimed to reach into another Worker.

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{DenyAllNet, FakeShell, FixedClock, MemKv, MemStore, ScriptedAgents, SeededRng};
use core::{boot, drive, handle, install_agents, App, Ports};
use kernel::{ModelError, ModelReply, ModelPort, Request, Response, Timestamp};

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

/// An endpoint that accepts and never answers — the walker's unroutable host,
/// and the only way to hold a turn open long enough to reload underneath it.
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

fn files() -> Vec<(String, String)> {
    let file = |name: &str, desc: &str| {
        (
            name.to_string(),
            format!("---\nname: {name}\ndescription: {desc}\ntools: []\n---\nbody"),
        )
    };
    vec![
        file("main", "the lead"),
        file("researcher", "finds things out"),
        // The agent from finding 4: a real file with no `description:` at all.
        (
            "note-taker".to_string(),
            "---\nname: note-taker\ntools: []\n---\nbody".to_string(),
        ),
    ]
}

fn ports(store: Rc<MemStore>) -> Ports {
    Ports {
        model: Rc::new(HangingModel),
        store,
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: Rc::new(FakeShell::new()),
        agents: Rc::new(ScriptedAgents::none()),
    }
}

fn booted(store: Rc<MemStore>) -> Rc<RefCell<App>> {
    let mut app = block_on(boot(ports(store))).expect("boot succeeds");
    install_agents(&mut app, files());
    Rc::new(RefCell::new(app))
}

fn chat(app: &Rc<RefCell<App>>, agent: &str) -> Response {
    handle(
        &mut app.borrow_mut(),
        Request::get("/chat").with_header("x-agent", agent),
    )
}

fn say(app: &Rc<RefCell<App>>, agent: &str, message: &str) -> Response {
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", message)]).with_header("x-agent", agent),
    )
}

fn stop(app: &Rc<RefCell<App>>, agent: &str) -> Response {
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat/stop", &[]).with_header("x-agent", agent),
    )
}

fn pending(res: &Response) -> bool {
    res.headers
        .iter()
        .any(|(k, v)| k == "x-turn" && v == "pending")
}

/// The walker's own repro, minus the browser. A turn is started against an
/// endpoint that never answers; a second `drive` — which is what every poll of
/// the page spawns — persists the log while the first one is still awaiting.
/// That store is what a reload replays.
fn store_holding_an_unanswered_turn() -> Rc<MemStore> {
    let store = Rc::new(MemStore::default());
    let app = booted(Rc::clone(&store));
    let started = say(&app, "main", "who is going to answer this");
    assert!(pending(&started), "the turn the reload will interrupt");

    let mut turn = pin!(drive(Rc::clone(&app)));
    let mut cx = Context::from_waker(Waker::noop());
    assert!(
        turn.as_mut().poll(&mut cx).is_pending(),
        "the model never answers, so this drive never finishes"
    );
    // Mid-turn, the log still says pending — and that is CORRECT here, because
    // there really is a fetch outstanding.
    assert!(pending(&chat(&app, "main")), "a live turn is still a live turn");
    // The page's own poll: another drive, which writes what the log owes the
    // store without touching the turn in flight.
    block_on(drive(Rc::clone(&app))).expect("the concurrent drive persists");
    store
}

/// Finding 1. The pane was dead until storage was wiped; nothing recovered it,
/// including waiting, switching tabs and reloading again.
#[test]
fn a_turn_replayed_with_nothing_driving_it_is_over() {
    let store = store_holding_an_unanswered_turn();

    // The reload: a new process over the same store.
    let reloaded = booted(store);
    let res = chat(&reloaded, "main");
    assert!(
        !pending(&res),
        "a replayed turn has no fetch behind it: {:?}",
        res.headers
    );
    assert!(
        !res.body.contains("thinking…"),
        "and must not claim to be thinking: {}",
        res.body
    );
    assert!(
        res.body.contains("not running any more"),
        "it says what happened instead of going quiet: {}",
        res.body
    );
    // Nothing was lost: the question is still in the conversation.
    assert!(res.body.contains("who is going to answer this"), "{}", res.body);
    // …and the next turn works, on the same pane, with no wipe.
    assert!(pending(&say(&reloaded, "main", "asking again")));
}

/// The other half of finding 1: the fix must not disable in-flight turns. A
/// turn accepted but not yet pumped, and a turn the board says is running, are
/// both still pending — the projection distinguishes, it does not just stop
/// reporting.
#[test]
fn a_turn_something_is_driving_is_still_pending() {
    let app = booted(Rc::new(MemStore::default()));
    // Accepted this instant, not yet pumped: the window `roster::accepted`
    // already knew about, which the browser hits at ~100 ms.
    assert!(pending(&say(&app, "main", "just now")), "accepted counts");
    assert!(pending(&chat(&app, "main")), "and still counts before the pump");

    // And once the board says so, on an agent that runs in its own Worker.
    say(&app, "researcher", "over there");
    core::report_agent(
        &mut app.borrow_mut(),
        "researcher",
        kernel::Status::Working,
        "",
    );
    assert!(pending(&chat(&app, "researcher")), "the board says it is working");
}

/// Finding 2. Stop ends the wait on ANY pane. It used to refuse for an agent
/// with its own Worker, which left the counter frozen and the composer disabled
/// for the rest of the timeout — a wrong number on screen for 26 seconds.
#[test]
fn stop_waiting_ends_the_turn_on_a_workers_pane_too() {
    let app = booted(Rc::new(MemStore::default()));
    say(&app, "main", "the lead's own turn");
    say(&app, "researcher", "the sub-agent's turn");
    core::report_agent(
        &mut app.borrow_mut(),
        "researcher",
        kernel::Status::Working,
        "",
    );

    let stopped = stop(&app, "researcher");
    assert_eq!(stopped.status, 200, "{}", stopped.body);
    assert!(!pending(&stopped), "the wait ended: {:?}", stopped.headers);
    assert!(stopped.body.contains("You stopped waiting"), "{}", stopped.body);
    assert!(!chat(&app, "researcher").body.contains("thinking…"));

    // …in ONE conversation. Stopping the pane you are on must not end a turn
    // nobody asked to end, and must not appear in another agent's transcript.
    let lead = chat(&app, "main");
    assert!(pending(&lead), "the lead's turn is untouched: {:?}", lead.headers);
    assert!(!lead.body.contains("You stopped waiting"), "{}", lead.body);
}

/// Finding 4. An authored agent with no `description:` rendered `note-taker — `
/// with nothing after the dash, in the conversation's own heading.
#[test]
fn an_agent_with_no_description_has_no_dangling_dash() {
    let app = booted(Rc::new(MemStore::default()));
    let res = chat(&app, "note-taker");
    assert!(res.body.contains("note-taker"), "{}", res.body);
    assert!(
        !res.body.contains("note-taker — <"),
        "the separator went with the missing half: {}",
        res.body
    );
    // The Agents card is the same absence in the same build.
    let listing = handle(&mut app.borrow_mut(), Request::get("/agents")).body;
    assert!(!listing.contains("<p></p>"), "no empty description: {listing}");
    // …and an agent that HAS one still reads as it always did.
    assert!(chat(&app, "main").body.contains("main — the lead"), "{}", res.body);
}
