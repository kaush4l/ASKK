//! The in-memory stores (`MemKv`/`MemBlob`/`MemStore`) — split from lib.rs
//! to hold the 200-line rule.

use std::cell::RefCell;
use std::collections::HashMap;

use kernel::{BlobStore, BoxFuture, KvStore, StoreError, StorePort};

use crate::ready;

/// HashMap-backed `KvStore`. `RefCell` because ports take `&self` (the wasm
/// host is single-threaded and tests are too — no lock needed or wanted).
#[derive(Debug, Default)]
pub struct MemKv {
    map: RefCell<HashMap<String, String>>,
}

impl MemKv {
    /// Empty store; tests seed it through the trait like production would.
    pub fn new() -> MemKv {
        MemKv::default()
    }
}

impl KvStore for MemKv {
    fn get<'a>(&'a self, key: &'a str) -> BoxFuture<'a, Result<Option<String>, StoreError>> {
        ready(Ok(self.map.borrow().get(key).cloned()))
    }
    fn put<'a>(&'a self, key: &'a str, value: &'a str) -> BoxFuture<'a, Result<(), StoreError>> {
        self.map.borrow_mut().insert(key.into(), value.into());
        ready(Ok(()))
    }
    fn delete<'a>(&'a self, key: &'a str) -> BoxFuture<'a, Result<(), StoreError>> {
        self.map.borrow_mut().remove(key);
        ready(Ok(()))
    }
    fn list_prefix<'a>(
        &'a self,
        prefix: &'a str,
    ) -> BoxFuture<'a, Result<Vec<String>, StoreError>> {
        let mut keys: Vec<String> = self
            .map
            .borrow()
            .keys()
            .filter(|k| k.starts_with(prefix))
            .cloned()
            .collect();
        keys.sort(); // IndexedDB key ranges come back sorted; match it
        ready(Ok(keys))
    }
}

/// HashMap-backed `BlobStore`, same shape and reasons as `MemKv`.
#[derive(Debug, Default)]
pub struct MemBlob {
    map: RefCell<HashMap<String, Vec<u8>>>,
}

impl MemBlob {
    /// Empty blob store.
    pub fn new() -> MemBlob {
        MemBlob::default()
    }
}

impl BlobStore for MemBlob {
    fn read<'a>(&'a self, path: &'a str) -> BoxFuture<'a, Result<Option<Vec<u8>>, StoreError>> {
        ready(Ok(self.map.borrow().get(path).cloned()))
    }
    fn write<'a>(
        &'a self,
        path: &'a str,
        bytes: &'a [u8],
    ) -> BoxFuture<'a, Result<(), StoreError>> {
        self.map.borrow_mut().insert(path.into(), bytes.to_vec());
        ready(Ok(()))
    }
    fn delete<'a>(&'a self, path: &'a str) -> BoxFuture<'a, Result<(), StoreError>> {
        self.map.borrow_mut().remove(path);
        ready(Ok(()))
    }
    fn list_prefix<'a>(
        &'a self,
        prefix: &'a str,
    ) -> BoxFuture<'a, Result<Vec<String>, StoreError>> {
        let mut keys: Vec<String> = self
            .map
            .borrow()
            .keys()
            .filter(|k| k.starts_with(prefix))
            .cloned()
            .collect();
        keys.sort();
        ready(Ok(keys))
    }
}

/// Both in-memory stores behind the one storage port (ADR-005 seam).
#[derive(Debug, Default)]
pub struct MemStore {
    pub kv: MemKv,
    pub blob: MemBlob,
}

impl StorePort for MemStore {
    fn kv(&self) -> &dyn KvStore {
        &self.kv
    }
    fn blob(&self) -> &dyn BlobStore {
        &self.blob
    }
}
