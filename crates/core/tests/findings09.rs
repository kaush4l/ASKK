//! The increment-09 walk's findings, pinned as behaviour so they cannot come
//! back. All on the host with in-memory ports (I3).

use std::cell::{Cell, RefCell};
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{DenyAllNet, FixedClock, MemKv, MemStore, ScriptedAgents, ScriptedModel, SeededRng};
use core::{boot, drive, handle, install_agents_as, App, Ports};
use kernel::{BoxFuture, EndpointName, ModelError, ModelPort, ModelReply, Request, Timestamp};

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

/// A model that answers everything except its `fails_on`th call — which is how
/// a BACKGROUND summarisation fails while the endpoint is otherwise fine.
struct FlakyModel {
    replies: RefCell<Vec<String>>,
    calls: Cell<usize>,
    fails_on: usize,
    prompts: RefCell<Vec<String>>,
}

impl FlakyModel {
    fn new(replies: &[&str], fails_on: usize) -> Rc<FlakyModel> {
        Rc::new(FlakyModel {
            replies: RefCell::new(replies.iter().map(|r| r.to_string()).collect()),
            calls: Cell::new(0),
            fails_on,
            prompts: RefCell::new(Vec::new()),
        })
    }
}

impl ModelPort for FlakyModel {
    fn call<'a>(
        &'a self,
        _endpoint: &'a EndpointName,
        body_json: &'a str,
    ) -> BoxFuture<'a, Result<ModelReply, ModelError>> {
        self.calls.set(self.calls.get() + 1);
        self.prompts.borrow_mut().push(body_json.to_string());
        if self.calls.get() == self.fails_on {
            return Box::pin(std::future::ready(Err(ModelError::Provider {
                status: 503,
                message: "summariser unavailable".into(),
            })));
        }
        let mut replies = self.replies.borrow_mut();
        let reply = match replies.is_empty() {
            true => "…".to_string(),
            false => replies.remove(0),
        };
        drop(replies);
        Box::pin(std::future::ready(Ok(ModelReply {
            body_json: ScriptedModel::text_reply(&reply),
            usage: None,
        })))
    }
}

fn agent_files() -> Vec<(String, String)> {
    vec![(
        "main".to_string(),
        "---\nname: main\ndescription: the lead\ntools: []\ncompact_at: 4\nkeep_recent: 2\n\
         ---\nbody"
            .to_string(),
    )]
}

fn booted(model: Rc<dyn ModelPort>) -> Rc<RefCell<App>> {
    let ports = Ports {
        model,
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: Rc::new(adapters_test::FakeShell::new()),
        agents: Rc::new(ScriptedAgents::none()),
    };
    let mut app = block_on(boot(ports)).expect("boot succeeds");
    install_agents_as(&mut app, agent_files(), "main");
    Rc::new(RefCell::new(app))
}

fn say(app: &Rc<RefCell<App>>, message: &str) {
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", message)]),
    );
    block_on(drive(Rc::clone(app))).expect("the turn drives");
}

fn body(app: &Rc<RefCell<App>>, path: &str) -> String {
    handle(&mut app.borrow_mut(), Request::get(path)).body
}

/// Finding 1. With the window at the trigger, exactly ONE request went out —
/// the summarisation — and the transcript showed the user's question followed
/// by an endpoint error. Their question was never asked. Now: the compaction
/// costs a compaction, the question is put to the model, the answer comes
/// back, and the failed summarisation is reported as what it was.
#[test]
fn a_failed_compaction_still_asks_the_question_and_says_what_failed() {
    // 1: first turn's answer. 2: the summarisation — fails. 3: the question.
    let model = FlakyModel::new(&["one", "two"], 2);
    let app = booted(Rc::clone(&model) as Rc<dyn ModelPort>);
    say(&app, "hello");
    say(&app, "what is the port?");

    assert_eq!(model.calls.get(), 3, "the question went out after the failure");
    let asked = model.prompts.borrow().last().cloned().unwrap_or_default();
    assert!(asked.contains("what is the port?"), "the question was ASKED: {asked}");

    let chat = body(&app, "/chat");
    assert!(chat.contains("two"), "and answered: {chat}");
    assert!(
        chat.contains("background summarisation of the older turns failed"),
        "the failure is named for what it was: {chat}"
    );
    assert!(
        !chat.contains("The turn failed before it produced an answer"),
        "…and never as the user's own turn failing: {chat}"
    );
    // The window was left alone, so the next turn tries again.
    let held = core::window(&app.borrow());
    assert!(
        !held.iter().any(|l| l.contains("Summary of the conversation")),
        "nothing was summarised: {held:?}"
    );
}

/// Finding 2. The denominator is the TRIGGER. "10 of 10 entries … compaction
/// runs at 8" was two numbers contradicting each other in one sentence.
#[test]
fn the_memory_line_counts_against_the_trigger_not_against_itself() {
    let model = FlakyModel::new(&["one", "two", "three"], 0);
    let app = booted(Rc::clone(&model) as Rc<dyn ModelPort>);
    say(&app, "hello");
    let chat = body(&app, "/chat");
    assert!(chat.contains("Working memory: 3 of 4 entries"), "{chat}");
    assert!(chat.contains("compaction runs at 4 entries"), "{chat}");
}

/// Findings 3 and 5. Both panes were GLOBAL: the space pane said "Space:
/// research" with the one agent that has no space selected, and the tools pane
/// showed that agent five calls it never made.
#[test]
fn the_space_and_tool_panes_are_about_the_agent_you_selected() {
    let model = FlakyModel::new(&["list_agents()", "one agent"], 0);
    let app = booted(Rc::clone(&model) as Rc<dyn ModelPort>);
    say(&app, "who is here?");

    let ask = |path: &str, who: &str| {
        handle(
            &mut app.borrow_mut(),
            Request::get(path).with_header("x-agent", who),
        )
        .body
    };
    let theirs = ask("/space", "summarizer");
    assert!(theirs.contains("s file names no space"), "{theirs}");
    assert!(theirs.contains("summarizer"), "{theirs}");
    assert!(!theirs.contains("Space: research"), "{theirs}");

    let trace = ask("/tools", "summarizer");
    assert!(trace.contains("runs in its own Worker"), "{trace}");
    assert!(!trace.contains("list_agents("), "not main's calls: {trace}");
    let mine = ask("/tools", "main");
    assert!(mine.contains("list_agents("), "main's own calls are still there: {mine}");
}
