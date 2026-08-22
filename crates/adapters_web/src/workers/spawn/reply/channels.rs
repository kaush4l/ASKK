//! THE THREE THINGS A WORKER SAYS ABOUT ITSELF alongside an answer, and the
//! one reader that takes them off a message.
//!
//! Split from [`super`] at I12's 200 lines, and along the seam that was
//! already there: everything here is about the SIDE channels — what a Worker
//! reports about its own window, what it wrote, and what it did — while its
//! parent owns the answer, the turn slot and the Worker's life.

use std::cell::RefCell;

use js_sys::Reflect;
use wasm_bindgen::JsValue;

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
pub(super) fn said(data: &JsValue, key: &str) -> Option<String> {
    Reflect::get(data, &key.into()).ok()?.as_string()
}

/// Every agent this Worker has written with `write_agent`; none, if absent.
pub(super) fn authored_in(data: &JsValue) -> Vec<Authored> {
    said(data, "authored")
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

/// The tool calls and spend it has not reported yet. An empty list is nothing
/// new, which is not the same fact as an empty report.
pub(super) fn activity_in(data: &JsValue, who: &str) -> Option<Activity> {
    match said(data, "activity")?.trim() {
        "" | "[]" => None,
        raw => Some((who.to_string(), raw.to_string())),
    }
}

/// What it holds in its own window. Absent means it said nothing, which the
/// pane prints as "not reported" rather than as a made-up number.
pub(super) fn memory_of(data: &JsValue, who: &str) -> Option<Memory> {
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
pub(super) fn drain_side_channels(
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
