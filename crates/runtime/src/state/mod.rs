//! State layer (MODELS.md §State model, ADR-003/005/009):
//!
//! - [`store`] — the injected seams: `KvStore` + `BlobStore` traits, memory
//!   impls for tests/host. OPFS impls live in `crates/web`.
//! - [`log`] — `SignalLog`: append-only JSONL signal log, epoch segments,
//!   replay, epoch fence. The sole run-state truth.
//! - [`session`] — `SessionStore`: reload-safe UI state over a `KvStore`.
//! - [`memory`] — `MemoryStore`: bounded per-agent memory digests.
//! - [`board`] — `BoardStore`: the persistent kanban board (`Card`s).
//!
//! Every durable *run* write is traceable to a signal; session/memory/board
//! writes are config-shaped and use plain `Result`s.

pub mod board;
pub mod log;
pub mod memory;
pub mod session;
pub mod store;

pub use board::BoardStore;
pub use log::{Clock, SignalLog};
pub use memory::{MemoryStore, DEFAULT_MAX_ENTRIES};
pub use session::SessionStore;
pub use store::{BlobStore, KvStore, LocalBoxFuture, MemBlob, MemKv, StoreError};

#[cfg(test)]
pub(crate) use crate::testutil::block_on;
