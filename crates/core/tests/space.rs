//! Increment 09 on the host (I3): one space, two agents that share NO memory,
//! and the three properties that makes true — a fact one records is in the
//! other's prompt, the space is read fresh rather than cached, and writes that
//! race leave the store valid and in agreement with what both agents hold.
//!
//! Two `App`s is the honest stand-in for two Workers: separate logs, separate
//! agent state, separate everything except the one injected `spaces` store —
//! exactly the split `AgentWorker` has in the browser.

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{DenyAllNet, FixedClock, MemStore, ScriptedAgents, ScriptedModel, SeededRng};
use core::{boot, drive, handle, install_agents_as, App, Ports};
use kernel::{BoxFuture, EndpointName, KvStore, ModelPort, ModelReply, Request, Timestamp};

mod slow;
use slow::{SlowKv, StepClock};

fn block_on<F: Future>(fut: F) -> F::Output {
    let mut fut = pin!(fut);
    let mut cx = Context::from_waker(Waker::noop());
    for _ in 0..1_000_000 {
        if let Poll::Ready(v) = fut.as_mut().poll(&mut cx) {
            return v;
        }
    }
    panic!("future not ready under in-memory ports");
}

/// A model that answers from a script AND keeps every request body — the only
/// way to assert what actually reached the model, rather than what a renderer
/// says reached it.
#[derive(Debug, Default)]
struct Recorder {
    replies: RefCell<Vec<String>>,
    seen: RefCell<Vec<String>>,
}

impl Recorder {
    fn with(replies: &[&str]) -> Rc<Recorder> {
        Rc::new(Recorder {
            replies: RefCell::new(
                replies.iter().map(|r| ScriptedModel::text_reply(r)).collect(),
            ),
            seen: RefCell::new(Vec::new()),
        })
    }
    fn last_prompt(&self) -> String {
        self.seen.borrow().last().cloned().unwrap_or_default()
    }
}

impl ModelPort for Recorder {
    fn call<'a>(
        &'a self,
        _endpoint: &'a EndpointName,
        body_json: &'a str,
    ) -> BoxFuture<'a, Result<ModelReply, kernel::ModelError>> {
        self.seen.borrow_mut().push(body_json.to_string());
        let mut replies = self.replies.borrow_mut();
        let body = match replies.is_empty() {
            true => ScriptedModel::text_reply("nothing scripted"),
            false => replies.remove(0),
        };
        Box::pin(std::future::ready(Ok(ModelReply {
            body_json: body,
            usage: None,
        })))
    }
}

/// Both agents name the SAME space; `main` also has the built-ins.
fn agent_files() -> Vec<(String, String)> {
    let file = |name: &str, space: &str| {
        (
            name.to_string(),
            format!("---\nname: {name}\ndescription: {name} does a thing\nspace: {space}\ntools: []\n---\nbody"),
        )
    };
    // The stray space is deliberate: " research " and "research" are one space.
    vec![file("main", "research"), file("researcher", " research ")]
}

fn booted(me: &str, model: Rc<dyn ModelPort>, spaces: Rc<dyn KvStore>) -> Rc<RefCell<App>> {
    booted_at(me, model, spaces, Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))))
}

fn booted_at(
    me: &str,
    model: Rc<dyn ModelPort>,
    spaces: Rc<dyn KvStore>,
    clock: Rc<dyn kernel::ClockPort>,
) -> Rc<RefCell<App>> {
    let ports = Ports {
        model,
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock,
        rng: Rc::new(SeededRng::seeded(7)),
        spaces,
        workspace: Rc::new(adapters_test::FakeShell::new()),
        agents: Rc::new(ScriptedAgents::none()),
    };
    let mut app = block_on(boot(ports)).expect("boot succeeds");
    install_agents_as(&mut app, agent_files(), me);
    Rc::new(RefCell::new(app))
}

fn ask(app: &Rc<RefCell<App>>, message: &str) {
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", message)]),
    );
    block_on(drive(Rc::clone(app))).expect("the turn drives");
}

fn inspector(app: &Rc<RefCell<App>>) -> String {
    let body = handle(&mut app.borrow_mut(), Request::get("/space")).body;
    block_on(drive(Rc::clone(app))).expect("the read drives");
    body
}

/// The increment's headline, on the host: `researcher` records a fact in its
/// own process, and `main` — which shares no memory with it — has that fact in
/// the very next prompt it sends, without asking anybody for it.
#[test]
fn a_fact_one_agent_records_is_in_the_other_agents_prompt() {
    let shared: Rc<dyn KvStore> = Rc::new(adapters_test::MemKv::new());
    let lead = Recorder::with(&["I will note that.", "The port is 8873."]);
    let sub = Recorder::with(&["remember({\"key\": \"omlx port\", \"value\": \"8873\"})", "Recorded."]);

    let researcher = booted("researcher", Rc::clone(&sub) as Rc<dyn ModelPort>, Rc::clone(&shared));
    ask(&researcher, "find the port and record it");

    let main = booted("main", Rc::clone(&lead) as Rc<dyn ModelPort>, Rc::clone(&shared));
    ask(&main, "what port is omlx on?");

    let prompt = lead.last_prompt();
    assert!(prompt.contains("omlx port: 8873"), "the fact reached the model: {prompt}");
    assert!(prompt.contains("space: research"), "{prompt}");
    assert!(
        prompt.contains("workspace: /root/spaces/research"),
        "the workspace is a real folder now, and the prompt says where: {prompt}"
    );
    // And nobody was delegated to: the answer came out of CONTEXT.
    let log = core::log_kinds(&main.borrow());
    assert!(
        !log.iter().any(|k| matches!(k, kernel::EventKind::ToolInvoked { .. })),
        "the lead answered from the space, not by calling anyone: {log:?}"
    );
}

/// Read FRESH, never cached: a fact written after `main`'s last turn is in its
/// next one, with nothing telling it to look (Python: the reason the clock is
/// not cached applies to a space twice over).
#[test]
fn a_later_write_by_a_peer_reaches_the_next_turn() {
    let shared: Rc<dyn KvStore> = Rc::new(adapters_test::MemKv::new());
    let lead = Recorder::with(&["first", "second"]);
    let sub = Recorder::with(&["post_note({\"note\": \"the docs page 404s\"})", "posted"]);
    let main = booted("main", Rc::clone(&lead) as Rc<dyn ModelPort>, Rc::clone(&shared));
    ask(&main, "hello");
    assert!(!lead.last_prompt().contains("404s"));

    let researcher = booted("researcher", sub as Rc<dyn ModelPort>, Rc::clone(&shared));
    ask(&researcher, "look at the docs");

    ask(&main, "anything new?");
    let prompt = lead.last_prompt();
    assert!(prompt.contains("recent notes"), "{prompt}");
    assert!(
        prompt.contains("[researcher] the docs page 404s"),
        "the note is attributed to whoever wrote it: {prompt}"
    );
}

/// An overwrite REPLACES, through the store as well as in memory: the prompt
/// holds the key exactly once and the old value is gone from both.
#[test]
fn an_overwrite_leaves_no_stale_value_in_the_store() {
    let shared: Rc<dyn KvStore> = Rc::new(adapters_test::MemKv::new());
    let model = Recorder::with(&[
        "remember({\"key\": \"port\", \"value\": \"8000\"})",
        "noted",
        "remember({\"key\": \"port\", \"value\": \"8873\"})",
        "noted",
        "done",
    ]);
    let main = booted("main", Rc::clone(&model) as Rc<dyn ModelPort>, Rc::clone(&shared));
    ask(&main, "record 8000");
    ask(&main, "no, 8873");
    ask(&main, "what is it?");

    let keys = block_on(shared.list_prefix("space/research/")).expect("the store reads");
    assert_eq!(keys, vec!["space/research/f/port".to_string()]);
    let prompt = model.last_prompt();
    assert_eq!(prompt.matches("port: 8873").count(), 1, "{prompt}");
    assert!(!prompt.contains("port: 8000"), "{prompt}");

    let panel = inspector(&main);
    assert!(panel.contains("8873"), "{panel}");
    assert!(!panel.contains("8000"), "{panel}");
    // The workspace sentence names the PANEL, not a direction: the rail puts
    // Workspace ABOVE Shared space from 1100px up, so "the Linux below" was
    // pointing the wrong way on every wide screen (12b walk, finding 1).
    assert!(
        panel.contains("a real folder in the Linux that Commands runs in")
            && !panel.contains("Linux below"),
        "{panel}"
    );
}

/// `forget` through the whole path: the key leaves the store, and asking again
/// says plainly that there was nothing to remove.
#[test]
fn forget_removes_the_key_and_reports_plainly_the_second_time() {
    let shared: Rc<dyn KvStore> = Rc::new(adapters_test::MemKv::new());
    let model = Recorder::with(&[
        "remember({\"key\": \"port\", \"value\": \"8873\"})",
        "noted",
        "forget({\"key\": \"port\"})",
        "gone",
        "forget({\"key\": \"port\"})",
        "still gone",
    ]);
    let main = booted("main", Rc::clone(&model) as Rc<dyn ModelPort>, shared.clone());
    ask(&main, "record it");
    ask(&main, "drop it");
    let keys = block_on(shared.list_prefix("space/research/")).expect("the store reads");
    assert!(keys.is_empty(), "the fact left the store too: {keys:?}");

    ask(&main, "drop it again");
    let prompt = model.last_prompt();
    assert!(
        prompt.contains("No fact called 'port'. The space holds: nothing"),
        "the refusal is what the model reads next: {prompt}"
    );
}

/// The Python's concurrency test, ported: fifty writes from two agents whose
/// stores interleave at every await, and afterwards the store is valid, holds
/// exactly the cap, and agrees with what BOTH agents have in memory.
///
/// `SlowKv` is what makes it a race at all — every operation yields once, so
/// one agent's read-then-write is interleaved with the other's, which is the
/// case a whole-document space would lose a write in.
#[test]
fn fifty_racing_writes_leave_the_store_valid_and_in_agreement() {
    let shared: Rc<dyn KvStore> = Rc::new(SlowKv::default());
    // Every note DIFFERENT, because identical notes are now one note (09
    // walk, finding 4) and the race this test exists for is about two writers
    // racing for a key, not about the dedupe.
    let calls: Vec<String> = (0..50)
        .map(|i| format!("post_note({{\"note\": \"working {i}\"}})"))
        .collect();
    let script: Vec<&str> = calls
        .iter()
        .flat_map(|call| [call.as_str(), "posted"])
        .collect();
    let clock: Rc<dyn kernel::ClockPort> = Rc::new(StepClock::default());
    let main = booted_at("main", Recorder::with(&script), Rc::clone(&shared), Rc::clone(&clock));
    let sub = booted_at("researcher", Recorder::with(&script), Rc::clone(&shared), clock);

    for i in 0..25 {
        for app in [&main, &sub] {
            handle(
                &mut app.borrow_mut(),
                Request::post_form("/chat", &[("message", &format!("turn {i}"))]),
            );
        }
        // Both loops in flight at once, interleaving inside the shared store.
        let (a, b) = (drive(Rc::clone(&main)), drive(Rc::clone(&sub)));
        let (ra, rb) = block_on(futures::future::join(a, b));
        (ra.expect("main drives"), rb.expect("researcher drives"));
    }

    let keys = block_on(shared.list_prefix("space/research/n/")).expect("the store reads");
    assert_eq!(keys.len(), 20, "the cap held under the race: {keys:?}");
    let mut stored = Vec::new();
    for key in &keys {
        let value = block_on(shared.get(key)).expect("readable").expect("present");
        assert!(
            value.starts_with("[main] working ") || value.starts_with("[researcher] working "),
            "every note is valid and attributed: {value}"
        );
        stored.push(value);
    }
    assert!(stored.iter().any(|n| n.starts_with("[main]")));
    assert!(stored.iter().any(|n| n.starts_with("[researcher]")));

    // …and in agreement with memory: both agents, refreshed, show the same
    // twenty notes the store holds.
    // The two panes differ only in WHOSE space they say it is (09 walk,
    // finding 3): the notes they show are the same twenty, because it is one
    // space seen from two agents.
    let (a, b) = (inspector(&main), inspector(&sub));
    let notes = |html: &str| html.split("<ul").nth(1).unwrap_or_default().to_string();
    assert_eq!(notes(&a), notes(&b), "two agents, one space");
    assert!(a.contains("data-agent=\"main\""), "{a}");
    assert!(b.contains("data-agent=\"researcher\""), "{b}");
    assert_eq!(a.matches("<li ").count(), 20, "{a}");
    for note in &stored {
        let (author, said) = note.trim_start_matches('[').split_once("] ").expect("attributed");
        assert!(
            a.contains(&format!("data-author=\"{author}\"")) && a.contains(said),
            "{note} is missing from {a}"
        );
    }
}
