//! State layer (MODELS.md §State model, ADR-003/005/009):
//!
//! - [`store`] — the injected seams: `KvStore` + `BlobStore` traits, memory
//!   impls for tests/host. OPFS impls live in `crates/web`.
//! - [`log`] — `SignalLog`: append-only JSONL signal log, epoch segments,
//!   replay, epoch fence. The sole run-state truth.
//! - [`session`] — `SessionStore`: reload-safe UI state over a `KvStore`.
//! - [`memory`] — `MemoryStore`: bounded per-agent memory digests.
//!
//! Every durable *run* write is traceable to a signal; session/memory writes
//! are config-shaped and use plain `Result`s.

pub mod log;
pub mod memory;
pub mod session;
pub mod store;

pub use log::{Clock, SignalLog};
pub use memory::{MemoryStore, DEFAULT_MAX_ENTRIES};
pub use session::SessionStore;
pub use store::{BlobStore, KvStore, LocalBoxFuture, MemBlob, MemKv, StoreError};

/// Minimal test executor: every memory-backed future here is immediately
/// ready, so a noop-waker poll loop suffices — no executor dependency.
#[cfg(test)]
pub(crate) fn block_on<T>(future: impl std::future::Future<Output = T>) -> T {
    use std::task::{Context, Poll, Waker};
    let mut future = std::pin::pin!(future);
    let mut cx = Context::from_waker(Waker::noop());
    loop {
        if let Poll::Ready(value) = future.as_mut().poll(&mut cx) {
            return value;
        }
    }
}
