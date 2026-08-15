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
    /// REFUSED, AND NO CREDENTIAL WAS EVER SENT (22). A 401 with a key
    /// configured and a 401 with the key field empty are different problems
    /// with different fixes, and both printed "check the base URL and API
    /// key" — beside a header that already said "with no key". The fact is
    /// held here rather than guessed from the provider's prose, because
    /// whether this browser sent an `authorization` header is something this
    /// application knows for certain and a stranger's error string is not.
    NoKey { status: u16, message: String },
    /// The network layer never got an answer. `url` is the address that was
    /// actually called, because the FIX depends on it: a loopback address is
    /// blocked by Chrome's Local Network Access prompt, a public one is not,
    /// and telling a person to look at the wrong one wastes their afternoon.
    /// Empty when the failure happened before an address was chosen.
    Transport {
        message: String,
        #[serde(default)]
        url: String,
    },
    /// THE CALL WAS GIVEN UP ON, not refused (R12-2). An abort — ours, on the
    /// budget, or the page's — is NOT a transport failure: the critic's first
    /// task hung and was reported as "the endpoint was unreachable" with a
    /// remedy about CORS and Chrome's local-address prompt, over a request the
    /// network log showed answering 200. Nothing about the endpoint is known to
    /// be wrong here; only that no answer arrived inside `seconds`.
    Timeout { url: String, seconds: u32 },
    /// THE MODEL NAMED IN AN AGENT'S FILE IS NOT ONE THIS ENDPOINT SERVES
    /// (R18-P1-7). An HTTP 404 that names the model we asked for is not an auth
    /// problem and not a wrong address: the address answered, and it answered
    /// about the `model:` line in one particular file. Folded into `Provider`
    /// it produced "check the base URL and API key in Settings" over an
    /// endpoint whose URL and key were both right. `available` is the endpoint's
    /// own list of what it does serve, empty when it named none.
    ModelMissing {
        model: String,
        available: Vec<String>,
    },
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
