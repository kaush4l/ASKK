//! WHAT A WORKER SAYS BACK: the handle to a running agent, the one message
//! handler installed on it, the side channels it reports about itself, and the
//! call that hands it a goal. [`super`] owns the other direction.

use std::cell::RefCell;
use std::rc::Rc;

use js_sys::{Function, Object, Promise, Reflect};
use wasm_bindgen::closure::Closure;
use wasm_bindgen::{JsCast, JsValue};
use web_sys::{MessageEvent, Worker};

use kernel::Status;

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

// The three things a Worker says about itself alongside an answer. All are
// QUEUED, not delivered: they arrive on a JS callback, where the app is
// already borrowed.

/// Its own window: `(agent, entries, the summary that replaced the oldest)`.
pub(crate) type Memory = (String, usize, Option<String>);

/// What it DID: `(agent, activity JSON)` — the tool calls and the spend.
pub(crate) type Activity = (String, String);

/// An agent it WROTE with `write_agent`: `(name, agent.md, author)`.
pub(crate) type Authored = (String, String, String);

/// One string field off a Worker's message; absent means it said nothing.
fn said(data: &JsValue, key: &str) -> Option<String> {
    Reflect::get(data, &key.into()).ok()?.as_string()
}

/// Every agent this Worker has written with `write_agent`; none, if absent.
fn authored_in(data: &JsValue) -> Vec<Authored> {
    said(data, "authored")
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

/// The tool calls and spend it has not reported yet. An empty list is nothing
/// new, which is not the same fact as an empty report.
fn activity_in(data: &JsValue, who: &str) -> Option<Activity> {
    match said(data, "activity")?.trim() {
        "" | "[]" => None,
        raw => Some((who.to_string(), raw.to_string())),
    }
}

/// What it holds in its own window. Absent means it said nothing, which the
/// pane prints as "not reported" rather than as a made-up number.
fn memory_of(data: &JsValue, who: &str) -> Option<Memory> {
    let v = serde_json::from_str::<serde_json::Value>(&said(data, "memory")?).ok()?;
    let summary = v.get("summary").and_then(|s| s.as_str()).map(str::to_string);
    Some((who.to_string(), v.get("window")?.as_u64()? as usize, summary))
}

/// Drain all three of those off one message, in the order the pane reads them.
///
/// Called BEFORE the `ok` branch below and deliberately so: a turn that FAILED
/// reports what it did on the way to failing, and that is the trace worth
/// reading. `web/agent-worker.js` puts the same fields on both outcomes; if
/// this only ran for `ok`, that fix would be inert.
fn drain_side_channels(
    data: &JsValue,
    who: &str,
    memory: &RefCell<Vec<Memory>>,
    written: &RefCell<Vec<Authored>>,
    did: &RefCell<Vec<Activity>>,
) {
    if let Some(said) = memory_of(data, who) {
        memory.borrow_mut().push(said);
    }
    written.borrow_mut().extend(authored_in(data));
    if let Some(done) = activity_in(data, who) {
        did.borrow_mut().push(done);
    }
}

/// The ONE message handler for this Worker: `ready` is a lifecycle fact,
/// anything else is the answer to the turn in flight.
pub(crate) fn listen(
    name: &str,
    worker: Worker,
    queue: Rc<RefCell<Vec<(String, Status, String)>>>,
    memory: Rc<RefCell<Vec<Memory>>>,
    written: Rc<RefCell<Vec<Authored>>>,
    did: Rc<RefCell<Vec<Activity>>>,
) -> Live {
    let waiting: Rc<RefCell<Option<(Function, Function)>>> = Rc::new(RefCell::new(None));
    let (pending, who) = (Rc::clone(&waiting), name.to_string());
    let handler = Closure::wrap(Box::new(move |e: MessageEvent| {
        let data = e.data();
        let text = said(&data, "text").unwrap_or_default();
        let ok = Reflect::get(&data, &"ok".into()).ok().and_then(|v| v.as_bool()) == Some(true);
        drain_side_channels(&data, &who, &memory, &written, &did);
        if said(&data, "kind").as_deref() == Some("ready") {
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


