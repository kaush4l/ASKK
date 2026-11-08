use super::Glass;
use dioxus::prelude::*;

#[component]
pub fn Topbar(title: String, on_toggle: EventHandler<()>) -> Element {
    rsx! {
        Glass { class: "topbar",
            h1 { "{title}" }
            button { class: "btn", onclick: move |_| on_toggle.call(()), "☰" }
        }
    }
}
