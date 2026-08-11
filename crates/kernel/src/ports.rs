//! The five port traits (§11, GLOSSARY: Capability "exercised through ports").
//! Pure crates describe I/O against these; adapters implement them. Injected
//! as `dyn` objects at the composition root (ARCHITECTURE §4) — hence no
//! `async fn` in traits: boxed futures keep the traits dyn-compatible.

use std::future::Future;
use std::pin::Pin;

use serde::{Deserialize, Serialize};

use crate::error::{DelegateError, ModelError, NetError, StoreError};
use crate::ids::{EndpointName, Timestamp};

/// Dyn-compatible future alias. No `Send` bound, and increment 06 is the
/// promised revisit: every agent now owns a dedicated Worker. A Worker is its
/// own JS context with its own Wasm instance, so nothing Rust-side is shared
/// across threads — the only thing that crosses is a structured-cloned
/// message. `Send` is therefore still not needed, and the bound stays off.
/// (Still PROVISIONAL for the day a port is driven from a shared-memory
/// thread, which `SharedArrayBuffer` threading for the core would be.)
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + 'a>>;

/// Injected time (I7: the core never reads a real clock). Sync because time
/// is a value, not an operation.
pub trait ClockPort {
    /// Now, as data. Every timestamp in the system originates here.
    fn now(&self) -> Timestamp;
}

/// Injected randomness (I7: ids and nonces are deterministic under test).
pub trait RngPort {
    /// Fill with random bytes; the one primitive every consumer derives from.
    fn fill(&self, buf: &mut [u8]);
}

/// Key → JSON-string store (ADR-005 seam, predecessor-proven). Narrow on
/// purpose: prefixes are the namespace convention, so `list_prefix` is the
/// only query the system is allowed to need.
pub trait KvStore {
    fn get<'a>(&'a self, key: &'a str) -> BoxFuture<'a, Result<Option<String>, StoreError>>;
    fn put<'a>(&'a self, key: &'a str, value: &'a str) -> BoxFuture<'a, Result<(), StoreError>>;
    fn delete<'a>(&'a self, key: &'a str) -> BoxFuture<'a, Result<(), StoreError>>;
    fn list_prefix<'a>(&'a self, prefix: &'a str)
        -> BoxFuture<'a, Result<Vec<String>, StoreError>>;

    /// Replace everything under `prefix` with `entries`, ATOMICALLY where the
    /// substrate can — the Python's `_replace_log`, which writes a temporary
    /// beside the log and `replace`s it so "a reader sees the old file or the
    /// new one and never half of either". An adapter that cannot be atomic
    /// still gets the right content from the default below (I15); IndexedDB
    /// overrides it with one transaction.
    fn replace_prefix<'a>(
        &'a self,
        prefix: &'a str,
        entries: &'a [(String, String)],
    ) -> BoxFuture<'a, Result<(), StoreError>> {
        Box::pin(async move {
            for key in self.list_prefix(prefix).await? {
                self.delete(&key).await?;
            }
            for (key, value) in entries {
                self.put(key, value).await?;
            }
            Ok(())
        })
    }
}

/// Path → bytes store for large append-heavy payloads (event segments,
/// exports — ADR-005). Separate from `KvStore` so the substrate split stays
/// an adapter decision, not a core rewrite.
pub trait BlobStore {
    fn read<'a>(&'a self, path: &'a str) -> BoxFuture<'a, Result<Option<Vec<u8>>, StoreError>>;
    fn write<'a>(&'a self, path: &'a str, bytes: &'a [u8])
        -> BoxFuture<'a, Result<(), StoreError>>;
    fn delete<'a>(&'a self, path: &'a str) -> BoxFuture<'a, Result<(), StoreError>>;
    fn list_prefix<'a>(&'a self, prefix: &'a str)
        -> BoxFuture<'a, Result<Vec<String>, StoreError>>;
}

/// The storage port: both stores behind one injection point, because ADR-005's
/// real decision is the two-trait seam, not the substrate behind it.
pub trait StorePort {
    fn kv(&self) -> &dyn KvStore;
    fn blob(&self) -> &dyn BlobStore;
}

/// Provider usage numbers, when reported. Public because token budgeting is
/// estimate + per-model EMA from these (RESEARCH: no shipped tokenizer).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Usage {
    pub input_tokens: u32,
    pub output_tokens: u32,
    /// Cache hits, when the provider says (the §8.3 payoff, measured).
    pub cached_input_tokens: Option<u32>,
}

/// One completed model reply. Body stays provider-shaped JSON: `context`
/// rendered the request, so only `context` knows how to read the reply —
/// the port moves bytes, it does not interpret them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelReply {
    pub body_json: String,
    pub usage: Option<Usage>,
}

/// External inference (§2: inference is external). Takes a symbolic endpoint
/// name — the adapter resolves it and attaches the credential, so a key can
/// never appear upstream of this trait (ADR-006, I6).
pub trait ModelPort {
    fn call<'a>(
        &'a self,
        endpoint: &'a EndpointName,
        body_json: &'a str,
    ) -> BoxFuture<'a, Result<ModelReply, ModelError>>;
}

/// A brokered outbound request: a path under a named endpoint's base URL.
/// No raw URL field exists on purpose — that absence is the I6 enforcement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BrokeredRequest {
    pub method: String,
    pub path: String,
    pub body: Option<Vec<u8>>,
}

/// What came back from a brokered call; headers withheld (they may carry
/// provider auth echoes — the envelope is data, not transport detail).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BrokeredResponse {
    pub status: u16,
    pub body: Vec<u8>,
}

/// Another agent, reachable only by message (ARCHITECTURE §10, ADR-008: one
/// Worker per agent, `postMessage`, no shared memory). The core names an agent
/// and hands it a goal; it never holds that agent's loop, its engine, or its
/// state — which is exactly what the Python's `AgentThread.run` marshalling
/// guarantees and what a Worker enforces structurally.
pub trait AgentPort {
    fn delegate<'a>(
        &'a self,
        agent: &'a str,
        goal: &'a str,
    ) -> BoxFuture<'a, Result<String, DelegateError>>;
}

/// Brokered general network (ADR-006: no module gets fetch). Distinct from
/// `ModelPort` because the model path adds credentials and streaming rules;
/// this one is plain allowlisted HTTP.
pub trait NetPort {
    fn fetch<'a>(
        &'a self,
        endpoint: &'a EndpointName,
        req: BrokeredRequest,
    ) -> BoxFuture<'a, Result<BrokeredResponse, NetError>>;
}
