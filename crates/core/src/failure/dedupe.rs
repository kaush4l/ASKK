//! THE SAME FAILURE, AGAIN — which failures count as the same one, and what a
//! recurrence looks like — the one fold in this folder that is about a
//! failure's SECOND appearance rather than its first.
//!
//! The fold used to be on the payload BYTE FOR BYTE. That collapses a dead
//! endpoint, whose `Transport` payload is identical every time, and fails to
//! collapse a refusing one, whose `Provider` payload carries the provider's own
//! body — a sentence that can differ by a request id nobody reads. So the same
//! screen both collapsed repeats and printed two full-width identical cards
//! depending on which failure you had (R3-4), and pressing Send again looked
//! like it had done something different from typing the message twice.
//!
//! What makes two failures the same is the typed variant plus the one field
//! that names its cause. Nothing is smoothed away by the fold: every DISTINCT
//! payload seen under one signature is still printed verbatim inside it.

use module::view::{Fragment, FragmentBuilder};

use crate::failure::what_to_do::{failure_kind, failure_line};

/// Which failure this IS, for the purpose of "the same one again": the variant,
/// and the field a person would fix. Two 401s from one endpoint are one
/// failure; a 401 and a 500 are not, and neither are two unreachable hosts.
/// An untyped payload is its own signature, so it can only fold onto itself.
pub(crate) fn signature(payload_json: &str) -> String {
    use kernel::ModelError::{EndpointUnknown, Provider, Transport, Unsupported};
    match serde_json::from_str::<crate::error::CoreError>(payload_json) {
        Ok(crate::error::CoreError::Model(Provider { status, .. })) => format!("provider {status}"),
        Ok(crate::error::CoreError::Model(Transport { url, .. })) => format!("transport {url}"),
        Ok(crate::error::CoreError::Model(EndpointUnknown { endpoint })) => {
            format!("no endpoint {endpoint}")
        }
        Ok(crate::error::CoreError::Model(Unsupported { detail })) => format!("unsupported {detail}"),
        _ => payload_json.to_string(),
    }
}

/// Every failure written out in full so far, and what has folded onto it.
#[derive(Default)]
pub(crate) struct Seen(Vec<(String, usize, Vec<String>)>);

impl Seen {
    /// Fold one failure in. `None` means this is the first of its kind and the
    /// caller should write the full card; `Some` is the recurrence, rendered.
    pub(crate) fn fold(&mut self, payload_json: &str) -> Option<Fragment> {
        let sig = signature(payload_json);
        let Some(entry) = self.0.iter_mut().find(|(s, _, _)| *s == sig) else {
            self.0.push((sig, 1, vec![payload_json.to_string()]));
            return None;
        };
        entry.1 += 1;
        if !entry.2.iter().any(|p| p == payload_json) {
            entry.2.push(payload_json.to_string());
        }
        Some(repeat(entry.1, &entry.2))
    }
}

/// The SAME failure, again. `failure::failure` writes the explanation ONCE, in
/// full; a recurrence adds not one word to it, and five of them were five
/// identical three-line paragraphs differing only by the instance number hidden
/// inside their disclosure (R2-5, walk 16b). Not one word of that copy is cut —
/// it is folded, sentence and typed error both, behind a summary that counts
/// the recurrences. It keeps `msg error`, so the pane's `last_failed` read and
/// the stylesheet's painting both still find it.
///
/// Every distinct payload is printed, newest last: two refusals with the same
/// status can still carry different words from the provider, and a fold that
/// dropped them would be the smoothing this product refuses everywhere else.
fn repeat(times: usize, payloads: &[String]) -> Fragment {
    let newest = payloads.last().map(String::as_str).unwrap_or_default();
    let mut disclosure = FragmentBuilder::new("details")
        .child(
            FragmentBuilder::new("summary")
                .text(&format!("⚠ Same error (×{times}) — {}", failure_kind(newest)))
                .build(),
        )
        .child(FragmentBuilder::new("p").text(&failure_line(newest)).build());
    for payload in payloads {
        disclosure = disclosure.child(FragmentBuilder::new("pre").text(payload).build());
    }
    FragmentBuilder::new("div")
        .class("msg error repeat")
        .child(disclosure.build())
        .build()
}

#[cfg(test)]
mod tests {
    /// Two refusals from one endpoint are one failure however the provider
    /// worded them — the bug R3-4 named — and two different statuses are two.
    #[test]
    fn a_refusal_folds_on_its_status_not_on_the_body() {
        let one = r#"{"Model":{"Provider":{"status":401,"message":"bad key (req_a)"}}}"#;
        let two = r#"{"Model":{"Provider":{"status":401,"message":"bad key (req_b)"}}}"#;
        let other = r#"{"Model":{"Provider":{"status":500,"message":"boom"}}}"#;
        let mut seen = super::Seen::default();
        assert!(seen.fold(one).is_none(), "the first is written in full");
        let again = seen.fold(two).expect("the second folds onto it");
        let html = again.into_html();
        assert!(html.contains("Same error (×2)"), "{html}");
        assert!(html.contains("req_a") && html.contains("req_b"), "both words kept: {html}");
        assert!(seen.fold(other).is_none(), "a different status is a different failure");
    }
}
