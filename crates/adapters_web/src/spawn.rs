//! Starting one agent's Worker: finding this build's bundle, constructing the
//! Worker, and sending it its world. Split from `workers.rs` so both hold the
//! 200-line rule (I12); `workers.rs` owns the port and the lifecycle, this
//! file owns the construction.

use std::cell::RefCell;
use std::rc::Rc;

use js_sys::{Function, Object, Promise, Reflect};
use wasm_bindgen::closure::Closure;
use wasm_bindgen::{JsCast, JsValue};
use web_sys::{MessageEvent, Worker, WorkerOptions, WorkerType};

use kernel::Status;

/// Where the Worker gets this build's Wasm from. Trunk fingerprints both files
/// and writes them into `index.html` as preload links, so the page can read
/// its own bundle's URLs instead of anyone hardcoding a hash. The snippet
/// links Dioxus adds are skipped by name.
pub(crate) fn bundle_urls() -> Option<(String, String)> {
    let document = web_sys::window()?.document()?;
    let links = document.query_selector_all("link[rel=modulepreload]").ok()?;
    let mut glue = None;
    for i in 0..links.length() {
        let href = links
            .item(i)?
            .dyn_into::<web_sys::Element>()
            .ok()?
            .get_attribute("href")?;
        if !href.contains("/snippets/") {
            glue = Some(href);
            break;
        }
    }
    let wasm = document
        .query_selector("link[type='application/wasm']")
        .ok()??
        .get_attribute("href")?;
    Some((glue?, wasm))
}

/// The three JSON blobs a sub-agent boots from: the agent files, the model
/// catalogue and the endpoint profile the page is using. Named rather than
/// three `&str` in a row, so nobody can pass them in the wrong order.
#[derive(Clone)]
pub(crate) struct Boot<'a> {
    pub agents: &'a str,
    pub models: &'a str,
    pub profile: &'a str,
}

/// Spawn one Worker and send it its boot message. The message is a plain
/// object because `postMessage` structured-clones it — no Wasm memory, no
/// handles, nothing shared (ADR-008).
pub(crate) fn start(
    name: &str,
    glue: &str,
    wasm: &str,
    boot: &Boot<'_>,
) -> Result<Worker, JsValue> {
    let options = WorkerOptions::new();
    options.set_type(WorkerType::Module);
    options.set_name(&format!("agent-{name}"));
    let worker = Worker::new_with_options("agent-worker.js", &options)?;
    let message = Object::new();
    let set = |k: &str, v: &str| Reflect::set(&message, &k.into(), &v.into());
    set("kind", "boot")?;
    set("name", name)?;
    set("glue", glue)?;
    set("wasm", wasm)?;
    set("agents", boot.agents)?;
    set("models", boot.models)?;
    set("profile", boot.profile)?;
    worker.post_message(&message)?;
    Ok(worker)
}

/// One running agent: its Worker, and the resolver of the turn in flight.
/// The reply handler is installed ONCE per Worker rather than per call, so a
/// `ready` message arriving mid-turn cannot be mistaken for an answer.
pub(crate) struct Live {
    pub(crate) worker: Worker,
    pub(crate) waiting: Rc<RefCell<Option<(Function, Function)>>>,
    /// Kept alive for as long as the Worker is: dropping it would silently
    /// detach the only handler that can ever resolve a turn.
    _handler: Closure<dyn FnMut(MessageEvent)>,
}

/// What a Worker said about its own window, waiting to be drained: the agent,
/// how many entries, and the summary that replaced the oldest, if any.
pub(crate) type Memory = (String, usize, Option<String>);

/// An agent a Worker WROTE, waiting to be drained: `(name, agent.md)`. Same
/// queue discipline as `Memory`, and for the same reason — it arrives on a JS
/// callback, where the app is already borrowed.
pub(crate) type Authored = (String, String);

/// Read the `authored` field off a Worker's message: every agent it has
/// written with `write_agent`. Absent means it wrote none.
fn authored_in(data: &JsValue) -> Vec<Authored> {
    let Some(raw) = Reflect::get(data, &"authored".into()).ok().and_then(|v| v.as_string()) else {
        return Vec::new();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

/// Read the `memory` field off a Worker's message. Absent (an older bundle, or
/// a failure) means it said nothing, which the pane prints as "not reported"
/// rather than as a made-up number.
fn memory_of(data: &JsValue, who: &str) -> Option<Memory> {
    let raw = Reflect::get(data, &"memory".into()).ok()?.as_string()?;
    let value = serde_json::from_str::<serde_json::Value>(&raw).ok()?;
    Some((
        who.to_string(),
        value.get("window")?.as_u64()? as usize,
        value.get("summary").and_then(|s| s.as_str()).map(str::to_string),
    ))
}

/// The ONE message handler for this Worker: `ready` is a lifecycle fact,
/// anything else is the answer to the turn in flight.
pub(crate) fn listen(
    name: &str,
    worker: Worker,
    queue: Rc<RefCell<Vec<(String, Status, String)>>>,
    memory: Rc<RefCell<Vec<Memory>>>,
    written: Rc<RefCell<Vec<Authored>>>,
) -> Live {
    let waiting: Rc<RefCell<Option<(Function, Function)>>> = Rc::new(RefCell::new(None));
    let (pending, who) = (Rc::clone(&waiting), name.to_string());
    let handler = Closure::wrap(Box::new(move |e: MessageEvent| {
        let data = e.data();
        let read = |k: &str| Reflect::get(&data, &k.into()).unwrap_or(JsValue::UNDEFINED);
        let text = read("text").as_string().unwrap_or_default();
        let ok = read("ok").as_bool().unwrap_or(false);
        if let Some(said) = memory_of(&data, &who) {
            memory.borrow_mut().push(said);
        }
        written.borrow_mut().extend(authored_in(&data));
        if read("kind").as_string().as_deref() == Some("ready") {
            let status = match ok {
                true => Status::Idle,
                false => Status::Failed,
            };
            queue.borrow_mut().push((who.clone(), status, text));
            return;
        }
        let Some((resolve, reject)) = pending.borrow_mut().take() else {
            return; // an answer to nothing: the turn was already settled
        };
        match ok {
            true => resolve.call1(&JsValue::UNDEFINED, &text.into()),
            false => reject.call1(&JsValue::UNDEFINED, &text.into()),
        }
        .ok();
    }) as Box<dyn FnMut(MessageEvent)>);
    worker.set_onmessage(Some(handler.as_ref().unchecked_ref()));
    Live {
        worker,
        waiting,
        _handler: handler,
    }
}

/// Send one goal and resolve when that Worker answers.
pub(crate) fn ask(live: &Live, goal: &str) -> Promise {
    let goal = goal.to_string();
    let (worker, waiting) = (live.worker.clone(), Rc::clone(&live.waiting));
    Promise::new(&mut |resolve, reject| {
        let refuse = reject.clone();
        *waiting.borrow_mut() = Some((resolve, reject));
        let message = Object::new();
        let sent = Reflect::set(&message, &"kind".into(), &"run".into())
            .and_then(|_| Reflect::set(&message, &"goal".into(), &goal.as_str().into()))
            .and_then(|_| worker.post_message(&message));
        if let Err(e) = sent {
            waiting.borrow_mut().take();
            refuse.call1(&JsValue::UNDEFINED, &e).ok();
        }
    })
}

