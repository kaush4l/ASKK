//! The harness: config loading, sheet assembly, run orchestration, tools, actions, state.

pub mod actions;
pub mod assemble;
pub mod config;
pub mod delegate;
pub mod loops;
pub mod run;
pub mod state;
pub mod tools;

/// Test-only helper shared by unit and workflow tests. Public (hidden) so
/// `tests/` integration crates can reuse it — runtime takes no executor dep.
#[doc(hidden)]
pub mod testutil {
    use std::future::Future;
    use std::task::{Context, Poll, Waker};

    /// Every future below `web` resolves without a reactor (memory stores,
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
