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

mod shelf;

use crate::files::listing::{self, Listing, TICK_MS, WATCH_TICKS};
use crate::ui::Card;
use crate::shell::views::View;
use shelf::{ArtifactView, HowItGetsHere, NothingMadeYet, ShelfRows, WhatAFinishedFileIs};

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

/// Open a path and WATCH for the listing the async half is producing — one
/// watcher at a time, whatever the click rate, because each tick is a full trip
/// through the seam.
pub(crate) fn refresh(
    web: Signal<Option<Rc<WebApp>>>,
    agent: ReadSignal<String>,
    mut shelf: Signal<Listing>,
    mut watching: Signal<bool>,
    path: String,
    folder: bool,
) {
    listing::open_path(web, &agent(), &path, folder);
    let before = shelf.peek().clone();
    if watching.peek().to_owned() {
        return;
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
}

/// Ask once when the pane appears, and again whenever the agent's own state
/// moves (R3-19): otherwise a `write_file` lands and the shelf goes on saying
/// nothing has been made. The board's status stamp is the signal.
fn relist(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    agent: ReadSignal<String>,
    shelf: Signal<Listing>,
    watching: Signal<bool>,
) {
    let mut listed_at = use_signal(|| None::<u64>);
    let mut shelf = shelf;
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
        let now = crate::board::read_attrs::since(&web, &agent());
        if *listed_at.peek() == Some(now) {
            return;
        }
        listed_at.set(Some(now));
        refresh(web, agent, shelf, watching, SHELF.to_string(), true);
    });
}

#[component]
pub fn Artifacts(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    agent: ReadSignal<String>,
    /// So the one action in the empty state can go where the composer is.
    view: Signal<View>,
) -> Element {
    let shelf = use_signal(Listing::default);
    // One watcher at a time — see `files/mod.rs`.
    let watching = use_signal(|| false);
    relist(web, tick, agent, shelf, watching);
    let now = shelf.read().clone();
    let shelved = listing::served(&now.html); // a folder this page can read
    let who = agent();
    rsx! {
        Card { title: "Finished files · {who}", aria_label: "Finished files by {who}",
            WhatAFinishedFileIs { who: who.clone(), shelved }
            // The shelf before the agent has made anything: a paragraph and a
            // bare Refresh button was the shape of a broken pane (F7b).
            if !shelved {
                {no_folder(&who, &now.html)}
            } else if now.entries.is_empty() {
                NothingMadeYet { who: who.clone(), view }
            } else {
                ShelfRows { web, agent, shelf, watching, now: now.clone() }
            }
            if shelved {
                ArtifactView { open: now.open.clone(), body: now.body.clone() }
            }
            HowItGetsHere { rows: shelved && !now.entries.is_empty() }
        }
    }
}
