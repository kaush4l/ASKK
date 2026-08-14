//! EmptyState — DESIGN.md §8, and the highest-value new component in the set:
//! four of the five rail panels were empty boxes on first load, which is
//! indistinguishable from a panel that is broken.
//!
//! Anatomy: one-line title → ONE sentence → one action. Never a bare "No
//! data". The sentence says what the region is for and what would put something
//! in it, because a person seeing this screen for the first time is being asked
//! to trust an empty box.
//!
//! NO GLYPH (R8-18). Every empty state opened on a Unicode character standing
//! in for an icon set that does not exist — `◈`, `✉`, `▮`, `⚙`, `▤`, `◇` — set
//! at `--t-display` in Inter, so six unrelated shapes from six unrelated blocks
//! rendered at 32px with six different optical weights and baselines, in the
//! exact spot the eye lands first on a panel that has nothing to say. A
//! placeholder for a set nobody drew. Drawing one is six SVGs to maintain for
//! decoration the headline already carries, so the headline carries it.
//!
//! ONE SENTENCE, NOT A PARAGRAPH (R8-EMPTY). These ran to sixty words, and the
//! shared space's repeated its own disclosure verbatim four lines below itself.
//! An empty state is the place with the least to say and it was the longest
//! prose in the product; the mechanism belongs in the disclosure each of these
//! panels already has.

use dioxus::prelude::*;

#[component]
pub(crate) fn EmptyState(
    /// One line. What is not here.
    title: String,
    /// ONE sentence. What this region is for, and what would fill it. `None`
    /// only where the CORE already wrote that sentence and the call site is
    /// putting the projection itself into `children` (R6-15).
    sentence: Option<String>,
    /// The one action. A `Button` at every call site — usually "put something
    /// in this region", which on this page means starting a turn.
    children: Element,
) -> Element {
    rsx! {
        div { class: "empty",
            p { class: "empty-title", "{title}" }
            if let Some(said) = sentence {
                p { "{said}" }
            }
            {children}
        }
    }
}
