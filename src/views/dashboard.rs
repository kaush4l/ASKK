use crate::api::world_view;
use crate::compose::Render;
use crate::components::Pane;
use dioxus::prelude::*;

/// Home: one card per engine, each drawn from the engine's own view.
#[component]
pub fn Dashboard() -> Element {
    let ui = use_context::<crate::api::UiConfig>();
    let mut world = use_server_future(world_view)?;
    // Live: re-read when any engine changes.
    use_future(move || async move {
        let mut seen = 0;
        while let Ok(now) = crate::api::wait_change(String::new(), seen).await {
            if now != seen {
                seen = now;
                world.restart();
            }
        }
    });
    let w = world.read();
    match w.as_ref() {
        Some(Ok(w)) => rsx! {
            if !w.error.is_empty() { Pane { pre { class: "reply", "{w.error}" } } }
            if w.engines.is_empty() { Pane { p { class: "dim", "{ui.t(\"no-engines\")}" } } }
            div { class: "board", style: if w.columns > 0 { format!("--cols:{}", w.columns) } else { String::new() },
                for n in w.engines.clone() { Render { node: n } }
            }
        },
        Some(Err(e)) => rsx! { Pane { p { "error: {e}" } } },
        None => rsx! {},
    }
}
