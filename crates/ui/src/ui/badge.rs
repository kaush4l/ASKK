//! Badge / StatusDot — DESIGN.md §8. A dot AND a label, never a dot alone.
//!
//! This is increment 06's invariant, restated as a component so it cannot be
//! broken by forgetting: the label is the primary channel and the colour is
//! secondary, because a refused call and a successful one that differ by hue
//! alone are identical with the stylesheet off, identical to a screen reader,
//! and unreadable to anyone who does not see red. The dot is drawn by
//! `.badge::before` from `--tone`, so it is decoration on top of a word.

use dioxus::prelude::*;

#[component]
pub(crate) fn Badge(
    /// idle · starting · waiting · working · failed · closed. Selects
    /// `--tone`; anything else falls back to `--control`, which is the same
    /// answer as "I do not know what this is".
    status: String,
    /// The word. Not optional, and there is no variant of this component that
    /// makes it optional.
    label: String,
) -> Element {
    rsx! {
        span { class: "badge", "data-status": "{status}", "{label}" }
    }
}
