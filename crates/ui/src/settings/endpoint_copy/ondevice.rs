//! WHAT SETTINGS SAYS ABOUT THE ONE ENTRY THAT IS NOT A SERVER: the model
//! built into the browser. It appears in the picker only where this browser
//! actually has one (I15 — `adapters_web::ondevice` decides), so nothing here
//! is a feature test; it is the copy for an entry that has no address, no API
//! key and no model id, and whose price is a download the browser performs.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;

use crate::settings::Fields;

/// Whether this entry is the browser's own model. The broker answers; the pane
/// keeps no list of its own to drift from.
pub(crate) fn is_on_device(app: &WebApp, name: &str) -> bool {
    app.entry_note(name).1
}

/// Whether the entry the pane is SHOWING is that one.
pub(crate) fn showing(web: Signal<Option<Rc<WebApp>>>, f: Fields) -> bool {
    let Some(app) = web.read().clone() else { return false };
    is_on_device(&app, &f.entry.read().clone())
}

/// What one option in the picker says: the entry's name and WHERE a turn to it
/// goes. For a server that is its host; for this one there is no host, and
/// "no address in the file" would read as a broken entry rather than the point
/// of it.
pub(crate) fn option_label(web: Signal<Option<Rc<WebApp>>>, name: &str) -> String {
    let Some(app) = web.peek().clone() else { return name.to_string() };
    if is_on_device(&app, name) {
        return format!("{name} — your browser's own model, on this machine");
    }
    let (base, _, _) = app.entry_fields(name);
    let rest = base.split("//").nth(1).unwrap_or_default();
    match rest.split('/').next().unwrap_or_default() {
        "" => format!("{name} — no address in the file"),
        at => format!("{name} — {at}"),
    }
}

/// WHAT THE ENTRY COSTS, BEFORE A TURN IS SENT TO IT. `models.json` has carried
/// a `note` on entries since the catalogue landed and nothing ever showed one.
/// This entry is why it must: picking it can commit the browser to a download
/// measured in gigabytes, and the only honest place to say so is the control
/// that picks it. It redraws as the dropdown changes — before Save, and long
/// before a turn.
pub(crate) fn note(web: Signal<Option<Rc<WebApp>>>, f: Fields) -> Element {
    let Some(app) = web.read().clone() else { return rsx! {} };
    let (note, _) = app.entry_note(&f.entry.read().clone());
    if note.is_empty() {
        return rsx! {};
    }
    rsx! { p { class: "note", role: "status", "{note}" } }
}

/// Instead of the address, key and model-id fields, which this entry has no use
/// for. Showing them would invite a person to type a URL and a secret that
/// nothing would ever send, and the key field's own label would have to claim
/// this endpoint "is on the internet, so it needs one" — which is the opposite
/// of what it is.
pub(crate) fn fields() -> Element {
    rsx! {
        p { class: "pending",
            "This endpoint has no address, no API key and no model id to type: the words of a \
             turn go to the model your browser runs on this machine and the answer comes back \
             from it. Nothing on this page can point it somewhere else, and none of the keys \
             saved for the other endpoints are sent with it."
        }
    }
}
