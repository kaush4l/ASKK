//! The artifact shelf (15M): what the agent MADE, rendered, beside the folder
//! it made it in.
//!
//! There is no artifact protocol, no artifact tool and no artifact event, and
//! that is the design. An artifact is a FILE the agent wrote into `artifacts/`
//! with the `write_file` it already has, and what it renders as comes from the
//! extension it chose. So a new kind of artifact costs nobody a code change —
//! the agent writes `report.html` instead of `report.md` and the shelf renders
//! a page instead of a document. "Without hardcoding" means the convention is
//! the whole mechanism.
//!
//! HTML renders in a `sandbox`ed iframe with no `allow-same-origin`, so an
//! artifact runs in an opaque origin: it cannot reach this page's storage, its
//! IndexedDB, or the broker's keys. An agent's output is not trusted content
//! just because our own agent produced it — the model wrote it, and a model
//! reads the web.

use std::rc::Rc;

use adapters_web::{sleep, WebApp};
use dioxus::prelude::*;
use kernel::Request;

use crate::ui::{Button, Card};

/// The one folder this shelf watches. A convention, named in one place.
pub(crate) const SHELF: &str = "artifacts";

/// How long to watch for a listing the async half is still producing.
const TICK_MS: i32 = 500;
const WATCH_TICKS: u32 = 240;

/// One artifact on the shelf.
#[derive(Clone, PartialEq)]
struct Item {
    name: String,
    path: String,
}

/// Everything the shelf is showing at once.
#[derive(Clone, Default, PartialEq)]
struct Shelf {
    items: Vec<Item>,
    /// The artifact currently open, and what is in it.
    open: String,
    body: String,
}

/// Read the shelf: `x-at` scopes the projection to `artifacts/`, so this pane
/// and the Files pane can watch two different folders without overwriting each
/// other's listing.
fn read(web: Signal<Option<Rc<WebApp>>>, agent: &str) -> Shelf {
    let Some(app) = web.peek().clone() else {
        return Shelf::default();
    };
    let res = app.handle(
        Request::get("/files")
            .with_header("x-agent", agent)
            .with_header("x-at", SHELF),
    );
    let items = res
        .headers
        .iter()
        .find(|(k, _)| k == "x-entries")
        .map(|(_, v)| v.as_str())
        .unwrap_or_default()
        .lines()
        .filter_map(|line| line.split_once('\t'))
        .filter(|(name, _)| *name != ".." && !name.ends_with('/'))
        .map(|(name, path)| Item {
            name: name.to_string(),
            path: path.to_string(),
        })
        .collect();
    // The BYTES, off `x-file` — not the core's escaped `<pre>`, which would
    // need a second parser on this side for a string the core already has.
    let (open, body) = res
        .headers
        .iter()
        .find(|(k, _)| k == "x-file")
        .and_then(|(_, v)| v.split_once('\n'))
        .map(|(path, body)| (path.to_string(), body.to_string()))
        .unwrap_or_default();
    Shelf { items, open, body }
}

#[component]
pub fn Artifacts(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    agent: ReadSignal<String>,
) -> Element {
    let mut shelf = use_signal(Shelf::default);
    // One watcher at a time — see `files.rs`.
    let mut watching = use_signal(|| false);
    let mut refresh = move |path: &str, folder: bool| {
        let Some(app) = web.peek().clone() else { return };
        app.handle(
            Request::post_form(
                "/files",
                &[("path", path), ("kind", if folder { "folder" } else { "file" })],
            )
            .with_header("x-agent", &agent()),
        );
        let before = shelf.peek().clone();
        if watching.peek().to_owned() {
            return; // one watcher, whatever the click rate
        }
        watching.set(true);
        spawn(async move {
            for _ in 0..WATCH_TICKS {
                if sleep(TICK_MS).await.is_err() {
                    return;
                }
                let next = read(web, &agent());
                if next != before {
                    shelf.set(next);
                    break;
                }
            }
            watching.set(false);
        });
    };
    // Ask once when the pane appears, and follow the agent after that: an
    // artifact written mid-run shows up because the agent's own `list_files`
    // lands in the same projection.
    use_effect(move || {
        let _ = (tick(), agent());
        if web.read().is_none() {
            return;
        }
        shelf.set(read(web, &agent()));
    });
    let now = shelf.read().clone();
    let open = now.open.clone();
    let html = open.ends_with(".html") || open.ends_with(".htm");
    rsx! {
        Card { title: "Artifacts", aria_label: "Artifacts",
            p { class: "note",
                "Anything the agent writes into artifacts/ shows up here, rendered by its \
                 extension — .html as a page, everything else as text. There is no artifact \
                 format to learn: it is a file, so a new kind of artifact is a new file name."
            }
            div { class: "file-list",
                Button {
                    variant: "secondary",
                    onclick: move |_| refresh(SHELF, true),
                    "⟳ Refresh the shelf"
                }
                for item in now.items.iter().cloned() {
                    button {
                        key: "{item.path}",
                        class: if item.path == now.open { "file-entry current" } else { "file-entry" },
                        onclick: move |_| refresh(&item.path.clone(), false),
                        "{item.name}"
                    }
                }
            }
            if !now.body.is_empty() {
                if html {
                    // Opaque origin: no allow-same-origin, so this cannot reach
                    // the page's storage or the broker's keys. Scripts are
                    // allowed because an artifact that cannot run is a picture
                    // of an artifact.
                    iframe {
                        class: "artifact-frame",
                        title: "{open}",
                        "sandbox": "allow-scripts",
                        srcdoc: "{now.body}",
                    }
                } else {
                    pre { class: "file-view", "data-path": "{open}", "{now.body}" }
                }
            }
        }
    }
}
