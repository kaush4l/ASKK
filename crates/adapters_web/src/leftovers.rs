//! WHAT THE DELETED ENGINE LEFT IN THIS BROWSER (2026-08-18, I11).
//!
//! CheerpX is gone. Deleting the code that wrote a browser's storage does not
//! delete the storage, so a returning visitor's origin still holds two things
//! nothing in this build can read:
//!
//! - `askk.engine` in `localStorage` — the engine choice. A dead preference,
//!   not data: no reader, no writer, and no meaning now that there is one
//!   engine. This module removes it on every page load, which is the whole of
//!   what "migrating" it can mean.
//! - the `askk-workspace` IndexedDB — the OVERLAY CheerpX kept every write in.
//!   That is a person's actual work: git clones, installed packages, files
//!   they wrote. It is unreachable, because reading it needs the engine that
//!   read it, and that engine is deleted.
//!
//! THE SECOND ONE IS NOT OURS TO DELETE. I11 forbids losing data across a
//! release and the project's own rule stops at destructive storage; silently
//! dropping a folder somebody trusted us with would be exactly the failure
//! I11 names. So this module does not delete it, and it does not stay quiet
//! about it either — the two options a silent build picks between. It REPORTS
//! that the database is there, and `ui/settings/linux_engine.rs` says so on the card that
//! used to carry the engine choice, with a control that removes it on a press.
//! The person decides; the page tells them there is something to decide.
//!
//! I15: `indexedDB.databases()` is the only way to ask without creating what
//! you are asking about. Where the browser will not answer, this reports
//! `Unknown` and the card says nothing — it never claims a folder is there,
//! and never claims one is not.

use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;

/// The overlay CheerpX mounted the container's writes into. This one string
/// decides WHICH of a person's databases a press destroys, so it is citable
/// rather than asserted. To check it, with nothing but this repo:
///
/// ```text
/// git show 2c89160:crates/adapters_web/src/cheerpx.rs | sed -n 48p
/// ```
///
/// `2c89160` is the last commit that still contains `cheerpx.rs` (find it
/// again with `git log --oneline -1 -- crates/adapters_web/src/cheerpx.rs`),
/// and line 48 is its `CACHE` const — the name CheerpX passed to `cx_boot`
/// as the overlay's IndexedDB. A commit hash is used deliberately: `HEAD`
/// stops resolving the moment the deletion lands, and a tag would have to
/// exist first, which is not this file's call to make.
pub const WORKSPACE_DB: &str = "askk-workspace";

/// The engine choice. One writer, one reader, both deleted.
const ENGINE_KEY: &str = "askk.engine";

/// Whether the deleted engine's workspace is still on this origin.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Leftover {
    /// The browser answered and the database is there.
    Present,
    /// The browser answered and it is not.
    Absent,
    /// The browser would not enumerate its databases. Not the same as
    /// `Absent`, and rendered as nothing rather than as a reassurance.
    Unknown,
}

/// Remove the dead engine preference. Idempotent, and silent on purpose: it
/// is a setting for a control that no longer exists, so there is nothing a
/// person could want to know or decide about it.
pub fn drop_engine_setting() {
    if let Some(s) = web_sys::window().and_then(|w| w.local_storage().ok().flatten()) {
        let _ = s.remove_item(ENGINE_KEY);
    }
}

fn factory() -> Option<web_sys::IdbFactory> {
    web_sys::window()?.indexed_db().ok().flatten()
}

/// Ask the browser whether `askk-workspace` still exists, WITHOUT opening it —
/// `open()` would create the database this is trying to find out about.
pub async fn workspace_leftover() -> Leftover {
    let Some(idb) = factory() else {
        return Leftover::Unknown;
    };
    let Ok(f) = js_sys::Reflect::get(&idb, &"databases".into()) else {
        return Leftover::Unknown;
    };
    let Ok(f) = f.dyn_into::<js_sys::Function>() else {
        return Leftover::Unknown; // not implemented here (I15)
    };
    let Ok(promise) = f.call0(&idb) else {
        return Leftover::Unknown;
    };
    let Ok(promise) = promise.dyn_into::<js_sys::Promise>() else {
        return Leftover::Unknown;
    };
    let Ok(list) = JsFuture::from(promise).await else {
        return Leftover::Unknown;
    };
    let Ok(list) = list.dyn_into::<js_sys::Array>() else {
        return Leftover::Unknown;
    };
    let found = list.iter().any(|entry| {
        js_sys::Reflect::get(&entry, &"name".into())
            .ok()
            .and_then(|n| n.as_string())
            .as_deref()
            == Some(WORKSPACE_DB)
    });
    match found {
        true => Leftover::Present,
        false => Leftover::Absent,
    }
}

/// Delete it, because somebody pressed the button that says so. Never called
/// on a timer, on boot, or on anybody's behalf.
///
/// `on_blocked` runs at most once, if another connection is still holding the
/// database open — in practice ANOTHER TAB on the old build, which is exactly
/// the population that has this database at all, so it is the expected case
/// and not an edge one.
///
/// WHY BLOCKED IS NOT A FAILURE. `blocked` is not an outcome; it is IndexedDB
/// saying "not yet". The request stays pending and fires `success` the moment
/// the last other connection closes. Returning an error here would reset the
/// button and tell a person the delete did not happen, while the browser goes
/// on to do it anyway behind them — a lie about a destructive action, which
/// is worse than a slow one. So the request is still awaited, and `on_blocked`
/// exists only so the page can say WHY it is still waiting and what closing
/// the other tab would fix. If they never close it, the control keeps saying
/// it is waiting, which is the truth; nothing is silently dropped either way.
pub async fn drop_workspace_leftover(
    on_blocked: impl FnOnce() + 'static,
) -> Result<(), crate::error::WebError> {
    let Some(idb) = factory() else {
        return Ok(());
    };
    let request = idb.delete_database(WORKSPACE_DB).map_err(|_| refused())?;
    // `Promise::new` takes an `FnMut` and calls it once; the `Option` is what
    // lets a `FnOnce` be moved out of it.
    let mut on_blocked = Some(on_blocked);
    let promise = js_sys::Promise::new(&mut |resolve, reject| {
        let done = wasm_bindgen::closure::Closure::once_into_js(move |_: web_sys::Event| {
            let _ = resolve.call0(&wasm_bindgen::JsValue::NULL);
        });
        let failed = wasm_bindgen::closure::Closure::once_into_js(move |_: web_sys::Event| {
            let _ = reject.call0(&wasm_bindgen::JsValue::NULL);
        });
        request.set_onsuccess(done.dyn_ref());
        request.set_onerror(failed.dyn_ref());
        if let Some(say) = on_blocked.take() {
            let held = wasm_bindgen::closure::Closure::once_into_js(move |_: web_sys::Event| say());
            request.set_onblocked(held.dyn_ref());
        }
    });
    JsFuture::from(promise)
        .await
        .map(|_| ())
        .map_err(|_| refused())
}

fn refused() -> crate::error::WebError {
    crate::error::WebError::Js {
        message: "the browser refused to delete it".into(),
    }
}
