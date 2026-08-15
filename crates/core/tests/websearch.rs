//! `web_search` as a whole turn through the seam, on the host with in-memory
//! ports (I3): the model calls it, the `NetPort` answers — or refuses — and
//! the result is a fact the trace projects like any other tool call (I8).

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{
    CannedNet, DenyAllNet, FixedClock, MemStore, ScriptedAgents, ScriptedModel, SeededRng,
};
use core::{boot, drive, handle, install_agents, App, Ports};
use kernel::{NetPort, Request, Timestamp};

const ANSWER: &str = r#"{"results": [
  {"url": "https://www.rust-lang.org/", "title": "Rust", "content": "A language empowering everyone."}
]}"#;

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

fn booted(net: Rc<dyn NetPort>, replies: &[&str]) -> Rc<RefCell<App>> {
    let ports = Ports {
        model: Rc::new(ScriptedModel::with_replies(
            replies.iter().map(|r| ScriptedModel::text_reply(r)).collect(),
        )),
        store: Rc::new(MemStore::default()),
        net,
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(adapters_test::MemKv::new()),
        workspace: Rc::new(adapters_test::FakeShell::new()),
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

fn ask(app: &Rc<RefCell<App>>, message: &str) {
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", message)]),
    );
    block_on(drive(Rc::clone(app))).expect("the turn runs");
}

fn trace(app: &Rc<RefCell<App>>) -> String {
    handle(&mut app.borrow_mut(), Request::get("/tools")).body
}

/// The turn the increment exists for: a query goes out through the port, and
/// the few lines that come back are what the model answers from.
#[test]
fn a_search_goes_through_the_net_port_and_comes_back_short() {
    let net = Rc::new(CannedNet::answering(200, ANSWER));
    let app = booted(
        Rc::clone(&net) as Rc<dyn NetPort>,
        &[
            "web_search({\"query\": \"rust lang\"})",
            "Rust is at https://www.rust-lang.org/.",
        ],
    );
    ask(&app, "where is rust");
    assert_eq!(
        net.asked(),
        vec!["/search?q=rust%20lang&format=json".to_string()],
        "the query the model typed, encoded by the pure path builder"
    );
    // The FACT, not the rendering: the trace is a projection of this (I8).
    let logged = core::log_kinds(&app.borrow())
        .into_iter()
        .find_map(|k| match k {
            kernel::EventKind::ToolInvoked { tool, args, ok, output } if tool.0 == "web_search" => {
                Some((args, ok, output))
            }
            _ => None,
        })
        .expect("the search is a fact in the log");
    assert!(logged.1, "it worked");
    assert!(logged.0.contains("rust lang"), "with the arguments it was called with");
    assert_eq!(logged.2, "1. Rust — https://www.rust-lang.org/\n   A language empowering everyone.");
    let shown = trace(&app);
    assert!(shown.contains("web_search"), "and the trace shows it: {shown}");
}

/// The default-deny posture, in words a model can act on. `DenyAllNet` is the
/// same answer an empty allowlist gives, which is what an unset setting is.
#[test]
fn an_unconfigured_endpoint_refuses_in_words_and_never_returns_nothing_found() {
    let app = booted(
        Rc::new(DenyAllNet),
        &["web_search({\"query\": \"rust\"})", "I cannot search from here."],
    );
    ask(&app, "search for rust");
    let said = core::log_kinds(&app.borrow())
        .into_iter()
        .find_map(|k| match k {
            kernel::EventKind::ToolInvoked { tool, ok, output, .. } if tool.0 == "web_search" => {
                Some((ok, output))
            }
            _ => None,
        })
        .expect("a refused search is still a fact");
    assert!(!said.0, "it did not work");
    assert!(said.1.contains("Settings"), "and it names where to fix it: {}", said.1);
    assert!(
        !said.1.contains("found nothing"),
        "a refusal must never read as an empty web"
    );
}

/// A search with no query is refused before the port is touched — the
/// `read_agent` rule: an unreadable argument is never delivered empty.
#[test]
fn an_empty_query_is_refused_without_a_call() {
    let net = Rc::new(CannedNet::answering(200, ANSWER));
    let app = booted(
        Rc::clone(&net) as Rc<dyn NetPort>,
        &["web_search({})", "I need something to look for."],
    );
    ask(&app, "search");
    assert!(net.asked().is_empty(), "nothing left the browser");
    assert!(trace(&app).contains("web_search"), "and the attempt is still on the record");
}

/// A public instance refusing a stranger is the endpoint's answer, not ours.
#[test]
fn a_403_is_reported_as_the_endpoint_refusing_rather_than_as_no_results() {
    let net = Rc::new(CannedNet::answering(403, "forbidden"));
    let app = booted(
        Rc::clone(&net) as Rc<dyn NetPort>,
        &["web_search({\"query\": \"rust\"})", "That endpoint refused."],
    );
    ask(&app, "search for rust");
    let output = core::log_kinds(&app.borrow())
        .into_iter()
        .find_map(|k| match k {
            kernel::EventKind::ToolInvoked { tool, output, .. } if tool.0 == "web_search" => {
                Some(output)
            }
            _ => None,
        })
        .expect("the call is a fact");
    assert!(output.contains("403"), "the status it actually got: {output}");
}
