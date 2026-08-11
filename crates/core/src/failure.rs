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
    match serde_json::from_str::<crate::error::CoreError>(payload_json) {
        Ok(crate::error::CoreError::Model(EndpointUnknown { .. })) => {
            "No model endpoint is set yet. Add one in Settings below — a local \
             OpenAI-compatible server, or a provider's base URL and API key."
        }
        Ok(crate::error::CoreError::Model(Transport { .. })) => {
            "The model endpoint could not be reached. Check the endpoint in Settings: \
             it must send CORS headers, and Chrome 142+ asks permission before a page \
             may call a local address."
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
