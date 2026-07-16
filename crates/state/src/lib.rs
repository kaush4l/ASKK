//! askk-state — what we store (MODELS.md §State model, ADR-003/005/009).
//! Two injected seams, both in [`store`]: [`KvStore`] (key → JSON) and
//! [`BlobStore`] (path → bytes); browser impls are `OpfsKv`/`OpfsBlob` in
//! `crates/browser/src/opfs.rs`, [`MemKv`]/[`MemBlob`] here serve tests
//! and host. THE persistence truth is the append-only signal log ([`log`]):
//! every durable *run* fact is a signal. The other stores are config-shaped
//! conveniences over the KV seam, plain `Result`s, no signals: [`session`]
//! (UI picks), [`memory`] (per-agent digests).
//!
//! No pub/sub between agents: nested runs share one `Shared`
//! (`crates/engine/src/run/session.rs`); the BroadcastChannel bus
//! (`crates/browser/src/bus.rs`) mirrors signals across tabs, view-only.
//!
//! Imports: core only. May be imported by: features, engine, browser.
//! See MAP.md and docs/NAVIGATION.md.

pub mod log;
pub mod memory;
pub mod session;
pub mod store;

pub use log::{Clock, HealthProbe, SignalLog};
pub use memory::{MemoryStore, DEFAULT_MAX_ENTRIES};
pub use session::SessionStore;
pub use store::{BlobStore, KvStore, LocalBoxFuture, MemBlob, MemKv, StoreError};

#[cfg(test)]
pub(crate) use crate::testutil::block_on;

/// Test-only helper shared by unit and workflow tests across the workspace.
/// Public (hidden) so downstream crates' tests can reuse it — state takes no
/// executor dep.
#[doc(hidden)]
pub mod testutil {
    use std::future::Future;
    use std::task::{Context, Poll, Waker};

    /// Every future below `browser` resolves without a reactor (memory stores,
    /// mock providers, sync tools), so a noop-waker poll loop suffices.
    pub fn block_on<T>(future: impl Future<Output = T>) -> T {
        let mut future = std::pin::pin!(future);
        let mut cx = Context::from_waker(Waker::noop());
        loop {
            if let Poll::Ready(value) = future.as_mut().poll(&mut cx) {
                return value;
            }
        }
    }
}
