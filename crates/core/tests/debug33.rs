//! THE DEBUG VIEW — the facts the harness already emitted and nothing read.
//!
//! Five were measured at zero readers outside the crate emitting them:
//! `core.route_chosen` (the loop a turn voted for, and why), `PhaseEntered`,
//! `StoreFailed`, `ModelCalled::document_hash`, and the `ModelReplied` rounds
//! whose text carries TOOL CALLS — the model's own working, which the
//! transcript counts and draws nothing for.
//!
//! Every assertion here is about a line a person reads, and each one is
//! deliberately paired with the fact that produced it: a projection test that
//! only checked the fragment was non-empty would pass over a pane that had
//! stopped reading four of the five.
//!
//! THE STAGE COUNT IS THE SIXTH ASSERTION AND THE ONE WITH A BUG BEHIND IT.
//! `board::stage::said` counted the current stage against the agent file's
//! DECLARED `stages:` list, while the list a routed turn walks comes from
//! `Route::stages()` — and the one shipped agent declares `stages: [strategy]`,
//! so `work` was never in the declared list and every shipped agent printed a
//! bare stage name with no count at all. `a_routed_turn_counts_its_stages`
//! below is red without the fix: the route is `project`, the turn is in `work`,
//! and the row must read `stage 2 of 4`.

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{
    DenyAllNet, FakeShell, FixedClock, MemKv, MemStore, ScriptedAgents, ScriptedModel, SeededRng,
};
use core::{boot, drive, handle, install_agents, App, Ports};
use kernel::{ModelPort, ModelReply, Request, Timestamp};

mod common;

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

/// Answers a script and then hangs, so the turn is still open when the pane is
/// read. Every state worth asserting on a debug pane is mid-turn.
struct AnswersThenHangs {
    replies: RefCell<Vec<String>>,
}

impl AnswersThenHangs {
    fn with(replies: &[&str]) -> Rc<Self> {
        Rc::new(Self {
            replies: RefCell::new(replies.iter().map(|r| (*r).to_string()).collect()),
        })
    }
}

impl ModelPort for AnswersThenHangs {
    fn call<'a>(
        &'a self,
        _endpoint: &'a kernel::EndpointName,
        _body_json: &'a str,
    ) -> kernel::BoxFuture<'a, Result<ModelReply, kernel::ModelError>> {
        let mut left = self.replies.borrow_mut();
        let next = match left.is_empty() {
            true => None,
            false => Some(left.remove(0)),
        };
        drop(left);
        match next {
            None => Box::pin(std::future::pending()),
            // USAGE REPORTED, because `effects.rs` emits `ModelCalled` — and
            // with it the `document_hash` — only where the provider says what a
            // call cost. A fixture that reported none would leave the very fact
            // this pane exists to read out of the log.
            Some(text) => Box::pin(std::future::ready(Ok(ModelReply {
                body_json: ScriptedModel::text_reply(&text),
                usage: Some(kernel::Usage {
                    input_tokens: 500,
                    output_tokens: 12,
                    cached_input_tokens: None,
                }),
            }))),
        }
    }
}

/// The shipped shape: the file declares the VOTE and the route decides the
/// rest. This is what makes the stage count wrong without the fix.
const VOTING: &str = "---\nname: main\ndescription: the lead\nspace: research\n\
     tools: [exec]\nstages: [strategy]\n---\nbody";

fn booted(agent: &str, model: Rc<dyn ModelPort>) -> Rc<RefCell<App>> {
    let ports = Ports {
        model,
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: Rc::new(FakeShell::new().answering("echo", 0, "hi")),
        agents: Rc::new(ScriptedAgents::none()),
    };
    let mut app = block_on(boot(ports)).expect("boot succeeds");
    install_agents(&mut app, vec![("main".to_string(), agent.to_string())]);
    common::brief(&mut app);
    Rc::new(RefCell::new(app))
}

fn run(app: &Rc<RefCell<App>>, message: &str) {
    handle(&mut app.borrow_mut(), Request::post_form("/chat", &[("message", message)]));
    let mut turn = Box::pin(drive(Rc::clone(app)));
    let mut cx = Context::from_waker(Waker::noop());
    let _ = turn.as_mut().poll(&mut cx);
}

fn pane(app: &Rc<RefCell<App>>) -> String {
    handle(&mut app.borrow_mut(), Request::get("/debug")).body
}

fn line(app: &Rc<RefCell<App>>) -> String {
    let board = handle(&mut app.borrow_mut(), Request::get("/board")).body;
    let at = board.find("data-agent=\"main\"").expect("main has a row");
    let (_, rest) = board[at..].split_once("data-line=\"").expect("the row's line");
    rest.split_once('"').map(|(v, _)| v.to_string()).unwrap_or_default()
}

/// A turn that voted `project` and walked into `work`.
fn a_project_turn() -> Rc<RefCell<App>> {
    let app = booted(
        VOTING,
        AnswersThenHangs::with(&[
            "ROUTE: project\nWHY: it asks for a working script",
            "OUTCOME — a script that prints the primes.",
        ]),
    );
    run(&app, "write me a primes script");
    app
}

/// FACT 1 — `core.route_chosen`, whose only reader in the tree was a test.
/// The route AND the clause the model wrote for it are both on the pane, and
/// so is the list that route really walks.
#[test]
fn the_route_and_the_why_behind_it_are_on_the_pane() {
    let said = pane(&a_project_turn());
    assert!(said.contains("route: project"), "the voted route is not shown: {said}");
    assert!(
        said.contains("it asks for a working script"),
        "the model's own WHY clause is not shown: {said}"
    );
    assert!(
        said.contains("plan → work → verify → critique"),
        "the stages that route really walks are not shown: {said}"
    );
}

// FACT 2 — `EventKind::PhaseEntered` — IS NOT HERE, AND THAT IS THE FINDING.
// It has a reader now (`debug::turns`, unit-tested in that file), but nothing
// in this build EMITS it: `runtime::pump` appends it only when `app.agent.phase`
// moves, and `agent::AgentState::phase` is never assigned anywhere in
// `crates/agent` — the stage machine superseded the phase machine and left the
// field behind. An integration test here would have to assert its absence,
// which proves nothing about the projection, so the claim is labelled
// unpinnable at the projection instead (I17) and the missing machine fact is
// named: an assignment to `state.phase`.

/// FACT 4 — `ModelCalled::document_hash`, emitted by `effects.rs` and read by
/// nothing. Its cost is beside it, per round, which is what makes two rounds
/// with the same hash visible as the loop they are — and what makes a turn that
/// quietly became several calls legible as several calls.
#[test]
fn every_round_says_what_it_cost_and_which_document_it_sent() {
    let said = pane(&a_project_turn());
    assert!(said.contains("round 1"), "the rounds are not numbered: {said}");
    assert!(said.contains("round 2"), "only the first round is drawn: {said}");
    assert!(said.contains("document "), "the document hash has no reader: {said}");
    assert!(said.contains("512 tokens"), "the round's own cost is missing: {said}");
    assert!(said.contains("2 model calls · 1024 tokens"), "the turn's cost is wrong: {said}");
}

/// FACT 5 — a `ModelReplied` whose text carries TOOL CALLS. The transcript
/// pushes it to a counter and draws nothing, so what the model said in the
/// round it decided to act was in the log and on no screen.
#[test]
fn what_the_model_said_when_it_called_a_tool_is_readable() {
    let app = booted(
        VOTING,
        AnswersThenHangs::with(&[
            "ROUTE: react\nWHY: it needs a command",
            "I will check what is here first.\nexec({\"command\": \"echo hi\"})",
        ]),
    );
    run(&app, "what is in the folder");
    let said = pane(&app);
    assert!(
        said.contains("I will check what is here first."),
        "the model's working in a tool-calling round is still invisible: {said}"
    );
    assert!(said.contains("called exec"), "the round does not say what it called: {said}");
}

/// A STORE WHOSE EVENT WRITES ALWAYS FAIL — a quota, in the one place a quota
/// really bites. Only `events/` fails, so boot and the rest of the app are
/// untouched and the test is about the log's own persistence and nothing else.
#[derive(Default)]
struct FullDisk {
    kv: FullKv,
    blob: adapters_test::MemBlob,
}

#[derive(Default)]
struct FullKv {
    inner: MemKv,
}

impl kernel::KvStore for FullKv {
    fn get<'a>(&'a self, key: &'a str) -> kernel::BoxFuture<'a, Result<Option<String>, kernel::StoreError>> {
        self.inner.get(key)
    }
    fn put<'a>(&'a self, key: &'a str, value: &'a str) -> kernel::BoxFuture<'a, Result<(), kernel::StoreError>> {
        if key.starts_with("events/") {
            return Box::pin(std::future::ready(Err(kernel::StoreError::Backend {
                message: "QuotaExceededError".into(),
            })));
        }
        self.inner.put(key, value)
    }
    fn delete<'a>(&'a self, key: &'a str) -> kernel::BoxFuture<'a, Result<(), kernel::StoreError>> {
        self.inner.delete(key)
    }
    fn list_prefix<'a>(&'a self, prefix: &'a str) -> kernel::BoxFuture<'a, Result<Vec<String>, kernel::StoreError>> {
        self.inner.list_prefix(prefix)
    }
}

impl kernel::StorePort for FullDisk {
    fn kv(&self) -> &dyn kernel::KvStore {
        &self.kv
    }
    fn blob(&self) -> &dyn kernel::BlobStore {
        &self.blob
    }
}

/// FACT 3 — `StoreFailed`. ADR-005 promised a quota error would surface; it was
/// recorded by `log::store` and shown to nobody. This drives the REAL path —
/// a store that refuses every `events/` write — so the assertion is on the
/// mechanism and not on a hand-appended fact.
///
/// THE POSITIVE CONTROL, RUN: with `FullDisk` swapped for `MemStore` this test
/// fails on the first assertion (`the failed write is not shown`), because
/// nothing appends a `StoreFailed` and the pane draws turns only. The alarm is
/// therefore produced by the failure and not by the pane.
#[test]
fn a_failed_write_is_the_first_thing_on_the_pane_and_says_what_it_means() {
    let ports = Ports {
        model: Rc::new(ScriptedModel::with_replies(
            ["ROUTE: answer\nWHY: it is a greeting", "Hello."]
                .iter()
                .map(|r| ScriptedModel::text_reply(r))
                .collect(),
        )),
        store: Rc::new(FullDisk::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: Rc::new(FakeShell::new().answering("echo", 0, "hi")),
        agents: Rc::new(ScriptedAgents::none()),
    };
    let mut app = block_on(boot(ports)).expect("boot succeeds — only `events/` is full");
    install_agents(&mut app, vec![("main".to_string(), VOTING.to_string())]);
    common::brief(&mut app);
    let app = Rc::new(RefCell::new(app));
    handle(&mut app.borrow_mut(), Request::post_form("/chat", &[("message", "hello")]));
    let _ = block_on(drive(Rc::clone(&app))); // it ends in the store error

    let said = pane(&app);
    let alarm = said.find("stopped being saved").expect("the failed write is not shown");
    assert!(said.contains("QuotaExceededError"), "the reason is swallowed: {said}");
    assert!(said.contains("events/"), "which write failed is swallowed: {said}");
    assert!(!said.contains("data-store-failed=\"0\""), "the pane does not count it: {said}");
    if let Some(turn) = said.find("debug-turn") {
        assert!(alarm < turn, "the alarm is a row among rows: {said}");
    }
}

/// THE STAGE COUNT, against the list the turn IS walking. Red before the fix:
/// `main` declares `stages: [strategy]`, the vote replaced that list with the
/// project route's four, and the board looked the current stage up in the
/// declaration — so `work` missed and the row printed a bare word.
#[test]
fn a_routed_turn_counts_its_stages_against_the_route_and_not_the_file() {
    let said = line(&a_project_turn());
    assert!(
        said.contains("stage 2 of 4: work"),
        "the count comes from the declared list, not the route: {said}"
    );
}

/// …AND A TURN THAT HAS NOT VOTED STILL COUNTS AGAINST ITS FILE. The strategy
/// stage itself is the declaration's own stage 1 of 1, and an agent that
/// declares a full loop and never votes is unchanged by any of this.
#[test]
fn a_turn_that_has_not_voted_yet_counts_against_the_declaration() {
    let app = booted(VOTING, AnswersThenHangs::with(&[]));
    run(&app, "hello");
    let said = line(&app);
    assert!(
        said.contains("stage 1 of 1: strategy"),
        "before the vote the declaration is all there is: {said}"
    );
}

/// …AND A ROUTE THE MACHINE FELL BACK TO IS NOT DRAWN AS A VOTE. `react` is
/// reached two ways — the model asked for it, or the reply was unreadable and
/// `strategy::route_of` failed towards the middle — and a pane that showed the
/// two identically would be repeating, on the screen, the exact defect the
/// `how` field was added to the fact to fix.
#[test]
fn a_route_the_machine_fell_back_to_is_marked_as_one() {
    let app = booted(VOTING, AnswersThenHangs::with(&["I am not sure what you want."]));
    run(&app, "what is here");
    let said = pane(&app);
    assert!(said.contains("route: react"), "the fallback route is not shown: {said}");
    assert!(
        said.contains("vote could not be read"),
        "a fallback is drawn as though the model chose it: {said}"
    );

    // …and a real vote is not accused of falling back.
    let voted = pane(&a_project_turn());
    assert!(!voted.contains("vote could not be read"), "a real vote is marked a fallback: {voted}");
}
