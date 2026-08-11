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
    BoxFuture, BrokeredRequest, BrokeredResponse, ClockPort, EndpointName, ModelError, ModelPort,
    ModelReply, NetError, NetPort, RngPort, Timestamp,
};

mod agents;
mod stores;

pub use agents::ScriptedAgents;
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

/// A model that replays scripted replies in order (ADR-010: "tests on the
/// host with a scripted model port"). Replies are ALREADY provider-shaped
/// chat-completion JSON bodies; `text_reply` wraps plain text for the common
/// case. An exhausted script returns a Transport error — the honest failure.
#[derive(Debug)]
pub struct ScriptedModel {
    replies: RefCell<Vec<String>>,
}

impl ScriptedModel {
    /// Queue the replies the test's turns will consume, first to last.
    pub fn with_replies(replies: Vec<String>) -> ScriptedModel {
        ScriptedModel {
            replies: RefCell::new(replies),
        }
    }

    /// A chat-completion body whose assistant message is `text`.
    pub fn text_reply(text: &str) -> String {
        format!(
            "{{\"choices\":[{{\"message\":{{\"role\":\"assistant\",\"content\":{}}}}}]}}",
            serde_json_escape(text)
        )
    }
}

/// Minimal JSON string literal (kernel-only crate: no serde_json here).
fn serde_json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

impl ModelPort for ScriptedModel {
    fn call<'a>(
        &'a self,
        _endpoint: &'a EndpointName,
        _body_json: &'a str,
    ) -> BoxFuture<'a, Result<ModelReply, ModelError>> {
        let mut replies = self.replies.borrow_mut();
        let result = if replies.is_empty() {
            Err(ModelError::Transport {
                message: "scripted model exhausted".into(),
                // A loopback address, because that is what the local server a
                // test stands in for actually is.
                url: "http://127.0.0.1:8873/v1/chat/completions".into(),
            })
        } else {
            Ok(ModelReply {
                body_json: replies.remove(0),
                usage: None,
            })
        };
        ready(result)
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
