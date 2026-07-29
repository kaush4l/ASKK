//! core test contract, G4 slice — the §3 promise under plain `cargo test`
//! with in-memory ports: boot, dashboard, panel, 404, one full chat turn
//! (UserMessage → CallModel → ModelReplied → fragment), honest model
//! failure, and event persistence through StorePort.

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use adapters_test::{DenyAllNet, FixedClock, MemStore, ScriptedModel, SeededRng};
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

fn ports(model: ScriptedModel, store: Rc<MemStore>) -> Ports {
    Ports {
        model: Rc::new(model),
        store,
        net: Rc::new(DenyAllNet),
        clock: Rc::new(FixedClock::at(Timestamp(1_753_800_000_000))),
        rng: Rc::new(SeededRng::seeded(7)),
    }
}

fn booted(replies: Vec<String>) -> (Rc<RefCell<App>>, Rc<MemStore>) {
    let store = Rc::new(MemStore::default());
    let app = block_on(boot(ports(
        ScriptedModel::with_replies(replies),
        Rc::clone(&store),
    )))
    .expect("boot succeeds");
    (Rc::new(RefCell::new(app)), store)
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
    assert!(
        res.body.contains("hx-get=\"/panels/status\""),
        "{}",
        res.body
    );
    assert!(res.body.contains("hx-post=\"/chat\""));

    let res = get(&app, "/panels/status");
    assert_eq!(res.status, 200);
    assert!(res.body.contains("walking skeleton"));
    assert!(res.body.contains("clock: 1753800000000 ms"), "{}", res.body);

    let res = get(&app, "/nope");
    assert_eq!(res.status, 404);
    assert!(res.body.starts_with("<div class=\"error\">"));
}

/// (3): the full turn through the seam — submit, drive, poll the reply.
#[test]
fn chat_turn_through_seam_with_scripted_model() {
    let (app, _store) = booted(vec![ScriptedModel::text_reply(
        "Hello from the scripted model.",
    )]);

    let res = post(&app, "/chat", "message=hi+there%21");
    assert_eq!(res.status, 200);
    assert!(res.body.contains("hi there!"), "{}", res.body);
    assert!(res.body.contains("hx-get=\"/chat/poll\""), "{}", res.body);

    // Before the drive, the poll honestly says: still thinking.
    let res = get(&app, "/chat/poll");
    assert!(res.body.contains("thinking"), "{}", res.body);

    block_on(drive(Rc::clone(&app))).expect("drive succeeds");

    let res = get(&app, "/chat/poll");
    assert_eq!(res.status, 200);
    assert!(
        res.body.contains("Hello from the scripted model."),
        "{}",
        res.body
    );
    assert!(res.body.contains("msg assistant"));
    // The chain terminates: no further self-poll in the reply fragment.
    assert!(!res.body.contains("hx-get"));
}

/// Model failure surfaces as the typed error fragment — never a faked reply.
#[test]
fn model_failure_renders_typed_error_fragment() {
    let (app, _store) = booted(vec![]); // exhausted script = transport error
    post(&app, "/chat", "message=hello");
    // The turn's drive fails internally; the error becomes a fact.
    let _ = block_on(drive(Rc::clone(&app)));
    let res = get(&app, "/chat/poll");
    assert!(res.body.contains("turn failed"), "{}", res.body);
    assert!(res.body.contains("Transport"), "{}", res.body);
    assert!(res.body.contains("msg error"));
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
        ScriptedModel::with_replies(vec![]),
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
        ScriptedModel::with_replies(vec![]),
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
