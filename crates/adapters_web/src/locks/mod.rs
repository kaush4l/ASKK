//! WEB LOCKS, HALF ONE: **who may WRITE this agent's log** — and the reach into
//! `navigator.locks` that both halves share.
//!
//! The other half is [`awake`], and the split is the one `core::faculty` made
//! for the same reason: two subjects at the 200-line ceiling, where neither
//! could grow a sentence without the other paying for it. Two SUBJECTS, not two
//! functions — this lock decides something and is read; that one decides
//! nothing, is read by nobody, and exists only to be QUEUED ON. Filed together,
//! "the second lock is never used for what it names" was a warning a reader had
//! to be given first. Apart, it is simply what each file is about.
//!
//! **WHO HOLDS IT, AND WHO WAITS.**
//!
//! ```text
//!   askk/log/<agent>     exclusive, ifAvailable: true
//!     HELD BY    the one context that owns that agent's log: the page for
//!                `main`, each agent Worker for the agent it is. Held from
//!                boot until the context dies, because the callback returns a
//!                promise that never settles — the lifetime we want IS the
//!                context's, and the browser already releases on death.
//!     AWAITED BY nobody, ever. `ifAvailable` refuses instead of queueing, so
//!                a second tab learns it is a follower in the same turn of the
//!                event loop instead of hanging at boot. Deliberate: a queued
//!                follower would be promoted long after its window went stale,
//!                and would then write the log from a snapshot — the exact
//!                corruption the lock exists to prevent.
//! ```
//!
//! Reached with `js_sys::Reflect` off `globalThis`, for the reason `ondevice.rs`
//! states: `LockManager` is not in this project's enabled `web-sys` features,
//! and reflection is a typed binding with a feature test built in. `globalThis`
//! rather than `window` because every sub-agent runs in a Worker, whose
//! `navigator` is a `WorkerNavigator` and carries `locks` just the same.

use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;

use core::Writership;

mod awake;

pub use awake::{await_awake, awake_contended};

/// Ask for this agent's log lock and report what the answer means. `None`
/// anywhere on this path — no `navigator`, no `locks`, a `request` that is not
/// callable, a request that rejects — becomes `Unguarded`: nothing was asked,
/// so nothing is claimed and the page behaves exactly as it did before this
/// file existed (I15).
pub async fn writership(agent: &str) -> Writership {
    let Some(locks) = manager() else {
        return core::decide_writership(None);
    };
    let name = core::log_lock_name(agent);
    let decided = js_sys::Promise::new(&mut |resolve, _reject| {
        ask(&locks, &name, resolve);
    });
    core::decide_writership(JsFuture::from(decided).await.ok().and_then(|v| v.as_bool()))
}

/// One `ifAvailable` request, resolving `answer` with the grant. The callback
/// is what learns the answer — the request's own promise cannot say, because
/// when we DO get the lock it never settles.
fn ask(locks: &js_sys::Object, name: &str, answer: js_sys::Function) {
    let told = answer.clone();
    let held = Closure::wrap(Box::new(move |lock: JsValue| -> JsValue {
        let granted = !lock.is_null() && !lock.is_undefined();
        let _ = told.call1(&JsValue::NULL, &JsValue::from_bool(granted));
        // Granted: hold it for this context's whole life. Refused: return at
        // once, having taken nothing.
        match granted {
            true => forever().into(),
            false => JsValue::UNDEFINED,
        }
    }) as Box<dyn FnMut(JsValue) -> JsValue>);
    let sent = request(locks, name, &options(true), held.as_ref());
    // The closure outlives this call ON PURPOSE: while it holds the lock it is
    // the page. Leaking one closure per context is the cost of that.
    held.forget();
    match sent {
        // A REJECTION MUST NOT WEDGE BOOT. `writership` awaits `answer`, and
        // if the request throws — an invalid name, a context that forbids
        // locks — the callback never runs and boot would wait forever.
        Some(promise) => catch_with(&promise, answer),
        None => drop(answer.call1(&JsValue::NULL, &JsValue::UNDEFINED)),
    }
}

/// EVERYTHING THE PAGE ASKS THIS ORIGIN FOR, in one call: `main`'s log lock,
/// whose answer it returns, and `askk/awake`, which it simply keeps so that its
/// Workers have something to queue behind. One door, because the two are taken
/// once each, together, at the one moment a page comes up.
pub async fn page_claim() -> Writership {
    let mine = writership(core::ENTRY_AGENT).await;
    // The page's end of the contended pair: take `askk/awake` and keep it.
    awake::queue(true);
    mine
}

/// `navigator.locks`, in a window or a Worker, or `None` where there is none.
fn manager() -> Option<js_sys::Object> {
    let navigator = js_sys::Reflect::get(&js_sys::global(), &"navigator".into()).ok()?;
    js_sys::Reflect::get(&navigator, &"locks".into())
        .ok()?
        .dyn_into::<js_sys::Object>()
        .ok()
}

fn request(
    locks: &js_sys::Object,
    name: &str,
    options: &js_sys::Object,
    callback: &JsValue,
) -> Option<js_sys::Promise> {
    let f = js_sys::Reflect::get(locks, &"request".into())
        .ok()?
        .dyn_into::<js_sys::Function>()
        .ok()?;
    let args = js_sys::Array::of3(&JsValue::from_str(name), options, callback);
    f.apply(locks, &args).ok()?.dyn_into::<js_sys::Promise>().ok()
}

fn options(if_available: bool) -> js_sys::Object {
    let o = js_sys::Object::new();
    let _ = js_sys::Reflect::set(&o, &"mode".into(), &"exclusive".into());
    if if_available {
        let _ = js_sys::Reflect::set(&o, &"ifAvailable".into(), &JsValue::TRUE);
    }
    o
}

/// A promise that never settles — how a lock is held for a context's lifetime.
fn forever() -> js_sys::Promise {
    js_sys::Promise::new(&mut |_resolve, _reject| {})
}

/// Resolve `answer` with nothing if the request rejects.
fn catch_with(promise: &js_sys::Promise, answer: js_sys::Function) {
    let on_reject = Closure::wrap(Box::new(move |_e: JsValue| {
        let _ = answer.call1(&JsValue::NULL, &JsValue::UNDEFINED);
    }) as Box<dyn FnMut(JsValue)>);
    let _ = promise.catch(&on_reject);
    on_reject.forget();
}
