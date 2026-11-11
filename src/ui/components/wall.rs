use dioxus::prelude::*;

/// Layer 0: the vivid fixed backdrop that glass reads against.
#[component]
pub fn Wall() -> Element {
    rsx! { div { class: "wall", aria_hidden: "true", i {} i {} i {} } }
}
