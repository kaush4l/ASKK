use crate::api::{save_theme, theme};
use crate::ui::web::components::Pane;
use dioxus::prelude::*;
use std::collections::BTreeMap;

/// Theme: the token overrides in `data/theme.json`, edited in place. New keys can be added.
#[component]
pub fn ThemeView() -> Element {
    let ui = use_context::<crate::api::UiConfig>();
    let mut tokens = use_signal(BTreeMap::<String, String>::new);
    let mut status = use_signal(String::new);
    let mut key = use_signal(String::new);
    use_future(move || async move {
        if let Ok(t) = theme().await {
            tokens.set(t);
        }
    });
    rsx! {
        Pane { class: "stack",
            h2 { {ui.t("theme")} }
            p { class: "dim", {ui.t("overrides-for-the-design")} }
            for (k, v) in tokens() {
                div { class: "row", key: "{k}",
                    span { class: "grow", "{k}" }
                    input { value: "{v}", oninput: { let k = k.clone(); move |e: FormEvent| { tokens.write().insert(k.clone(), e.value()); } } }
                    button { class: "btn", onclick: { let k = k.clone(); move |_| { tokens.write().remove(&k); } }, {ui.t("remove")} }
                }
            }
            div { class: "row",
                input { placeholder: "--token-name", value: "{key}", oninput: move |e| key.set(e.value()) }
                button { class: "btn", onclick: move |_| { if !key().is_empty() { tokens.write().insert(key(), String::new()); key.set(String::new()); } }, {ui.t("add")} }
            }
            div { class: "row",
                button { class: "btn primary", onclick: move |_| async move {
                    status.set(match save_theme(tokens()).await { Ok(()) => consume_context::<crate::api::UiConfig>().t("saved"), Err(e) => e.to_string() });
                }, {ui.t("save")} }
                span { class: "dim", "{status}" }
            }
        }
    }
}
