//! Storage seams (ADR-009): [`KvStore`] (key → JSON) and [`BlobStore`]
//! (path → bytes) are the two traits the runtime persists through.
//! Implementors: [`MemKv`]/[`MemBlob`] here (tests + host runs),
//! `OpfsKv`/`OpfsBlob` in `web/src/host/opfs.rs` (browser). The traits
//! assume nothing beyond flat path-string semantics — no directories, no
//! metadata, no atomicity guarantees.
//!
//! Namespacing is by prefix convention, one owner per prefix. KV keys:
//! `session/*` (`SessionStore`), `memory/<agent_id>` (`MemoryStore`),
//! `board/<id>` (`BoardStore`), `notes/<slug>` (`tools/memory_tools.rs`).
//! Blob paths: `seg-<epoch>.jsonl` (`SignalLog`).

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::fmt;
use std::future::Future;
use std::pin::Pin;

use serde_json::Value;

/// Local (non-Send) boxed future — the browser is single-threaded (ADR-009).
/// Shape-identical to `futures::future::LocalBoxFuture`; defined here so the
/// runtime needs no extra dependency.
pub type LocalBoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + 'a>>;

/// One error type for the storage seams. Carries a message, nothing else —
/// callers surface it, they don't branch on it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoreError {
    pub message: String,
}

impl StoreError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "store error: {}", self.message)
    }
}

impl std::error::Error for StoreError {}

impl From<serde_json::Error> for StoreError {
    fn from(err: serde_json::Error) -> Self {
        Self::new(err.to_string())
    }
}

/// Key → JSON value store. Dyn-safe; local boxed futures, no Send bounds
/// (single-threaded browser). Keys are flat strings; namespacing is by the
/// prefix conventions in the module banner. Last write wins.
pub trait KvStore {
    fn get(&self, key: &str) -> LocalBoxFuture<'_, Result<Option<Value>, StoreError>>;
    fn set(&self, key: &str, value: Value) -> LocalBoxFuture<'_, Result<(), StoreError>>;
    fn remove(&self, key: &str) -> LocalBoxFuture<'_, Result<(), StoreError>>;
    /// All keys starting with `prefix`, sorted.
    fn list_prefix(&self, prefix: &str) -> LocalBoxFuture<'_, Result<Vec<String>, StoreError>>;
}

/// Path → byte blob store. Whole-blob read/write — no append primitive;
/// appending is the caller's concern (`SignalLog` rewrites its whole
/// segment per append).
pub trait BlobStore {
    fn read(&self, path: &str) -> LocalBoxFuture<'_, Result<Option<Vec<u8>>, StoreError>>;
    fn write(&self, path: &str, bytes: &[u8]) -> LocalBoxFuture<'_, Result<(), StoreError>>;
    fn remove(&self, path: &str) -> LocalBoxFuture<'_, Result<(), StoreError>>;
    /// All paths starting with `prefix`, sorted.
    fn list(&self, prefix: &str) -> LocalBoxFuture<'_, Result<Vec<String>, StoreError>>;
}

/// In-memory `KvStore` for tests and host runs.
#[derive(Default)]
pub struct MemKv {
    map: RefCell<BTreeMap<String, Value>>,
}

impl MemKv {
    pub fn new() -> Self {
        Self::default()
    }
}

impl KvStore for MemKv {
    fn get(&self, key: &str) -> LocalBoxFuture<'_, Result<Option<Value>, StoreError>> {
        let value = self.map.borrow().get(key).cloned();
        Box::pin(async move { Ok(value) })
    }

    fn set(&self, key: &str, value: Value) -> LocalBoxFuture<'_, Result<(), StoreError>> {
        self.map.borrow_mut().insert(key.to_string(), value);
        Box::pin(async { Ok(()) })
    }

    fn remove(&self, key: &str) -> LocalBoxFuture<'_, Result<(), StoreError>> {
        self.map.borrow_mut().remove(key);
        Box::pin(async { Ok(()) })
    }

    fn list_prefix(&self, prefix: &str) -> LocalBoxFuture<'_, Result<Vec<String>, StoreError>> {
        let keys = self
            .map
            .borrow()
            .keys()
            .filter(|k| k.starts_with(prefix))
            .cloned()
            .collect();
        Box::pin(async move { Ok(keys) })
    }
}

/// In-memory `BlobStore` for tests and host runs.
#[derive(Default)]
pub struct MemBlob {
    map: RefCell<BTreeMap<String, Vec<u8>>>,
}

impl MemBlob {
    pub fn new() -> Self {
        Self::default()
    }
}

impl BlobStore for MemBlob {
    fn read(&self, path: &str) -> LocalBoxFuture<'_, Result<Option<Vec<u8>>, StoreError>> {
        let bytes = self.map.borrow().get(path).cloned();
        Box::pin(async move { Ok(bytes) })
    }

    fn write(&self, path: &str, bytes: &[u8]) -> LocalBoxFuture<'_, Result<(), StoreError>> {
        self.map
            .borrow_mut()
            .insert(path.to_string(), bytes.to_vec());
        Box::pin(async { Ok(()) })
    }

    fn remove(&self, path: &str) -> LocalBoxFuture<'_, Result<(), StoreError>> {
        self.map.borrow_mut().remove(path);
        Box::pin(async { Ok(()) })
    }

    fn list(&self, prefix: &str) -> LocalBoxFuture<'_, Result<Vec<String>, StoreError>> {
        let paths = self
            .map
            .borrow()
            .keys()
            .filter(|k| k.starts_with(prefix))
            .cloned()
            .collect();
        Box::pin(async move { Ok(paths) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::block_on;
    use serde_json::json;

    #[test]
    fn kv_roundtrip_and_remove() {
        let kv = MemKv::new();
        assert_eq!(block_on(kv.get("a")).unwrap(), None);
        block_on(kv.set("a", json!({"x": 1}))).unwrap();
        assert_eq!(block_on(kv.get("a")).unwrap(), Some(json!({"x": 1})));
        block_on(kv.set("a", json!(2))).unwrap(); // overwrite
        assert_eq!(block_on(kv.get("a")).unwrap(), Some(json!(2)));
        block_on(kv.remove("a")).unwrap();
        assert_eq!(block_on(kv.get("a")).unwrap(), None);
    }

    #[test]
    fn kv_list_prefix_sorted() {
        let kv = MemKv::new();
        for key in ["p/b", "p/a", "q/x"] {
            block_on(kv.set(key, json!(1))).unwrap();
        }
        assert_eq!(block_on(kv.list_prefix("p/")).unwrap(), vec!["p/a", "p/b"]);
        assert!(block_on(kv.list_prefix("z/")).unwrap().is_empty());
    }

    #[test]
    fn blob_roundtrip_and_list() {
        let blobs = MemBlob::new();
        assert_eq!(block_on(blobs.read("seg-1.jsonl")).unwrap(), None);
        block_on(blobs.write("seg-1.jsonl", b"hello")).unwrap();
        block_on(blobs.write("seg-2.jsonl", b"world")).unwrap();
        block_on(blobs.write("other.bin", b"x")).unwrap();
        assert_eq!(
            block_on(blobs.read("seg-1.jsonl")).unwrap(),
            Some(b"hello".to_vec())
        );
        assert_eq!(
            block_on(blobs.list("seg-")).unwrap(),
            vec!["seg-1.jsonl", "seg-2.jsonl"]
        );
        block_on(blobs.remove("seg-1.jsonl")).unwrap();
        assert_eq!(block_on(blobs.read("seg-1.jsonl")).unwrap(), None);
    }

    #[test]
    fn store_error_displays_message() {
        let err = StoreError::new("disk gone");
        assert_eq!(err.to_string(), "store error: disk gone");
        let json_err = serde_json::from_str::<Value>("{").unwrap_err();
        assert!(!StoreError::from(json_err).message.is_empty());
    }
}
