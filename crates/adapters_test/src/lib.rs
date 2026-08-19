//! In-memory port implementations (ARCHITECTURE §2). Exists so every pure
//! crate tests on the host in milliseconds with no browser, no Wasm, no
//! network (I3). Imports `kernel` only; consumed as a dev-dependency. Never
//! shipped to production — that is its entire "must not absorb" list.
//!
//! Every future here is immediately ready — a single poll with a noop waker
//! resolves it, which is what lets `core`'s tests drive the async runtime
//! loop without an executor dependency.

use std::cell::RefCell;

use kernel::{
    BoxFuture, BrokeredRequest, BrokeredResponse, ClockPort, EndpointName, NetError, NetPort,
    RngPort, Timestamp,
};

mod agents;
mod model;
mod shell;
mod stores;

pub use agents::ScriptedAgents;
pub use model::ScriptedModel;
pub use shell::FakeShell;
pub use stores::{MemBlob, MemKv, MemStore};

pub(crate) fn ready<'a, T: 'a>(value: T) -> BoxFuture<'a, T> {
    Box::pin(std::future::ready(value))
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
        FixedClock { now }
    }
}

impl ClockPort for FixedClock {
    fn now(&self) -> Timestamp {
        self.now
    }
}

/// A clock that MOVES, deterministically: every read is `step` milliseconds
/// later than the one before. `FixedClock` cannot tell a call's START from its
/// end, because under it they are the same instant — and that difference is the
/// whole of R13-4, where a trace timestamped every row with the moment its call
/// came BACK and read as though it were the moment it began.
#[derive(Debug)]
pub struct TickingClock {
    at: RefCell<i64>,
    step: i64,
}

impl TickingClock {
    pub fn from(start: Timestamp, step_ms: i64) -> TickingClock {
        TickingClock {
            at: RefCell::new(start.0),
            step: step_ms,
        }
    }
}

impl ClockPort for TickingClock {
    fn now(&self) -> Timestamp {
        let mut at = self.at.borrow_mut();
        let was = *at;
        *at += self.step;
        Timestamp(was)
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
        SeededRng {
            state: RefCell::new(seed.max(1)),
        }
    }
}

impl RngPort for SeededRng {
    fn fill(&self, buf: &mut [u8]) {
        // xorshift64 — tiny, deterministic, plenty for test identity.
        let mut s = self.state.borrow_mut();
        for b in buf.iter_mut() {
            *s ^= *s << 13;
            *s ^= *s >> 7;
            *s ^= *s << 17;
            *b = (*s & 0xff) as u8;
        }
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
        _req: BrokeredRequest,
    ) -> BoxFuture<'a, Result<BrokeredResponse, NetError>> {
        ready(Err(NetError::Denied {
            endpoint: endpoint.0.clone(),
        }))
    }
}

/// A broker that answers ONE canned body, and remembers the path it was asked
/// for. The path is the point: a query is encoded into it by a pure function,
/// and a test that never reads it could not tell a search for `rust lang` from
/// a search for nothing at all.
pub struct CannedNet {
    status: u16,
    body: String,
    asked: RefCell<Vec<String>>,
}

impl CannedNet {
    pub fn answering(status: u16, body: &str) -> CannedNet {
        CannedNet {
            status,
            body: body.to_string(),
            asked: RefCell::new(Vec::new()),
        }
    }

    /// Every path this broker was asked for, in order.
    pub fn asked(&self) -> Vec<String> {
        self.asked.borrow().clone()
    }
}

impl NetPort for CannedNet {
    fn fetch<'a>(
        &'a self,
        _endpoint: &'a EndpointName,
        req: BrokeredRequest,
    ) -> BoxFuture<'a, Result<BrokeredResponse, NetError>> {
        self.asked.borrow_mut().push(req.path);
        ready(Ok(BrokeredResponse {
            status: self.status,
            body: self.body.clone().into_bytes(),
        }))
    }
}
