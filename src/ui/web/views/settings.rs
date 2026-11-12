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
                // In the tab, an engine reaches a model through one server set here; on a machine,
                // through the connectors in models.json.
                TabsContent { value: "models",
                    if cfg!(feature = "local") { TabModelView {} } else { ModelsView {} }
                }
                TabsContent { value: "theme", ThemeView {} }
                TabsContent { value: "layout", LayoutView {} }
                TabsContent { value: "parts", super::parts::PartsView {} }
            }
        }
    }
}

/// Where this tab asks a model (the tab build): an askk server, an OpenAI-style one, or the
/// built-in echo. A token typed here stays in this tab's memory.
#[cfg(not(feature = "local"))]
#[component]
fn TabModelView() -> Element {
    rsx! {}
}

#[cfg(feature = "local")]
#[component]
fn TabModelView() -> Element {
    {
        let mut base = use_signal(String::new);
        let mut model = use_signal(String::new);
        let mut token = use_signal(String::new);
        let mut token_set = use_signal(|| false);
        let mut said = use_signal(String::new);
        use_future(move || async move {
            if let Ok(t) = crate::api::tab_model().await {
                base.set(t.base);
                model.set(t.model);
                token_set.set(t.token_set);
            }
        });
        let save = move |e: FormEvent| {
            e.prevent_default();
            spawn(async move {
                let r = crate::api::set_tab_model(base(), model(), token()).await;
                if r.is_ok() && !token().is_empty() {
                    token_set.set(true);
                    token.set(String::new());
                }
                said.set(match r {
                    Ok(()) if base().is_empty() => "Saved: engines answer with the built-in echo.".into(),
                    Ok(()) => format!("Saved: engines ask {}.", base()),
                    Err(e) => e,
                });
            });
        };
        rsx! {
            Pane { class: "tab-model",
                h2 { "Model server" }
                p { class: "dim", "This tab runs the engines itself. They reach a model through one server: an askk server (http://127.0.0.1:8090/ask), which uses its own keys, or an OpenAI-style one (https://…/v1). Empty answers with the built-in echo." }
                form { class: "tab-model-form", onsubmit: save,
                    label { "Server" input { id: "base", r#type: "url", placeholder: "http://127.0.0.1:8090/ask", value: base, oninput: move |e| base.set(e.value()) } }
                    label { "Model" input { id: "model", placeholder: "the engine's own when empty", value: model, oninput: move |e| model.set(e.value()) } }
                    label { "Token"
                        input { id: "token", r#type: "password", autocomplete: "off", placeholder: if token_set() { "set (kept in this tab's memory only)" } else { "none" }, value: token, oninput: move |e| token.set(e.value()) }
                    }
                    button { r#type: "submit", class: "btn", "Save" }
                }
                if !said().is_empty() { p { role: "status", "{said}" } }
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
