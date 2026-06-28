use crate::state::AppSnapshot;
use dioxus::prelude::*;

#[component]
pub fn StatBlock(label: &'static str, value: String) -> Element {
    rsx! {
        div { class: "stat-block",
            span { "{label}" }
            strong { "{value}" }
        }
    }
}

#[component]
pub fn CompactList(items: Vec<String>) -> Element {
    rsx! {
        ul { class: "compact-list",
            if items.is_empty() {
                li { class: "muted", "None yet" }
            } else {
                for (index, item) in items.iter().enumerate() {
                    li { key: "{index}", "{item}" }
                }
            }
        }
    }
}

pub fn set_status(snapshot: &mut Signal<AppSnapshot>, status: String) {
    snapshot.write().status = status;
}
