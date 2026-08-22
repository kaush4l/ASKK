//! WHAT A WORKER SAYS BACK: the handle to a running agent, the two handlers
//! installed on it, and the side channels it reports about itself. [`turn`]
//! owns the one turn it can have in flight; [`super`] owns the other direction.

use std::cell::RefCell;
use std::rc::Rc;

use js_sys::Reflect;
use wasm_bindgen::closure::Closure;
use wasm_bindgen::{JsCast, JsValue};
use web_sys::{MessageEvent, Worker};

use kernel::Status;

mod turn;

pub(crate) use turn::ask;
use turn::{lose, Turn};

/// One running agent: its Worker, and the turn in flight on it.
/// The handlers are installed ONCE per Worker rather than per call, so a
/// `ready` message arriving mid-turn cannot be mistaken for an answer.
pub(crate) struct Live {
    pub(crate) worker: Worker,
    pub(crate) waiting: Rc<RefCell<Option<Turn>>>,
    /// Kept alive for as long as the Worker is: dropping either would silently
    /// detach a handler that is the only thing able to settle a turn.
    _handler: Closure<dyn FnMut(MessageEvent)>,
    _raised: Closure<dyn FnMut(JsValue)>,
}

impl Drop for Live {
    /// A stopped Worker answers nothing. `AgentWorkers::close_all`
    /// (`workers.rs:139-144`) terminates these and drops them to swap the
    /// endpoint, and until this existed a turn in flight had no sender left
    /// afterwards: its promise never settled and the lead's turn hung, exactly
    /// the way the overwrite bug it replaced used to hang it.
    fn drop(&mut self) {
        lose(&self.waiting, "its Worker was stopped mid-turn, so that turn has no answer");
    }
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
fn on_message(
    who: String,
    pending: Rc<RefCell<Option<Turn>>>,
    queue: Rc<RefCell<Vec<(String, Status, String)>>>,
    memory: Rc<RefCell<Vec<Memory>>>,
    written: Rc<RefCell<Vec<Authored>>>,
    did: Rc<RefCell<Vec<Activity>>>,
) -> Closure<dyn FnMut(MessageEvent)> {
    Closure::wrap(Box::new(move |e: MessageEvent| {
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
        let Some(turn) = pending.borrow_mut().take() else {
            return; // an answer to nothing: the turn was already settled
        };
        match ok {
            true => turn.resolve.call1(&JsValue::UNDEFINED, &text.into()),
            false => turn.reject.call1(&JsValue::UNDEFINED, &text.into()),
        }
        .ok();
    }) as Box<dyn FnMut(MessageEvent)>)
}

/// A Worker that RAISES is the one lost turn this side can actually observe,
/// and the only reason a crashed peer can come back at all: the slot is freed
/// here, so the NEXT ask is delivered instead of refused forever.
///
/// Both halves of that are browser behaviour, so both are pinned rather than
/// assumed — an uncaught error inside a Worker reaches its spawner as an
/// `error` event, and the Worker keeps running afterwards
/// (`tests/browser/tests/worker_error.rs`). The `run` message's own failures do
/// NOT arrive here: `web/agent-worker.js` catches those and posts `ok: false`,
/// which is an answer. This is for what escapes it.
fn on_error(pending: Rc<RefCell<Option<Turn>>>) -> Closure<dyn FnMut(JsValue)> {
    Closure::wrap(Box::new(move |e: JsValue| {
        // `messageerror` is deliberately not handled beside this: every field
        // crossing this boundary is a string, so there is no clone failure to
        // report and a handler for one would assert a case that cannot arise.
        let raised = said(&e, "message").unwrap_or_else(|| "an error it did not describe".into());
        let why = format!("its Worker raised \"{raised}\", so the turn it was given has no answer");
        lose(&pending, &why);
    }) as Box<dyn FnMut(JsValue)>)
}

/// Install both handlers on a freshly started Worker and hand back the handle.
pub(crate) fn listen(
    name: &str,
    worker: Worker,
    queue: Rc<RefCell<Vec<(String, Status, String)>>>,
    memory: Rc<RefCell<Vec<Memory>>>,
    written: Rc<RefCell<Vec<Authored>>>,
    did: Rc<RefCell<Vec<Activity>>>,
) -> Live {
    let waiting: Rc<RefCell<Option<Turn>>> = Rc::new(RefCell::new(None));
    let handler = on_message(name.to_string(), Rc::clone(&waiting), queue, memory, written, did);
    worker.set_onmessage(Some(handler.as_ref().unchecked_ref()));
    let raised = on_error(Rc::clone(&waiting));
    worker.set_onerror(Some(raised.as_ref().unchecked_ref()));
    Live {
        worker,
        waiting,
        _handler: handler,
        _raised: raised,
    }
}
