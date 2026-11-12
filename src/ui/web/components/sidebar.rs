use super::Icon;
use crate::api::NavLink;
use dioxus::prelude::*;

/// The navigation panel. Wide screens: full panel (icon + label) that the button in its own
/// header folds to an icon rail. Medium screens: the rail. Phones: one floating routes button
/// that opens the panel as a sheet. Labels stay in the DOM for screen readers at every size.
#[component]
pub fn Sidebar(brand: String, items: Vec<NavLink>, mut collapsed: Signal<bool>, mut open: Signal<bool>) -> Element {
    let mark = brand.chars().next().map(String::from).unwrap_or_default();
    rsx! {
        button { class: "routes-fab glass-btn", "aria-label": if open() { "Close navigation" } else { "Open navigation" },
            "aria-expanded": "{open()}", onclick: move |_| open.toggle(),
            Icon { name: if open() { "close" } else { "routes" } }
        }
        if open() { div { class: "scrim", onclick: move |_| open.set(false) } }
        nav { class: if open() { "sidebar glass open" } else { "sidebar glass" }, "aria-label": "Primary",
            div { class: "side-head",
                span { class: "brand-mark", "aria-hidden": "true", "{mark}" }
                span { class: "brand-name", "{brand}" }
                button { class: "icon-btn side-toggle", "aria-label": if collapsed() { "Expand panel" } else { "Collapse panel" },
                    "aria-pressed": "{collapsed()}", title: if collapsed() { "Expand panel" } else { "Collapse panel" },
                    onclick: move |_| collapsed.toggle(),
                    Icon { name: "sidebar" }
                }
            }
            for item in items {
                Link { to: item.to.clone(), class: "nav-item", active_class: "active", onclick: move |_| open.set(false),
                    Icon { name: item.icon.clone() }
                    span { class: "label", "{item.label}" }
                    span { class: "tip", "aria-hidden": "true", "{item.label}" }
                }
            }
        }
    }
}
