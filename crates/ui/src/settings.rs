//! `Settings` — the model catalogue, endpoints and keys (plan, "UI shape").
//! It writes to the ADR-006 broker, NOT through the seam: `core::handle`
//! records an Event for every request (I8), and a credential must never enter
//! the log, a Document, or a module. The picker chooses a `public/models.json`
//! entry; the fields under it OVERRIDE it and live in this browser, blank
//! meaning "whatever the file says". The key field is WRITE-ONLY, so blank
//! means "leave the stored key alone"; Clear key is the explicit way.
//!
//! A key belongs to ONE entry. Everything here says which entry it is talking
//! about, because a key that follows the picker around is a key sent to three
//! other people's servers (`ux-walker`, increment 04).

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;

use crate::settings_view::{endpoint_form, TrustNote};
use crate::ui::Card;

/// The pane's fields; `Signal` is `Copy`, so passing this around is free.
#[derive(Clone, Copy)]
pub(crate) struct Fields {
    pub entry: Signal<String>,
    pub base: Signal<String>,
    pub key: Signal<String>,
    pub model: Signal<String>,
    pub status: Signal<String>,
    /// Whether the SELECTED entry has a key — never "some key exists".
    pub has_key: Signal<bool>,
    /// The env var this entry's key comes from in the Python catalogue.
    /// Empty means the entry asks for no key at all — which is how the pane
    /// knows whether "leave this empty" is true for THIS entry.
    pub key_env: Signal<String>,
    pub names: Signal<Vec<String>>,
    /// "something moved" — bumped after every save so the chat pane's
    /// endpoint line and the tool trace redraw against the new truth.
    pub tick: Signal<u32>,
}

/// Fill the pane from the broker. The key itself is never read back out.
fn show_current(web: Signal<Option<Rc<WebApp>>>, mut f: Fields, mut endpoint_set: Signal<bool>) {
    if let Some(app) = web.read().clone() {
        let (url, has_key, model, key_env) = app.endpoint_summary();
        endpoint_set.set(!url.is_empty());
        f.names.set(app.catalogue_names());
        f.entry.set(app.current_entry());
        f.base.set(url);
        f.model.set(model);
        f.has_key.set(has_key);
        f.key_env.set(key_env);
    }
}

/// Switching entries shows what THAT entry resolves to — its URL, its model,
/// whether IT has a key — and refuses here if this build cannot call it, one
/// send before the refusal used to arrive.
pub(crate) fn pick_entry(web: Signal<Option<Rc<WebApp>>>, mut f: Fields, name: String) {
    let Some(app) = web.peek().clone() else { return };
    let (base, model, key_env) = app.entry_fields(&name);
    f.base.set(base);
    f.model.set(model);
    f.key_env.set(key_env);
    f.has_key.set(app.entry_has_key(&name));
    // Selecting is not saving. The card relabels itself around the new pick
    // the moment you choose it, while the chat pane above correctly still
    // names the SAVED endpoint — and nothing said which of the two the next
    // turn would use (`ux-walker`, increment 06).
    let saved = app.current_entry();
    f.status.set(match app.entry_problem(&name) {
        Some(detail) => format!("This build cannot call {name}: {detail}"),
        None if name != saved => format!(
            "Showing {name} — NOT saved. The next turn still calls {saved} until you \
             press Save endpoint."
        ),
        None => String::new(),
    });
    f.entry.set(name);
}

/// The sentence after a save: what the next turn actually does, or why it
/// cannot. Separate so `save_endpoint` stays one job.
fn saved_line(app: &WebApp, entry: &str, url: &str, model: &str, has_key: bool) -> String {
    if let Some(detail) = app.entry_problem(entry) {
        return format!("Saved — but this build cannot call {entry}: {detail}");
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

/// Hand the pick and its override to the broker. The key goes straight to
/// `adapters_web`, never to the seam; `None` = blank field = keep what is stored.
pub(crate) fn save_endpoint(
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
                let (url, has_key, model, key_env) = app.endpoint_summary();
                endpoint_set.set(!url.is_empty());
                f.has_key.set(has_key);
                f.key_env.set(key_env);
                f.base.set(url.clone());
                f.model.set(model.clone());
                f.status.set(saved_line(&app, &entry, &url, &model, has_key));
                // A sub-agent's Worker was handed the endpoint at boot and
                // cannot learn a new one; without this, `researcher` kept
                // calling the old endpoint while the page called the new.
                app.restart_agents();
                let n = f.tick.peek().to_owned();
                f.tick.set(n + 1);
            }
            Err(e) => f.status.set(format!("could not save: {e:?}")),
        }
    });
}

/// Forget every choice: the pick, the overrides and the saved keys. Without
/// it the first Save is permanent.
pub(crate) fn reset(web: Signal<Option<Rc<WebApp>>>, mut f: Fields, endpoint_set: Signal<bool>) {
    let Some(app) = web.peek().clone() else { return };
    spawn(async move {
        match app.reset_endpoint().await {
            Ok(()) => {
                show_current(web, f, endpoint_set);
                let n = f.tick.peek().to_owned();
                f.tick.set(n + 1);
                f.status
                    .set("Back to the catalogue default. Saved keys and overrides are gone.".into());
            }
            Err(e) => f.status.set(format!("could not reset: {e:?}")),
        }
    });
}

#[component]
pub fn Settings(
    web: Signal<Option<Rc<WebApp>>>,
    endpoint_set: Signal<bool>,
    tick: Signal<u32>,
) -> Element {
    let f = Fields {
        entry: use_signal(String::new),
        base: use_signal(String::new),
        key: use_signal(String::new),
        model: use_signal(String::new),
        status: use_signal(String::new),
        has_key: use_signal(|| false),
        key_env: use_signal(String::new),
        names: use_signal(Vec::new),
        tick,
    };
    let status = f.status;
    use_effect(move || show_current(web, f, endpoint_set));
    rsx! {
        // The pane three other messages call "Settings" is now called Settings
        // (`ux-walker`, increment 04).
        Card { title: "Settings", aria_label: "Settings",
            {endpoint_form(web, f, endpoint_set)}
            // A refusal is a BLOCKING condition, not help text: styled as the
            // error it is, and announced, rather than reading like the note
            // beneath it (`ux-walker`, increment 05).
            if !status.read().is_empty() {
                p {
                    class: if status.read().contains("cannot call") || status.read().contains("NOT saved") {
                        "error"
                    } else {
                        "pending"
                    },
                    role: "status",
                    "{status}"
                }
            }
            TrustNote {}
        }
    }
}
