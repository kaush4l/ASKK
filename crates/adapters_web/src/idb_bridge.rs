//! The IDBRequest -> Future bridge and error translation (spike-idb
//! plumbing) — split from idb.rs to hold the 200-line rule.

use js_sys::Promise;
use wasm_bindgen::closure::Closure;
use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_futures::JsFuture;
use web_sys::IdbRequest;

use kernel::StoreError;

pub(crate) fn err(context: &str, e: JsValue) -> StoreError {
    let msg = e
        .as_string()
        .or_else(|| {
            js_sys::Reflect::get(&e, &"message".into())
                .ok()
                .and_then(|m| m.as_string())
        })
        .unwrap_or_else(|| format!("{e:?}"));
    StoreError::Backend {
        message: format!("idb {context}: {msg}"),
    }
}

/// One IDBRequest → Future bridge (the plumbing spike-idb priced).
/// Whichever handler does not fire leaks its once-closure (`forget`) —
/// ~2 small allocs per op, accepted there and here.
pub(crate) async fn await_request(req: IdbRequest) -> Result<JsValue, JsValue> {
    let promise = Promise::new(&mut |resolve, reject| {
        let ok_req = req.clone();
        let on_ok = Closure::once(move |_: JsValue| {
            let val = ok_req.result().unwrap_or(JsValue::UNDEFINED);
            resolve.call1(&JsValue::UNDEFINED, &val).unwrap();
        });
        req.set_onsuccess(Some(on_ok.as_ref().unchecked_ref()));
        on_ok.forget();
        let err_req = req.clone();
        let on_err = Closure::once(move |_: JsValue| {
            let e = err_req
                .error()
                .ok()
                .flatten()
                .map(JsValue::from)
                .unwrap_or_else(|| JsValue::from_str("request failed"));
            reject.call1(&JsValue::UNDEFINED, &e).unwrap();
        });
        req.set_onerror(Some(on_err.as_ref().unchecked_ref()));
        on_err.forget();
    });
    JsFuture::from(promise).await
}
