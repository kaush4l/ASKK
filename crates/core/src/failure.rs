//! What a failed turn looks like to the person reading it. Its own file so
//! `chat.rs` stays inside the 200-line rule (I12); the rule is the same one it
//! always was — the actionable sentence first, the typed error verbatim behind
//! a disclosure named for THIS failure, nothing smoothed away.

use module::view::{Fragment, FragmentBuilder};

/// A failed turn: the sentence a person can act on FIRST, the typed error
/// folded away behind it. The raw error is still there verbatim (a failure is
/// never smoothed into a reply) — it just no longer reads like a crash.
/// `nth` is which failure this is IN THIS transcript. Two failures of the same
/// KIND were still "Technical detail — the provider refused" twice, which is
/// one control to a screen reader (`ux-walker`, increment 05); the instance
/// number is what tells them apart, and it is also what a person says out loud.
pub(crate) fn failure(payload_json: &str, nth: usize) -> Fragment {
    FragmentBuilder::new("div")
        .class("msg error")
        .child(FragmentBuilder::new("p").text(&failure_line(payload_json)).build())
        .child(
            FragmentBuilder::new("details")
                .child(
                    // Named for its own failure: every disclosure called
                    // "Technical detail" is the same control to a screen
                    // reader (`ux-walker`, increment 04).
                    FragmentBuilder::new("summary")
                        .text(&format!(
                            "Technical detail for failure {nth} — {}",
                            failure_kind(payload_json)
                        ))
                        .build(),
                )
                .child(FragmentBuilder::new("pre").text(payload_json).build())
                .build(),
        )
        .build()
}

/// The same actionable sentence, for a caller that has the typed error rather
/// than its JSON — the board's failure detail. One definition, so the board
/// and the transcript cannot say different things about one failure.
pub(crate) fn sentence(error: &crate::error::CoreError) -> String {
    let payload = serde_json::to_string(error).unwrap_or_default();
    failure_line(&payload)
}

/// The same sentence from the LOGGED payload — what a sub-agent's Worker hands
/// back to the agent that called it (`core::last_failure`).
pub(crate) fn sentence_of(payload_json: &str) -> String {
    failure_line(payload_json)
}

/// A sub-agent's turn that raised, as a fact scoped to THAT agent's
/// conversation: `{"agent": …, "message": …}`. One shape, two readers below,
/// so the transcript and the board cannot disagree about whose failure it was.
pub(crate) fn agent_error(agent: &str, message: &str) -> String {
    serde_json::json!({ "agent": agent, "message": message }).to_string()
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

/// One string field of an `agent_error` payload. Through serde, not a substring
/// scan: a model endpoint's own words routinely contain quotes and braces.
fn field(payload_json: &str, name: &str) -> String {
    serde_json::from_str::<serde_json::Value>(payload_json)
        .ok()
        .and_then(|v| Some(v.get(name)?.as_str()?.to_string()))
        .unwrap_or_default()
}

/// Which failure this was, in two or three words — the disclosure's name.
fn failure_kind(payload_json: &str) -> &'static str {
    use kernel::ModelError::{EndpointUnknown, Provider, Transport, Unsupported};
    match serde_json::from_str::<crate::error::CoreError>(payload_json) {
        Ok(crate::error::CoreError::Model(EndpointUnknown { .. })) => "no endpoint configured",
        Ok(crate::error::CoreError::Model(Transport { .. })) => "the endpoint was unreachable",
        Ok(crate::error::CoreError::Model(Unsupported { .. })) => "unsupported wire protocol",
        Ok(crate::error::CoreError::Model(Provider { .. })) => "the provider refused",
        _ => "raw error",
    }
}

/// The actionable sentence, chosen on the typed variant — not by grepping the
/// payload. Each names its own fix; the fallback admits it has none.
fn failure_line(payload_json: &str) -> String {
    use kernel::ModelError::{EndpointUnknown, Provider, Transport, Unsupported};
    // The Local Network Access prompt is about LOOPBACK, and this sentence
    // named it while calling `https://198.51.100.7/v1` — sending the reader
    // after a cause that could not apply (`ux-walker`, increment 06). The
    // variant still chooses the sentence; the ADDRESS chooses which of its two
    // real causes to name, and the address is typed on the error.
    if let Ok(crate::error::CoreError::Model(Transport { url, .. })) =
        serde_json::from_str::<crate::error::CoreError>(payload_json)
    {
        return match is_loopback(&url) {
            true => "The model endpoint could not be reached. Check the endpoint in \
                     Settings: it is an address on THIS machine, so the server must be \
                     running, it must send CORS headers, and Chrome 142+ asks permission \
                     before a page may call a local address."
                .to_string(),
            false => "The model endpoint could not be reached. Check the base URL in \
                      Settings: the host must resolve and answer from this browser, and it \
                      must send CORS headers allowing this page's origin."
                .to_string(),
        };
    }
    match serde_json::from_str::<crate::error::CoreError>(payload_json) {
        Ok(crate::error::CoreError::Model(EndpointUnknown { .. })) => {
            "No model endpoint is set yet. Add one in Settings below — a local \
             OpenAI-compatible server, or a provider's base URL and API key."
        }
        Ok(crate::error::CoreError::Model(Unsupported { .. })) => {
            "That model catalogue entry speaks a wire protocol this build does not. \
             Pick an OpenAI-compatible entry in Settings below — the detail names \
             which protocol the entry asked for."
        }
        Ok(crate::error::CoreError::Model(Provider { .. })) => {
            "The model endpoint answered, but refused the request. Check the base URL \
             and API key in Settings — the provider's own words are below."
        }
        _ => "The turn failed before it produced an answer.",
    }
    .to_string()
}

/// Whether that URL is this machine. The one definition, so the transcript,
/// the board and Settings cannot disagree about what "local" means.
pub(crate) fn is_loopback(url: &str) -> bool {
    ["127.0.0.1", "localhost", "[::1]", "0.0.0.0"]
        .iter()
        .any(|host| url.contains(host))
}
