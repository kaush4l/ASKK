//! THE SHELF ON SCREEN: what a finished file is, the files there are, the one
//! that is open, and what to say when there are none. The pane beside this owns
//! the reading and the watching; this owns the arrangement.

use std::rc::Rc;

use adapters_web::{sleep, WebApp};
use dioxus::prelude::*;

use dioxus::core::spawn_forever;

use crate::files::listing::Listing;
use crate::ui::{focus, Button, Disclosure, EmptyState, COMPOSER_ID};
use crate::shell::views::View;

/// WHAT A FINISHED FILE IS, STILL READABLE ONCE THERE IS ONE (R16-P2-5): the
/// definition lived only in the empty state, so the first file it explained
/// deleted it. `shelved` because there is nothing to define for an agent whose
/// folder this page cannot read.
#[component]
pub(crate) fn WhatAFinishedFileIs(who: String, shelved: bool) -> Element {
    if !shelved {
        return rsx! {};
    }
    rsx! {
        p { class: "note",
            "A finished file is one {who} wrote into its artifacts/ folder — a report, \
             a page, a table."
        }
    }
}

/// A folder this page can read, with nothing in it yet.
#[component]
pub(crate) fn NothingMadeYet(who: String, view: Signal<View>) -> Element {
    rsx! {
        EmptyState {
            title: "Nothing has been made yet",
            // A CONDITION, not a prophecy (R4-14). ONE sentence, and
            // no longer the definition: that is above, where it
            // survives the first file (R16-P2-5).
            sentence: "That folder does not exist yet — {who} makes it when it writes \
                       the first one.",
            // The one action, and one that can do something.
            Button {
                variant: "secondary",
                onclick: move |_| {
                    let mut view = view;
                    view.set(View::Chat);
                    // `spawn_forever`: routing UNMOUNTS this pane and a
                    // plain task dies with its scope (see `space/mod.rs`).
                    spawn_forever(async move {
                        let _ = sleep(30).await;
                        focus(COMPOSER_ID);
                    });
                },
                "Ask {who} for one in Chat"
            }
        }
    }
}

/// The files on the shelf, and the one control that asks for them again.
#[component]
pub(crate) fn ShelfRows(
    web: Signal<Option<Rc<WebApp>>>,
    agent: ReadSignal<String>,
    shelf: Signal<Listing>,
    watching: Signal<bool>,
    now: Listing,
) -> Element {
    let open = move |path: String, folder: bool| {
        super::refresh(web, agent, shelf, watching, path, folder);
    };
    rsx! {
        div { class: "file-list",
            Button {
                variant: "secondary",
                onclick: move |_| open(super::SHELF.to_string(), true),
                "⟳ Refresh"
            }
            for item in now.entries.iter().cloned() {
                button {
                    key: "{item.path}",
                    class: if item.path == now.open { "file-entry current" } else { "file-entry" },
                    onclick: move |_| open(item.path.clone(), false),
                    "{item.name}"
                }
            }
        }
    }
}

/// The open file, rendered as the extension it was given.
#[component]
pub(crate) fn ArtifactView(open: String, body: String) -> Element {
    if body.is_empty() {
        return rsx! {};
    }
    let html = open.ends_with(".html") || open.ends_with(".htm");
    rsx! {
        if html {
            // Opaque origin: no allow-same-origin, so this cannot reach
            // the page's storage or the broker's keys. Scripts run —
            // an artifact that cannot run is a picture of one.
            iframe {
                class: "artifact-frame",
                title: "{open}",
                "sandbox": "allow-scripts",
                srcdoc: "{body}",
            }
        } else {
            pre { class: "file-view", "data-path": "{open}", "{body}" }
        }
    }
}

/// NOT OVER AN EMPTY SHELF (R11-AESTHETIC): the note and the empty state above
/// already say what one is and that there is none, so `rows` keeps this off a
/// shelf with nothing on it.
#[component]
pub(crate) fn HowItGetsHere(rows: bool) -> Element {
    if !rows {
        return rsx! {};
    }
    rsx! {
        Disclosure { summary: "How a finished file gets here",
            p { class: "note",
                "There is no format to learn and no special tool to call: the agent uses \
                 the write_file it already has, and the extension it chose is what this \
                 panel renders. A new kind of finished file is a new file name."
            }
        }
    }
}
