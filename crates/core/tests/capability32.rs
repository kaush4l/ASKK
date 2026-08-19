//! INCREMENT 32 — THE SAME QUESTION, IN THE FOUR PLACES 29 DID NOT REACH.
//!
//! 29 made `agents::card_sentences::can` the one predicate behind the task doors, the launcher
//! and the Commands pane. A walk of the deployed build then found the same
//! defect four more times, because the predicate had not reached them:
//!
//! 1. The Commands pane told `summarizer` — `engine: base`, no space, NO TOOLS
//!    AT ALL — that it "can read this Linux but not change it", one sentence
//!    after saying it has no folder. An empty toolbox cannot read either.
//! 2. …and the board's eight cards differed in name and status word alone, so
//!    the four agents you can hand a task to and the four you cannot were
//!    indistinguishable until you selected one and read the launcher.
//!
//! The Dashboard's starter tasks are the other half and they are asserted where
//! they live (`crates/ui/src/board/examples.rs`), off the same three attributes this
//! file proves the board publishes. Shipped files, never fixtures: the defect
//! was that the shipped roster and the shipped copy disagreed.

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{
    DenyAllNet, FakeShell, FixedClock, MemKv, MemStore, ScriptedAgents, ScriptedModel, SeededRng,
};
use core::{boot, handle, install_agents, App, Ports};
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

const SHIPPED: [(&str, &str); 8] = [
    ("ask", include_str!("../../agent/tests/agents/ask.md")),
    ("author", include_str!("../../agent/tests/agents/author.md")),
    ("builder", include_str!("../../agent/tests/agents/builder.md")),
    ("critic", include_str!("../../agent/tests/agents/critic.md")),
    ("main", include_str!("../../../public/agents/main/agent.md")),
    ("researcher", include_str!("../../agent/tests/agents/researcher.md")),
    ("scout", include_str!("../../agent/tests/agents/scout.md")),
    ("summarizer", include_str!("../../agent/tests/agents/summarizer.md")),
];

fn booted() -> Rc<RefCell<App>> {
    let mut app = block_on(boot(Ports {
        model: Rc::new(ScriptedModel::with_replies(Vec::new())),
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
        SHIPPED.iter().map(|(n, t)| (n.to_string(), t.to_string())).collect(),
    );
    Rc::new(RefCell::new(app))
}

fn board(app: &Rc<RefCell<App>>) -> String {
    handle(&mut app.borrow_mut(), Request::get("/board")).body
}

/// One agent's row out of the board, up to the next row.
fn row(page: &str, who: &str) -> String {
    let at = page.find(&format!("data-agent=\"{who}\"")).unwrap_or_else(|| panic!("no {who}"));
    let rest = &page[at..];
    rest.find("class=\"agent-row").map_or(rest, |end| &rest[..end]).to_string()
}

fn attr(page: &str, who: &str, name: &str) -> String {
    let row = row(page, who);
    let (_, rest) = row
        .split_once(&format!("{name}=\""))
        .unwrap_or_else(|| panic!("{who} has no {name}: {row}"));
    rest.split_once('"').map(|(v, _)| v.to_string()).unwrap()
}

/// THE BOARD SAYS WHICH FOUR TAKE A TASK. It is the one view where agents are
/// compared, and it said nothing about the difference that decides whether the
/// Dashboard will even draw a Start control.
#[test]
fn the_board_card_says_whether_there_is_a_task_to_give_this_agent() {
    let page = board(&booted());
    for who in ["main", "builder", "researcher"] {
        let said = row(&page, who);
        assert!(said.contains("you can give it a task, and it runs commands"), "{who}: {said}");
    }
    let author = row(&page, "author");
    assert!(author.contains("you can give it a task; it runs no commands"), "{author}");
    for who in ["ask", "critic", "scout"] {
        let said = row(&page, who);
        assert!(said.contains("no task to give it — every tool it has reads"), "{who}: {said}");
        assert!(!said.contains("you can give it a task"), "{who}: {said}");
    }
    // AN EMPTY TOOLBOX IS NOT A READING ONE: `summarizer` has no tools, so the
    // sentence about what its tools read is not said about it.
    let summarizer = row(&page, "summarizer");
    assert!(summarizer.contains("no task to give it — it has no tools at all"), "{summarizer}");
    assert!(!summarizer.contains("every tool it has reads"), "{summarizer}");
    // …and the one agent that laps says so, where nothing else on the board did.
    assert!(row(&page, "builder").contains("over up to 4 passes"), "builder laps");
    assert!(!row(&page, "main").contains("passes"), "main does not");
}

/// THE THREE FACTS THE STARTER TASKS ARE CHOSEN FROM, published once. The
/// Dashboard picks its three examples off these attributes, so a task offered is
/// a task some tool this agent really resolved to can finish.
#[test]
fn every_board_row_publishes_the_toolbox_the_launcher_chooses_tasks_from() {
    let page = board(&booted());
    for (who, can, laps) in [
        ("main", "run", "1"),
        ("builder", "run", "4"),
        ("researcher", "run", "1"),
        ("author", "change", "1"),
        ("ask", "read", "1"),
        ("summarizer", "read", "1"),
    ] {
        assert_eq!(attr(&page, who, "data-can"), can, "{who}");
        assert_eq!(attr(&page, who, "data-laps"), laps, "{who}");
    }
    // The names are the RESOLVED ones, not the file's line: `researcher` names
    // no tools at all and gets every built-in plus its space's set.
    let tools = |who| attr(&page, who, "data-toolset");
    assert!(tools("main").contains("exec") && tools("main").contains("write_file"), "main");
    // `web_search` stands where `write_agent` stood: the contrast being drawn
    // is "a named list resolves to what it named, an empty one to every
    // built-in", and it needs a built-in `main` has NOT asked for. `main` names
    // `write_agent` since increment 27, so the assertion moved to a tool it
    // still does not name rather than being weakened or dropped.
    assert!(!tools("main").contains("web_search"), "main's list does not name it");
    assert!(tools("researcher").contains("web_search"), "an empty list is every built-in");
    assert_eq!(
        tools("author"),
        "list_agents, read_agent, write_agent, list_skills, read_skill",
        "the allowlist IS it"
    );
    assert_eq!(tools("summarizer"), "", "engine: base is the empty toolbox");
    // A peer is not a tool the examples can be built on, but it is in the list
    // the model sees; what matters here is that the list is the resolved one.
    assert!(tools("builder").contains("critic"), "builder: {}", tools("builder"));
}

/// THE COMMANDS PANE STOPS CREDITING AN EMPTY TOOLBOX WITH READING. Two
/// consecutive sentences over `summarizer` said it runs no commands because it
/// has no folder, and then that it "can read this Linux" — which it cannot, by
/// any route. `author`, which HAS tools, got the correct variant: the branch was
/// inverted for the agent with less capability.
#[test]
fn the_commands_pane_says_no_tools_where_there_are_none() {
    let app = booted();
    let why = |who: &str| {
        let res =
            handle(&mut app.borrow_mut(), Request::get("/terminal").with_header("x-agent", who));
        res.headers
            .iter()
            .find(|(k, _)| k == "x-typeable-why")
            .map(|(_, v)| v.clone())
            .unwrap_or_default()
    };
    let none = why("summarizer");
    assert!(none.contains("summarizer has no tools at all"), "{none}");
    assert!(!none.contains("can read this Linux"), "it cannot read it either: {none}");
    // The agent that really does read one keeps the sentence that is true of it.
    let reads = why("critic");
    assert!(reads.contains("critic has no shell — it can read this Linux"), "{reads}");
    // …and an agent that can change but not run is still told the third thing.
    let changes = why("author");
    assert!(changes.contains("it cannot run a command here"), "{changes}");
}
