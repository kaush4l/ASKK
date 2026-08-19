//! WHAT SETTINGS SAYS ABOUT AN ADDRESS: whether the endpoint it names actually
//! works, what a save did, the trust model, and why a typed base URL was
//! refused. `endpoint.rs` next door owns the header's sentence and the
//! composer's gate.

/// The search endpoint's own card, a child of this file rather than a module
/// of its own: it is one more thing Settings says about an address.
pub(crate) mod search;

/// The one entry that is not a server: the model built into the browser.
pub(crate) mod ondevice;
/// The destructive control — arm, then reset every endpoint.
pub(crate) mod reset;

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;

/// WHETHER THE ENDPOINT IS ACTUALLY WORKING, as far as anything here knows
/// (R2-6). Settings could tell you what the next turn WOULD call and nothing
/// else, so the only way to find out that an address was wrong was to go to
/// Chat and lose a message to it.
///
/// This is not a new probe and deliberately not one: the app already holds the
/// answer to "did the last call to this endpoint work". `GET /board` is the
/// exact request the header's heartbeat makes, and `x-failed` is the exact
/// header the trouble pill reads. Same call, said where the address is typed.
///
/// It reports a FAILURE, never a success: no failure on the board is not the
/// same fact as "this endpoint answers", and claiming the second from the first
/// is the invention this pane refuses everywhere else.
fn last_failure(web: Signal<Option<Rc<WebApp>>>) -> String {
    let Some(app) = web.read().clone() else { return String::new() };
    let failed = crate::board::read_attrs::failure(&app.handle(kernel::Request::get("/board")));
    let why = failed.why;
    if why.is_empty() {
        return String::new();
    }
    match failed.who {
        whose if whose.is_empty() => format!("The last turn failed: {why}"),
        whose => format!("{whose}'s last turn failed: {why}"),
    }
}

/// THE ONE THING SETTINGS COULD NOT TELL YOU: whether the endpoint it names
/// actually works (R2-6). It re-reads on the page's heartbeat, so a turn that
/// fails while Settings is open says so here without a click.
#[component]
pub(crate) fn EndpointHealth(web: Signal<Option<Rc<WebApp>>>, tick: Signal<u32>) -> Element {
    let mut broken = use_signal(String::new);
    use_effect(move || {
        let _ = tick();
        let now = last_failure(web);
        if *broken.peek() != now {
            broken.set(now);
        }
    });
    if broken.read().is_empty() {
        return rsx! {};
    }
    rsx! {
        p { class: "error", role: "status", "⚠ {broken}" }
        p { class: "note",
            "Nothing on this page calls the endpoint on its own — a turn is the only thing \
             that does — so correct the address or the key above and send one message to see \
             this clear."
        }
    }
}

/// The sentence after a save: what the next turn actually does, or why it
/// cannot. Here rather than in `settings/mod.rs` because it is the same question
/// `endpoint_line` above answers for the header — one file owns what this
/// build says about an address.
pub(crate) fn saved_line(app: &WebApp, entry: &str, url: &str, model: &str, has_key: bool) -> String {
    if let Some(detail) = app.entry_problem(entry) {
        return format!("Saved — but this build cannot call {entry}: {detail}");
    }
    // No address, so "calls {url}" would describe a request that never happens.
    if ondevice::is_on_device(app, entry) {
        return "Saved. The next turn runs on your browser's own model, on this machine — \
                no address is called and no API key is sent.".into();
    }
    let key = match has_key {
        true => format!("with the key saved for {entry}"),
        false => "with no key".to_string(),
    };
    match url.is_empty() {
        true => format!("Saved — but {entry} has no base URL, so there is nothing to call."),
        false => format!("Saved. The next turn calls {url} as {model}, {key}."),
    }
}

/// Whether the Settings form holds anything a save would change (R7-14): a
/// typed key, or an address or model id that differs from what the picked entry
/// already resolves to. Read off the BROKER, which is where the saved truth is
/// — the pane keeps no second copy of it to drift from.
pub(crate) fn unsaved(web: Signal<Option<Rc<WebApp>>>, f: crate::settings::Fields) -> bool {
    let Some(app) = web.read().clone() else { return false };
    if !f.key.read().trim().is_empty() {
        return true;
    }
    let (base, model, _) = app.entry_fields(&f.entry.read().clone());
    *f.base.read() != base || *f.model.read() != model
}

/// The trust model, stated where keys are entered (ADR-006).
///
/// IT SAID IT TWICE IN CAPITALS (R6-14). "stored against the ONE entry it was
/// typed for" was the only shouting in the product — a tic that reads like a
/// different author wrote this paragraph, in the one card where the tone has to
/// be steady because it is about a credential. The sentence carries itself.
///
/// ONE CLAIM ABOUT CHROME, AND IT IS THE TRUE ONE (R8-8). This said Chrome 142+
/// *blocks* a page from calling a local address while the failure that same
/// condition produces said it *asks permission*. Local Network Access ships as
/// a PERMISSION — the page prompts and the call goes through if it is granted;
/// a block is what a DENIAL produces. Both places now say the permission
/// (`core::failure::failure_line` is the other).
#[component]
pub(crate) fn TrustNote() -> Element {
    rsx! {
        p { class: "pending",
            "The endpoints above are a file this site serves; what you save here is stored in \
             this browser and layered on top of it. A key is stored against the one entry it \
             was typed for, never shown again, and attached only to calls to that entry's \
             endpoint — switching entries does not carry it across. But this is a browser: any \
             code on this page could read it, so use a scoped, credit-limited key. A provider \
             must send CORS headers, and Chrome 142+ asks permission before a page may call a \
             local address such as 127.0.0.1."
        }
    }
}

/// Why this base URL cannot be saved, in this app's own words (R2-20). Blank
/// is legal and means "use this entry's own address", which is why the field
/// is not `required` either.
pub(crate) fn bad_base(url: &str) -> Option<String> {
    bad_address(url, "http://127.0.0.1:8873/v1", "to use this entry's own")
}

/// The same rule, told in the CALLING FIELD'S OWN TERMS (24-walk F2). The search
/// endpoint reused this message verbatim and so refused a SearXNG address with
/// an LLM example carrying a `/v1` path its own copy tells you to leave off, and
/// with a blank-means clause about entry inheritance that does not exist there.
/// The check is one rule; the example and what blank means are the field's.
pub(crate) fn bad_address(url: &str, example: &str, blank_means: &str) -> Option<String> {
    let url = url.trim();
    let host = url
        .strip_prefix("http://")
        .or_else(|| url.strip_prefix("https://"));
    if url.is_empty() || host.is_some_and(|h| !h.is_empty()) {
        return None;
    }
    // "It STARTS with http://" asserted of the value what the rule REQUIRES of
    // it, so the message contradicted itself in the one sentence explaining why
    // the value was refused (R11-13).
    Some(format!(
        "That base URL is not an address this can call: “{url}”. It must start with http:// or \
         https:// — for example {example} — or be left empty {blank_means}."
    ))
}

/// Whether the status line is a REFUSAL — nothing was saved — rather than a
/// report of what was. A refused Base URL is not one: it goes under its field
/// (R4-7). Here because the wordings it matches are written here.
pub(crate) fn refusal(status: &str) -> bool {
    ["cannot call", "not saved yet"].iter().any(|mark| status.contains(mark))
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_refused_address_is_told_off_in_its_own_field_s_terms() {
        // The search field's refusal must not offer an LLM path as the example,
        // nor promise the entry-inheritance meaning of blank (24-walk F2).
        let why = super::bad_address("not-a-url", "https://search.rhscz.eu", "to leave it off")
            .expect("not-a-url is refused");
        assert!(why.contains("https://search.rhscz.eu"), "{why}");
        assert!(!why.contains("/v1"), "the model endpoint's example leaked: {why}");
        assert!(!why.contains("entry's own"), "{why}");
        // …and the model field keeps the wording it had.
        let base = super::bad_base("not-a-url").expect("not-a-url is refused");
        assert!(base.contains("http://127.0.0.1:8873/v1"), "{base}");
        assert!(base.contains("entry's own"), "{base}");
    }

    #[test]
    fn only_a_real_http_address_saves() {
        let ok = |u| super::bad_base(u).is_none();
        assert!(ok(""), "blank means this entry's own address");
        assert!(ok("http://127.0.0.1:8873/v1"));
        assert!(ok("https://api.example.com/v1"));
        assert!(!ok("not a url"));
        assert!(!ok("127.0.0.1:8873/v1"), "no scheme is the Chrome-bubble case");
        assert!(!ok("http://"), "a scheme with no host is not an address");
    }
}
