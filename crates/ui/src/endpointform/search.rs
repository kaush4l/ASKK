//! WHERE A WEB SEARCH GOES — the setting that turns `web_search` from a tool
//! that refuses into a tool that works (increment 21).
//!
//! Its own card, beside the endpoint one rather than inside it, because it is
//! a different destination with a different trust story: no key is ever sent
//! here, and the address is not one of the shipped catalogue's entries.
//!
//! NOTHING IS ENABLED BY TYPING NOTHING. The field ships empty and the tool
//! refuses until a person fills it in — CLAUDE.md §17 makes a network
//! allowlist a user gate, so this build offers a suggestion and never a
//! default. The suggestion is placeholder text, which is a thing you have to
//! choose to copy, not a value that is already saved.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;

use crate::endpointform::bad_address;
use crate::ui::{Button, Card, Field, Form};

/// The one instance measured to serve CORS + JSON from a browser (the
/// predecessor's `web_search` work). Offered, never applied: it is somebody
/// else's server and reading every query typed here is what it does.
const SUGGESTED: &str = "https://search.rhscz.eu";

/// What the pane says after a save — the address, or that there is none. It
/// names the shape this build appends, because the value is an ORIGIN and the
/// path is not the user's to choose: half the ways to get this wrong are
/// pasting a whole `/search?q=…` URL.
fn saved_line(url: &str) -> String {
    match url.is_empty() {
        true => "Saved. No search endpoint is set, so web_search refuses and says so.".into(),
        false => format!("Saved. A search now calls {url}/search?q=…&format=json."),
    }
}

#[component]
pub fn SearchEndpoint(web: Signal<Option<Rc<WebApp>>>, mut tick: Signal<u32>) -> Element {
    let mut url = use_signal(String::new);
    let mut status = use_signal(String::new);
    let mut refused = use_signal(String::new);
    // Filled from the broker, which is where the saved truth is — the pane
    // keeps no second copy to drift from (`settings.rs`, R13-P1-6).
    use_effect(move || {
        if let Some(app) = web.read().clone() {
            url.set(app.search_endpoint());
        }
    });
    let save = move |_| {
        let typed = url.peek().clone();
        // Blank is legal here and means OFF, so an empty field is not refused
        // — the same rule the model endpoint's Base URL follows.
        let why = match typed.trim().is_empty() {
            true => String::new(),
            // THIS field's example and THIS field's meaning for blank (24-walk
            // F2): an origin with no path, and off rather than inherited.
            false => bad_address(&typed, SUGGESTED, "to leave the agent unable to search")
                .unwrap_or_default(),
        };
        refused.set(why.clone());
        if !why.is_empty() {
            return;
        }
        let Some(app) = web.peek().clone() else { return };
        spawn(async move {
            match app.set_search_endpoint(&typed).await {
                Ok(()) => {
                    let saved = app.search_endpoint();
                    url.set(saved.clone());
                    status.set(saved_line(&saved));
                    let n = tick.peek().to_owned();
                    tick.set(n + 1);
                }
                Err(e) => status.set(format!("could not save: {e:?}")),
            }
        });
    };
    rsx! {
        Card { title: "Web search", aria_label: "Web search",
            Form {
                novalidate: true,
                onsubmit: save,
                Field {
                    id: "search-endpoint",
                    label: "Search endpoint — a SearXNG address; blank means the agent cannot search",
                    r#type: "url",
                    value: "{url}",
                    placeholder: "{SUGGESTED}",
                    "aria-invalid": if refused.read().is_empty() { "false" } else { "true" },
                    "aria-describedby": if refused.read().is_empty() { "" } else { "search-endpoint-why" },
                    oninput: move |e: FormEvent| {
                        url.set(e.value());
                        if !refused.peek().is_empty() { refused.set(String::new()); }
                    },
                }
                if !refused.read().is_empty() {
                    p { id: "search-endpoint-why", class: "error", role: "status", "⚠ {refused}" }
                }
                div { class: "row",
                    Button { variant: "secondary", submit: true, "Save search endpoint" }
                }
            }
            if !status.read().is_empty() {
                p { class: "pending", role: "status", "{status}" }
            }
            // THE COST OF THE SUGGESTION, BESIDE IT. The address above is a
            // stranger's server: every query an agent runs is a line in its
            // log. And most SearXNG instances serve HTML only and refuse
            // cross-origin JSON, so a working-looking address will typically
            // come back as "did not answer with JSON" — self-hosting is the
            // reliable route, and the only one where the queries stay yours.
            p { class: "note",
                "Only the origin — this build appends /search?q=…&format=json itself. Most \
                 public SearXNG instances serve HTML only and refuse cross-origin JSON, so \
                 most addresses will not work here; {SUGGESTED} is one that has answered, and \
                 running your own instance is the reliable route. No API key is ever sent to \
                 this address, and whoever runs it sees every query an agent makes."
            }
        }
    }
}
