//! WEB LOCKS, in a browser (I17). `crates/adapters_web/src/locks/awake.rs:88-97`
//! says of `awake_contended` that three of its claims are "UNVERIFIABLE HERE"
//! — that `query()` is reachable by `Reflect`, that its `pending` array carries
//! a `name` per waiting request, and that a queued `askk/awake` shows up there
//! while the page holds the lock. Two of the three are verifiable HERE, and
//! this file verifies them; the third needs a Worker and is named below.
//!
//! The `navigator.locks` plumbing is re-reached rather than reused because
//! `adapters_web::locks` is a private module: only `awake_contended` crosses
//! the crate boundary (`lib.rs:56-58`). What that costs is recorded at the one
//! test it costs something.

use adapters_web::{awake_contended, sleep};
use harness::{decide_writership, log_lock_name, Writership, AWAKE_LOCK};
use js_sys::{Array, Function, Object, Promise, Reflect};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;
use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};

wasm_bindgen_test_configure!(run_in_browser);

fn manager() -> Object {
    let navigator = Reflect::get(&js_sys::global(), &"navigator".into()).expect("navigator");
    Reflect::get(&navigator, &"locks".into())
        .expect("navigator.locks")
        .dyn_into()
        .expect("a LockManager object")
}

fn options(if_available: bool) -> Object {
    let o = Object::new();
    let _ = Reflect::set(&o, &"mode".into(), &"exclusive".into());
    if if_available {
        let _ = Reflect::set(&o, &"ifAvailable".into(), &JsValue::TRUE);
    }
    o
}

fn request(name: &str, opts: &Object, callback: &JsValue) {
    let locks = manager();
    let f: Function = Reflect::get(&locks, &"request".into())
        .expect("request")
        .dyn_into()
        .expect("callable");
    f.apply(&locks, &Array::of3(&JsValue::from_str(name), opts, callback))
        .expect("request() throws");
}

/// A promise that never settles — how a lock is held for a context's lifetime.
fn forever() -> Promise {
    Promise::new(&mut |_resolve, _reject| {})
}

/// Ask for `name` with `ifAvailable`, hold it forever if granted, and report
/// which happened. The shape of `locks::ask`, because that is the shape whose
/// answer is under test.
async fn take_if_available(name: &str) -> bool {
    let name = name.to_string();
    let answered = Promise::new(&mut |resolve, _reject| {
        let told = resolve.clone();
        let held = Closure::wrap(Box::new(move |lock: JsValue| -> JsValue {
            let granted = !lock.is_null() && !lock.is_undefined();
            let _ = told.call1(&JsValue::NULL, &JsValue::from_bool(granted));
            match granted {
                true => forever().into(),
                false => JsValue::UNDEFINED,
            }
        }) as Box<dyn FnMut(JsValue) -> JsValue>);
        request(&name, &options(true), held.as_ref());
        held.forget();
    });
    JsFuture::from(answered)
        .await
        .expect("the request settles")
        .as_bool()
        .expect("granted or refused")
}

/// Queue on `name` and never be granted it — a Worker's end of the awake pair
/// (`awake::queue(false)`), which is the whole freeze-exemption mechanism.
fn queue_on(name: &str) {
    let waited = Closure::wrap(Box::new(|_lock: JsValue| JsValue::UNDEFINED)
        as Box<dyn FnMut(JsValue) -> JsValue>);
    request(name, &options(false), waited.as_ref());
    waited.forget();
}

/// TWO CONTENDERS, ONE WRITER — the arbitration `Writership` is built on, asked
/// of a real `LockManager`. The host can assert what `decide_writership` does
/// with a `bool`; only a browser can say that the second `ifAvailable` request
/// for a held name comes back refused instead of queueing, which is the fact
/// `locks/mod.rs:21-27` rests its whole "a second tab learns it is a follower in
/// the same turn of the event loop" argument on.
///
/// THE GAP, SAID PLAINLY: this drives `navigator.locks` directly, because
/// `adapters_web::locks::writership` is private and an integration test cannot
/// reach it. The twenty lines that wrap this are still unexecuted, and making
/// them reachable is a `src` change this file's author does not own.
#[wasm_bindgen_test]
async fn two_contenders_for_one_agents_log_lock_yield_exactly_one_writer() {
    let name = log_lock_name("browser-suite-lead");

    let first = take_if_available(&name).await;
    assert!(first, "the first context in an origin gets the log lock");
    assert_eq!(decide_writership(Some(first)), Writership::Leader);

    let second = take_if_available(&name).await;
    assert!(!second, "the second is REFUSED, not queued");
    assert_eq!(decide_writership(Some(second)), Writership::Follower);

    let other = take_if_available(&log_lock_name("browser-suite-critic")).await;
    assert!(other, "a different agent's log is a different lock");
}

/// `awake_contended` answers the browser, and answers about the RIGHT lock.
///
/// All three states are asserted in one test on purpose: a queued lock is held
/// for the life of the page, so once `askk/awake` is contended it stays
/// contended, and splitting these would make each one depend on an execution
/// order wasm-bindgen-test does not promise.
///
/// WHAT IS STILL UNVERIFIED: that a Worker's queue shows up here. This page
/// manufactures the contention itself, which settles the `Reflect` path and the
/// `pending[].name` shape but not the cross-context claim.
#[wasm_bindgen_test]
async fn awake_contention_is_reported_for_the_awake_lock_and_no_other() {
    assert_eq!(
        awake_contended().await,
        Some(false),
        "the browser answered, and nothing is queued yet — NOT `None`, which \
         would mean the query path never reached a LockManager at all"
    );

    // Contention on some OTHER lock is not awake contention. Drop the name
    // filter in `awake.rs` and this is the line that goes red.
    assert!(take_if_available("askk/log/browser-suite-decoy").await);
    queue_on("askk/log/browser-suite-decoy");
    sleep(0).await.expect("a turn of the event loop");
    assert_eq!(awake_contended().await, Some(false), "a decoy queue is not the awake queue");

    assert!(take_if_available(AWAKE_LOCK).await, "the page takes the awake lock");
    queue_on(AWAKE_LOCK);
    sleep(0).await.expect("a turn of the event loop");
    assert_eq!(awake_contended().await, Some(true), "and now something is waiting on it");
}
