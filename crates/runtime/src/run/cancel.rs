//! Wake-aware cancel token (GAPS 17): the flag `RunSession::cancel` sets,
//! awaitable so an in-flight provider call can be raced against it instead
//! of only being checked between turns.

use std::cell::{Cell, RefCell};
use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll, Waker};

/// One-way cancel flag with a single waker slot: `cancelled()` resolves as
/// soon as `set` fires. ponytail: one waker slot is enough — exactly one
/// drive polls a run at a time; a stale waker only costs a spurious wake.
#[derive(Debug, Default)]
pub(crate) struct CancelToken {
    flag: Cell<bool>,
    waker: RefCell<Option<Waker>>,
}

impl CancelToken {
    pub(crate) fn set(&self) {
        self.flag.set(true);
        if let Some(waker) = self.waker.borrow_mut().take() {
            waker.wake();
        }
    }

    pub(crate) fn get(&self) -> bool {
        self.flag.get()
    }

    pub(crate) fn cancelled(&self) -> Cancelled<'_> {
        Cancelled { token: self }
    }
}

/// Resolves when the token is set. No borrow is held across an await: the
/// waker slot is written inside a single synchronous `poll`.
pub(crate) struct Cancelled<'a> {
    token: &'a CancelToken,
}

impl Future for Cancelled<'_> {
    type Output = ();

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
        if self.token.flag.get() {
            Poll::Ready(())
        } else {
            *self.token.waker.borrow_mut() = Some(cx.waker().clone());
            Poll::Pending
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    struct CountWake(AtomicUsize);

    impl std::task::Wake for CountWake {
        fn wake(self: Arc<Self>) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }

    #[test]
    fn set_wakes_a_parked_cancelled_future() {
        let token = CancelToken::default();
        let wakes = Arc::new(CountWake(AtomicUsize::new(0)));
        let waker = Waker::from(wakes.clone());
        let mut cx = Context::from_waker(&waker);
        let mut fut = std::pin::pin!(token.cancelled());
        assert!(fut.as_mut().poll(&mut cx).is_pending());
        assert!(!token.get());
        token.set();
        assert_eq!(wakes.0.load(Ordering::SeqCst), 1);
        assert!(fut.as_mut().poll(&mut cx).is_ready());
    }

    #[test]
    fn already_set_token_resolves_immediately_and_is_sticky() {
        let token = CancelToken::default();
        token.set();
        token.set(); // second set: no waker, no panic
        assert!(token.get());
        let mut cx = Context::from_waker(Waker::noop());
        assert!(std::pin::pin!(token.cancelled()).poll(&mut cx).is_ready());
    }
}
