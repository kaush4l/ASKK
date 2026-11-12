//! From rust-ui.com (MIT, see LICENSE-rust-ui beside this file). The code is ours now: changed in three ways. The ring is drawn here (the original took it from an icon crate this app does not carry). It says what is being waited for (`role="status"` and a label), which the original left out. And it turns in the app's own time (`--motion-quick`).
use dioxus::prelude::*;
use tw_merge::tw_merge;

#[component]
pub fn Spinner(
    #[props(into, optional)] class: Option<String>,
    /// What is being waited for, for a screen reader.
    #[props(into, default = "Working".to_string())] label: String,
) -> Element {
    let merged_class = tw_merge!("size-4 shrink-0 animate-[kit-spin_var(--motion-quick)_linear_infinite]", class.as_deref().unwrap_or(""));

    rsx! {
        svg {
            "data-name": "Spinner",
            class: "{merged_class}",
            role: "status",
            "aria-label": "{label}",
            view_box: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            stroke_width: "2",
            stroke_linecap: "round",
            path { d: "M21 12a9 9 0 1 1-6.219-8.56" }
        }
    }
}
