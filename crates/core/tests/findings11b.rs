//! The 11b walk's findings, each as the behaviour it asked for, through the
//! seam on the host (I3): the chat pane's identity line following a swap in
//! both directions, `Stop waiting` releasing a deferred swap, the board naming
//! an agent written here, the Run box refusing to be another agent's shell,
//! and the "Folder name" field actually deciding a folder.

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{
    DenyAllNet, FakeShell, FixedClock, MemKv, MemStore, ScriptedAgents, ScriptedModel, SeededRng,
};
use core::{boot, drive, handle, install_agents, pump, App, Ports};
use kernel::{Event, EventId, EventKind, Request, Timestamp};

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

const AT: Timestamp = Timestamp(1_753_800_000_000);

fn shipped() -> Vec<(String, String)> {
    vec![(
        "main".to_string(),
        "---\nname: main\ndescription: the shipped lead\ntools: []\n---\nSHIPPED PROMPT".into(),
    )]
}

fn booted() -> Rc<RefCell<App>> {
    let mut app = block_on(boot(Ports {
        model: Rc::new(ScriptedModel::with_replies(Vec::new())),
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(AT)),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: Rc::new(FakeShell::new()),
        agents: Rc::new(ScriptedAgents::none()),
    }))
    .expect("boot succeeds");
    install_agents(&mut app, shipped());
    Rc::new(RefCell::new(app))
}

fn body(app: &Rc<RefCell<App>>, req: Request) -> String {
    handle(&mut app.borrow_mut(), req).body
}

fn author(app: &Rc<RefCell<App>>, name: &str, text: &str) -> kernel::Response {
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/agents", &[("name", name), ("text", text)]),
    )
}

fn asked(text: &str) -> Event {
    Event {
        id: EventId(0),
        seq: 0,
        at: AT,
        kind: EventKind::UserMessage {
            text: text.into(),
            agent: String::new(),
            from: String::new(),
        },
    }
}

/// FINDING 3. The chat pane's identity line is part of the CONVERSATION's own
/// projection, so the moment an override installs it must name the new file —
/// and the moment it is deleted, the shipped one again. Two projections of one
/// agent disagreeing on screen is what the turn boundary exists to prevent.
#[test]
fn the_chat_header_follows_a_swap_in_both_directions() {
    let app = booted();
    let before = body(&app, Request::get("/chat"));
    assert!(before.contains("the shipped lead"), "{before}");

    author(
        &app,
        "main",
        "---\nname: main\ndescription: the browser lead\ntools: []\n---\nBROWSER PROMPT",
    );
    let after = body(&app, Request::get("/chat"));
    assert!(after.contains("the browser lead"), "{after}");
    assert!(!after.contains("the shipped lead"), "{after}");

    handle(
        &mut app.borrow_mut(),
        Request::post_form("/agents/delete", &[("name", "main")]),
    );
    let reverted = body(&app, Request::get("/chat"));
    assert!(reverted.contains("the shipped lead"), "{reverted}");
    assert!(!reverted.contains("the browser lead"), "{reverted}");
}

/// FINDING 4. `Stop waiting` says the turn is over, so the turn must BE over:
/// a task left outstanding defers every agent swap indefinitely, and an edit
/// saved mid-flight stayed uninstalled until a reload.
#[test]
fn stopping_the_wait_ends_the_turn_and_releases_the_deferred_swap() {
    let app = booted();
    pump(&mut app.borrow_mut(), asked("what is the capital of France?"));
    author(
        &app,
        "main",
        "---\nname: main\ndescription: edited\ntools: []\n---\nEDITED PROMPT",
    );
    let mid = body(&app, Request::get("/agents"));
    assert!(!mid.contains("EDITED PROMPT"), "deferred mid-turn: {mid}");

    let stopped = handle(&mut app.borrow_mut(), Request::post_form("/chat/stop", &[]));
    assert_eq!(stopped.status, 200, "{}", stopped.body);
    // The transcript stops claiming a turn is running the moment it is stopped.
    assert!(!stopped.headers.iter().any(|(k, _)| k == "x-turn"), "still pending");
    assert!(stopped.body.contains("stopped waiting"), "{}", stopped.body);

    block_on(drive(Rc::clone(&app))).expect("the stop is pumped");
    let after = body(&app, Request::get("/agents"));
    assert!(after.contains("EDITED PROMPT"), "the swap landed: {after}");
}

/// The same boundary one step earlier: between the seam ACCEPTING an utterance
/// and the async half pumping it, `task` is still None — and a save landing in
/// that window swapped the agent under a turn already accepted (the browser
/// hits it at ~100ms).
#[test]
fn an_edit_saved_before_the_turn_is_pumped_is_deferred_too() {
    let app = booted();
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", "what is the capital of France?")]),
    );
    author(
        &app,
        "main",
        "---\nname: main\ndescription: edited\ntools: []\n---\nEDITED PROMPT",
    );
    let queued = body(&app, Request::get("/agents"));
    assert!(queued.contains("SHIPPED PROMPT"), "accepted, not yet taken: {queued}");
    assert!(!queued.contains("EDITED PROMPT"), "{queued}");
}

/// FINDING 5. One agent, one origin. The board used to say "from
/// public/agents/" on every row, including rows for agents written in this
/// browser — contradicting the Agents card three panels below it.
#[test]
fn the_board_names_an_agent_written_here_as_written_here() {
    let app = booted();
    author(
        &app,
        "scribe",
        "---\nname: scribe\ndescription: writes\ntools: []\n---\nYou write.",
    );
    let board = body(&app, Request::get("/board"));
    let (_, scribe) = board.split_once("data-agent=\"scribe\"").expect("a row: {board}");
    let row = scribe.split("data-agent").next().unwrap_or_default();
    // R4-18: ONE wording for this badge — the tab strip says the same.
    assert!(row.contains("written here"), "{row}");
    assert!(!row.contains("public/agents/"), "{row}");
    // …and the two it did not write still say where they came from.
    assert!(board.contains("built in to this build"), "{board}");
}

/// FINDING 9. The Run box is this page's own shell. With another agent
/// selected it executed in this page's space while the prose beside it
/// described the other agent's, so it refuses instead — and says the way round.
#[test]
fn a_command_typed_for_another_agent_is_refused_not_run_in_mine() {
    let app = booted();
    let read = handle(
        &mut app.borrow_mut(),
        Request::get("/terminal").with_header("x-agent", "summarizer"),
    );
    assert!(
        read.headers.iter().any(|(k, v)| k == "x-typeable" && v == "0"),
        "{:?}",
        read.headers
    );
    let refused = handle(
        &mut app.borrow_mut(),
        Request::post_form("/terminal", &[("command", "whoami")])
            .with_header("x-agent", "summarizer"),
    );
    assert_eq!(refused.status, 400, "{}", refused.body);
    assert!(refused.body.contains("main"), "{}", refused.body);
    let ran = body(&app, Request::get("/terminal").with_header("x-agent", "main"));
    assert!(!ran.contains("whoami"), "nothing ran: {ran}");
}

/// FINDING 6. The "Folder name" field decides the folder: an empty
/// frontmatter `name:` falls back to it rather than erroring, and a field that
/// disagrees with the frontmatter is refused rather than silently ignored.
#[test]
fn the_folder_name_field_decides_the_folder_or_says_it_cannot() {
    let app = booted();
    let saved = author(
        &app,
        "scribe",
        "---\nname: \ndescription: writes\ntools: []\n---\nYou write.",
    );
    assert_eq!(saved.status, 200, "{}", saved.body);
    assert!(core::agent_names(&app.borrow()).contains(&"scribe".to_string()));

    let refused = author(
        &app,
        "scribe",
        "---\nname: totally-different\ndescription: x\ntools: []\n---\nY",
    );
    assert_eq!(refused.status, 400, "{}", refused.body);
    assert!(refused.body.contains("totally-different"), "{}", refused.body);
    assert!(
        !core::agent_names(&app.borrow()).contains(&"totally-different".to_string()),
        "nothing was saved under a name the person did not type"
    );
}
