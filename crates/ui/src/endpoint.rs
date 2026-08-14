//! What this page can send, and to whom: the one sentence in the HEADER that
//! says what the next turn actually calls, and the boolean the composer is
//! gated on. Split from `chat.rs`, which owns the conversation; what SETTINGS
//! says about an address — the health line, the save confirmation, the trust
//! note, the base-URL rule — is `endpointform.rs`, so both hold the 200-line
//! rule (I12). One file still owns each half of "what this build says about an
//! address", which is the property that stopped the two from drifting.
//!
//! Both read the BROKER directly rather than a signal some component publishes
//! (15K): a view mounts only while it is current.

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

/// The header pill's sentence, IN FOUR PARTS so that it can shrink instead of
/// dropping (R11-10).
///
/// The pill used to be `display: none` below 75rem, which put a phone in the
/// one state this product must never leave a person in: spending tokens against
/// an endpoint the page had never named. Every other pill that gives way here
/// SHRINKS (the workspace's `.pill-label` / `.pill-short`, R7-12/R9-5), and this
/// one now does the same — `(lead, short, subject, tail)`, where the SUBJECT is
/// the model id and is the part that never leaves. A truncated model id is
/// still an identification; nothing at all is not.
pub(crate) type Parts = (String, String, String, String);

pub(crate) fn endpoint_parts(web: Signal<Option<Rc<WebApp>>>) -> Parts {
    let none = || (String::new(), String::new(), String::new(), String::new());
    let Some(app) = web.read().clone() else { return none() };
    let (url, has_key, model, _) = app.endpoint_summary();
    if url.is_empty() {
        return (
            String::new(),
            String::new(),
            "No endpoint yet".into(),
            " — no turn can be sent.".into(),
        );
    }
    let entry = app.current_entry();
    let key = match has_key {
        true => "with the key saved for it",
        false => "with no key",
    };
    match app.entry_problem(&entry) {
        Some(detail) => (
            "This build cannot call ".into(),
            "cannot call ".into(),
            entry,
            format!(": {detail}"),
        ),
        // The same words `saved_line` uses below (R8-8): one fact, one name.
        None => (
            format!("The next turn calls {entry} — "),
            "calls ".into(),
            model,
            format!(" at {url}, {key}."),
        ),
    }
}

/// …and the whole of it, for the nav's status fold, which has the room.
pub(crate) fn joined(parts: &Parts) -> String {
    let (lead, _, subject, tail) = parts;
    match subject.is_empty() {
        true => String::new(),
        false => format!("{lead}{subject}{tail}"),
    }
}

/// WHAT THE NEXT TURN CALLS, and only that. It carried the fleet's last failure
/// as a modifier too (F12), putting a fact about whichever agent failed inside
/// the header's `Agent: {selected}` cluster. It has its own pill (`trouble.rs`).
///
/// IT SHRINKS; IT DOES NOT DROP (R11-10). `header .chat-endpoint { display:
/// none }` below 75rem meant that at 800 and at 390 nothing on the page named
/// the model or the address a turn was about to spend tokens on. The same shape
/// the workspace pill already uses answers it: the framing is `.pill-label`, the
/// short framing is `.pill-short`, the closing clause is `.pill-tail`, and the
/// MODEL ID between them is never hidden — it only ellipsises.
#[component]
pub fn EndpointPill(parts: Parts) -> Element {
    let (lead, short, subject, tail) = parts;
    if subject.is_empty() {
        return rsx! {};
    }
    // Bound, not interpolated three-deep: `rsx!` folds adjacent literals in the
    // RELEASE profile only, and `"{lead}{subject}{tail}"` there compiles to
    // `String + &String`, which does not exist. Debug built it; `trunk build
    // --release`, which is what `publish.sh` runs, did not.
    let whole = format!("{lead}{subject}{tail}");
    rsx! {
        p { class: "pill chat-endpoint", role: "status", title: "{whole}",
            span { class: "pill-label", "{lead}" }
            span { class: "pill-short", "{short}" }
            span { class: "pill-subject", "{subject}" }
            span { class: "pill-tail", "{tail}" }
        }
    }
}
