//! R18: AUTHORING AND ENDINGS — three findings, one file.
//!
//! **P1-7.** A reviewer wrote an agent with `model: locl`, `engine: reakt` and
//! `tools: [nope_tool]`. It saved clean, the card reported the garbage back as
//! fact — `No tools` — and the first message failed with *"The model endpoint
//! answered, but refused the request. Check the base URL and API key in
//! Settings"* over an endpoint whose URL and key were both right. The truth,
//! `Model 'locl' not found. Available models: …`, was three levels of JSON down
//! behind `Technical detail`.
//!
//! **P1-8.** `Delete haiku` removed an authored agent on one unconfirmed click.
//!
//! **P1-5.** A task asked for a BBC headline in `artifacts/news.md`. The agent
//! refused it for want of a web browser, no file was written, and the Dashboard
//! card said `main finished "Find the top news story…"`. `Answered` is the
//! ending and it is true — answered is just not did-what-you-asked. This page
//! cannot know whether a task was accomplished and does not guess; it can count
//! whether anything RAN, and that is what it now says.

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{
    DenyAllNet, FakeShell, FixedClock, MemKv, MemStore, ScriptedAgents, ScriptedModel, SeededRng,
};
use core::{boot, drive, handle, install_agents, provider_error, App, Ports};
use kernel::{ModelError, Request, Timestamp};

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

/// The reviewer's own file, verbatim in the parts that matter.
///
/// ITS `engine: reakt` MOVED OUT (increment 19). Two of the reviewer's three
/// mistakes are reported and saved — a model id this catalogue lacks may be one
/// another endpoint has, and a tool name nothing answers to may be a peer agent
/// written a minute from now. An engine has neither excuse: there are two, the
/// machine can run both, and it can run nothing else. So that line is refused at
/// the parser now, and it is pinned one test below rather than sitting in a
/// fixture whose other two keys must still save.
const BROKEN: &str = "---\nname: haiku\ndescription: writes haiku\nmodel: locl\n\
                      tools: [nope_tool]\n---\nwrite haiku";
const MAIN: &str = "---\nname: main\ndescription: the lead\ntools: []\nspace: research\n---\nbody";

/// LM Studio's own 404 body for a model it does not have — the one the reviewer
/// found three levels down behind `Technical detail`.
const NOT_FOUND: &str = r#"{"error":{"message":"Model 'locl' not found. Available models: gemma-4-12B-it-qat-mxfp8, qwen3-4b","type":"invalid_request_error"}}"#;

fn booted(agents: Vec<(String, String)>, replies: &[&str]) -> Rc<RefCell<App>> {
    let ports = Ports {
        model: Rc::new(ScriptedModel::with_replies(
            replies.iter().map(|r| ScriptedModel::text_reply(r)).collect(),
        )),
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: Rc::new(FakeShell::new()),
        agents: Rc::new(ScriptedAgents::none()),
    };
    let mut app = block_on(boot(ports)).expect("boot succeeds");
    install_agents(&mut app, agents);
    Rc::new(RefCell::new(app))
}

/// One agent, and an endpoint that answers every call with that typed failure.
fn refused(error: ModelError) -> Rc<RefCell<App>> {
    let ports = Ports {
        model: Rc::new(ScriptedModel::refusing(error)),
        store: Rc::new(MemStore::default()),
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        spaces: Rc::new(MemKv::new()),
        workspace: Rc::new(FakeShell::new()),
        agents: Rc::new(ScriptedAgents::none()),
    };
    let mut app = block_on(boot(ports)).expect("boot succeeds");
    install_agents(&mut app, vec![("main".to_string(), MAIN.to_string())]);
    Rc::new(RefCell::new(app))
}

fn body(app: &Rc<RefCell<App>>, path: &str) -> String {
    handle(&mut app.borrow_mut(), Request::get(path)).body
}

fn cell(board: &str, attr: &str) -> String {
    let at = board.find("data-agent=\"main\"").expect("main has a row");
    let (_, rest) = board[at..].split_once(&format!("{attr}=\"")).expect("the attribute");
    rest.split_once('"').map(|(v, _)| v.to_string()).unwrap_or_default()
}

/// P1-7a — AN UNKNOWN TOOL NAME IS NOT DROPPED IN SILENCE.
///
/// It is still SAVED: a name in `tools:` may be a peer agent written a minute
/// from now, so refusing here would turn the order you type two agents in into
/// a rule about capability. It is reported instead — at the save, and on the
/// card, which is the surface that told the reviewer `No tools` as a fact.
#[test]
fn a_tool_name_nothing_answers_to_is_reported_not_swallowed() {
    let app = booted(vec![("haiku".into(), BROKEN.into())], &[]);
    let saved = handle(
        &mut app.borrow_mut(),
        Request::post_form("/agents", &[("name", "haiku"), ("text", BROKEN)]),
    );
    assert_eq!(saved.status, 200, "an unresolvable tool name is not a refusal");
    assert!(
        saved.body.contains("Nothing here is called nope_tool"),
        "the save says what it could not resolve: {}",
        saved.body
    );

    let cards = body(&app, "/agents");
    assert!(
        cards.contains("Named in its file but not installed here"),
        "the card says it too: {cards}"
    );
    assert!(cards.contains("nope_tool"), "and names it: {cards}");
}

/// P1-7b — A 404 NAMING THE MODEL IS NOT AN AUTH PROBLEM.
///
/// The discriminant is the status plus the model id this page asked for, never
/// a phrase we hope the provider uses. A 401 with the same body stays
/// `Provider` and keeps the Settings remedy, which is right for it.
#[test]
fn a_missing_model_is_its_own_failure_and_points_at_the_agents_file() {
    let missing = provider_error(404, NOT_FOUND, "locl", true);
    assert_eq!(
        missing,
        ModelError::ModelMissing {
            model: "locl".into(),
            available: vec!["gemma-4-12B-it-qat-mxfp8".into(), "qwen3-4b".into()],
        },
        "the endpoint's own list comes out of its own sentence"
    );
    assert!(
        matches!(provider_error(401, NOT_FOUND, "locl", true), ModelError::Provider { .. }),
        "a refused credential is still a refused credential"
    );
    assert!(
        matches!(
            provider_error(404, "{\"error\":\"no route\"}", "locl", true),
            ModelError::Provider { .. }
        ),
        "a 404 that says nothing about the model we asked for is not about the model"
    );
}

/// 22 — A REFUSAL OF NOTHING IS NOT A WRONG CREDENTIAL.
///
/// The cold walk saved an endpoint with the key field empty, sent a message,
/// and read "check the base URL and API key in Settings" beside a header that
/// already said "with no key". The discriminant is whether an `authorization`
/// header actually went out — a fact this application holds — never the
/// provider's prose, which says whatever that provider likes.
#[test]
fn a_refusal_with_no_key_sent_says_so_and_a_keyed_one_does_not() {
    use kernel::ModelError::{NoKey, Provider};
    for status in [401, 403] {
        assert!(
            matches!(provider_error(status, NOT_FOUND, "", false), NoKey { .. }),
            "{status} with nothing sent is a missing key"
        );
        assert!(
            matches!(provider_error(status, NOT_FOUND, "", true), Provider { .. }),
            "{status} with a key sent is a refused credential, a different problem"
        );
    }
    // …and no other status becomes it: a 500 with no key configured is the
    // provider's own fault, and telling a person to add a key would be a
    // remedy for a problem they do not have.
    assert!(matches!(
        provider_error(500, NOT_FOUND, "", false),
        Provider { .. }
    ));
}

/// …AND WHAT THE PERSON READS. The remedy names the one thing to do, and does
/// not send them to re-check a base URL that answered.
#[test]
fn the_missing_key_card_says_the_key_is_absent() {
    let app = refused(ModelError::NoKey {
        status: 401,
        message: "{\"error\":\"no credential\"}".into(),
    });
    handle(&mut app.borrow_mut(), Request::post_form("/chat", &[("message", "hi")]));
    let _ = block_on(drive(Rc::clone(&app)));
    let chat = body(&app, "/chat");
    assert!(chat.contains("none is set"), "says the key is absent: {chat}");
    assert!(
        !chat.contains("base URL"),
        "and not to check an address that answered: {chat}"
    );
}

/// …AND WHAT THE PERSON READS, on the turn that produces it. The old card sent
/// them to Settings, where nothing about a model id can be changed.
#[test]
fn the_missing_model_card_names_the_file_and_never_the_api_key() {
    let app = refused(ModelError::ModelMissing {
        model: "locl".into(),
        available: vec!["gemma-4-12B-it-qat-mxfp8".into()],
    });
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", "write me a haiku")]),
    );
    let _ = block_on(drive(Rc::clone(&app)));

    let chat = body(&app, "/chat");
    // Escaped, because the projection escapes what it prints.
    assert!(chat.contains("called &#39;locl&#39;"), "{chat}");
    assert!(chat.contains("gemma-4-12B-it-qat-mxfp8"), "it names what the endpoint has: {chat}");
    assert!(chat.contains("`model:`"), "and the line to change: {chat}");
    for wrong in ["API key", "refused the request", "base URL"] {
        assert!(!chat.contains(wrong), "the missing model borrowed {wrong}: {chat}");
    }
    // The one bit the pane reads to swap `Open Settings` for the agent's file
    // (`ui::recover::fix_in_file`) — the same class read `last_failed` makes.
    assert!(chat.contains("class=\"msg error fix-file\""), "{chat}");

    let board = body(&app, "/board");
    assert!(board.contains("no model of that name"), "the row says which failure: {board}");
}

/// …and the endpoint remedy is untouched for the failure it describes: a
/// refused credential still sends you to Settings, and its card carries no
/// `fix-file` class, so the button stays where it was.
#[test]
fn a_refused_credential_still_sends_you_to_settings() {
    let app = refused(ModelError::Provider {
        status: 401,
        message: "{\"error\":\"invalid api key\"}".into(),
    });
    handle(&mut app.borrow_mut(), Request::post_form("/chat", &[("message", "hi")]));
    let _ = block_on(drive(Rc::clone(&app)));
    let chat = body(&app, "/chat");
    assert!(chat.contains("API key in Settings"), "{chat}");
    assert!(!chat.contains("fix-file"), "the fix is not in a file here: {chat}");
}

/// P1-7c — …AND AN ENGINE THIS BUILD CANNOT RUN IS REFUSED, which is the other
/// half of the same finding. `engine: reakt` saved clean and the card printed
/// `How it works: reakt` — the file's own typo, dressed as a fact about the
/// machine, over a key that selected nothing at all. Reported-not-refused is a
/// ruling about NAMES that may resolve later; this value never will.
#[test]
fn an_engine_this_build_cannot_run_is_refused_at_the_save() {
    let app = booted(vec![("main".into(), MAIN.into())], &[]);
    let text = "---\nname: haiku\ndescription: writes haiku\nengine: reakt\n---\nwrite haiku";
    let saved = handle(
        &mut app.borrow_mut(),
        Request::post_form("/agents", &[("name", "haiku"), ("text", text)]),
    );
    assert_eq!(saved.status, 400, "refused: {}", saved.body);
    assert!(saved.body.contains("react"), "and it says what it takes: {}", saved.body);
}

/// P1-8 — DELETING AN AUTHORED AGENT IS STILL POSSIBLE, and the route is
/// unchanged: the guard is the two-press arm in the editor (`ui::authoring`),
/// the same one `Reset every endpoint` has worn since R6-5. What this pins is
/// that the route it arms is the one that still works.
#[test]
fn the_delete_route_is_unchanged_behind_the_arm() {
    let app = booted(vec![("haiku".into(), BROKEN.into())], &[]);
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/agents", &[("name", "haiku"), ("text", BROKEN)]),
    );
    block_on(drive(Rc::clone(&app))).expect("the write lands");
    let gone = handle(
        &mut app.borrow_mut(),
        Request::post_form("/agents/delete", &[("name", "haiku")]),
    );
    assert_eq!(gone.status, 200, "{}", gone.body);
    assert!(gone.body.contains("Removed haiku"), "{}", gone.body);
}

/// P1-5 — A TURN THAT ANSWERED WITHOUT RUNNING ANYTHING SAYS SO.
///
/// The refusal is the reviewer's, word for word. The card reads `data-tools-ran`
/// off the row; zero is what turns its warn line on.
#[test]
fn an_answer_that_ran_nothing_is_not_reported_as_a_finished_task() {
    let app = booted(
        vec![("main".into(), MAIN.into())],
        &["I cannot fulfil this request, as I do not have access to a live web browser."],
    );
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", "Find the top news story on BBC and write it to artifacts/news.md")]),
    );
    block_on(drive(Rc::clone(&app))).expect("the turn runs");

    let board = body(&app, "/board");
    assert_eq!(cell(&board, "data-tools-ran"), "0", "nothing ran: {board}");
    // The ending is still `Answered` — it answered — so `Read the reply` stays.
    assert_eq!(cell(&board, "data-ending"), "", "an answer is an answer: {board}");
}

/// …and a turn that DID run something says that instead: the count is a fact
/// about this agent's own calls, so a turn with one is not warned about.
#[test]
fn a_turn_that_ran_a_tool_carries_the_count_that_proves_it() {
    let app = booted(
        vec![("main".into(), MAIN.into())],
        &[r#"write_file({"path": "news.md", "contents": "a headline"})"#, "Written."],
    );
    handle(
        &mut app.borrow_mut(),
        Request::post_form("/chat", &[("message", "write the headline to news.md")]),
    );
    block_on(drive(Rc::clone(&app))).expect("the turn runs");
    let board = body(&app, "/board");
    assert_ne!(cell(&board, "data-tools-ran"), "0", "one call ran: {board}");
}
