//! Tool surface (MAP hop 7): ONE registry (ADR-004), a rust-fn adapter, and
//! the builtins. `ToolSet` membership is the run's allowlist; unknown names
//! fail loud at build time. MCP / agent-as-tool / JS adapters arrive in
//! later waves behind the same `dyn Tool` seam.

pub mod builtin;
pub mod registry;

pub use builtin::register_builtins;
pub use registry::{RegistryError, RustTool, ToolRegistry};

#[cfg(test)]
pub(crate) mod testutil {
    use std::future::Future;
    use std::pin::pin;
    use std::task::{Context, Poll, Waker};

    /// Tool futures in this crate wrap sync closures — ready on first poll,
    /// so tests need no executor (and runtime takes no futures dependency).
    pub fn block_on<F: Future>(fut: F) -> F::Output {
        let mut fut = pin!(fut);
        let mut cx = Context::from_waker(Waker::noop());
        match fut.as_mut().poll(&mut cx) {
            Poll::Ready(value) => value,
            Poll::Pending => panic!("tool future pended; tests expect ready futures"),
        }
    }
}
