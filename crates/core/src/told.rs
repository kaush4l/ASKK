//! A SUB-AGENT's failed turn, and the payload it travelled in. Split from
//! `failure.rs` for the 200-line rule (I12): that file is what a failure looks
//! like, this one is what a failure that happened somewhere ELSE looks like
//! once it has crossed a `postMessage` boundary.

use module::view::Fragment;

use crate::failure::{card, failure_kind, failure_line};

/// A SUB-AGENT's failed turn, in the same card. It used to render as
/// `researcher: The model endpoint could not be reached…` — a failure
/// attributed to the agent as something it SAID, with no technical detail
/// reachable at all, while the identical failure on `main` was a card with a
/// disclosure (`ux-walker`, increment 07b). One failure now has one
/// presentation, whichever agent it happened to.
pub(crate) fn agent_failure(payload_json: &str, who: &str, nth: usize) -> Fragment {
    // The sub-agent's Worker sends back the raw `core.error` payload when it
    // has one, so the cause survives the `postMessage` boundary typed. Older
    // records carry the SENTENCE instead; that is still the sentence, and the
    // payload is still the detail.
    // The DETAIL is the sub-agent's own typed payload when it sent one, not the
    // envelope it travelled in: a JSON string inside a JSON string, in the one
    // place a person looks when already confused (`ux-walker`, increment 08).
    let raw = message_of(payload_json);
    let detail = match typed(&raw) {
        true => raw.clone(),
        false => payload_json.to_string(),
    };
    card(&told(&raw, who), told_kind(&raw), &detail, nth)
}

/// A sub-agent's failure in the words a person reads, whether its Worker sent
/// the typed payload (this build) or the sentence (records already written).
pub(crate) fn told(message: &str, who: &str) -> String {
    match typed(message) {
        true => failure_line(message),
        false => readable(message, who),
    }
}

/// Whether this is one of THIS build's typed errors rather than a sentence an
/// older build recorded. One definition, three readers.
fn typed(message: &str) -> bool {
    serde_json::from_str::<crate::error::CoreError>(message).is_ok()
}

/// The disclosure's name for the same two shapes.
fn told_kind(message: &str) -> &'static str {
    match typed(message) {
        true => failure_kind(message),
        false => "reported by the sub-agent",
    }
}

/// Whose failure it was — the empty string if the payload will not read, which
/// scopes it to nobody rather than to the wrong conversation.
pub(crate) fn agent_of(payload_json: &str) -> String {
    field(payload_json, "agent")
}

/// The sub-agent's OWN words about why its turn failed. Before increment 07
/// this was always "<name> produced no answer" — four words naming no cause,
/// where the lead's own failure said which endpoint was unreachable and why.
pub(crate) fn message_of(payload_json: &str) -> String {
    field(payload_json, "message")
}

/// A sub-agent's turn that raised, as a fact scoped to THAT agent's
/// conversation: `{"agent": …, "message": …}`. One shape, two readers below,
/// so the transcript and the board cannot disagree about whose failure it was.
pub(crate) fn agent_error(agent: &str, message: &str) -> String {
    serde_json::json!({ "agent": agent, "message": message }).to_string()
}

/// The same message as a person must READ it. A record is written once and
/// replays forever, so records already in a store carry the shapes earlier
/// builds wrote: the Rust debug wrapper `JsValue("…")` around a rejected
/// Worker string, and the agent's own name in front of a sentence the
/// transcript already attributes to it — `researcher: JsValue("researcher: The
/// model endpoint could not be reached…")` (`ux-walker`, increment 07). Both
/// were fixed at the source; this is the guard for everyone who used the
/// build before that, and it costs one pass over one string.
pub(crate) fn readable(message: &str, who: &str) -> String {
    let unwrapped = match message.strip_prefix("JsValue(\"").and_then(|s| s.strip_suffix("\")")) {
        Some(inner) => inner.replace("\\\"", "\"").replace("\\n", "\n"),
        None => message.to_string(),
    };
    match unwrapped.strip_prefix(&format!("{who}: ")) {
        Some(said) => said.to_string(),
        None => unwrapped,
    }
}

/// One string field of an `agent_error` payload. Through serde, not a substring
/// scan: a model endpoint's own words routinely contain quotes and braces.
fn field(payload_json: &str, name: &str) -> String {
    serde_json::from_str::<serde_json::Value>(payload_json)
        .ok()
        .and_then(|v| Some(v.get(name)?.as_str()?.to_string()))
        .unwrap_or_default()
}

