//! A store whose every operation YIELDS once before it happens. Its own module
//! for the 200-line rule, and its own type because the in-memory store answers
//! immediately: a race needs two agents to be inside the store at the same
//! time, and nothing that resolves on its first poll ever is.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};

use kernel::{BoxFuture, KvStore, StoreError};

/// Ready on the SECOND poll — one suspension point, which is all an executor
/// needs to run the other agent's turn in the middle of this one's.
struct YieldOnce(bool);

impl Future for YieldOnce {
    type Output = ();
    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
        if self.0 {
            return Poll::Ready(());
        }
        self.0 = true;
        cx.waker().wake_by_ref();
        Poll::Pending
    }
}

/// A `BTreeMap` store with a suspension point in front of every operation.
#[derive(Debug, Default)]
pub struct SlowKv {
    map: RefCell<BTreeMap<String, String>>,
}

impl KvStore for SlowKv {
    fn get<'a>(&'a self, key: &'a str) -> BoxFuture<'a, Result<Option<String>, StoreError>> {
        Box::pin(async move {
            YieldOnce(false).await;
            Ok(self.map.borrow().get(key).cloned())
        })
    }
    fn put<'a>(&'a self, key: &'a str, value: &'a str) -> BoxFuture<'a, Result<(), StoreError>> {
        Box::pin(async move {
            YieldOnce(false).await;
            self.map.borrow_mut().insert(key.into(), value.into());
            Ok(())
        })
    }
    fn delete<'a>(&'a self, key: &'a str) -> BoxFuture<'a, Result<(), StoreError>> {
        Box::pin(async move {
            YieldOnce(false).await;
            self.map.borrow_mut().remove(key);
            Ok(())
        })
    }
    fn list_prefix<'a>(&'a self, prefix: &'a str) -> BoxFuture<'a, Result<Vec<String>, StoreError>> {
        Box::pin(async move {
            YieldOnce(false).await;
            Ok(self
                .map
                .borrow()
                .keys()
                .filter(|k| k.starts_with(prefix))
                .cloned()
                .collect())
        })
    }
}

/// A clock that MOVES — one millisecond per read. A frozen clock made every
/// note in the racing test carry the same timestamp, so the cap fell back to
/// tie-breaking by author and dropped one agent's notes wholesale: an artifact
/// of the fixture, but only a moving clock proves it was one.
#[derive(Debug, Default)]
pub struct StepClock {
    ms: RefCell<i64>,
}

impl kernel::ClockPort for StepClock {
    fn now(&self) -> kernel::Timestamp {
        let mut ms = self.ms.borrow_mut();
        *ms += 1;
        kernel::Timestamp(1_753_800_000_000 + *ms)
    }
}
