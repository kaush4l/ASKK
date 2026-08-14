//! The artifact shelf (15M): what the agent MADE, rendered, beside the folder
//! it made it in.
//!
//! There is no artifact protocol, no artifact tool and no artifact event, and
//! that is the design. An artifact is a FILE the agent wrote into `artifacts/`
//! with the `write_file` it already has, and what it renders as comes from the
//! extension it chose: `report.html` renders as a page, `report.md` as a
//! document, and a new kind of artifact costs nobody a code change.
//!
//! HTML renders in a `sandbox`ed iframe with no `allow-same-origin`, so an
//! artifact runs in an opaque origin: it cannot reach this page's storage, its
//! IndexedDB, or the broker's keys. An agent's output is not trusted content
//! just because our own agent produced it.

use std::rc::Rc;

use adapters_web::{sleep, WebApp};
use dioxus::prelude::*;
use kernel::Request;

use dioxus::core::spawn_forever;

use crate::listing::{self, Listing, TICK_MS, WATCH_TICKS};
use crate::ui::{focus, Button, Card, Disclosure, EmptyState, COMPOSER_ID};
use crate::views::View;

/// The one folder this shelf watches. A convention, named in one place.
pub(crate) const SHELF: &str = "artifacts";

/// WHY THERE IS NO SHELF, SAID ONCE (R7-4). The core's refusal is one sentence
/// and these two cards are stacked, so it appeared twice, four lines apart, in
/// one rail. The pane above owns that explanation — it is the one with the
/// folder in its name — so this says what the condition means HERE.
fn no_folder(who: &str, html: &str) -> Element {
    match listing::spaceless(html) {
        true => rsx! {
            p { class: "pending",
                "{who} has no folder, so there is nowhere to put a finished file. Files \
                 above says how to give it one."
            }
        },
        // The core's own sentence for every other reason.
        false => rsx! { div { class: "pending", dangerous_inner_html: "{html}" } },
    }
}

#[component]
pub fn Artifacts(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    agent: ReadSignal<String>,
    /// So the one action in the empty state can go where the composer is.
    view: Signal<View>,
) -> Element {
    let mut shelf = use_signal(Listing::default);
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
                let next = listing::files_in(web, &agent(), SHELF);
                if next != before {
                    shelf.set(next);
                    break;
                }
            }
            watching.set(false);
        });
    };
    // Ask once when the pane appears, and again whenever the agent's own state
    // moves (R3-19): otherwise a `write_file` lands and the shelf goes on
    // saying nothing has been made. The board's status stamp is the signal.
    let mut listed_at = use_signal(|| None::<u64>);
    use_effect(move || {
        let _ = (tick(), agent());
        if web.read().is_none() {
            return;
        }
        shelf.set(listing::files_in(web, &agent(), SHELF));
        // NOT FOR AN AGENT WHOSE FOLDER THIS IS NOT (R5-1): the core serves it
        // a sentence instead of a listing, and asking it for one anyway is a
        // refused write in the log every time the board's status moves.
        if !listing::served(&shelf.peek().html) {
            return;
        }
        let now = crate::runstatus::since(&web, &agent());
        if *listed_at.peek() == Some(now) {
            return;
        }
        listed_at.set(Some(now));
        let mut refresh = refresh;
        refresh(SHELF, true);
    });
    let now = shelf.read().clone();
    let shelved = listing::served(&now.html); // a folder this page can read

    let open = now.open.clone();
    let html = open.ends_with(".html") || open.ends_with(".htm");
    let who = agent();
    rsx! {
        Card { title: "Finished files · {who}", aria_label: "Finished files by {who}",
            // WHAT A FINISHED FILE IS, STILL READABLE ONCE THERE IS ONE
            // (R16-P2-5): the definition lived only in the empty state, so the
            // first file it explained deleted it.
            if shelved {
                p { class: "note",
                    "A finished file is one {who} wrote into its artifacts/ folder — a report, \
                     a page, a table."
                }
            }
            // The shelf before the agent has made anything: a paragraph and a
            // bare Refresh button was the shape of a broken pane (F7b).
            if !shelved {
                {no_folder(&who, &now.html)}
            } else if now.entries.is_empty() {
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
                            // plain task dies with its scope (see `space.rs`).
                            spawn_forever(async move {
                                let _ = sleep(30).await;
                                focus(COMPOSER_ID);
                            });
                        },
                        "Ask {who} for one in Chat"
                    }
                }
            } else {
                div { class: "file-list",
                    Button {
                        variant: "secondary",
                        onclick: move |_| refresh(SHELF, true),
                        "⟳ Refresh"
                    }
                    for item in now.entries.iter().cloned() {
                        button {
                            key: "{item.path}",
                            class: if item.path == now.open { "file-entry current" } else { "file-entry" },
                            onclick: move |_| refresh(&item.path.clone(), false),
                            "{item.name}"
                        }
                    }
                }
            }
            if shelved && !now.body.is_empty() {
                if html {
                    // Opaque origin: no allow-same-origin, so this cannot reach
                    // the page's storage or the broker's keys. Scripts run —
                    // an artifact that cannot run is a picture of one.
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
            // NOT OVER AN EMPTY SHELF (R11-AESTHETIC): the note and the empty
            // state above already say what one is and that there is none.
            if shelved && !now.entries.is_empty() {
            Disclosure { summary: "How a finished file gets here",
                p { class: "note",
                    "There is no format to learn and no special tool to call: the agent uses \
                     the write_file it already has, and the extension it chose is what this \
                     panel renders. A new kind of finished file is a new file name."
                }
            }
            }
        }
    }
}
