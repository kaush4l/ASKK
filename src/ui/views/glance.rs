use super::live::use_live_server;
use crate::api::glance;
use dioxus::prelude::*;

/// The smallest view: how many engines run, how many messages wait. Made for glance faces
/// (the notch panel).
#[component]
pub fn GlanceView() -> Element {
    let g = use_live_server(String::new, glance)?;
    let g = g().unwrap_or_default();
    rsx! {
        div { class: "glance row", role: "status",
            // Who is running, not only how many.
            if g.running > 0 { super::loops::NowChip {} } else { span { class: "badge", "idle" } }
            span { class: "badge", "{g.waiting} waiting" }
        }
    }
}
