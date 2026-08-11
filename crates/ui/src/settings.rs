//! `Settings` — the model catalogue, endpoints and keys (plan, "UI shape").
//! It writes to the ADR-006 broker, NOT through the seam: `core::handle`
//! records an Event for every request (I8), and a credential must never enter
//! the log, a Document, or a module. The picker chooses a `public/models.json`
//! entry; the fields under it OVERRIDE it and live in this browser, blank
//! meaning "whatever the file says". The key field is WRITE-ONLY, so blank
//! means "leave the stored key alone"; Clear key is the explicit way.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;

/// The pane's fields; `Signal` is `Copy`, so passing this around is free.
#[derive(Clone, Copy)]
struct Fields {
    entry: Signal<String>,
    base: Signal<String>,
    key: Signal<String>,
    model: Signal<String>,
    status: Signal<String>,
    has_key: Signal<bool>,
    names: Signal<Vec<String>>,
}
/// Fill the pane from the broker. The key itself is never read back out.
fn show_current(web: Signal<Option<Rc<WebApp>>>, mut f: Fields, mut endpoint_set: Signal<bool>) {
    if let Some(app) = web.read().clone() {
        let (url, has_key, model, _) = app.endpoint_summary();
        endpoint_set.set(!url.is_empty());
        f.names.set(app.catalogue_names());
        f.entry.set(app.current_entry());
        f.base.set(url);
        f.model.set(model);
        f.has_key.set(has_key);
    }
}

/// Switching entries shows what THAT entry resolves to, so the fields are
/// never stale against the pick.
fn pick_entry(web: Signal<Option<Rc<WebApp>>>, mut f: Fields, name: String) {
    let Some(app) = web.peek().clone() else { return };
    let (base, model, _) = app.entry_fields(&name);
    f.entry.set(name);
    f.base.set(base);
    f.model.set(model);
    f.status.set(String::new());
}

/// Hand the pick and its override to the broker. The key goes straight to
/// `adapters_web`, never to the seam; `None` = blank field = keep what is stored.
fn save_endpoint(
    web: Signal<Option<Rc<WebApp>>>,
    key: Option<String>,
    mut f: Fields,
    mut endpoint_set: Signal<bool>,
) {
    let Some(app) = web.peek().clone() else { return };
    let (entry, url) = (f.entry.peek().clone(), f.base.peek().clone());
    let model = f.model.peek().clone();
    spawn(async move {
        match app.set_endpoint(&entry, &url, key.as_deref(), &model).await {
            Ok(()) => {
                f.key.set(String::new());
                let (url, has_key, model, _) = app.endpoint_summary();
                endpoint_set.set(!url.is_empty());
                f.has_key.set(has_key);
                f.base.set(url.clone());
                f.model.set(model.clone());
                f.status.set(match (url.is_empty(), has_key) {
                    (true, _) => "Saved — but this entry has no base URL, so there is nothing to call.".into(),
                    (false, true) => format!("Saved. The next turn calls {url} as {model}, with the saved key."),
                    (false, false) => format!("Saved. The next turn calls {url} as {model}, with no key."),
                });
            }
            Err(e) => f.status.set(format!("could not save: {e:?}")),
        }
    });
}

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

/// The write-only key field and the buttons.
fn key_row(web: Signal<Option<Rc<WebApp>>>, f: Fields, endpoint_set: Signal<bool>) -> Element {
    let (mut key, has_key) = (f.key, f.has_key);
    rsx! {
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

/// The form: pick an entry, override it, save. All markup.
fn endpoint_form(web: Signal<Option<Rc<WebApp>>>, f: Fields, endpoint_set: Signal<bool>) -> Element {
    let (mut base, key, mut model) = (f.base, f.key, f.model);
    rsx! {
        form {
            class: "stacked",
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
                placeholder: "http://127.0.0.1:8873/v1",
                oninput: move |e| base.set(e.value()),
            }
            label { r#for: "endpoint-model", "Model id as the endpoint names it — blank uses this entry's own" }
            input {
                id: "endpoint-model",
                r#type: "text",
                value: "{model}",
                autocomplete: "off",
                placeholder: "gpt-4o-mini",
                oninput: move |e| model.set(e.value()),
            }
            {key_row(web, f, endpoint_set)}
        }
    }
}

#[component]
pub fn Settings(web: Signal<Option<Rc<WebApp>>>, endpoint_set: Signal<bool>) -> Element {
    let f = Fields {
        entry: use_signal(String::new),
        base: use_signal(String::new),
        key: use_signal(String::new),
        model: use_signal(String::new),
        status: use_signal(String::new),
        has_key: use_signal(|| false),
        names: use_signal(Vec::new),
    };
    let status = f.status;
    use_effect(move || show_current(web, f, endpoint_set));
    rsx! {
        section { class: "panel", aria_label: "Settings",
            h2 { "Model" }
            {endpoint_form(web, f, endpoint_set)}
            if !status.read().is_empty() { p { class: "pending", "{status}" } }
            TrustNote {}
        }
    }
}

/// The trust model, stated where keys are entered (ADR-006).
#[component]
fn TrustNote() -> Element {
    rsx! {
        p { class: "pending",
            "The list comes from public/models.json — edit that file, redeploy, and the \
             choices change with no rebuild; what you save here is stored in this browser \
             and layered on top of it. The key is stored in this browser, never shown again, \
             and attached only to calls to the endpoint above — but this is a browser: any \
             code on this page could read it, so use a scoped, credit-limited key. A provider \
             must send CORS headers, and Chrome 142+ blocks a hosted page from calling a \
             local address such as 127.0.0.1."
        }
    }
}
