//! THE BROWSER FACTS A LOST TURN RESTS ON (I17). `spawn/reply/mod.rs`'s
//! `on_error` frees the turn slot when a Worker raises, and the whole claim
//! that a crashed peer COMES BACK is two assumptions about Chrome that were
//! never executed anywhere: that an uncaught error inside a Worker reaches the
//! spawner as an `error` event, and that the Worker keeps running afterwards so
//! the next goal can be delivered to it. Both are pinned below.
//!
//! What is NOT pinned here, and why: `ask` and `Live` are `pub(crate)` behind a
//! private `mod workers` (`lib.rs`), so this package — which depends on
//! `adapters_web` as an ordinary crate — cannot call them. These tests
//! therefore exercise the same Worker mechanics through the same browser API,
//! one layer under the code that uses them; the refusal SENTENCE is host-tested
//! in `reply/turn.rs`. A test that drove `ask` end to end would need it
//! exported, and nothing has yet needed that enough to widen the seam.
//!
//! `listen` IS reachable now, through `AgentWorkers::listen_to` — opened for
//! `crashed_peer.rs` beside this, which runs our own `on_error` rather than
//! only the browser behaviour it stands on.

use std::cell::RefCell;
use std::rc::Rc;

use adapters_web::sleep;
use js_sys::{Array, Function, Object, Reflect};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};

wasm_bindgen_test_configure!(run_in_browser);

/// A Worker whose FIRST turn throws and whose second answers: the crash this
/// guards against, in the smallest script that produces it.
const RAISES_ONCE: &str = r#"
let seen = 0;
self.onmessage = () => {
  seen += 1;
  if (seen === 1) { throw new Error("boom"); }
  self.postMessage("answered " + seen);
};
"#;

/// A Worker that ACCEPTS a turn and neither answers nor raises — the case
/// `ask`'s unpinnable names. It exists here to show the silence is total.
///
/// It answers `"ping"` and swallows everything else, and that is not a
/// convenience — it is what stops the test being vacuous. Asserting only that
/// nothing arrives is equally true of a Worker that never started, a blob URL
/// that failed, and a handler that never attached, so the silence has to be
/// proved to be a CHOICE by a live Worker rather than an absence. The ping is
/// the liveness half; the swallowed goal is the claim.
const SWALLOWS: &str = r#"
self.onmessage = (e) => {
  if (e.data === "ping") { self.postMessage("pong"); }
};
"#;

fn of_global(name: &str) -> JsValue {
    Reflect::get(&js_sys::global(), &name.into()).expect(name)
}

fn method(on: &JsValue, name: &str) -> Function {
    Reflect::get(on, &name.into())
        .expect(name)
        .dyn_into()
        .expect("a callable")
}

/// One Worker running `source`. A blob URL, because a test cannot add a file to
/// the runner's document root and `agent-worker.js` is not what is under test —
/// the Worker LIFECYCLE is, and it is identical either way.
fn worker(source: &str) -> JsValue {
    let options = Object::new();
    Reflect::set(&options, &"type".into(), &"text/javascript".into()).expect("blob options");
    let parts = Array::of1(&JsValue::from_str(source));
    let ctor: Function = of_global("Blob").dyn_into().expect("Blob");
    let blob = Reflect::construct(&ctor, &Array::of2(&parts, &options)).expect("new Blob");
    let url_api = of_global("URL");
    let url = method(&url_api, "createObjectURL")
        .call1(&url_api, &blob)
        .expect("createObjectURL");
    let ctor: Function = of_global("Worker").dyn_into().expect("Worker");
    Reflect::construct(&ctor, &Array::of1(&url)).expect("new Worker")
}

/// Push one string field of every `event` fired at `target` into `seen` — the
/// shape of `listen`'s two handlers, minus everything they decide.
fn record(target: &JsValue, event: &str, seen: Rc<RefCell<Vec<String>>>, field: &str) {
    let field = field.to_string();
    let handler = Closure::wrap(Box::new(move |e: JsValue| {
        let said = Reflect::get(&e, &field.as_str().into())
            .ok()
            .and_then(|v| v.as_string())
            .unwrap_or_default();
        seen.borrow_mut().push(said);
    }) as Box<dyn FnMut(JsValue)>);
    Reflect::set(target, &event.into(), handler.as_ref()).expect("install handler");
    // The Worker outlives the test that made it; a dropped closure would
    // detach the handler and the assertion below would read as a silence.
    handler.forget();
}

fn post(target: &JsValue, message: &str) {
    method(target, "postMessage")
        .call1(target, &JsValue::from_str(message))
        .expect("postMessage");
}

/// Long enough for a blob Worker to start, run one line and report. Not a
/// performance budget: a slow machine that needs longer makes these tests fail
/// loudly, which is the correct way for an unmet assumption to surface.
async fn settle() {
    sleep(1_500).await.expect("setTimeout");
}

#[wasm_bindgen_test]
async fn a_worker_that_raises_reports_it_and_still_answers_the_next_turn() {
    let (answers, raised) = (Rc::new(RefCell::new(vec![])), Rc::new(RefCell::new(vec![])));
    let worker = worker(RAISES_ONCE);
    record(&worker, "onmessage", Rc::clone(&answers), "data");
    record(&worker, "onerror", Rc::clone(&raised), "message");

    post(&worker, "first");
    settle().await;
    assert!(answers.borrow().is_empty(), "a raised turn answers nothing: {:?}", answers.borrow());
    assert_eq!(
        raised.borrow().len(),
        1,
        "the spawner hears the error, which is the ONLY signal `on_error` has that \
         a turn will never be answered: {:?}",
        raised.borrow()
    );
    assert!(raised.borrow()[0].contains("boom"), "with its cause: {:?}", raised.borrow());

    // …and the peer comes back. If an uncaught error killed the Worker,
    // freeing the slot would only mean the next ask hangs instead.
    post(&worker, "second");
    settle().await;
    assert_eq!(*answers.borrow(), vec!["answered 2".to_string()]);
}

#[wasm_bindgen_test]
async fn a_worker_that_swallows_a_turn_gives_the_spawner_no_signal_at_all() {
    let (answers, raised) = (Rc::new(RefCell::new(vec![])), Rc::new(RefCell::new(vec![])));
    let worker = worker(SWALLOWS);
    record(&worker, "onmessage", Rc::clone(&answers), "data");
    record(&worker, "onerror", Rc::clone(&raised), "message");

    // LIVENESS FIRST, or the two assertions below are vacuous. A bar-raiser
    // caught exactly that: emptiness alone would be just as green if this
    // Worker had never started. So prove the channel works in both directions
    // before proving the swallow is silent.
    post(&worker, "ping");
    settle().await;
    assert_eq!(
        *answers.borrow(),
        vec!["pong".to_string()],
        "the Worker never answered a message it DOES handle, so the silence below \
         would say nothing about swallowing — it would only say this Worker is not \
         running: {:?}",
        answers.borrow()
    );
    answers.borrow_mut().clear();

    post(&worker, "a goal it will never answer");
    settle().await;
    // This is `ask`'s unpinnable, executed: a Worker we just watched reply stays
    // silent on this one, so nothing on the page can distinguish it from one
    // that is still thinking. A deadline here would be a guess, and the refusal
    // says so instead.
    assert!(answers.borrow().is_empty(), "{:?}", answers.borrow());
    assert!(raised.borrow().is_empty(), "{:?}", raised.borrow());
}
