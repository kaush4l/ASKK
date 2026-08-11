//! One whole tool turn through the seam, on the host with in-memory ports
//! (I3): the model calls a tool, the tool runs, the result goes back to the
//! model, and the answer AND the trace are both projections of the log.

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

/// A booted app whose model says exactly these things, in order, and whose
/// agents are the compiled-in built-ins.
fn booted(replies: &[&str]) -> Rc<RefCell<App>> {
    let ports = Ports {
        model: Rc::new(ScriptedModel::with_replies(
            replies.iter().map(|r| ScriptedModel::text_reply(r)).collect(),
        )),
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(adapters_test::MemKv::new()),
        agents: Rc::new(ScriptedAgents::none()),
    };
    let mut app = block_on(boot(ports)).expect("boot succeeds");
    // A `main` agent with an empty `tools:` list gets every built-in — the
    // Python rule, and what decides the toolbox since increment 06.
    install_agents(
        &mut app,
        vec![(
            "main".to_string(),
            "---\nname: main\ndescription: the lead\ntools: []\n---\nbody".to_string(),
        )],
    );
    Rc::new(RefCell::new(app))
}

fn ask(app: &Rc<RefCell<App>>, message: &str) {
    handle(
        &mut app.borrow_mut(),
        Request {
            method: "POST".into(),
            path: "/chat".into(),
            headers: vec![(
                "content-type".into(),
                "application/x-www-form-urlencoded".into(),
            )],
            body: format!("message={}", message.replace(' ', "+")),
        },
    );
    block_on(drive(Rc::clone(app))).expect("the turn runs");
}

fn body(app: &Rc<RefCell<App>>, path: &str) -> String {
    handle(&mut app.borrow_mut(), Request::get(path)).body
}

/// The turn the increment exists for: call → result → answer, with the call
/// and its output visible to the user.
#[test]
fn the_model_calls_a_tool_and_the_result_comes_back_into_the_answer() {
    let app = booted(&[
        "list_agents()",
        "One agent is loaded: summarizer.",
    ]);
    ask(&app, "which agents are loaded");

    let trace = body(&app, "/tools");
    assert!(trace.contains("list_agents({})"), "the call, with its args: {trace}");
    assert!(trace.contains("summarizer"), "and what came back: {trace}");

    let chat = body(&app, "/chat");
    assert!(chat.contains("One agent is loaded"), "the answer: {chat}");
    assert!(
        !chat.contains("x-turn"),
        "sanity: the body is the transcript, not headers"
    );
    let pending = handle(&mut app.borrow_mut(), Request::get("/chat"))
        .headers
        .iter()
        .any(|(k, v)| k == "x-turn" && v == "pending");
    assert!(!pending, "the turn is over once the answer lands");
}

/// A call the toolbox cannot read is refused, the refusal goes back to the
/// model, and the model's corrected call runs. The user sees both.
#[test]
fn an_unreadable_call_is_refused_and_the_model_can_correct_it() {
    let app = booted(&[
        "read_agent({\"name\": \"the \"main\" one\"})",
        "read_agent({\"name\": \"summarizer\"})",
        "It compresses a conversation into a summary.",
    ]);
    ask(&app, "what does the summarizer do");

    let trace = body(&app, "/tools");
    assert!(
        trace.contains("Could not read the arguments"),
        "the refusal is a recorded result: {trace}"
    );
    assert!(
        trace.contains("read_agent({&quot;name&quot;: &quot;&lt;name&gt;&quot;})"),
        "quoting the tool's own usage line: {trace}"
    );
    assert!(trace.contains("summarizer"), "the corrected call ran: {trace}");
    assert!(
        body(&app, "/chat").contains("compresses a conversation"),
        "and the turn still reached an answer"
    );
}

/// Nothing was called, so the trace says exactly that — an empty panel with
/// no explanation is indistinguishable from a broken one.
#[test]
fn a_session_with_no_tool_calls_says_so() {
    let app = booted(&["Nothing to look up — the answer is 4."]);
    ask(&app, "what is two plus two");
    assert!(body(&app, "/tools").contains("No tool has been called yet."));
    assert!(body(&app, "/chat").contains("the answer is 4"));
}
