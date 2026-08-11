//! The seam types (§3). HTTP-shaped in, HTML-shaped out; nothing else crosses
//! the boundary. Mirrors the Spike A vocabulary that proved the transport.

use serde::{Deserialize, Serialize};

/// HTTP-shaped input to `core::handle`. Exists so the core never sees a
/// browser type (I3): the transport builds one of these from whatever htmx sent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Request {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl Request {
    /// Shorthand for the common case; exists so tests and transports read as
    /// `handle(Request::get("/dashboard"))` — the §3 promise, verbatim.
    pub fn get(path: &str) -> Request {
        Request {
            method: "GET".into(),
            path: path.into(),
            headers: Vec::new(),
            body: String::new(),
        }
    }

    /// The other common case: a form POST. Encoding lives here rather than in
    /// every caller, so a message containing `&` or `=` cannot silently
    /// truncate itself on the way through the seam.
    pub fn post_form(path: &str, fields: &[(&str, &str)]) -> Request {
        let body = fields
            .iter()
            .map(|(k, v)| format!("{k}={}", percent_encode(v)))
            .collect::<Vec<_>>()
            .join("&");
        Request {
            method: "POST".into(),
            path: path.into(),
            headers: vec![(
                "content-type".into(),
                "application/x-www-form-urlencoded".into(),
            )],
            body,
        }
    }
}

/// Percent-encode one form value. Lives beside the Request it builds so the
/// encoder and `core`'s decoder are one another's stated inverse.
fn percent_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            b' ' => out.push('+'),
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

/// HTML-shaped output of `core::handle`. Body is a fragment htmx can swap
/// directly (I4/I5): if it isn't valid fragment HTML, the frontend has no
/// logic with which to repair it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Response {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
}
