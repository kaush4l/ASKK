use super::{LayoutView, ModelsView, ThemeView};
use crate::ui::components::{Icon, Pane};
use dioxus::prelude::*;

/// Tab label for the model connectors page; `defaults/ui.json` and the models route use the same words.
const MODELS_LABEL: &str = "Model connectors";

/// Settings: theme, models and layout behind one segmented control.
#[component]
pub fn SettingsView() -> Element {
    let mut tab = use_signal(|| "models");
    rsx! {
        Pane { class: "settings-app fill",
            div { class: "segmented glass", role: "tablist", "aria-label": "Settings",
                for (id, label, icon) in [("models", MODELS_LABEL, "cube"), ("theme", "Theme", "palette"), ("layout", "Layout", "layout")] {
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

#[cfg(test)]
mod tests {
    use super::MODELS_LABEL;

    #[test]
    fn models_label_is_consistent_everywhere() {
        assert_eq!(MODELS_LABEL, "Model connectors");
        let ui: serde_json::Value = serde_json::from_str(include_str!("../../../defaults/ui.json")).unwrap();
        assert_eq!(ui["text"]["models"], MODELS_LABEL);
        let page: serde_json::Value = serde_json::from_str(include_str!("../../../defaults/routes/models/page.json")).unwrap();
        assert_eq!(page["title"], MODELS_LABEL);
    }
}
