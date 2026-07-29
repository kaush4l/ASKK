//! In-memory port implementations (ARCHITECTURE §2). Exists so every pure
//! crate tests on the host in milliseconds with no browser, no Wasm, no
//! network (I3). Imports `kernel` only; consumed as a dev-dependency. Never
//! shipped to production — that is its entire "must not absorb" list.
//!
//! G3 interface freeze: types and signatures only; bodies are `todo!()`.

// G3 freeze: private fields are unread while bodies are todo!(); lift at G4.
#![allow(dead_code)]

use std::cell::RefCell;
use std::collections::HashMap;

use kernel::{
    BlobStore, BoxFuture, BrokeredRequest, BrokeredResponse, ClockPort, EndpointName, KvStore,
    ModelError, ModelPort, ModelReply, NetError, NetPort, RngPort, StoreError, StorePort,
    Timestamp,
};

/// HashMap-backed `KvStore`. `RefCell` because ports take `&self` (the wasm
/// host is single-threaded and tests are too — no lock needed or wanted).
#[derive(Debug, Default)]
pub struct MemKv {
    map: RefCell<HashMap<String, String>>,
}

impl MemKv {
    /// Empty store; tests seed it through the trait like production would.
    pub fn new() -> MemKv {
        todo!("G3-test")
    }
}

impl KvStore for MemKv {
    fn get<'a>(&'a self, key: &'a str) -> BoxFuture<'a, Result<Option<String>, StoreError>> {
        let _ = key;
        todo!("G4")
    }
    fn put<'a>(&'a self, key: &'a str, value: &'a str) -> BoxFuture<'a, Result<(), StoreError>> {
        let _ = (key, value);
        todo!("G4")
    }
    fn delete<'a>(&'a self, key: &'a str) -> BoxFuture<'a, Result<(), StoreError>> {
        let _ = key;
        todo!("G4")
    }
    fn list_prefix<'a>(
        &'a self,
        prefix: &'a str,
    ) -> BoxFuture<'a, Result<Vec<String>, StoreError>> {
        let _ = prefix;
        todo!("G4")
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
        todo!("G3-test")
    }
}

impl BlobStore for MemBlob {
    fn read<'a>(&'a self, path: &'a str) -> BoxFuture<'a, Result<Option<Vec<u8>>, StoreError>> {
        let _ = path;
        todo!("G4")
    }
    fn write<'a>(
        &'a self,
        path: &'a str,
        bytes: &'a [u8],
    ) -> BoxFuture<'a, Result<(), StoreError>> {
        let _ = (path, bytes);
        todo!("G4")
    }
    fn delete<'a>(&'a self, path: &'a str) -> BoxFuture<'a, Result<(), StoreError>> {
        let _ = path;
        todo!("G4")
    }
    fn list_prefix<'a>(
        &'a self,
        prefix: &'a str,
    ) -> BoxFuture<'a, Result<Vec<String>, StoreError>> {
        let _ = prefix;
        todo!("G4")
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
        todo!("G4")
    }
    fn blob(&self) -> &dyn BlobStore {
        todo!("G4")
    }
}

/// A clock that reads whatever the test set (I7: time is injected data —
/// this type is the proof).
#[derive(Debug, Clone, Copy)]
pub struct FixedClock {
    now: Timestamp,
}

impl FixedClock {
    /// Pin time to `now`; determinism follows.
    pub fn at(now: Timestamp) -> FixedClock {
        let _ = now;
        todo!("G3-test")
    }
}

impl ClockPort for FixedClock {
    fn now(&self) -> Timestamp {
        todo!("G4")
    }
}

/// Deterministic RNG from a seed — same seed, same ids, same golden files.
#[derive(Debug)]
pub struct SeededRng {
    state: RefCell<u64>,
}

impl SeededRng {
    /// Seeded; not cryptographic, deliberately (tests want repeatability).
    pub fn seeded(seed: u64) -> SeededRng {
        let _ = seed;
        todo!("G3-test")
    }
}

impl RngPort for SeededRng {
    fn fill(&self, buf: &mut [u8]) {
        let _ = buf;
        todo!("G4")
    }
}

/// A model that replays scripted replies in order (ADR-010: "tests on the
/// host with a scripted model port"). The whole orchestration cycle runs
/// against this with no network and no fakes beyond it.
#[derive(Debug)]
pub struct ScriptedModel {
    replies: RefCell<Vec<String>>,
}

impl ScriptedModel {
    /// Queue the replies the test's turns will consume, first to last.
    pub fn with_replies(replies: Vec<String>) -> ScriptedModel {
        let _ = replies;
        todo!("G3-test")
    }
}

impl ModelPort for ScriptedModel {
    fn call<'a>(
        &'a self,
        endpoint: &'a EndpointName,
        body_json: &'a str,
    ) -> BoxFuture<'a, Result<ModelReply, ModelError>> {
        let _ = (endpoint, body_json);
        todo!("G4")
    }
}

/// A broker that denies everything — the default-deny posture as a test
/// fixture (I6): any test that accidentally reaches for the network fails
/// loudly instead of passing quietly.
#[derive(Debug, Default)]
pub struct DenyAllNet;

impl NetPort for DenyAllNet {
    fn fetch<'a>(
        &'a self,
        endpoint: &'a EndpointName,
        req: BrokeredRequest,
    ) -> BoxFuture<'a, Result<BrokeredResponse, NetError>> {
        let _ = (endpoint, req);
        todo!("G4")
    }
}
