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
