use crate::api::{engine_view, run_engine};
use crate::compose::Render;
use crate::components::Pane;
use dioxus::prelude::*;

/// One engine: its view (all elements) and an input. The engine is a tool: input → answer.
#[component]
pub fn EngineView(path: Vec<String>) -> Element {
    let path = path.join("/");
    let p = path.clone();
    let mut view = use_resource(move || { let p = p.clone(); async move { engine_view(p).await } });
    let mut input = use_signal(String::new);
    let mut answer = use_signal(String::new);
    let mut busy = use_signal(|| false);
    let live = path.clone();
    // Live: re-read the engine view whenever it changes (alerts, sub-engines, other tabs).
    use_future(move || {
        let live = live.clone();
        async move {
            let mut seen = 0;
            while let Ok(now) = crate::api::wait_change(live.clone(), seen).await {
                if now != seen {
                    seen = now;
                    view.restart();
                }
            }
        }
    });
    let stop_path = path.clone();
    let run = move |_| {
        let path = path.clone();
        async move {
            busy.set(true);
            answer.set(match run_engine(path, input()).await { Ok(a) => a, Err(e) => format!("error: {e}") });
            busy.set(false);
            view.restart();
        }
    };
    rsx! {
        match &*view.read() {
            Some(Ok(n)) => rsx! { Render { node: n.clone() } },
            Some(Err(e)) => rsx! { Pane { p { "{e}" } } },
            None => rsx! {},
        }
        Pane { class: "stack",
            div { class: "row",
                input { class: "grow", value: "{input}", oninput: move |e| input.set(e.value()) }
                button { class: "btn primary", disabled: busy(), onclick: run, if busy() { "Running…" } else { "Run" } }
                if busy() {
                    button { class: "btn", onclick: move |_| { let p = stop_path.clone(); async move { let _ = crate::api::stop_engine(p).await; } }, "Stop" }
                }
            }
            if !answer.read().is_empty() { pre { class: "reply", "{answer}" } }
        }
    }
}
