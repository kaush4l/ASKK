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
    /// THE MODEL IN THE BROWSER REFUSED, AND NOTHING WAS SENT ANYWHERE. A
    /// catalogue entry can be the browser's own on-device model, which has no
    /// address, no credential and no network: every other variant here names
    /// something to check that does not exist on that path — `Transport` and
    /// `Timeout` carry a URL, `NoKey` and `Provider` send a person to a key
    /// field, `Unsupported` claims a wire protocol. `detail` is why the
    /// browser said no, in its own words where it gave any.
    OnDevice { detail: String },
    /// THE CALL WAS TO THIS MACHINE FROM A PAGE THAT IS NOT ON IT (28). A
    /// hosted page reaching `127.0.0.1` is a cross-address-space fetch, which
    /// the Local Network Access specification governs and the two engines
    /// answer differently — Chrome asks the person, WebKit has never allowed
    /// it. Folded into `Transport` this read as "the endpoint could not be
    /// reached", which sent people to restart a server that was already
    /// running: a denied prompt and a closed port reject identically, so the
    /// error itself cannot tell them apart and nothing downstream should try.
    /// This variant is not guessed from the failure — it is decided from two
    /// addresses this application holds for certain, the `url` it called and
    /// the `origin` it was served from, exactly as `NoKey` above decides from
    /// a header it knows it did or did not send.
    LocalNetwork { url: String, origin: String },
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

/// Whether that URL names this machine. The one definition, so the transcript,
/// the board, Settings and the adapter that declares a fetch's address space
/// cannot disagree about what "local" means. It lives at the leaf because both
/// sides of that agreement need it: `core` writes the sentence, `adapters_web`
/// decides whether to declare the call `loopback` before it goes out.
pub fn is_loopback(url: &str) -> bool {
    host_of(url).is_some_and(|h| {
        h == "localhost" || h == "[::1]" || h == "0.0.0.0" || is_v4_loopback(&h)
    })
}

/// THE HOST, NOT THE URL. This was a substring test over the whole address —
/// `url.contains("localhost")` — for as long as it only chose which sentence to
/// print, where being wrong about `https://localhost.evil.example/` cost a
/// paragraph of bad advice. It decides a NETWORK DECLARATION now
/// (`adapters_web::model` sets `targetAddressSpace` from it), so the same
/// looseness would put `"loopback"` on a call to somebody else's public host.
/// Chrome re-checks the declaration against the response's real address space
/// and fails the fetch on a mismatch, so the old test failed CLOSED rather than
/// open — but it failed a legitimate endpoint for having six letters in its
/// name, which is its own defect.
///
/// Not a URL parser and not trying to be: scheme off, userinfo off, path and
/// query off, port off, brackets kept because `[::1]` IS the host. Anything it
/// cannot read is `None`, which reads as "not loopback" — I15's direction,
/// claim less rather than guess.
fn host_of(url: &str) -> Option<String> {
    let after = url.split_once("://").map_or(url, |(_, rest)| rest);
    let authority = after.split(['/', '?', '#']).next()?;
    let authority = authority.rsplit_once('@').map_or(authority, |(_, host)| host);
    let host = match authority.starts_with('[') {
        // A bracketed IPv6 literal keeps its brackets; the port is after `]`.
        true => format!("{}]", authority.split_once(']')?.0),
        false => authority.split(':').next()?.to_string(),
    };
    match host.is_empty() {
        true => None,
        false => Some(host.to_ascii_lowercase()),
    }
}

/// The whole of `127.0.0.0/8` is loopback, not just `127.0.0.1` — a person
/// running a server on `127.0.0.2` is on the same machine and the browser
/// treats it the same way.
fn is_v4_loopback(host: &str) -> bool {
    let mut parts = host.split('.');
    parts.next() == Some("127")
        && parts.clone().count() == 3
        && parts.all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}
