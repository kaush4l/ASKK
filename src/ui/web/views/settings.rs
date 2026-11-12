use super::{LayoutView, ModelsView, ThemeView};
use crate::ui::web::components::{Icon, Pane};
use crate::ui::web::kit::{Tabs, TabsContent, TabsList, TabsTrigger};
use dioxus::prelude::*;

/// Tab label for the model connectors page; `defaults/ui.json` and the models route use the same words.
const MODELS_LABEL: &str = "Model connectors";

/// Settings: theme, models and layout behind one set of tabs (the kit's), and the parts
/// catalogue ([`super::parts`]): parts drawn with made-up values.
#[component]
pub fn SettingsView() -> Element {
    rsx! {
        Pane { class: "settings-app fill",
            Tabs { default_value: "models", class: "fill",
                TabsList { class: "glass max-w-full overflow-x-auto",
                    for (id, label, icon) in [("models", MODELS_LABEL, "cube"), ("theme", "Theme", "palette"), ("layout", "Layout", "layout"), ("parts", "Parts", "shapes")] {
                        TabsTrigger { value: id, class: "px-3",
                            Icon { name: icon, size: 18 } span { "{label}" }
                        }
                    }
                }
                TabsContent { value: "models", ModelsView {} }
                TabsContent { value: "theme", ThemeView {} }
                TabsContent { value: "layout", LayoutView {} }
                TabsContent { value: "parts", super::parts::PartsView {} }
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
        let ui: serde_json::Value = serde_json::from_str(include_str!("../../../../defaults/ui.json")).unwrap();
        assert_eq!(ui["text"]["models"], MODELS_LABEL);
        let page: serde_json::Value = serde_json::from_str(include_str!("../../../../defaults/routes/models/page.json")).unwrap();
        assert_eq!(page["title"], MODELS_LABEL);
    }
}
