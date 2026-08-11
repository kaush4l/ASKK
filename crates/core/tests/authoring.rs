//! Increment 11 through the whole seam, on the host with no browser (I3):
//! writing an agent, the same-name collision, the turn-boundary prompt swap,
//! deleting back to the shipped file, and the export round trip.

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

/// The `public/agents/` half of the world this test's browser was served.
fn shipped() -> Vec<(String, String)> {
    vec![(
        "main".to_string(),
        "---\nname: main\ndescription: the shipped lead\ntools: []\n---\nSHIPPED PROMPT".into(),
    )]
}

fn ports(replies: &[&str]) -> Ports {
    Ports {
        model: Rc::new(ScriptedModel::with_replies(
            replies.iter().map(|r| ScriptedModel::text_reply(r)).collect(),
        )),
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(AT)),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: Rc::new(FakeShell::new()),
        agents: Rc::new(ScriptedAgents::none()),
    }
}

fn booted(replies: &[&str]) -> Rc<RefCell<App>> {
    let mut app = block_on(boot(ports(replies))).expect("boot succeeds");
    install_agents(&mut app, shipped());
    Rc::new(RefCell::new(app))
}

fn body(app: &Rc<RefCell<App>>, req: Request) -> String {
    handle(&mut app.borrow_mut(), req).body
}

/// Author an agent the way the pane does: one whole `agent.md` in one field.
fn author(app: &Rc<RefCell<App>>, name: &str, text: &str) -> kernel::Response {
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/agents", &[("name", name), ("text", text)]),
    )
}

fn file_of(name: &str, prompt: &str) -> String {
    format!("---\nname: {name}\ndescription: written here\ntools: []\n---\n{prompt}")
}

/// The increment: a person writes an agent.md in the browser and the agent is
/// there — in the listing, in the roster the Workers are started from, and
/// marked as this browser's rather than this deploy's.
#[test]
fn an_agent_written_in_the_browser_joins_the_roster() {
    let app = booted(&[]);
    assert!(!core::agent_names(&app.borrow()).contains(&"scribe".to_string()));

    let response = author(&app, "scribe", &file_of("scribe", "You write things down."));
    assert_eq!(response.status, 200, "{}", response.body);

    let names = core::agent_names(&app.borrow());
    assert!(names.contains(&"scribe".to_string()), "{names:?}");
    let listing = body(&app, Request::get("/agents"));
    assert!(listing.contains("data-agent=\"scribe\""), "{listing}");
    assert!(
        listing.contains("Authored in this browser"),
        "an authored agent is named as one: {listing}"
    );
    assert!(
        listing.contains("Shipped in this deploy"),
        "…and a shipped one still says where it came from: {listing}"
    );
    // The grant is stated, because a space is what actually grants a shell.
    assert!(
        listing.contains("No space, so no workspace: it cannot run commands."),
        "{listing}"
    );
}

/// A file that will not load is refused where the person typing it is looking,
/// not swallowed into the skipped-agents list after the fact.
#[test]
fn an_agent_md_that_will_not_parse_is_refused_at_the_form() {
    let app = booted(&[]);
    let bad = author(&app, "scribe", "no frontmatter at all");
    assert_eq!(bad.status, 400);
    assert!(bad.body.contains("could not be read"), "{}", bad.body);
    assert!(!core::agent_names(&app.borrow()).contains(&"scribe".to_string()));

    let named = author(&app, "", &file_of("../etc", "x"));
    assert_eq!(named.status, 400);
    assert!(named.body.contains("folder"), "{}", named.body);
}

/// THE COLLISION, which is the same one `_agent_dirs` resolves in the Python,
/// extended by one step: built-in, then `public/agents/`, then this browser.
/// Last wins — so authoring `main` overrides the shipped `main`, and deleting
/// that record puts the shipped file back (I10).
#[test]
fn a_browser_agent_of_the_same_name_wins_and_deleting_it_reverts() {
    let app = booted(&[]);
    assert!(body(&app, Request::get("/agents")).contains("SHIPPED PROMPT"));

    author(&app, "main", &file_of("main", "BROWSER PROMPT"));
    let listing = body(&app, Request::get("/agents"));
    assert!(listing.contains("BROWSER PROMPT"), "{listing}");
    assert!(!listing.contains("SHIPPED PROMPT"), "one main, not two");
    assert_eq!(
        core::agent_names(&app.borrow())
            .iter()
            .filter(|n| *n == "main")
            .count(),
        1
    );

    let removed = handle(
        &mut app.borrow_mut(),
        Request::post_form("/agents/delete", &[("name", "main")]),
    );
    assert_eq!(removed.status, 200, "{}", removed.body);
    let listing = body(&app, Request::get("/agents"));
    assert!(listing.contains("SHIPPED PROMPT"), "reverted: {listing}");
    assert!(listing.contains("Shipped in this deploy"), "{listing}");
}

/// A shipped agent cannot be deleted from the browser: the file belongs to the
/// deploy. Said in words rather than by quietly doing nothing.
#[test]
fn a_shipped_agent_cannot_be_deleted_from_the_browser() {
    let app = booted(&[]);
    let refused = handle(
        &mut app.borrow_mut(),
        Request::post_form("/agents/delete", &[("name", "main")]),
    );
    assert_eq!(refused.status, 400);
    assert!(refused.body.contains("public/agents/"), "{}", refused.body);
    assert!(core::agent_names(&app.borrow()).contains(&"main".to_string()));
}

/// THE HAZARD. A prompt edited while a turn is in flight must not take effect
/// until that turn has ended — a swap between the model call and the reply it
/// is waiting for would finish the turn out of a different agent's file. And
/// when it does land, the CONVERSATION IS INTACT.
#[test]
fn a_prompt_edit_lands_at_the_turn_boundary_and_keeps_the_conversation() {
    let app = booted(&[]);
    // The turn starts: `task` is Some from here until an answer ends it.
    let started = Event {
        id: EventId(0),
        seq: 0,
        at: AT,
        kind: EventKind::UserMessage {
            text: "what is the capital of France?".into(),
            agent: String::new(),
            from: String::new(),
        },
    };
    pump(&mut app.borrow_mut(), started);

    // …and mid-flight, the prompt is edited.
    let saved = author(&app, "main", &file_of("main", "EDITED PROMPT"));
    assert_eq!(saved.status, 200, "{}", saved.body);
    let mid = body(&app, Request::get("/agents"));
    assert!(
        mid.contains("SHIPPED PROMPT") && !mid.contains("EDITED PROMPT"),
        "the running agent must still be the one that started this turn: {mid}"
    );

    // The reply ends the turn — and only now does the edit apply.
    let answered = Event {
        id: EventId(0),
        seq: 0,
        at: AT,
        kind: EventKind::ModelReplied {
            text: "Paris.".into(),
            agent: String::new(),
        },
    };
    pump(&mut app.borrow_mut(), answered);
    let after = body(&app, Request::get("/agents"));
    assert!(after.contains("EDITED PROMPT"), "{after}");

    // The conversation is untouched by the swap. The WINDOW is the thing the
    // hazard threatened — it is what the next Document is assembled from — and
    // it still holds both turns of the one that ran across the edit.
    let window = core::window(&app.borrow()).join("\n");
    assert!(
        window.contains("capital of France") && window.contains("Paris."),
        "the edit replaced the prompt, not the history: {window}"
    );
}

/// The export IS the `public/agents/` format, served as the file rather than
/// as a fragment to be scraped — and it is the same route for a shipped agent
/// and an authored one (I9).
#[test]
fn an_agent_exports_as_the_agent_md_it_is() {
    let app = booted(&[]);
    author(&app, "scribe", &file_of("scribe", "You write things down."));
    for (who, marker) in [("main", "SHIPPED PROMPT"), ("scribe", "You write things down.")] {
        let res = handle(
            &mut app.borrow_mut(),
            Request::get("/agents/file").with_header("x-agent", who),
        );
        assert_eq!(res.status, 200);
        assert!(
            res.headers.iter().any(|(k, v)| k == "content-type" && v.starts_with("text/markdown")),
            "the body is the FILE, not a fragment: {:?}",
            res.headers
        );
        assert!(res.body.starts_with("---\nname: "), "{}", res.body);
        assert!(res.body.contains(marker), "{}", res.body);
        // The proof it is droppable into public/agents/: the loader reads it.
        let parsed = agent::parse_agent_file(who, &res.body).expect("the export loads");
        assert_eq!(parsed.name, who);
    }
}

/// The model's route to the same fact. `write_agent` is an ordinary tool, so
/// an agent authored by a model and one authored by a person are one record —
/// and the agent it wrote is installed with no reload, at the end of the turn.
#[test]
fn the_model_authors_an_agent_with_an_ordinary_tool() {
    let app = booted(&[
        r#"write_agent({"name": "haiku", "description": "Writes haiku.", "prompt": "You write haiku. Three lines, 5-7-5.", "tools": "", "space": ""})"#,
        "I made you an agent called haiku.",
    ]);
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", "make me an agent that writes haiku")]),
    );
    block_on(drive(Rc::clone(&app))).expect("the turn runs");

    let names = core::agent_names(&app.borrow());
    assert!(names.contains(&"haiku".to_string()), "{names:?}");
    let listing = body(&app, Request::get("/agents"));
    assert!(listing.contains("Authored in this browser"), "{listing}");
    assert!(listing.contains("Writes haiku."), "{listing}");
    // Its file is the same format everything else exports in.
    let res = handle(
        &mut app.borrow_mut(),
        Request::get("/agents/file").with_header("x-agent", "haiku"),
    );
    assert!(res.body.contains("5-7-5"), "{}", res.body);
    assert!(agent::parse_agent_file("haiku", &res.body).is_ok());
    // …and it is on the board, so it has a row and a conversation.
    assert!(body(&app, Request::get("/board")).contains("haiku"));
}

/// A refused `write_agent` call is a result the model can act on, and nothing
/// is installed — the same discipline as every other unreadable argument.
#[test]
fn write_agent_refuses_a_nameless_or_promptless_agent_in_words() {
    let app = booted(&[r#"write_agent({"name": "a b", "prompt": "x"})"#, "sorry"]);
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", "make an agent")]),
    );
    block_on(drive(Rc::clone(&app))).expect("the turn runs");
    let names = core::agent_names(&app.borrow());
    assert!(!names.contains(&"a b".to_string()), "{names:?}");
    let trace = body(&app, Request::get("/tools"));
    assert!(trace.contains("cannot be an agent name"), "{trace}");
}

/// A refresh is a new process, and an authored agent survives it — the record
/// is a fact in the log, and the log is replayed at boot (I8, I11).
#[test]
fn an_authored_agent_survives_a_reload() {
    let store = Rc::new(MemStore::default());
    let world = |store: Rc<MemStore>| Ports {
        store,
        ..ports(&[])
    };
    let mut app = block_on(boot(world(Rc::clone(&store)))).expect("boot");
    install_agents(&mut app, shipped());
    let app = Rc::new(RefCell::new(app));
    author(&app, "scribe", &file_of("scribe", "You write things down."));
    block_on(drive(Rc::clone(&app))).expect("events persist");

    // A second process over the same storage: the same browser, reloaded.
    let mut again = block_on(boot(world(store))).expect("boot again");
    install_agents(&mut again, shipped());
    let names = core::agent_names(&again);
    assert!(names.contains(&"scribe".to_string()), "{names:?}");
    let listing = handle(&mut again, Request::get("/agents")).body;
    assert!(listing.contains("You write things down."), "{listing}");
    assert!(listing.contains("Authored in this browser"), "{listing}");
}

/// What a small local model actually sends. A space that could never be one is
/// dropped rather than written into the file — it would grant nothing and put
/// a capability line on the card that means nothing — and a prompt whose
/// newlines arrived still escaped is unescaped, so the agent it writes is not
/// one 400-character paragraph.
#[test]
fn write_agent_cleans_up_what_a_small_model_actually_sends() {
    let app = booted(&[
        r#"write_agent({"name": "haiku", "description": "Writes haiku.", "prompt": "You write haiku.\\n\\nThree lines, 5-7-5.", "tools": "now", "space": "\"})"})"#,
        "done",
    ]);
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", "make one")]),
    );
    block_on(drive(Rc::clone(&app))).expect("the turn runs");

    let res = handle(
        &mut app.borrow_mut(),
        Request::get("/agents/file").with_header("x-agent", "haiku"),
    );
    let spec = agent::parse_agent_file("haiku", &res.body).expect("the file loads");
    assert_eq!(spec.space, "", "an unusable space name is not kept: {:?}", spec.space);
    assert!(spec.prompt.contains("\n\nThree lines"), "{:?}", spec.prompt);
    // …and with no space there is no shell, which the card states plainly.
    let listing = body(&app, Request::get("/agents"));
    assert!(listing.contains("No space, so no workspace"), "{listing}");
}
