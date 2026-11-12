use crate::ui::web::render::Render;
use crate::ui::web::components::Pane;
use crate::{api::resolve_route, core::routes::Params};
use dioxus::prelude::*;

/// `/`: the page in `routes/page.json`.
#[component]
pub fn Home() -> Element {
    rsx! { RoutePage { segments: Vec::<String>::new() } }
}

/// Any URL: find its folder in `data/routes`, draw the page's node tree with its params.
#[component]
pub fn RoutePage(segments: ReadSignal<Vec<String>>) -> Element {
    let page = use_server_future(move || resolve_route(segments()))?;
    let key = segments().join("/");
    match page() {
        Some(Ok(Some(r))) => rsx! {
            document::Title { "{r.page.title}" }
            // Keyed so a new URL on the same pattern mounts fresh (params are read once).
            for k in [key] {
                Scoped { key: "{k}", params: r.params.clone(), node: r.page.root.clone() }
            }
        },
        Some(Ok(None)) => rsx! { Pane { p { class: "dim", "No page at /{key}. Add data/routes/{key}/page.json." } } },
        Some(Err(e)) => rsx! { Pane { p { "error: {e}" } } },
        None => rsx! {},
    }
}

#[component]
fn Scoped(params: std::collections::BTreeMap<String, String>, node: crate::core::node::Node) -> Element {
    use_context_provider(|| Params(params.clone()));
    rsx! { Render { node } }
}
