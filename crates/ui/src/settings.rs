//! `Settings` — endpoints and keys (plan, "UI shape"). It writes to the
//! ADR-006 broker in `adapters_web` and NOT through the seam: `core::handle`
//! records an Event for every request (I8), and a credential must never enter
//! the log, a Document, or a module. This component is the only place a key is
//! typed, and the broker is the only place it is kept.
//!
//! The key field is WRITE-ONLY: it is never repopulated, because repopulating
//! it would put the secret back in the page. Blank therefore means "leave the
//! stored key alone" — Save cannot silently wipe it — and Clear key is the
//! explicit way to remove one.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;

/// The pane's fields. `Signal` is `Copy`, so passing this around is free.
#[derive(Clone, Copy)]
struct Fields {
    base: Signal<String>,
    key: Signal<String>,
    model: Signal<String>,
    status: Signal<String>,
    has_key: Signal<bool>,
}

/// Fill the pane from the broker: the base URL and the model name, and whether
/// a key is set — the key itself is never read back out.
fn show_current(
    web: Signal<Option<Rc<WebApp>>>,
    mut f: Fields,
    mut endpoint_set: Signal<bool>,
) {
    if let Some(app) = web.read().clone() {
        let (url, has_key, model) = app.endpoint_summary();
        endpoint_set.set(!url.is_empty());
        f.base.set(url);
        f.model.set(model);
        f.has_key.set(has_key);
    }
}

/// Hand the endpoint to the broker and report what happened. The key goes from
/// this call straight to `adapters_web`; it is never an argument to the seam.
/// `key: None` means the field was blank — keep whatever is stored.
fn save_endpoint(
    web: Signal<Option<Rc<WebApp>>>,
    key: Option<String>,
    mut f: Fields,
    mut endpoint_set: Signal<bool>,
) {
    let Some(app) = web.peek().clone() else { return };
    let (url, model) = (f.base.peek().clone(), f.model.peek().clone());
    spawn(async move {
        match app.set_endpoint(&url, key.as_deref(), &model).await {
            Ok(()) => {
                f.key.set(String::new());
                let (url, has_key, _) = app.endpoint_summary();
                endpoint_set.set(!url.is_empty());
                f.has_key.set(has_key);
                f.status.set(match (url.is_empty(), has_key) {
                    (true, _) => "Saved — but with no base URL there is nothing to call.".into(),
                    (false, true) => "Saved. The next turn uses this endpoint, with the saved key.".into(),
                    (false, false) => "Saved. The next turn uses this endpoint, with no key.".into(),
                });
            }
            Err(e) => f.status.set(format!("could not save: {e:?}")),
        }
    });
}

/// The fields themselves. Split out of `Settings` so neither function is a
/// wall: this one is all markup, `Settings` is all state.
fn endpoint_form(
    web: Signal<Option<Rc<WebApp>>>,
    f: Fields,
    endpoint_set: Signal<bool>,
) -> Element {
    let (mut base, mut key, mut model, has_key) = (f.base, f.key, f.model, f.has_key);
    rsx! {
        form {
            class: "stacked",
            onsubmit: move |e| {
                e.prevent_default();
                let typed = key.peek().trim().to_string();
                save_endpoint(web, (!typed.is_empty()).then_some(typed), f, endpoint_set);
            },
            label { r#for: "endpoint-base", "Base URL (OpenAI-compatible, ending in /v1)" }
            input {
                id: "endpoint-base",
                r#type: "url",
                value: "{base}",
                placeholder: "http://127.0.0.1:8873/v1",
                oninput: move |e| base.set(e.value()),
            }
            label { r#for: "endpoint-model", "Model name, as the endpoint names it (blank sends \"local\")" }
            input {
                id: "endpoint-model",
                r#type: "text",
                value: "{model}",
                autocomplete: "off",
                placeholder: "gpt-4o-mini",
                oninput: move |e| model.set(e.value()),
            }
            label { r#for: "endpoint-key",
                if has_key() { "API key — a key is saved; type here only to replace it" }
                else { "API key (leave empty for a local server)" }
            }
            input {
                id: "endpoint-key",
                r#type: "password",
                value: "{key}",
                autocomplete: "off",
                placeholder: if has_key() { "•••••• saved" } else { "" },
                oninput: move |e| key.set(e.value()),
            }
            div { class: "row",
                button { r#type: "submit", "Save endpoint" }
                if has_key() {
                    button {
                        r#type: "button",
                        onclick: move |_| save_endpoint(web, Some(String::new()), f, endpoint_set),
                        "Clear key"
                    }
                }
            }
        }
    }
}

#[component]
pub fn Settings(web: Signal<Option<Rc<WebApp>>>, endpoint_set: Signal<bool>) -> Element {
    let f = Fields {
        base: use_signal(String::new),
        key: use_signal(String::new),
        model: use_signal(String::new),
        status: use_signal(String::new),
        has_key: use_signal(|| false),
    };
    let status = f.status;

    use_effect(move || show_current(web, f, endpoint_set));

    rsx! {
        section { class: "panel", aria_label: "Settings",
            h2 { "Model endpoint" }
            {endpoint_form(web, f, endpoint_set)}
            if !status.read().is_empty() { p { class: "pending", "{status}" } }
            TrustNote {}
        }
    }
}

/// The trust model, stated where keys are entered (ADR-006: "the predecessor
/// stated the browser-visible-key trust model honestly and so do we, in the UI
/// where keys are entered").
#[component]
fn TrustNote() -> Element {
    rsx! {
        p { class: "pending",
            "With no base URL there is no endpoint and the agent cannot answer — this \
             page is static hosting, it has no model of its own. The key is stored in \
             this browser, never shown again, and attached only to calls to the endpoint \
             above — but this is a browser: any code running on this page could read it, \
             so use a scoped, credit-limited key. A local server must send CORS headers, \
             and Chrome 142+ asks permission before a page may call a local address."
        }
    }
}
