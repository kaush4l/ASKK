//! `Settings` — endpoints and keys (plan, "UI shape"). It writes to the
//! ADR-006 broker, NOT through the seam: `core::handle` records an Event for
//! every request (I8) and a credential must never enter the log. The picker
//! chooses a `public/models.json` entry; the fields under it OVERRIDE it and
//! live in this browser, blank meaning "whatever the file says". The key field
//! is WRITE-ONLY: blank means "leave the stored key alone".
//!
//! A key belongs to ONE entry, and everything here says which one: a key that
//! follows the picker around is a key sent to three other people's servers.

pub(crate) mod endpoint;
pub(crate) mod endpoint_copy;
pub(crate) mod linux_engine;
pub(crate) mod view;

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;

use endpoint_copy::{refusal, saved_line, EndpointHealth, TrustNote};
use view::endpoint_form;
use crate::ui::Card;

/// The pane's fields; `Signal` is `Copy`, so passing this around is free.
#[derive(Clone, Copy)]
pub(crate) struct Fields {
    pub entry: Signal<String>,
    pub base: Signal<String>,
    pub key: Signal<String>,
    pub model: Signal<String>,
    pub status: Signal<String>,
    /// Why the typed Base URL cannot be saved, or empty. Its OWN signal: it
    /// belongs under its field (R4-7), and while it stands nothing reads it (R4-6).
    pub bad_url: Signal<String>,
    /// Whether the SELECTED entry has a key — never "some key exists".
    pub has_key: Signal<bool>,
    /// Whether the destructive reset is ARMED — one press asks, the next does it
    /// (R6-5). On `Fields` because the markup is a plain fn (no hooks).
    pub arm: Signal<bool>,
    pub names: Signal<Vec<String>>,
    /// "something moved" — bumped after every save so the chat pane's
    /// endpoint line and the tool trace redraw against the new truth.
    pub tick: Signal<u32>,
}

/// SHOW ONE ENTRY, BY NAME — the ONE read these three fields are filled from
/// (R13-P1-6). Two of them read `endpoint_summary()`, whatever the broker calls
/// CURRENT, while the picker's labels read `entry_fields(name)` — and a miss
/// `summary()` swallows as an empty `Entry` is exactly the reported shape: the
/// dropdown showing the address you typed over a field that reads as unset.
fn show(app: &WebApp, mut f: Fields, name: &str) -> (String, String, bool) {
    let (url, model, _) = app.entry_fields(name);
    let has_key = app.entry_has_key(name);
    f.base.set(url.clone());
    f.model.set(model.clone());
    f.has_key.set(has_key);
    (url, model, has_key)
}

/// Fill the pane from the broker: the entry it is on, and what that resolves to.
fn show_current(web: Signal<Option<Rc<WebApp>>>, mut f: Fields, mut endpoint_set: Signal<bool>) {
    if let Some(app) = web.read().clone() {
        let entry = app.current_entry();
        endpoint_set.set(!show(&app, f, &entry).0.is_empty());
        f.names.set(app.catalogue_names());
        f.entry.set(entry);
    }
}

/// Switching entries shows what THAT entry resolves to, and refuses here if this
/// build cannot call it — one send before the refusal used to arrive.
pub(crate) fn pick_entry(web: Signal<Option<Rc<WebApp>>>, mut f: Fields, name: String) {
    let Some(app) = web.peek().clone() else { return };
    show(&app, f, &name);
    // Selecting is not saving. The card relabels itself around the new pick at
    // once while the chat pane above still names the SAVED endpoint, and
    // nothing said which the next turn would use (`ux-walker`, increment 06).
    let saved = app.current_entry();
    f.status.set(match app.entry_problem(&name) {
        Some(detail) => format!("This build cannot call {name}: {detail}"),
        None if name != saved => format!(
            "Showing {name} — not saved yet. The next turn still calls {saved} until you \
             press Save this endpoint."
        ),
        None => String::new(),
    });
    f.entry.set(name);
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
                // BY NAME (R13-P1-6): the entry just saved, not "current".
                let (url, model, has_key) = show(&app, f, &entry);
                endpoint_set.set(!url.is_empty());
                f.status.set(saved_line(&app, &entry, &url, &model, has_key));
                // A sub-agent's Worker was handed the endpoint at boot and cannot
                // learn a new one; without this, `researcher` kept calling the old.
                app.restart_agents();
                // …AND THE HEADER STOPS REPORTING A FAILURE OF THE OLD ONE
                // (R8-4). It is about an address this page no longer calls.
                crate::shell::status_pills::hush_current(&app);
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
                f.status.set(
                    "Back to the endpoints shipped with this site. Saved keys and overrides are gone."
                        .into(),
                );
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
        bad_url: use_signal(String::new),
        has_key: use_signal(|| false),
        arm: use_signal(|| false),
        names: use_signal(Vec::new),
        tick,
    };
    let status = f.status;
    use_effect(move || show_current(web, f, endpoint_set));
    rsx! {
        // Called Settings, like the three other messages that name it.
        Card { title: "Settings", aria_label: "Settings",
            // THE FORM IS A READING COLUMN AND THE REST GOES BESIDE IT
            // (R6-LAYOUT). Every field is capped at the measure, so at 1440 this
            // card was a 544px column of labels in a 1136px box with 600px of
            // nothing beside it — while the two things a person needs while
            // typing an address, whether the last turn to it worked and where
            // the key is kept, were stacked below the fold.
            div { class: "split",
                div {
                    {endpoint_form(web, f, endpoint_set)}
                    // A refusal is a BLOCKING condition, not help text: styled
                    // as the error it is, and announced, rather than reading
                    // like the note beneath it (`ux-walker`, increment 05). A
                    // refused BASE URL is one of these too (R2-20).
                    if !status.read().is_empty() {
                        p {
                            class: if refusal(&status.read()) { "error" } else { "pending" },
                            role: "status",
                            "{status}"
                        }
                    }
                }
                div { class: "beside",
                    // WHAT HAPPENED LAST TIME, beside the address that caused
                    // it (R2-6) — and now literally beside it.
                    EndpointHealth { web, tick }
                    TrustNote {}
                }
            }
        }
    }
}
