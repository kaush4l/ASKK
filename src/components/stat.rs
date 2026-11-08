use super::Pane;
use dioxus::prelude::*;

/// One metric tile.
#[component]
pub fn Stat(label: String, value: String, #[props(default)] delta: String) -> Element {
    rsx! {
        Pane { class: "stat",
            div { class: "label", "{label}" }
            div { class: "value", "{value}" }
            if !delta.is_empty() { div { class: "delta", "{delta}" } }
        }
    }
}
