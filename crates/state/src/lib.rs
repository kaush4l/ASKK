//! State layer (MODELS.md §State model, ADR-003/005/009): what we store,
//! where, and who talks to whom.
//!
//! Two injected seams, both in [`store`]: [`KvStore`] (key → JSON) and
//! [`BlobStore`] (path → bytes). Browser impls are `OpfsKv`/`OpfsBlob` in
//! `web/src/host/opfs.rs`; [`MemKv`]/[`MemBlob`] here serve tests and host.
//!
//! THE persistence truth is the append-only signal log ([`log`]): every
//! durable *run* fact is a signal. The other stores are config-shaped
//! conveniences over the KV seam, plain `Result`s, no signals:
//! [`session`] (UI picks), [`memory`] (per-agent digests), [`board`] (kanban).
//!
//! Who talks to whom: there is NO pub/sub between agents. Inter-agent
//! communication is nested runs sharing one `Shared` (`run/session.rs`) via
//! delegation/loops; signals (`core/src/signal.rs`) are the single run-state
//! truth (UI = fold(signals)); and the BroadcastChannel bus
//! (`web/src/host/bus.rs`) mirrors stamped signals across TABS, view-only —
//! a tab owns only the runs it submitted.

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
