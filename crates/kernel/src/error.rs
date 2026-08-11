//! Typed errors for the port boundary (PROMPT §13: no stringly errors across
//! module boundaries). Each port failure is a variant callers can match on;
//! adapter detail rides as payload, never as the discriminant.

use serde::{Deserialize, Serialize};

/// Storage failures (`KvStore`/`BlobStore`). Public because ADR-005 requires
/// every failed write to surface as a typed event, never a silent drop.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum StoreError {
    /// The browser refused for space (ADR-005: "best-effort is the truth").
    QuotaExceeded,
    /// The key/path exists but the payload didn't parse as expected.
    Corrupt { key: String, message: String },
    /// The substrate is gone or refused (private mode, eviction, adapter bug).
    Backend { message: String },
}

/// Model-call failures (`ModelPort`). Public so `step()`-adjacent retry logic
/// can distinguish "retry" (transient) from "reconfigure" (endpoint/auth).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ModelError {
    /// No endpoint of that name is configured — the capability is absent,
    /// not broken (I15); advertise less, don't fail more.
    EndpointUnknown { endpoint: String },
    /// The provider answered with a non-success status.
    Provider { status: u16, message: String },
    /// The network layer never got an answer.
    Transport { message: String },
    /// The endpoint is configured and reachable, but asks for a wire protocol
    /// this build does not speak (a catalogue entry's `kind`/`api`). Distinct
    /// from `EndpointUnknown` on purpose: "unconfigured" and "configured for
    /// something else" have different fixes, and the UI says so.
    Unsupported { detail: String },
}

/// Delegation failures (`AgentPort`): one agent handing a goal to another.
/// Typed because "there is no such agent" and "that agent's turn raised" have
/// different fixes — the first is a wiring mistake, the second is recorded
/// against the agent as `Status::Failed` with its message (Python
/// `ThreadedAgent.invoke`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum DelegateError {
    /// No agent of that name is loaded in this browser.
    Unknown { agent: String },
    /// The agent ran and its turn failed; the message is its own words.
    Failed { agent: String, message: String },
}

/// Brokered-network failures (`NetPort`). Public for the same match-don't-parse
/// reason; `Denied` exists because the allowlist is a real boundary (ADR-006)
/// and its refusals must be visible, auditable facts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum NetError {
    /// The endpoint name is not on the user-configured allowlist.
    Denied {
        endpoint: String,
    },
    Status {
        status: u16,
    },
    Transport {
        message: String,
    },
}
