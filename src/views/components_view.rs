use crate::compose::{self, Render};
use crate::components::Pane;
use dioxus::prelude::*;

/// Lists runtime-created components, rendered live, and runs the create_component tool.
#[component]
pub fn ComponentsView() -> Element {
    let ui = use_context::<crate::api::UiConfig>();
    let mut specs = use_resource(compose::list_components);
    let catalog = use_resource(crate::api::kinds);
    let mut args = use_signal(String::new);
    let mut status = use_signal(String::new);
    rsx! {
        Pane { class: "stack",
            h2 { {ui.t("element-kinds")} }
            p { class: "dim", {ui.t("every-engine-element-is")} }
            div { class: "grid",
                for k in catalog.read().as_ref().and_then(|r| r.as_ref().ok()).cloned().unwrap_or_default() {
                    div { class: "tile", div { class: "tile-head", span { "{k.kind}" } } p { class: "dim", "{k.doc}" } }
                }
            }
        }
        Pane { class: "stack",
            h2 { {ui.t("ui-components")} }
            p { class: "dim", "create_component tool: the same call an engine makes. Primitives: {compose::PRIMITIVES.join(\", \")}" }
            textarea { rows: "8", placeholder: "{{\"name\": \"...\", \"root\": {{\"kind\": \"pane\"}}}}", value: "{args}", oninput: move |e| args.set(e.value()) }
            div { class: "row",
                button { class: "btn primary", onclick: move |_| async move {
                    status.set(compose::create_component(args()).await.unwrap_or_else(|e| e.to_string()));
                    specs.restart();
                }, {ui.t("create")} }
                span { class: "dim", "{status}" }
            }
        }
        match &*specs.read() {
            Some(Ok(list)) if list.is_empty() => rsx! { Pane { p { class: "dim", "{ui.t(\"no-components\")}" } } },
            Some(Ok(list)) => rsx! {
                for s in list.clone() {
                    div { class: "stack", key: "{s.name}",
                        span { class: "dim", "{s.name}" }
                        Render { node: s.root.clone() }
                    }
                }
            },
            Some(Err(e)) => rsx! { Pane { p { "error: {e}" } } },
            None => rsx! { Pane { p { class: "dim", "{ui.t(\"loading\")}" } } },
        }
    }
}
