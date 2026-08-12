//! Skeleton — DESIGN.md §8. Blocks in the shape of what is loading.
//!
//! It exists because of one specific confusion: before it, a region that had
//! not answered yet and a region with nothing in it were the SAME empty box.
//! The five rail panels each hold an empty `String` signal until the core's
//! first projection lands, so on first paint the page showed four boxes that
//! looked broken and then filled in. A skeleton says "wait"; an EmptyState
//! says "there is nothing"; they are different claims and the page now makes
//! the right one.
//!
//! `role="status"` with a real label, so the wait reaches a screen reader too
//! — a shimmer is not an announcement. The shimmer itself stops under
//! `prefers-reduced-motion` through the global rule in `base.css`.

use dioxus::prelude::*;

#[component]
pub(crate) fn Skeleton(
    /// How many blocks. Default 3: enough to read as a list rather than as one
    /// grey bar, which is what a single block looks like.
    lines: Option<u8>,
    /// What is loading, in words.
    label: Option<String>,
) -> Element {
    let label = label.unwrap_or_else(|| "Loading".to_string());
    rsx! {
        div { class: "skeleton-stack", role: "status", aria_label: "{label}",
            for line in 0..lines.unwrap_or(3) {
                div { key: "{line}", class: "skeleton" }
            }
        }
    }
}
