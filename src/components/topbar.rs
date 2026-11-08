use super::Glass;
use dioxus::prelude::*;

/// The page header: where you are (the current page's title) under the brand.
#[component]
pub fn Topbar(brand: String, title: String) -> Element {
    rsx! {
        Glass { class: "topbar",
            div { class: "crumbs", span { class: "dim", "{brand}" } span { class: "sep", "aria-hidden": "true", "/" } h1 { "{title}" } }
        }
    }
}
