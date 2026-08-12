//! What this page can send, and to whom: the one sentence in the header that
//! says what the next turn actually calls, and the boolean the composer is
//! gated on. Split from `chat.rs`, which owns the conversation, so both hold
//! the 200-line rule (I12).
//!
//! Both read the BROKER directly rather than a signal some component publishes
//! (15K): a view mounts only while it is current, so anything that depends on
//! Settings having been opened is false until somebody opens it.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;

/// Whether a turn could be sent at all: an endpoint is chosen and has a URL.
/// Read straight off the broker, so it is true whether or not the Settings
/// view has ever been opened.
pub(crate) fn endpoint_configured(web: Signal<Option<Rc<WebApp>>>) -> bool {
    web.read()
        .clone()
        .map(|app| !app.endpoint_summary().0.is_empty())
        .unwrap_or(false)
}

pub(crate) fn endpoint_line(web: Signal<Option<Rc<WebApp>>>) -> String {
    let Some(app) = web.read().clone() else {
        return String::new();
    };
    let (url, has_key, model, _) = app.endpoint_summary();
    if url.is_empty() {
        return "No endpoint yet — this turn cannot be sent.".into();
    }
    let entry = app.current_entry();
    let key = match has_key {
        true => "with the key saved for it",
        false => "with no key",
    };
    match app.entry_problem(&entry) {
        Some(detail) => format!("This build cannot call {entry}: {detail}"),
        None => format!("This turn calls {entry} — {model} at {url}, {key}."),
    }
}

