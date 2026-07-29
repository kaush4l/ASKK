//! Spike D: IndexedDB from Rust — minimal KV probe (`put` / `get` /
//! `list_prefix` over one object store).
//!
//! Deliberately NOT a trait and NOT a port impl (PROMPT §13: no speculative
//! generality). This exists to measure what the callback→future plumbing
//! costs before ADR-005 commits `StorePort` to a backend. Findings live in
//! `docs/research/indexeddb.md`.

use js_sys::Promise;
use serde_json::Value;
use wasm_bindgen::closure::Closure;
use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_futures::JsFuture;
use web_sys::{IdbDatabase, IdbKeyRange, IdbRequest, IdbTransaction, IdbTransactionMode};

const STORE: &str = "kv";

/// Stringly error on purpose: the probe only surfaces failures; nothing
/// branches on them.
#[derive(Debug)]
pub struct Error(pub String);

fn err(context: &str, e: JsValue) -> Error {
    let msg = e
        .as_string()
        .or_else(|| {
            js_sys::Reflect::get(&e, &"message".into())
                .ok()
                .and_then(|m| m.as_string())
        })
        .unwrap_or_else(|| format!("{e:?}"));
    Error(format!("idb {context}: {msg}"))
}

/// An open database holding the single `"kv"` object store.
pub struct Db(IdbDatabase);

/// Open (creating on first run) database `name`, version 1.
pub async fn open(name: &str) -> Result<Db, Error> {
    let factory = web_sys::window()
        .ok_or_else(|| Error("no window".into()))?
        .indexed_db()
        .map_err(|e| err("factory", e))?
        .ok_or_else(|| Error("indexedDB unavailable".into()))?;
    let open_req = factory.open_with_u32(name, 1).map_err(|e| err("open", e))?;
    let for_upgrade = open_req.clone();
    let on_upgrade = Closure::once(move |_: JsValue| {
        // upgradeneeded fires only on first creation (fixed version 1).
        let db: IdbDatabase = for_upgrade.result().unwrap().unchecked_into();
        db.create_object_store(STORE).unwrap();
    });
    open_req.set_onupgradeneeded(Some(on_upgrade.as_ref().unchecked_ref()));
    let db = await_request(open_req.unchecked_into::<IdbRequest>())
        .await
        .map_err(|e| err("open", e))?;
    drop(on_upgrade); // alive across the await; harmlessly unfired on reopen
    Ok(Db(db.unchecked_into()))
}

impl Db {
    /// Store `value` (as its JSON text) under `key`. Resolves at transaction
    /// commit, not request success — timings measure the commit.
    pub async fn put(&self, key: &str, value: &Value) -> Result<(), Error> {
        let txn = self
            .0
            .transaction_with_str_and_mode(STORE, IdbTransactionMode::Readwrite)
            .map_err(|e| err("txn", e))?;
        let store = txn.object_store(STORE).map_err(|e| err("store", e))?;
        store
            .put_with_key(
                &JsValue::from_str(&value.to_string()),
                &JsValue::from_str(key),
            )
            .map_err(|e| err("put", e))?;
        await_txn(txn).await.map_err(|e| err("put commit", e))
    }

    pub async fn get(&self, key: &str) -> Result<Option<Value>, Error> {
        let txn = self
            .0
            .transaction_with_str(STORE)
            .map_err(|e| err("txn", e))?;
        let store = txn.object_store(STORE).map_err(|e| err("store", e))?;
        let req = store
            .get(&JsValue::from_str(key))
            .map_err(|e| err("get", e))?;
        let val = await_request(req).await.map_err(|e| err("get", e))?;
        if val.is_undefined() {
            return Ok(None);
        }
        let text = val
            .as_string()
            .ok_or_else(|| Error("stored value not a string".into()))?;
        serde_json::from_str(&text)
            .map(Some)
            .map_err(|e| Error(format!("bad json under {key}: {e}")))
    }

    /// Sorted keys starting with `prefix` — one `getAllKeys` over a key range.
    pub async fn list_prefix(&self, prefix: &str) -> Result<Vec<String>, Error> {
        let txn = self
            .0
            .transaction_with_str(STORE)
            .map_err(|e| err("txn", e))?;
        let store = txn.object_store(STORE).map_err(|e| err("store", e))?;
        // ponytail: upper bound = prefix + U+10FFFF, so a key containing
        // U+10FFFF could escape the range. Switch to a cursor if that matters.
        let upper = format!("{prefix}\u{10FFFF}");
        let range = IdbKeyRange::bound(&JsValue::from_str(prefix), &JsValue::from_str(&upper))
            .map_err(|e| err("range", e))?;
        let req = store
            .get_all_keys_with_key(range.as_ref())
            .map_err(|e| err("getAllKeys", e))?;
        let arr: js_sys::Array = await_request(req)
            .await
            .map_err(|e| err("getAllKeys", e))?
            .unchecked_into();
        Ok(arr.iter().filter_map(|v| v.as_string()).collect())
    }
}

/// THE plumbing this spike exists to price: one IDBRequest → Future bridge.
/// resolve/reject are moved into once-closures wired to onsuccess/onerror;
/// whichever handler does not fire leaks its closure (`forget`).
async fn await_request(req: IdbRequest) -> Result<JsValue, JsValue> {
    let promise = Promise::new(&mut |resolve, reject| {
        let ok_req = req.clone();
        let on_ok = Closure::once(move |_: JsValue| {
            let val = ok_req.result().unwrap_or(JsValue::UNDEFINED);
            resolve.call1(&JsValue::UNDEFINED, &val).unwrap();
        });
        req.set_onsuccess(Some(on_ok.as_ref().unchecked_ref()));
        on_ok.forget(); // ponytail: ~2 small allocs leaked per op on the unfired path
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

/// Same bridge for transaction commit (oncomplete / onerror / onabort).
async fn await_txn(txn: IdbTransaction) -> Result<(), JsValue> {
    let promise = Promise::new(&mut |resolve, reject| {
        let on_done = Closure::once(move |_: JsValue| {
            resolve.call0(&JsValue::UNDEFINED).unwrap();
        });
        txn.set_oncomplete(Some(on_done.as_ref().unchecked_ref()));
        on_done.forget();
        // Separate once-closures for error/abort: both may fire for one
        // failure and a once-closure must not be invoked twice.
        for setter in [IdbTransaction::set_onerror, IdbTransaction::set_onabort] {
            let err_txn = txn.clone();
            let rej = reject.clone();
            let on_err = Closure::once(move |_: JsValue| {
                let e = err_txn
                    .error()
                    .map(JsValue::from)
                    .unwrap_or_else(|| JsValue::from_str("txn failed"));
                let _ = rej.call1(&JsValue::UNDEFINED, &e); // 2nd reject is a JS no-op
            });
            setter(&txn, Some(on_err.as_ref().unchecked_ref()));
            on_err.forget();
        }
    });
    JsFuture::from(promise).await.map(|_| ())
}
