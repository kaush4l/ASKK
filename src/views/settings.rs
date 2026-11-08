use super::{LayoutView, ModelsView, ThemeView};
use crate::components::Icon;
use dioxus::prelude::*;

/// Settings: theme, models and layout behind one segmented control.
#[component]
pub fn SettingsView() -> Element {
    let mut tab = use_signal(|| "models");
    rsx! {
        div { class: "stack",
            div { class: "segmented glass", role: "tablist", "aria-label": "Settings",
                for (id, label, icon) in [("models", "Models", "cube"), ("theme", "Theme", "palette"), ("layout", "Layout", "layout")] {
                    button { class: "seg", role: "tab", "aria-selected": "{tab() == id}", onclick: move |_| tab.set(id),
                        Icon { name: icon, size: 18 } span { "{label}" }
                    }
                }
            }
            match tab() {
                "theme" => rsx! { ThemeView {} },
                "layout" => rsx! { LayoutView {} },
                _ => rsx! { ModelsView {} },
            }
        }
    }
}
