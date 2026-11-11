use dioxus::prelude::*;

/// Layer 1: calm content surface (tinted, no blur).
#[component]
pub fn Pane(#[props(default)] class: String, children: Element) -> Element {
    rsx! { section { class: "pane {class}", {children} } }
}

/// Layer 2: frosted floating surface. Children must be panes or opaque, never glass.
#[component]
pub fn Glass(#[props(default)] class: String, children: Element) -> Element {
    rsx! { div { class: "glass {class}", {children} } }
}
