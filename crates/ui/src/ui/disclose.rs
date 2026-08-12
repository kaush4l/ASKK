//! Disclosure — DESIGN.md §8. `<details class="disclose">` with a 44px
//! summary and a rotating chevron.
//!
//! One implementation replaces the four hand-rolled `details` blocks in the
//! board, tools, terminal and space panes. All four exist for the same reason
//! and were written four times: increment 12b's walk found each pane leading
//! with four to six lines of explanation above two lines of signal, so the
//! footnote outnumbered the thing it annotated 4:1. The prose went BEHIND a
//! marker, word for word, and not one word of it is cut here either.

use dioxus::prelude::*;

#[component]
pub(crate) fn Disclosure(
    /// The summary line. It is the only thing visible when closed, so it says
    /// what is behind it rather than "More".
    summary: String,
    /// Open on first paint. Default closed: the signal comes first.
    open: Option<bool>,
    #[props(extends = global_attributes, extends = details)] attributes: Vec<Attribute>,
    children: Element,
) -> Element {
    rsx! {
        details {
            class: "disclose panel-note",
            open: open.unwrap_or(false),
            ..attributes,
            summary { "{summary}" }
            {children}
        }
    }
}
