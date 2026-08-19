//! `KvStore` over the IndexedDB database `idb.rs` opens: the key half of the
//! store, whose weight is `replace_prefix` — a whole prefix swapped inside ONE
//! transaction, so a crash mid-write cannot leave half a segment behind.

use wasm_bindgen::JsValue;
use web_sys::{IdbKeyRange, IdbTransactionMode};

use kernel::{BoxFuture, KvStore, StoreError};

use super::bridge::{await_request, err};
use super::{IdbStore, KV};

impl KvStore for IdbStore {
    fn get<'a>(&'a self, key: &'a str) -> BoxFuture<'a, Result<Option<String>, StoreError>> {
        Box::pin(async move {
            let req = self.request(KV, IdbTransactionMode::Readonly, |s| {
                s.get(&JsValue::from_str(key))
            })?;
            let val = await_request(req).await.map_err(|e| err("get", e))?;
            if val.is_undefined() {
                return Ok(None);
            }
            val.as_string()
                .map(Some)
                .ok_or_else(|| StoreError::Corrupt {
                    key: key.into(),
                    message: "stored value not a string".into(),
                })
        })
    }
    fn put<'a>(&'a self, key: &'a str, value: &'a str) -> BoxFuture<'a, Result<(), StoreError>> {
        Box::pin(async move {
            let req = self.request(KV, IdbTransactionMode::Readwrite, |s| {
                s.put_with_key(&JsValue::from_str(value), &JsValue::from_str(key))
            })?;
            await_request(req).await.map_err(|e| err("put", e))?;
            Ok(())
        })
    }
    fn delete<'a>(&'a self, key: &'a str) -> BoxFuture<'a, Result<(), StoreError>> {
        Box::pin(async move {
            let req = self.request(KV, IdbTransactionMode::Readwrite, |s| {
                s.delete(&JsValue::from_str(key))
            })?;
            await_request(req).await.map_err(|e| err("delete", e))?;
            Ok(())
        })
    }
    fn list_prefix<'a>(
        &'a self,
        prefix: &'a str,
    ) -> BoxFuture<'a, Result<Vec<String>, StoreError>> {
        Box::pin(self.keys_with_prefix(KV, prefix))
    }

    /// The Python's atomic `_replace_log`, as ONE IndexedDB transaction: the
    /// old range is deleted and the new entries written together, so a reader
    /// sees the old log or the new one and never half of either. The default
    /// implementation would do the same writes in separate transactions, which
    /// is exactly the truncated-file case `replace` exists to prevent.
    fn replace_prefix<'a>(
        &'a self,
        prefix: &'a str,
        entries: &'a [(String, String)],
    ) -> BoxFuture<'a, Result<(), StoreError>> {
        Box::pin(async move {
            let upper = format!("{prefix}\u{10FFFF}");
            let range = IdbKeyRange::bound(&JsValue::from_str(prefix), &JsValue::from_str(&upper))
                .map_err(|e| err("range", e))?;
            let txn = self
                .db
                .transaction_with_str_and_mode(KV, IdbTransactionMode::Readwrite)
                .map_err(|e| err("txn", e))?;
            let store = txn.object_store(KV).map_err(|e| err("store", e))?;
            store
                .delete(range.as_ref())
                .map_err(|e| err("clear", e))?;
            let mut last = None;
            for (key, value) in entries {
                last = Some(
                    store
                        .put_with_key(&JsValue::from_str(value), &JsValue::from_str(key))
                        .map_err(|e| err("put", e))?,
                );
            }
            // Awaiting the LAST request in the transaction awaits the whole of
            // it: requests in one transaction complete in the order they were
            // made. An empty rewrite has only the delete to wait on.
            match last {
                Some(req) => await_request(req).await.map(|_| ()),
                None => Ok(()),
            }
            .map_err(|e| err("replace", e))
        })
    }
}

