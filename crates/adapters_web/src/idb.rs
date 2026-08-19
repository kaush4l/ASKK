//! `StorePort` over IndexedDB — hand-rolled web-sys, no wrapper crate
//! (spike-idb: `indexed_db_futures` costs a 52-crate tree and a pin
//! conflict for ~70 lines of once-written plumbing, stolen from
//! `spikes/idb/src/lib.rs`).

use wasm_bindgen::closure::Closure;
use wasm_bindgen::{JsCast, JsValue};
use web_sys::{IdbDatabase, IdbKeyRange, IdbRequest, IdbTransactionMode};

mod bridge;
mod kv;

use bridge::{await_request, err};

use kernel::{BlobStore, BoxFuture, KvStore, StoreError, StorePort};

pub(crate) const KV: &str = "kv";
const BLOB: &str = "blob";

/// `StorePort` over one IndexedDB database, two object stores (`kv`, `blob`
/// — ADR-005: prefixes migrate in data, not in DDL).
pub struct IdbStore {
    pub(crate) db: IdbDatabase,
}

impl IdbStore {
    /// Open (creating the two object stores on first run), version 1.
    pub async fn open(name: &str) -> Result<IdbStore, StoreError> {
        let factory = factory()?;
        let open_req = factory.open_with_u32(name, 1).map_err(|e| err("open", e))?;
        let for_upgrade = open_req.clone();
        let on_upgrade = Closure::once(move |_: JsValue| {
            let db: IdbDatabase = for_upgrade.result().unwrap().unchecked_into();
            db.create_object_store(KV).unwrap();
            db.create_object_store(BLOB).unwrap();
        });
        open_req.set_onupgradeneeded(Some(on_upgrade.as_ref().unchecked_ref()));
        let db = await_request(open_req.unchecked_into::<IdbRequest>())
            .await
            .map_err(|e| err("open", e))?;
        drop(on_upgrade); // alive across the await; harmlessly unfired on reopen
        Ok(IdbStore {
            db: db.unchecked_into(),
        })
    }

    pub(crate) fn request(
        &self,
        store: &str,
        mode: IdbTransactionMode,
        op: impl FnOnce(&web_sys::IdbObjectStore) -> Result<IdbRequest, JsValue>,
    ) -> Result<IdbRequest, StoreError> {
        let txn = self
            .db
            .transaction_with_str_and_mode(store, mode)
            .map_err(|e| err("txn", e))?;
        let store = txn.object_store(store).map_err(|e| err("store", e))?;
        op(&store).map_err(|e| err("op", e))
    }

    /// Sorted keys of `store` starting with `prefix`.
    pub(crate) async fn keys_with_prefix(&self, store: &str, prefix: &str) -> Result<Vec<String>, StoreError> {
        // ponytail: upper bound = prefix + U+10FFFF (spike-idb); a key
        // containing U+10FFFF could escape the range — cursor if it matters.
        let upper = format!("{prefix}\u{10FFFF}");
        let range = IdbKeyRange::bound(&JsValue::from_str(prefix), &JsValue::from_str(&upper))
            .map_err(|e| err("range", e))?;
        let req = self.request(store, IdbTransactionMode::Readonly, |s| {
            s.get_all_keys_with_key(range.as_ref())
        })?;
        let arr: js_sys::Array = await_request(req)
            .await
            .map_err(|e| err("getAllKeys", e))?
            .unchecked_into();
        Ok(arr.iter().filter_map(|v| v.as_string()).collect())
    }
}

/// The `indexedDB` factory of whatever global this code is running in. A page
/// has `window`; a sub-agent's Worker has `WorkerGlobalScope` and no window at
/// all — and a sub-agent whose store is a HashMap loses its whole conversation
/// on every reload, which is the open item increment 07 recorded.
fn factory() -> Result<web_sys::IdbFactory, StoreError> {
    let missing = || StoreError::Backend {
        message: "indexedDB unavailable in this context".into(),
    };
    let global = js_sys::global();
    if let Some(window) = global.dyn_ref::<web_sys::Window>() {
        return window
            .indexed_db()
            .map_err(|e| err("factory", e))?
            .ok_or_else(missing);
    }
    global
        .dyn_ref::<web_sys::WorkerGlobalScope>()
        .ok_or_else(missing)?
        .indexed_db()
        .map_err(|e| err("factory", e))?
        .ok_or_else(missing)
}

impl BlobStore for IdbStore {
    fn read<'a>(&'a self, path: &'a str) -> BoxFuture<'a, Result<Option<Vec<u8>>, StoreError>> {
        Box::pin(async move {
            let req = self.request(BLOB, IdbTransactionMode::Readonly, |s| {
                s.get(&JsValue::from_str(path))
            })?;
            let val = await_request(req).await.map_err(|e| err("read", e))?;
            if val.is_undefined() {
                return Ok(None);
            }
            Ok(Some(js_sys::Uint8Array::new(&val).to_vec()))
        })
    }
    fn write<'a>(
        &'a self,
        path: &'a str,
        bytes: &'a [u8],
    ) -> BoxFuture<'a, Result<(), StoreError>> {
        Box::pin(async move {
            let array = js_sys::Uint8Array::from(bytes);
            let req = self.request(BLOB, IdbTransactionMode::Readwrite, |s| {
                s.put_with_key(&array, &JsValue::from_str(path))
            })?;
            await_request(req).await.map_err(|e| err("write", e))?;
            Ok(())
        })
    }
    fn delete<'a>(&'a self, path: &'a str) -> BoxFuture<'a, Result<(), StoreError>> {
        Box::pin(async move {
            let req = self.request(BLOB, IdbTransactionMode::Readwrite, |s| {
                s.delete(&JsValue::from_str(path))
            })?;
            await_request(req).await.map_err(|e| err("delete", e))?;
            Ok(())
        })
    }
    fn list_prefix<'a>(
        &'a self,
        prefix: &'a str,
    ) -> BoxFuture<'a, Result<Vec<String>, StoreError>> {
        Box::pin(self.keys_with_prefix(BLOB, prefix))
    }
}

impl StorePort for IdbStore {
    fn kv(&self) -> &dyn KvStore {
        self
    }
    fn blob(&self) -> &dyn BlobStore {
        self
    }
}
