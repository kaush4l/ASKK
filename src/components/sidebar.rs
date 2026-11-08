use super::Glass;
use crate::api::NavLink;
use dioxus::prelude::*;

/// Collapsible left panel; brand and links come from `ui.json`.
#[component]
pub fn Sidebar(brand: String, items: Vec<NavLink>, collapsed: bool) -> Element {
    let short = |s: &str| s.chars().next().map(String::from).unwrap_or_default();
    rsx! {
        Glass { class: "sidebar",
            div { class: "brand", if collapsed { {short(&brand)} } else { "{brand}" } }
            for item in items {
                Link { to: item.to.clone(), active_class: "active",
                    if collapsed { {short(&item.label)} } else { "{item.label}" }
                }
            }
        }
    }
}
