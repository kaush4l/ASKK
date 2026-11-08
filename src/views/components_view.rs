use crate::compose::{self, Render};
use crate::components::Pane;
use dioxus::prelude::*;

/// Catalog sections: (category, title, what belongs there).
const CATEGORIES: &[(&str, &str, &str)] = &[
    ("engine", "Engine", "The object that runs: elements in, prompt out, model and tools in a loop."),
    ("prompt", "Prompt", "Elements that write a section of the prompt: goal, focus, learning, phase, memory, history, reply format."),
    ("action", "Action", "What an engine can do: selected tools and scripts."),
    ("live", "Live", "Elements that watch the world: artifacts refreshed each step, alerts polled on a timer."),
];

/// Lists runtime-created components, rendered live, and runs the create_component tool.
#[component]
pub fn ComponentsView() -> Element {
    let ui = use_context::<crate::api::UiConfig>();
    let mut specs = use_resource(compose::list_components);
    let catalog = use_resource(crate::api::kinds);
    let mut args = use_signal(String::new);
    let mut status = use_signal(String::new);
    rsx! {
        for (cat, title, blurb) in CATEGORIES {
            Pane { class: "stack",
                h2 { "{title}" }
                p { class: "dim", "{blurb}" }
                for k in catalog.read().as_ref().and_then(|r| r.as_ref().ok()).cloned().unwrap_or_default().into_iter().filter(|k| k.category == *cat) {
                    div { class: "kind",
                        div { class: "row", b { "{k.kind}" } span { class: "dim grow", "{k.doc}" } }
                        div { class: "sizes",
                            for (n, size) in k.views.iter().zip(["small", "medium", "large"]) {
                                div { class: "size-col", span { class: "dim", "{size}" } Render { node: n.clone() } }
                            }
                        }
                    }
                }
            }
        }
        Pane { class: "stack",
            h2 { "Created" }
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
