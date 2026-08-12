//! Card — the surface every panel in this product is (DESIGN.md §8, "Surface /
//! Card"). Anatomy: `<section class="panel">` → optional `<h2>` → the body.
//!
//! It was hand-rolled eight times, and the eight had already drifted: some
//! carried `aria-label`, some carried `aria-labelledby`, one carried both and
//! one carried neither. The `hidden` attribute passes through because it is
//! this app's ROUTE mechanism, not a styling detail — `[hidden] { display:
//! none !important }` is the one rule that works with the machine layer off.

use dioxus::prelude::*;

#[component]
pub(crate) fn Card(
    /// The panel's heading. `<h2>` because the page's one `<h1>` is the
    /// dashboard title the core renders; a panel is a level below it.
    title: Option<String>,
    /// `e1` chrome · `e2` (default, the bare `.panel`) · `e3` floating ·
    /// `flat` for anything holding body text (G3). Appended to `.panel`, never
    /// replacing it: the layout guard and six stylesheet rules key off it.
    variant: Option<String>,
    /// `id`, `role`, `aria-*`, `hidden` — every affordance the eight
    /// hand-rolled sections carried, passed through untouched.
    #[props(extends = global_attributes, extends = section)] attributes: Vec<Attribute>,
    children: Element,
) -> Element {
    let class = match &variant {
        Some(v) => format!("panel {v}"),
        None => "panel".to_string(),
    };
    let head: Element = match &title {
        Some(t) => rsx! { h2 { "{t}" } },
        None => rsx! {},
    };
    rsx! {
        section { class: "{class}", ..attributes,
            {head}
            {children}
        }
    }
}
