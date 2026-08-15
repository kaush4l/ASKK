//! The Settings pane's markup, split from its actions so both files hold the
//! 200-line rule (I12). Nothing here decides anything: every handler calls
//! `settings.rs`, which calls the broker.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;

use crate::endpointform::ondevice;
use crate::endpointform::{bad_base, unsaved};
use crate::settings::{pick_entry, save_endpoint, Fields};
use crate::ui::{Button, Field, Form, SelectField};

/// The endpoint picker — ONE CONCEPT, ONE NAME (R5-17). It was labelled `Model`,
/// offered two providers and a model name as one list, sat above a field
/// labelled `Model id`, and was reset by a button naming a "catalogue". The ids
/// are `public/models.json`'s keys and an agent's `model:` picks one.
fn entry_picker(web: Signal<Option<Rc<WebApp>>>, f: Fields) -> Element {
    let names = f.names;
    rsx! {
        SelectField {
            id: "endpoint-entry",
            label: "Endpoint — which server this build sends a turn to",
            value: "{f.entry}",
            disabled: names.read().is_empty(),
            onchange: move |e: FormEvent| pick_entry(web, f, e.value()),
            if names.read().is_empty() {
                option { value: "", "no endpoints listed — type a base URL below" }
            }
            for name in names.read().iter().cloned() {
                {
                    let shown = ondevice::option_label(web, &name);
                    rsx! { option { value: "{name}", selected: name == *f.entry.read(), "{shown}" } }
                }
            }
        }
        {ondevice::note(web, f)}
    }
}

/// WHAT THE KEY FIELD SAYS, which is a claim about the ADDRESS: a loopback
/// endpoint wants no credential, anything else does. Every entry names an
/// `api_key_env`, so that cannot decide it; nothing derives from a REFUSED value
/// (R4-6).
fn key_label(f: Fields) -> String {
    let entry = f.entry;
    if f.has_key.read().to_owned() {
        return format!("API key — a key is saved for {entry}; type here only to replace it");
    }
    if !f.bad_url.read().is_empty() {
        return format!("API key for {entry} — whether it needs one follows from the address above");
    }
    let url = f.base.read().clone();
    // …in WORDS A READER CAN CHECK (R2-7): it named "the Python" and an
    // environment variable, neither of which has a referent here.
    match url.contains("127.0.0.1") || url.contains("localhost") || url.contains("[::1]") {
        true => format!("API key for {entry} — a server on this machine needs none; leave it empty"),
        false => format!("API key for {entry} — this address is on the internet, so it needs one"),
    }
}

/// The key field and the buttons; every sentence names the entry.
fn key_row(web: Signal<Option<Rc<WebApp>>>, f: Fields, endpoint_set: Signal<bool>) -> Element {
    let (mut key, has_key, entry, label) = (f.key, f.has_key, f.entry, key_label(f));
    let od = ondevice::showing(web, f);
    rsx! {
        if !od {
            Field {
                id: "endpoint-key",
                label: "{label}",
                r#type: "password",
                value: "{key}",
                autocomplete: "off",
                placeholder: if has_key() { "•••••• saved for this entry" } else { "" },
                oninput: move |e: FormEvent| key.set(e.value()),
            }
        }
        // UNSAVED EDITS ARE SAID SO (R7-14): leaving this route drops them.
        if !od && unsaved(web, f) {
            p { class: "file-state dirty", role: "status",
                "Unsaved changes — press Save this endpoint, or they are dropped when you \
                 leave this view."
            }
        }
        div { class: "row",
            // A SECONDARY (R3-16): it was the loudest control on the page.
            Button { variant: "secondary", submit: true, "Save this endpoint" }
            if has_key() {
                Button {
                    variant: "secondary",
                    onclick: move |_| save_endpoint(web, Some(String::new()), f, endpoint_set),
                    "Clear key for {entry}"
                }
            }
            {crate::endpointform::reset::reset_control(web, f, endpoint_set)}
        }
    }
}

/// The form: pick an entry, override it, save. All markup — and the SPLIT's
/// reading column now (`settings.rs`, R6-LAYOUT).
pub(crate) fn endpoint_form(
    web: Signal<Option<Rc<WebApp>>>,
    mut f: Fields,
    endpoint_set: Signal<bool>,
) -> Element {
    let (mut base, key, mut model) = (f.base, f.key, f.model);
    let refused = move || !f.bad_url.read().is_empty(); // R4-6: nothing derives from it
    // A placeholder shows what THIS entry would use, never another's (04).
    let base_hint = match base.read().is_empty() {
        true => "http://127.0.0.1:8873/v1",
        false => "",
    };
    let model_hint = match model.read().is_empty() {
        true => "the model id this endpoint names",
        false => "",
    };
    // The browser's own model: no address to refuse, no key to send, no model
    // id to override. The three fields are replaced by the sentence saying so.
    let od = ondevice::showing(web, f);
    rsx! {
        Form {
            // OUR refusal, not Chrome's (R2-20): its bubble goes on blur.
            novalidate: true,
            onsubmit: move |_| {
                let why = match od {
                    true => String::new(),
                    false => bad_base(&base.peek().clone()).unwrap_or_default(),
                };
                f.bad_url.set(why.clone());
                if !why.is_empty() { return; }
                let typed = key.peek().trim().to_string();
                save_endpoint(web, (!typed.is_empty()).then_some(typed), f, endpoint_set);
            },
            {entry_picker(web, f)}
            if od { {ondevice::fields()} }
            if !od {
            Field {
                id: "endpoint-base",
                label: "Base URL — blank uses this endpoint's own (ending in /v1)",
                r#type: "url",
                value: "{base}",
                placeholder: "{base_hint}",
                // WIRED TO ITS FIELD (R4-7): it used to sit two fields below.
                "aria-invalid": if refused() { "true" } else { "false" },
                "aria-describedby": if refused() { "endpoint-base-why" } else { "" },
                oninput: move |e: FormEvent| {
                    base.set(e.value());
                    if !f.bad_url.peek().is_empty() { f.bad_url.set(String::new()); }
                },
            }
            // Directly under the field it is about, before anything else.
            if refused() {
                p { id: "endpoint-base-why", class: "error", role: "status", "⚠ {f.bad_url}" }
            }
            Field {
                id: "endpoint-model",
                label: "Model id, as that endpoint names it — blank uses its own",
                r#type: "text",
                value: "{model}",
                autocomplete: "off",
                placeholder: "{model_hint}",
                oninput: move |e: FormEvent| model.set(e.value()),
            }
            }
            {key_row(web, f, endpoint_set)}
        }
    }
}
