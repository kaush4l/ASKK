//! Round 21 — a cold first-time walk of the deployed page.
//!
//! TWO LIES AND A SILENCE.
//!
//! The card printed `Model: local` — the agent file's own field, verbatim — on
//! every card on the Agents view, while the header on the SAME SCREEN said "The
//! next turn calls openrouter — openai/gpt-4o-mini" and openrouter.ai was
//! returning a real 401. Somebody who changes the endpoint and is refused looks
//! at the card and concludes the change did not take. The card now asks the port
//! that will make the call (`ModelPort::resolves`).
//!
//! And increment 20's declared plan → work → verify loop had no name anywhere:
//! the rendered text of all six views contained `verify` 0 times, `stage` 0,
//! `loop` 0, `delegat` 0. Every stage block wore the page's generic `Note:`.
//! Both are projections of facts already in the log — `core.stage_entered` and
//! the spec's own `stages:` — so neither adds a state to keep in step (I8).

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{
    DenyAllNet, FakeShell, FixedClock, MemKv, MemStore, ScriptedAgents, ScriptedModel, SeededRng,
};
use core::{boot, drive, handle, install_agents, App, Ports};
use kernel::{BoxFuture, EndpointName, ModelError, ModelPort, ModelReply, Request, Timestamp};

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

/// A model port with a CATALOGUE, which is the whole point: only the adapter
/// knows that Settings has been pointed somewhere else, so only it can answer
/// what the next turn really calls. `answers` is the `(entry, model)` this
/// build would reach whatever the agent file asked for — the shape of an
/// explicit Settings pick, which outranks the file's `model:` key.
struct Broker {
    inner: ScriptedModel,
    answers: Option<(String, String)>,
}

impl Broker {
    fn new(replies: &[&str], answers: Option<(&str, &str)>) -> Broker {
        Broker {
            inner: ScriptedModel::with_replies(
                replies.iter().map(|r| ScriptedModel::text_reply(r)).collect(),
            ),
            answers: answers.map(|(e, m)| (e.to_string(), m.to_string())),
        }
    }
}

impl ModelPort for Broker {
    fn call<'a>(
        &'a self,
        endpoint: &'a EndpointName,
        body_json: &'a str,
    ) -> BoxFuture<'a, Result<ModelReply, ModelError>> {
        self.inner.call(endpoint, body_json)
    }

    fn resolves(&self, _asked: &str) -> Option<(String, String)> {
        self.answers.clone()
    }
}

fn booted(model: Rc<dyn ModelPort>, files: &[(&str, &str)]) -> Rc<RefCell<App>> {
    let ports = Ports {
        model,
        store: Rc::new(MemStore::default()),
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
        files.iter().map(|(n, t)| (n.to_string(), t.to_string())).collect(),
    );
    // As the page does it: a stage with no brief refuses to be entered.
    common::brief(&mut app);
    Rc::new(RefCell::new(app))
}

fn body(app: &Rc<RefCell<App>>, path: &str) -> String {
    handle(&mut app.borrow_mut(), Request::get(path)).body
}

/// `model: local` in the file, `openrouter` chosen in Settings. Both facts are
/// stated and the resolved one leads, because the resolved one is what the
/// tokens get spent on.
#[test]
fn the_card_states_what_the_next_turn_really_calls() {
    let file = "---\nname: main\ndescription: the lead\nmodel: local\ntools: []\n---\nbody";
    let app = booted(
        Rc::new(Broker::new(&[], Some(("openrouter", "openai/gpt-4o-mini")))),
        &[("main", file)],
    );
    let listing = body(&app, "/agents");
    assert!(
        listing.contains("Next turn: openai/gpt-4o-mini, at the openrouter endpoint"),
        "the card says what the call will reach: {listing}"
    );
    assert!(
        listing.contains("its file asks for local, and the choice in Settings overrides it"),
        "…and that the file asked for something else: {listing}"
    );
    assert!(
        !listing.contains("Model: local"),
        "the file's field is never printed as if it were the answer: {listing}"
    );
}

/// The file gets what it asked for. Nothing says "overrides", because nothing
/// did — a card that cried override on every agreement would be the same defect
/// pointing the other way.
#[test]
fn a_file_that_gets_its_own_endpoint_is_not_reported_as_overridden() {
    let file = "---\nname: main\ndescription: the lead\nmodel: local\ntools: []\n---\nbody";
    let app = booted(
        Rc::new(Broker::new(&[], Some(("local", "gemma-3-12b")))),
        &[("main", file)],
    );
    let listing = body(&app, "/agents");
    assert!(
        listing.contains("Next turn: gemma-3-12b, at the local endpoint its file asks for"),
        "{listing}"
    );
    assert!(!listing.contains("overrides"), "nothing was overridden: {listing}");
}

/// AN AGENT FILE THAT NAMES NO MODEL MUST NOT PRINT A WORD THAT LOOKS LIKE ONE.
/// It used to read "Uses the endpoint's default model", which names nothing;
/// with a port that cannot say, the honest answer is where the decision is made
/// and no invented id.
#[test]
fn a_file_naming_no_endpoint_gets_no_invented_model_id() {
    let file = "---\nname: main\ndescription: the lead\ntools: []\n---\nbody";
    let quiet = ScriptedModel::with_replies(Vec::new());
    let app = booted(Rc::new(quiet), &[("main", file)]);
    let listing = body(&app, "/agents");
    assert!(
        listing.contains("Its file names no endpoint, so the one chosen in Settings decides"),
        "{listing}"
    );
    assert!(!listing.contains("default model"), "it named nothing: {listing}");
}

/// THE LOOP, AND WHO IT HANDS WORK TO, ON THE FACE OF THE CARD. Both were
/// inside `<details>`, which is why the walk found neither. The assertion is
/// positional: the text has to appear BEFORE the first disclosure opens.
#[test]
fn the_card_names_its_loop_and_its_delegation_outside_any_fold() {
    let main = "---\nname: main\ndescription: the lead\nstages: [plan, work, verify]\n\
                tools: [researcher]\n---\nbody";
    let helper = "---\nname: researcher\ndescription: answers one question\ntools: []\n---\nbody";
    let app = booted(
        Rc::new(ScriptedModel::with_replies(Vec::new())),
        &[("main", main), ("researcher", helper)],
    );
    let listing = body(&app, "/agents");
    let open = listing.find("<details").expect("the card still has its folds");
    let face = &listing[..open];
    assert!(face.contains("Runs in stages: plan → work → verify."), "{face}");
    assert!(
        face.contains("Other agents it can hand work to: researcher"),
        "delegation is legible without hunting: {face}"
    );
    // …and an agent that declares none says so in words, not by omission.
    assert!(
        listing.contains("Runs no stages: it works and answers in one go"),
        "{listing}"
    );
}

/// EVERY STAGE BLOCK CARRIES ITS STAGE'S NAME. All four wore `Note:`, so the
/// conversation showed one agent answering three times in a row with nothing on
/// screen naming the loop that asked it. The label is folded out of the
/// `core.stage_entered` fact the log already holds (I8).
#[test]
fn the_conversation_labels_each_stage_with_its_name() {
    let file = "---\nname: main\ndescription: the lead\nstages: [plan, work, critique]\n\
                tools: []\n---\nbody";
    let app = booted(
        Rc::new(ScriptedModel::with_replies(
            ["OUTCOME — the file exists.", "I wrote it.", "Nothing is missing. Done."]
                .iter()
                .map(|r| ScriptedModel::text_reply(r))
                .collect(),
        )),
        &[("main", file)],
    );
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", "write a note")]),
    );
    block_on(drive(Rc::clone(&app))).expect("the turn runs");
    let chat = body(&app, "/chat");
    for label in ["Plan stage", "Work stage", "Critique stage"] {
        assert!(chat.contains(label), "no `{label}` in the conversation: {chat}");
    }
}
