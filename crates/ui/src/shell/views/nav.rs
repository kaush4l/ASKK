//! THE LEFT PANEL — one `<button>` per view. `views.rs` beside it owns what a
//! view IS: its slug, its label, whether it is scoped to one agent. This owns
//! the list you click, which is a different job and, since the Debug view took
//! `views.rs` past 200 lines, needs a different file (I12).

use dioxus::prelude::*;

use super::{View, NAV};
use crate::ui::Button;

/// The left panel. One `<button>` per view.
#[component]
pub(crate) fn ViewNav(
    view: Signal<View>,
    /// Whether the panel this list is in is shown. Below the three-column
    /// breakpoint it is a SHEET over the content (R3-9), so choosing a view
    /// puts it away rather than standing on top of what you just picked.
    nav: Signal<bool>,
) -> Element {
    let here = view();
    rsx! {
        // THE WAY OUT OF THE DRAWER (R5-8). Below 1100px this list is a sheet
        // over the page and had no close control. `display:none` above it.
        Button {
            class: "nav-close",
            variant: "ghost",
            onclick: move |_| { nav.to_owned().set(false) },
            "✕ Close"
        }
        div { class: "view-list",
            for entry in NAV {
                Button {
                    key: "{entry.slug()}",
                    // NO VARIANT (R4-17): with `secondary` the nav entries and
                    // the form actions computed to the same everything.
                    id: "view-{entry.slug()}",
                    class: if entry == here { "view-item current" } else { "view-item" },
                    // NOT aria-selected. This is navigation.
                    aria_current: (entry == here).then_some("page"),
                    // Both: `.nav-label` is `display:none` on the icon rail.
                    title: "{entry.label()}",
                    aria_label: "{entry.label()}",
                    onclick: move |_| {
                        view.to_owned().set(entry);
                        if !crate::shell::dash::wide() { nav.to_owned().set(false) }
                    },
                    span { class: "nav-label", "{entry.label()}" } // no glyph (F8)
                }
            }
        }
    }
}
