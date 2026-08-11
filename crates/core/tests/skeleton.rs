//! core test contract, G4 slice — the §3 promise under plain `cargo test`
//! with in-memory ports: boot, dashboard, panel, 404, one full chat turn
//! (UserMessage → CallModel → ModelReplied → fragment), honest model
//! failure, and event persistence through StorePort.

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{DenyAllNet, FixedClock, MemStore, ScriptedAgents, ScriptedModel, SeededRng};
use core::{boot, drive, handle, App, Ports};
use kernel::{Request, Timestamp};

/// Every adapters_test future is immediately ready; poll until Ready with a
/// noop waker — no executor dependency, by design.
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

fn ports(model: Rc<dyn kernel::ModelPort>, store: Rc<MemStore>) -> Ports {
    Ports {
        model,
        store,
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
        agents: Rc::new(ScriptedAgents::none()),
    }
}

fn booted(replies: Vec<String>) -> (Rc<RefCell<App>>, Rc<MemStore>) {
    let store = Rc::new(MemStore::default());
    let app = block_on(boot(ports(
        Rc::new(ScriptedModel::with_replies(replies)),
        Rc::clone(&store),
    )))
    .expect("boot succeeds");
    (Rc::new(RefCell::new(app)), store)
}

/// The first-run browser state: nothing configured, so there is no endpoint —
/// exactly what `adapters_web::FetchModel` returns with a blank base URL.
struct UnconfiguredModel;

impl kernel::ModelPort for UnconfiguredModel {
    fn call<'a>(
        &'a self,
        _endpoint: &'a kernel::EndpointName,
        _body_json: &'a str,
    ) -> kernel::BoxFuture<'a, Result<kernel::ModelReply, kernel::ModelError>> {
        Box::pin(std::future::ready(Err(kernel::ModelError::EndpointUnknown {
            endpoint: "model".into(),
        })))
    }
}

fn get(app: &Rc<RefCell<App>>, path: &str) -> kernel::Response {
    handle(&mut app.borrow_mut(), Request::get(path))
}

fn post(app: &Rc<RefCell<App>>, path: &str, body: &str) -> kernel::Response {
    handle(
        &mut app.borrow_mut(),
        Request {
            method: "POST".into(),
            path: path.into(),
            headers: vec![(
                "content-type".into(),
                "application/x-www-form-urlencoded".into(),
            )],
            body: body.into(),
        },
    )
}

/// (1)+(2): dashboard composes the slotted panel; panel serves; 404 is an
/// HTML fragment; built-ins were registered through the install path.
#[test]
fn dashboard_panel_and_404() {
    let (app, _store) = booted(vec![]);
    let res = get(&app, "/");
    assert_eq!(res.status, 200);
    assert!(res.body.contains("/panels/status"), "{}", res.body);

    let res = get(&app, "/panels/status");
    assert_eq!(res.status, 200);
    assert!(res.body.contains("walking skeleton"));
    assert!(res.body.contains("clock: 1753800000000 ms"), "{}", res.body);

    let res = get(&app, "/nope");
    assert_eq!(res.status, 404);
    assert!(res.body.starts_with("<div class=\"error\">"));
}

/// Increment 02, the ux-walker findings that live in the core: the root page
/// carries NO form and no dead htmx attribute (the Send button that navigated
/// to `?message=…` was exactly that form), exactly one `<h1>`, and the panel
/// placeholder is marked as the placeholder it is.
#[test]
fn root_page_has_no_dead_form_and_one_heading() {
    let (app, _store) = booted(vec![]);
    let res = get(&app, "/");
    assert!(!res.body.contains("<form"), "{}", res.body);
    assert!(!res.body.contains("hx-"), "{}", res.body);
    assert_eq!(res.body.matches("<h1").count(), 1, "{}", res.body);
    assert!(res.body.contains("panel pending"), "{}", res.body);
    // The placeholder is a sentence a user can read; the route it will serve
    // is an attribute, not developer text in the page's most prominent slot.
    assert!(!res.body.contains("mounted"), "{}", res.body);
    assert!(res.body.contains("data-panel=\"/panels/status\""), "{}", res.body);
}

/// (3): the full turn through the seam — submit, drive, read the transcript.
#[test]
fn chat_turn_through_seam_with_scripted_model() {
    let (app, _store) = booted(vec![ScriptedModel::text_reply(
        "Hello from the scripted model.",
    )]);

    let res = post(&app, "/chat", "message=hi+there%21");
    assert_eq!(res.status, 200);
    assert!(res.body.contains("hi there!"), "{}", res.body);
    // In flight: the transcript says so, and says so in a header the UI can
    // read without parsing HTML.
    assert!(res.body.contains("thinking"), "{}", res.body);
    assert!(res.headers.contains(&("x-turn".into(), "pending".into())));

    let res = get(&app, "/chat");
    assert!(res.body.contains("thinking"), "{}", res.body);

    block_on(drive(Rc::clone(&app))).expect("drive succeeds");

    let res = get(&app, "/chat");
    assert_eq!(res.status, 200);
    assert!(
        res.body.contains("Hello from the scripted model."),
        "{}",
        res.body
    );
    assert!(res.body.contains("msg assistant"));
    // The turn is over: no pending marker, no pending header.
    assert!(!res.body.contains("thinking"), "{}", res.body);
    assert!(!res.headers.iter().any(|(k, _)| k == "x-turn"));
}

/// The transcript is a PROJECTION of the log (I8), not a list the UI keeps:
/// both turns are in it, in log order, and every message came from an event.
#[test]
fn transcript_projects_the_whole_conversation_in_order() {
    let (app, _store) = booted(vec![
        ScriptedModel::text_reply("first answer"),
        ScriptedModel::text_reply("second answer"),
    ]);
    post(&app, "/chat", "message=one");
    block_on(drive(Rc::clone(&app))).expect("drive succeeds");
    post(&app, "/chat", "message=two");
    block_on(drive(Rc::clone(&app))).expect("drive succeeds");

    let body = get(&app, "/chat").body;
    let at = |needle: &str| body.find(needle).unwrap_or_else(|| panic!("{needle}: {body}"));
    assert!(at(">one<") < at("first answer"));
    assert!(at("first answer") < at(">two<"));
    assert!(at(">two<") < at("second answer"));
    assert_eq!(body.matches("msg user").count(), 2, "{body}");
    assert_eq!(body.matches("msg assistant").count(), 2, "{body}");
}

/// Reload the page and the conversation is still there: a rebooted app
/// replays the log and the same fold produces the same transcript.
#[test]
fn transcript_survives_reboot() {
    let (app, store) = booted(vec![ScriptedModel::text_reply("remembered")]);
    post(&app, "/chat", "message=do+you+remember");
    block_on(drive(Rc::clone(&app))).expect("drive succeeds");

    let app2 = block_on(boot(ports(
        Rc::new(ScriptedModel::with_replies(vec![])),
        Rc::clone(&store),
    )))
    .expect("reboot succeeds");
    let app2 = Rc::new(RefCell::new(app2));
    let body = get(&app2, "/chat").body;
    assert!(body.contains("do you remember"), "{body}");
    assert!(body.contains("remembered"), "{body}");
}

/// Model failure surfaces as the typed error fragment — never a faked reply.
#[test]
fn model_failure_renders_typed_error_fragment() {
    let (app, _store) = booted(vec![]); // exhausted script = transport error
    post(&app, "/chat", "message=hello");
    // The turn's drive fails internally; the error becomes a fact.
    let _ = block_on(drive(Rc::clone(&app)));
    let res = get(&app, "/chat");
    assert!(res.body.contains("msg error"));
    // The actionable sentence LEADS; the typed error is still there verbatim,
    // but folded behind the expander instead of opening the message.
    let lead = res.body.find("could not be reached").expect(&res.body);
    let raw = res.body.find("Transport").expect(&res.body);
    assert!(lead < raw, "raw error before the sentence: {}", res.body);
    assert!(res.body.contains("<details>"), "{}", res.body);
    assert!(res.body.contains("Settings"), "{}", res.body);
    // …and the pane stops claiming to be thinking.
    assert!(!res.body.contains("thinking"), "{}", res.body);
}

/// (4)+persistence: every handled request/turn is an Event written through
/// StorePort, and a rebooted app replays them.
#[test]
fn events_persist_and_replay_across_boot() {
    let (app, store) = booted(vec![ScriptedModel::text_reply("ok")]);
    post(&app, "/chat", "message=persist+me");
    block_on(drive(Rc::clone(&app))).expect("drive succeeds");

    let keys = block_on(kernel::StorePort::kv(store.as_ref()).list_prefix("events/")).unwrap();
    assert!(!keys.is_empty(), "events were persisted");
    let raw = block_on(kernel::StorePort::kv(store.as_ref()).get(&keys[0]))
        .unwrap()
        .unwrap();
    assert!(
        raw.contains("\"seq\""),
        "persisted record is the Event JSON"
    );

    // Reboot on the same store: the log replays; the status panel counts
    // MORE facts than a fresh boot would alone.
    let app2 = block_on(boot(ports(
        Rc::new(ScriptedModel::with_replies(vec![])),
        Rc::clone(&store),
    )))
    .expect("reboot succeeds");
    let app2 = Rc::new(RefCell::new(app2));
    let res = get(&app2, "/panels/status");
    let facts: u32 = res
        .body
        .split("facts in the log: ")
        .nth(1)
        .and_then(|s| s.split('<').next())
        .and_then(|s| s.parse().ok())
        .expect("status shows fact count");
    assert!(
        facts as usize > keys.len() - 1,
        "replayed history is visible"
    );
}

/// (5): the migration gate refuses a store newer than the code.
#[test]
fn newer_schema_refuses_boot() {
    let store = Rc::new(MemStore::default());
    block_on(kernel::StorePort::kv(store.as_ref()).put("meta/schema_version", "999")).unwrap();
    let result = block_on(boot(ports(
        Rc::new(ScriptedModel::with_replies(vec![])),
        Rc::clone(&store),
    )));
    match result {
        Err(core::CoreError::SchemaNewerThanCode {
            stored: 999,
            expected: 1,
        }) => {}
        Err(other) => panic!("wrong error: {other:?}"),
        Ok(_) => panic!("boot must refuse a newer store"),
    }
}

/// The path EVERY new visitor takes: no endpoint configured. It must say so in
/// words that name the fix — not dump a typed error, and not POST at whatever
/// a bare `/v1` resolves to on the host.
#[test]
fn unconfigured_endpoint_says_what_to_do() {
    let store = Rc::new(MemStore::default());
    let app = block_on(boot(ports(Rc::new(UnconfiguredModel), Rc::clone(&store))))
        .expect("boot succeeds");
    let app = Rc::new(RefCell::new(app));
    post(&app, "/chat", "message=hello");
    let _ = block_on(drive(Rc::clone(&app)));
    let body = get(&app, "/chat").body;
    assert!(body.contains("No model endpoint is set yet"), "{body}");
    assert!(body.contains("Settings"), "{body}");
    assert!(!body.contains("thinking"), "{body}");
}
