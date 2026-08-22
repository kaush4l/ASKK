//! WEB LOCKS, HALF TWO: **the lock that exists only to be waited on.**
//!
//! ```text
//!   askk/awake           exclusive, queueing
//!     HELD BY    the PAGE, from boot until the tab closes.
//!     AWAITED BY every agent Worker this page starts, forever — and by any
//!                second tab's page, which queues behind the first.
//! ```
//!
//! The second lock is the freeze story and nothing else. Chrome 133+ freezes a
//! hidden, CPU-heavy context group — page and Workers together — after five
//! minutes, and the exemption is holding a lock some other context is WAITING
//! on. An uncontended lock exempts nothing, so the contention is manufactured:
//! the Workers queue on a lock they will never receive, and the queue is the
//! whole mechanism. Nothing reads it, nothing is guarded by it.
//!
//! Two honest limits, and the first is worse than a trimmed roster. **The
//! exemption needs a waiter RIGHT NOW**, and the page takes `askk/awake` at boot
//! while the Workers queue only as they come up — so every load has a window
//! where the lock is held and uncontended, whatever the roster says. Trimming
//! the roster to `main` widens that window to the session; it is not the only
//! way to be unexempt, and a sentence phrased about the roster would be a
//! true-sounding claim about the wrong thing. [`awake_contended`] asks the
//! question actually being asked. The second limit is unchanged: a Worker's
//! grant would mean the page is gone, and it never arrives, because a dedicated
//! Worker dies with the page that made it.
//!
//! Everything it reaches the browser with — `manager`, `request`, `options`,
//! `forever` — belongs to [`super`], because both halves ask one `LockManager`
//! the same way and a second copy of that reflection would be a second place to
//! keep in step.

use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;

use super::{forever, manager, options, request};

/// A Worker's end: queue on `askk/awake` behind the page and never get it.
/// This call IS the contention; there is nothing to await and nothing to read.
pub fn await_awake() {
    queue(false);
}

/// One request on the awake lock: the page HOLDS it, a Worker merely queues.
/// `pub(super)` for `page_claim`, which takes the page's end of the pair at the
/// one moment a page comes up.
pub(super) fn queue(hold: bool) {
    let Some(locks) = manager() else { return };
    let cb = Closure::wrap(Box::new(move |_lock: JsValue| -> JsValue {
        match hold {
            true => forever().into(),
            false => JsValue::UNDEFINED,
        }
    }) as Box<dyn FnMut(JsValue) -> JsValue>);
    let _ = request(&locks, core::AWAKE_LOCK, &options(false), cb.as_ref());
    cb.forget();
}

/// IS ANYTHING ACTUALLY WAITING ON `askk/awake` — the fact the freeze story
/// depends on, asked of the browser rather than inferred.
///
/// `None` is "nothing was asked", exactly as [`writership`] means it: no
/// `navigator`, no `locks`, no `query`, a rejected promise, a shape this cannot
/// read. It is NOT "nothing is waiting", and no caller may collapse the two —
/// an unanswerable question reported as a reassuring answer is the failure this
/// whole file is careful about (I15). `Some(false)` is the browser saying the
/// queue is empty, which is the state the exemption is lost in.
///
/// WHY `query()` AND NOT THE ROSTER. A roster naming `critic` does not mean a
/// `critic` Worker exists: `bringup::wake_roster` starts them, and one that
/// failed to start is indistinguishable from one never listed. Only the lock
/// manager knows who is really queued — and the boot window this exists to
/// catch is invisible to any count of names.
///
/// UNVERIFIABLE HERE, AND SAID SO (T51), exactly as [`page_claim`] and
/// [`await_awake`] are. Three claims ride on a real browser: that `query()` is
/// reachable by `Reflect` in a window AND a dedicated Worker, that its
/// `pending` array carries a `name` per waiting request, and that a Worker's
/// queued `askk/awake` appears there while the page holds the lock.
pub async fn awake_contended() -> Option<bool> {
    let locks = manager()?;
    let query = js_sys::Reflect::get(&locks, &"query".into())
        .ok()?
        .dyn_into::<js_sys::Function>()
        .ok()?;
    let asked = query.call0(&locks).ok()?.dyn_into::<js_sys::Promise>().ok()?;
    let state = JsFuture::from(asked).await.ok()?;
    let pending = js_sys::Reflect::get(&state, &"pending".into())
        .ok()?
        .dyn_into::<js_sys::Array>()
        .ok()?;
    Some(pending.iter().any(|waiter| {
        js_sys::Reflect::get(&waiter, &"name".into())
            .ok()
            .and_then(|name| name.as_string())
            .is_some_and(|name| name == core::AWAKE_LOCK)
    }))
}
