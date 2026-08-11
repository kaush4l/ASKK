//! The recording store the log tests drive. Its own module for the 200-line
//! rule (I12): the mirror property is about CONTENT, drain-before-rewrite is
//! about ORDER, and only a store that records order can be asked about it.

use std::cell::RefCell;
use std::collections::HashMap;

use adapters_test::MemBlob;
use kernel::{BlobStore, BoxFuture, KvStore, StoreError, StorePort};

/// A store that also remembers WHAT ORDER it was asked to do things in. The
/// mirror property is about content; drain-before-rewrite is about order, and
/// only a store that records order can be asked about it.
#[derive(Debug, Default)]
pub struct Recording {
    map: RefCell<HashMap<String, String>>,
    pub ops: RefCell<Vec<String>>,
    blob: MemBlob,
}

impl Recording {
    /// This agent's log as the store holds it, in key order.
    pub fn log(&self, agent: &str) -> Vec<String> {
        let prefix = format!("log/{agent}/");
        let map = self.map.borrow();
        let mut keys: Vec<&String> = map.keys().filter(|k| k.starts_with(&prefix)).collect();
        keys.sort();
        keys.into_iter().map(|k| map[k].clone()).collect()
    }
}

fn ready<'a, T: 'a>(value: T) -> BoxFuture<'a, T> {
    Box::pin(std::future::ready(value))
}

impl KvStore for Recording {
    fn get<'a>(&'a self, key: &'a str) -> BoxFuture<'a, Result<Option<String>, StoreError>> {
        ready(Ok(self.map.borrow().get(key).cloned()))
    }
    fn put<'a>(&'a self, key: &'a str, value: &'a str) -> BoxFuture<'a, Result<(), StoreError>> {
        if key.starts_with("log/") {
            self.ops.borrow_mut().push(format!("append {key}"));
        }
        self.map.borrow_mut().insert(key.into(), value.into());
        ready(Ok(()))
    }
    fn delete<'a>(&'a self, key: &'a str) -> BoxFuture<'a, Result<(), StoreError>> {
        self.map.borrow_mut().remove(key);
        ready(Ok(()))
    }
    fn list_prefix<'a>(&'a self, prefix: &'a str) -> BoxFuture<'a, Result<Vec<String>, StoreError>> {
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
    fn replace_prefix<'a>(
        &'a self,
        prefix: &'a str,
        entries: &'a [(String, String)],
    ) -> BoxFuture<'a, Result<(), StoreError>> {
        self.ops.borrow_mut().push(format!("rewrite {prefix}"));
        let mut map = self.map.borrow_mut();
        map.retain(|k, _| !k.starts_with(prefix));
        for (key, value) in entries {
            map.insert(key.clone(), value.clone());
        }
        ready(Ok(()))
    }
}

impl BlobStore for Recording {
    fn read<'a>(&'a self, p: &'a str) -> BoxFuture<'a, Result<Option<Vec<u8>>, StoreError>> {
        self.blob.read(p)
    }
    fn write<'a>(&'a self, p: &'a str, b: &'a [u8]) -> BoxFuture<'a, Result<(), StoreError>> {
        self.blob.write(p, b)
    }
    fn delete<'a>(&'a self, p: &'a str) -> BoxFuture<'a, Result<(), StoreError>> {
        BlobStore::delete(&self.blob, p)
    }
    fn list_prefix<'a>(&'a self, p: &'a str) -> BoxFuture<'a, Result<Vec<String>, StoreError>> {
        BlobStore::list_prefix(&self.blob, p)
    }
}

impl StorePort for Recording {
    fn kv(&self) -> &dyn KvStore {
        self
    }
    fn blob(&self) -> &dyn BlobStore {
        self
    }
}

