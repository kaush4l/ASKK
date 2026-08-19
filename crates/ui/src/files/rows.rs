//! WHERE YOU ARE and WHAT IS HERE — the two halves of the folder above the
//! editor. Both press the same one handler (`files::open`), told a path.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;

use crate::files::listing::Listing;

/// WHERE YOU ARE (R16-P1-4), pressing the rows' own handler, and the one way
/// back to the whole folder from anywhere inside it.
#[component]
pub(crate) fn WhereYouAre(
    web: Signal<Option<Rc<WebApp>>>,
    agent: ReadSignal<String>,
    at: Signal<String>,
    panel: Signal<Listing>,
    watching: Signal<bool>,
) -> Element {
    let go = move |path: String| super::open(web, agent, at, panel, watching, path, true);
    rsx! {
        crate::files::breadcrumbs::Crumbs { at: at(), on_open: move |path: String| go(path) }
        button {
            class: "file-entry root",
            onclick: move |_| go(".".to_string()),
            "⟳ List the whole folder"
        }
    }
}

/// The entries themselves.
///
/// A SELECTED STATE (R5-9): no class, no `aria-current`, no weight said which
/// row was open. `.file-entry.current` has been in `workspace.css` since the
/// artifact shelf; this pane simply never asked for it.
#[component]
pub(crate) fn EntryRows(
    web: Signal<Option<Rc<WebApp>>>,
    agent: ReadSignal<String>,
    at: Signal<String>,
    panel: Signal<Listing>,
    watching: Signal<bool>,
    shown: Listing,
) -> Element {
    rsx! {
        div { class: "file-list", aria_label: "Entries",
            for item in shown.entries.iter().cloned() {
                button {
                    key: "{item.path}",
                    class: match (item.path == shown.open, item.name.ends_with('/')) {
                        (true, _) => "file-entry current",
                        (false, true) => "file-entry folder",
                        (false, false) => "file-entry",
                    },
                    aria_current: (item.path == shown.open).then_some("true"),
                    onclick: move |_| {
                        let folder = item.name.ends_with('/') || item.name == "..";
                        super::open(web, agent, at, panel, watching, item.path.clone(), folder);
                    },
                    "{item.name}"
                }
            }
        }
    }
}
