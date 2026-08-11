//! The Settings pane's markup, split from its actions so both files stay
//! inside the 200-line rule (I12). Nothing here decides anything: every
//! handler calls into `settings.rs`, which calls the broker.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;

use crate::settings::{pick_entry, reset, save_endpoint, Fields};

/// The catalogue picker.
fn entry_picker(web: Signal<Option<Rc<WebApp>>>, f: Fields) -> Element {
    let names = f.names;
    rsx! {
        label { r#for: "endpoint-entry", "Model (an entry in public/models.json)" }
        select {
            id: "endpoint-entry",
            value: "{f.entry}",
            disabled: names.read().is_empty(),
            onchange: move |e| pick_entry(web, f, e.value()),
            if names.read().is_empty() {
                option { value: "", "no catalogue loaded — type a base URL below" }
            }
            for name in names.read().iter().cloned() {
                option { value: "{name}", selected: name == *f.entry.read(), "{name}" }
            }
        }
    }
}

/// The write-only key field and the buttons. Every sentence names the entry:
/// the key belongs to it and to nothing else.
fn key_row(web: Signal<Option<Rc<WebApp>>>, f: Fields, endpoint_set: Signal<bool>) -> Element {
    let (mut key, has_key, entry) = (f.key, f.has_key, f.entry);
    // "leave empty for a local server" was printed for `openai`, `openrouter`
    // and `sonnet` too, where it is the opposite of the truth (`ux-walker`,
    // increment 05). What that sentence was ever about is the ADDRESS: a
    // loopback endpoint is your own machine and wants no credential; anything
    // else is somebody's API and does. Every catalogue entry names an
    // `api_key_env`, including `local`, so that field cannot decide it.
    let url = f.base.read().clone();
    let is_local = url.contains("127.0.0.1") || url.contains("localhost") || url.contains("[::1]");
    let label = match (has_key(), is_local) {
        (true, _) => format!("API key — a key is saved for {entry}; type here only to replace it"),
        (false, true) => {
            format!("API key for {entry} — a server on this machine needs none; leave it empty")
        }
        (false, false) => format!(
            "API key for {entry} — this endpoint is remote and needs one (the Python reads it \
             from {})",
            f.key_env
        ),
    };
    rsx! {
        label { r#for: "endpoint-key", "{label}" }
        input {
            id: "endpoint-key",
            r#type: "password",
            value: "{key}",
            autocomplete: "off",
            placeholder: if has_key() { "•••••• saved for this entry" } else { "" },
            oninput: move |e| key.set(e.value()),
        }
        div { class: "row",
            button { r#type: "submit", "Save endpoint" }
            if has_key() {
                button {
                    r#type: "button",
                    onclick: move |_| save_endpoint(web, Some(String::new()), f, endpoint_set),
                    "Clear key for {entry}"
                }
            }
            button {
                r#type: "button",
                onclick: move |_| reset(web, f, endpoint_set),
                "Reset to the catalogue default"
            }
        }
    }
}

/// The form: pick an entry, override it, save. All markup.
pub(crate) fn endpoint_form(
    web: Signal<Option<Rc<WebApp>>>,
    f: Fields,
    endpoint_set: Signal<bool>,
) -> Element {
    let (mut base, key, mut model) = (f.base, f.key, f.model);
    // A placeholder shows what THIS entry would use — never another entry's
    // values (`ux-walker`, increment 04). With a catalogue entry selected the
    // fields are filled, so the hint only appears when there is nothing to show.
    let base_hint = match base.read().is_empty() {
        true => "http://127.0.0.1:8873/v1",
        false => "",
    };
    let model_hint = match model.read().is_empty() {
        true => "the model id this endpoint names",
        false => "",
    };
    rsx! {
        form {
            onsubmit: move |e| {
                e.prevent_default();
                let typed = key.peek().trim().to_string();
                save_endpoint(web, (!typed.is_empty()).then_some(typed), f, endpoint_set);
            },
            {entry_picker(web, f)}
            label { r#for: "endpoint-base", "Base URL — blank uses this entry's own (ending in /v1)" }
            input {
                id: "endpoint-base",
                r#type: "url",
                value: "{base}",
                placeholder: "{base_hint}",
                oninput: move |e| base.set(e.value()),
            }
            label { r#for: "endpoint-model", "Model id as the endpoint names it — blank uses this entry's own" }
            input {
                id: "endpoint-model",
                r#type: "text",
                value: "{model}",
                autocomplete: "off",
                placeholder: "{model_hint}",
                oninput: move |e| model.set(e.value()),
            }
            {key_row(web, f, endpoint_set)}
        }
    }
}

/// The trust model, stated where keys are entered (ADR-006).
#[component]
pub(crate) fn TrustNote() -> Element {
    rsx! {
        p { class: "pending",
            "The list comes from public/models.json — edit that file, redeploy, and the \
             choices change with no rebuild; what you save here is stored in this browser \
             and layered on top of it. A key is stored against the ONE entry it was typed \
             for, never shown again, and attached only to calls to that entry's endpoint — \
             switching entries does not carry it across. But this is a browser: any code on \
             this page could read it, so use a scoped, credit-limited key. A provider must \
             send CORS headers, and Chrome 142+ blocks a hosted page from calling a local \
             address such as 127.0.0.1."
        }
    }
}
