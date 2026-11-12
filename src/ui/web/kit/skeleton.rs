//! From rust-ui.com (MIT, see LICENSE-rust-ui beside this file). The code is ours now: changed in two ways. The root carries the `data-name` that marks it as kit and is hidden from a screen reader (it stands for something not yet there). And it breathes in the app's own time (`--motion-pulse`) instead of a time of its own.
use dioxus::prelude::*;
use tw_merge::tw_merge;

#[component]
pub fn Skeleton(#[props(into, optional)] class: Option<String>) -> Element {
    let merged_class = tw_merge!("animate-[kit-breathe_var(--motion-pulse)_ease-in-out_infinite] rounded-md bg-muted", class.as_deref().unwrap_or(""));

    rsx! {
        div { "data-name": "Skeleton", "aria-hidden": "true", class: "{merged_class}" }
    }
}
