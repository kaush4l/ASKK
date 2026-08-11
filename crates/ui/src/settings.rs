//! `Settings` — endpoints and keys (plan, "UI shape"). It writes to the
//! ADR-006 broker in `adapters_web` and NOT through the seam: `core::handle`
//! records an Event for every request (I8), and a credential must never enter
//! the log, a Document, or a module. This component is the only place a key is
//! typed, and the broker is the only place it is kept.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;

#[component]
pub fn Settings(web: Signal<Option<Rc<WebApp>>>) -> Element {
    let mut base = use_signal(String::new);
    let mut key = use_signal(String::new);
    let mut status = use_signal(String::new);

    use_effect(move || {
        if let Some(app) = web.read().clone() {
            let (url, has_key) = app.endpoint_summary();
            base.set(url);
            status.set(if has_key { "A key is stored for this endpoint.".into() } else { String::new() });
        }
    });

    let save = move || {
        let Some(app) = web.peek().clone() else { return };
        let (url, secret) = (base(), key());
        spawn(async move {
            match app.set_endpoint(&url, &secret).await {
                Ok(()) => status.set("Saved. The next turn uses this endpoint.".into()),
                Err(e) => status.set(format!("could not save: {e:?}")),
            }
        });
    };

    rsx! {
        section { class: "panel", aria_label: "Settings",
            h2 { "Model endpoint" }
            form {
                class: "stacked",
                onsubmit: move |e| { e.prevent_default(); save(); },
                label { r#for: "endpoint-base", "Base URL (OpenAI-compatible)" }
                input {
                    id: "endpoint-base",
                    r#type: "url",
                    value: "{base}",
                    placeholder: "http://127.0.0.1:8873/v1",
                    oninput: move |e| base.set(e.value()),
                }
                label { r#for: "endpoint-key", "API key (leave empty for a local server)" }
                input {
                    id: "endpoint-key",
                    r#type: "password",
                    value: "{key}",
                    autocomplete: "off",
                    oninput: move |e| key.set(e.value()),
                }
                button { r#type: "submit", "Save endpoint" }
            }
            if !status.read().is_empty() { p { class: "pending", "{status}" } }
            p { class: "pending",
                "Empty base URL means this site's own /v1 proxy. The key is stored in this \
                 browser and attached only to calls to the endpoint above — but this is a \
                 browser: any code running on this page could read it, so use a scoped, \
                 credit-limited key. A local server must send CORS headers, and Chrome 142+ \
                 asks permission before a page may call a local address."
            }
        }
    }
}
