//! EmptyState — DESIGN.md §8, and the highest-value new component in the set:
//! four of the five rail panels were empty boxes on first load, which is
//! indistinguishable from a panel that is broken.
//!
//! Anatomy: glyph → one-line title → one sentence → one action. Never a bare
//! "No data". The sentence says what the region is FOR and what would put
//! something in it, because a person seeing this screen for the first time is
//! being asked to trust an empty box, and "no results" gives them nothing to
//! act on.

use dioxus::prelude::*;

#[component]
pub(crate) fn EmptyState(
    /// One character, decorative, `aria-hidden`. It is the fastest thing on
    /// the panel to recognise and it carries no information the title does not.
    glyph: String,
    /// One line. What is not here.
    title: String,
    /// One sentence. What this region is for, and what would fill it.
    sentence: String,
    /// The one action. A `Button` at every call site — usually "put something
    /// in this region", which on this page means starting a turn.
    children: Element,
) -> Element {
    rsx! {
        div { class: "empty",
            span { class: "empty-glyph", aria_hidden: "true", "{glyph}" }
            p { class: "empty-title", "{title}" }
            p { "{sentence}" }
            {children}
        }
    }
}
