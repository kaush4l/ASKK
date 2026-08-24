//! THE FOUR DIRECTIONS (ADE-DESIGN.md §4) — which one this device draws.
//!
//! Its own file rather than a second half of `skin.rs`, because the two bits
//! are not the same kind of thing and saying so is the point. A SKIN is a token
//! swap: `glow` and `plain` are one page with the light on or off. A THEME is a
//! different answer to "what does an assistant that works look like" — it may
//! move type, space, corners, and the shape of a turn in the transcript, and
//! `scripts/check-themes.py` is what stops that freedom from becoming the
//! cross-file property collision G1 exists to catch.
//!
//! NOTHING HERE RUNS BEFORE THE FIRST PAINT, and it cannot — this crate is Wasm
//! and the bundle arrives after the first frame. `web/index.html` applies the
//! saved attribute in the `<head>`, the same four lines and the same reasoning
//! as the skin's; this module owns the SWITCH and the storage.
//!
//! No application logic in JS, and none in Rust either (I5): four names and one
//! attribute. Nothing here decides anything about the system being looked at.

use dioxus::prelude::*;

use crate::ui::{Button, Card};

/// The device's own key namespace, beside `askk.skin`. A preference about this
/// screen is not app data and never leaves the machine (I2).
const KEY: &str = "askk.theme";

/// The slug, the name, and the one sentence that says what the direction is
/// FOR — because a picker offering four words is a quiz, and the owner is
/// choosing on feel and functionality, not on vocabulary.
///
/// The empty slug is the shipped page. It is FIRST and it is the default, so
/// choosing costs nothing and reverting is one press: a round that offers four
/// directions has to leave the fifth — what already exists — on the list, or it
/// is not offering a choice, it is announcing one.
const THEMES: [(&str, &str, &str); 5] = [
    ("", "As it ships", "The current page: violet ground, serif headline, ruled panels."),
    ("halo", "Halo", "One light, one field, centred. Voice first, air everywhere, no corners."),
    ("console", "Console", "Monospace and dense. No light, no blur, square. Rows over room."),
    ("gallery", "Gallery", "Light paper, big rounded cards, thumb-sized targets. Made for a phone."),
    ("atelier", "Atelier", "Warm ink and paper. Serif prose, two rules, the workshop reading."),
];

fn storage() -> Option<web_sys::Storage> {
    web_sys::window()?.local_storage().ok().flatten()
}

/// Which theme is stored. Absent, unreadable, or a name no stylesheet answers
/// to all mean the same thing — the shipped page — because that is what
/// `index.html` painted before this component existed.
fn saved() -> String {
    let raw = storage().and_then(|s| s.get_item(KEY).ok().flatten()).unwrap_or_default();
    match THEMES.iter().any(|(slug, _, _)| !slug.is_empty() && *slug == raw) {
        true => raw,
        false => String::new(),
    }
}

/// Put the choice where CSS can see it and where a reload can find it again.
/// The empty slug REMOVES the attribute rather than writing `data-theme=""`:
/// an empty attribute matches no stylesheet and would leave the DOM asserting a
/// theme the page does not have, which is the kind of half-truth I16 is about.
fn apply(slug: &str) {
    if let Some(root) =
        web_sys::window().and_then(|w| w.document()).and_then(|d| d.document_element())
    {
        let _ = match slug.is_empty() {
            true => root.remove_attribute("data-theme").map(|_| ()),
            false => root.set_attribute("data-theme", slug),
        };
    }
    if let Some(s) = storage() {
        let _ = match slug.is_empty() {
            true => s.remove_item(KEY),
            false => s.set_item(KEY, slug),
        };
    }
}

/// The picker. A radio GROUP and not five toggles: these are mutually
/// exclusive, exactly one is true at a time, and `aria-checked` on a
/// `radiogroup` is the one control that says so to a screen reader without the
/// reader having to press anything to find out.
#[component]
pub fn Themes() -> Element {
    let mut chosen = use_signal(saved);
    use_effect(move || apply(&chosen()));
    rsx! {
        Card { title: "Theme", aria_label: "Theme", variant: "flat reading",
            p { class: "note",
                "Four directions for what this product looks and feels like, plus the page as \
                 it ships. They change type, space, colour and the shape of a turn in the \
                 transcript — not what anything does. Switching is immediate and this device \
                 remembers; adding ?theme= to the address shows one without changing what is \
                 saved."
            }
            div { class: "theme-list", role: "radiogroup", aria_label: "Theme",
                for (slug, name, what) in THEMES {
                    Button {
                        class: "theme-choice",
                        variant: "ghost",
                        role: "radio",
                        aria_checked: if chosen() == slug { "true" } else { "false" },
                        onclick: move |_| chosen.set(slug.to_string()),
                        span { class: "theme-name", "{name}" }
                        span { class: "theme-what", "{what}" }
                    }
                }
            }
        }
    }
}
