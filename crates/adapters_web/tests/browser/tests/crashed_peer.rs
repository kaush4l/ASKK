//! **A WORKER THAT CRASHES WHILE IDLE MUST REACH THE BOARD (I8, I16).**
//!
//! `worker_error.rs` beside this pins the two BROWSER facts a lost turn rests
//! on, one layer under our code. This one runs OUR code: the real `on_error`
//! that `spawn/reply/mod.rs` installs, with a real Worker that really raises.
//!
//! The defect it was written against: `on_error` called `lose()` and nothing
//! else, and `lose` only rejects a PENDING turn. A Worker that raised while no
//! turn was in flight — a boot-time throw, a listener that dies between goals —
//! produced no status, no event and nothing on screen. The board went on
//! reading `idle` for an agent that was dead, which is the exact sentence
//! `status.rs` reserves for "loaded and doing nothing; nobody has called it".
//!
//! It reaches `listen` through `AgentWorkers::listen_to`, which is public for
//! this reason and says so at its definition: the claim is about our handler,
//! so the gate has to be able to run our handler (I17).

use adapters_web::AgentWorkers;
use js_sys::{Array, Function, Object, Reflect};
use kernel::Status;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};

wasm_bindgen_test_configure!(run_in_browser);

/// A Worker that answers a ping and RAISES on anything else — the crash, with
/// a liveness half so an empty report cannot pass for the right reason. If
/// this Worker had never started, the ping would go unanswered and the test
/// would say so before it ever reached the assertion that matters.
const RAISES_WHEN_TOLD: &str = r#"
self.onmessage = (e) => {
  if (e.data === "ping") { self.postMessage({ kind: "ready", ok: true, text: "" }); return; }
  throw new Error("boom");
};
"#;

fn of_global(name: &str) -> JsValue {
    Reflect::get(&js_sys::global(), &name.into()).expect(name)
}

fn method(on: &JsValue, name: &str) -> Function {
    Reflect::get(on, &name.into()).expect(name).dyn_into().expect("a callable")
}

/// One Worker running `source`, from a blob URL — a test cannot add a file to
/// the runner's document root, and `agent-worker.js` is not what is under test.
fn worker(source: &str) -> web_sys::Worker {
    let options = Object::new();
    Reflect::set(&options, &"type".into(), &"text/javascript".into()).expect("blob options");
    let parts = Array::of1(&JsValue::from_str(source));
    let ctor: Function = of_global("Blob").dyn_into().expect("Blob");
    let blob = Reflect::construct(&ctor, &Array::of2(&parts, &options)).expect("new Blob");
    let url_api = of_global("URL");
    let url = method(&url_api, "createObjectURL")
        .call1(&url_api, &blob)
        .expect("createObjectURL");
    web_sys::Worker::new(&url.as_string().expect("a blob url")).expect("new Worker")
}

fn post(target: &web_sys::Worker, message: &str) {
    target.post_message(&JsValue::from_str(message)).expect("postMessage");
}

/// Long enough for a blob Worker to start, run one line and report.
async fn settle() {
    adapters_web::sleep(1_500).await.expect("setTimeout");
}

#[wasm_bindgen_test]
async fn a_worker_that_raises_with_no_turn_in_flight_is_reported_failed() {
    let workers = AgentWorkers::none();
    let peer = worker(RAISES_WHEN_TOLD);
    workers.listen_to("researcher", peer.clone());

    // LIVENESS FIRST. An empty report is equally true of a Worker that never
    // started, so prove the channel works before proving what the crash does.
    post(&peer, "ping");
    settle().await;
    let ready = workers.take_reports();
    assert_eq!(
        ready.iter().map(|(_, s, _)| *s).collect::<Vec<_>>(),
        vec![Status::Idle],
        "the Worker never said it was ready, so nothing below would be about a crash: {ready:?}"
    );

    // THE CRASH, with NO turn in flight: nobody called `ask`, so there is no
    // pending promise for `lose` to reject and the freed slot proves nothing.
    post(&peer, "a message it will raise on");
    settle().await;

    let said = workers.take_reports();
    let failed: Vec<&(String, Status, String)> =
        said.iter().filter(|(_, s, _)| *s == Status::Failed).collect();
    assert_eq!(
        failed.len(),
        1,
        "a Worker raised while idle and the board was told NOTHING — it goes on \
         reading `idle`, which `kernel::Status` defines as \"loaded and doing \
         nothing; nobody has called it\", for an agent that is dead: {said:?}"
    );
    assert_eq!(failed[0].0, "researcher", "under its own name: {said:?}");
    assert!(
        failed[0].2.contains("boom"),
        "…and with the cause the browser gave, so the row can say why: {said:?}"
    );
}
