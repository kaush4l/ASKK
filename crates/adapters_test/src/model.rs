//! The scripted `ModelPort`. Split from `lib.rs`, which owns the crate's own
//! small fakes — clock, RNG, deny-all net — so both hold the 200-line rule
//! (I12), and because this is the only one that has to speak a PROVIDER'S
//! wire format: replies here are chat-completion JSON bodies, so the crate
//! carries a JSON string escaper it needs nowhere else.
//!
//! One fake per file is already this crate's shape (`agents`, `shell`,
//! `stores`); this is that shape applied to the fake that outgrew the root.

use std::cell::RefCell;

use kernel::{BoxFuture, EndpointName, ModelError, ModelPort, ModelReply};

use crate::ready;

/// A model that replays scripted replies in order (ADR-010: "tests on the
/// host with a scripted model port"). Replies are ALREADY provider-shaped
/// chat-completion JSON bodies; `text_reply` wraps plain text for the common
/// case. An exhausted script returns a Transport error — the honest failure.
#[derive(Debug)]
pub struct ScriptedModel {
    replies: RefCell<Vec<String>>,
    /// An endpoint that TAKES the request and never answers, so the page gives
    /// up on its own budget (R12-2). Distinct from an exhausted queue on
    /// purpose: the two used to be the same `Transport` and the product told a
    /// person to check CORS about a server that had answered.
    times_out: Option<u32>,
    /// An endpoint that ANSWERS, with a refusal of its own. The one way to
    /// exercise a typed provider failure end to end on the host (R18-P1-7).
    refuses: Option<ModelError>,
}

impl ScriptedModel {
    /// Queue the replies the test's turns will consume, first to last.
    pub fn with_replies(replies: Vec<String>) -> ScriptedModel {
        ScriptedModel {
            replies: RefCell::new(replies),
            times_out: None,
            refuses: None,
        }
    }

    /// A model that never answers inside `seconds`.
    pub fn timing_out(seconds: u32) -> ScriptedModel {
        ScriptedModel {
            replies: RefCell::new(Vec::new()),
            times_out: Some(seconds),
            refuses: None,
        }
    }

    /// An endpoint that answers every call with THAT typed failure.
    pub fn refusing(error: ModelError) -> ScriptedModel {
        ScriptedModel {
            replies: RefCell::new(Vec::new()),
            times_out: None,
            refuses: Some(error),
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
        if let Some(error) = self.refuses.clone() {
            return ready(Err(error));
        }
        if let Some(seconds) = self.times_out {
            return ready(Err(ModelError::Timeout {
                url: "http://127.0.0.1:8873/v1/chat/completions".into(),
                seconds,
            }));
        }
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
