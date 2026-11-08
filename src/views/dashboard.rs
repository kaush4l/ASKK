use crate::api::{layout, save_layout, world_view};
use crate::compose::{Render, Size};
use crate::components::{Icon, Pane};
use dioxus::prelude::*;

/// Home: every top-level engine at its own size, live. A long press (or the Edit button)
/// enters layout editing: drag a card to reorder, pick small / medium / large; saved to
/// `data/layout.json`.
#[component]
pub fn Dashboard() -> Element {
    let ui = use_context::<crate::api::UiConfig>();
    let mut world = use_server_future(world_view)?;
    let mut edit = use_signal(|| false);
    let mut pressing = use_signal(|| 0u64);
    let mut dragged = use_signal(|| None::<usize>);
    use_future(move || async move {
        let mut seen = 0;
        while let Ok(now) = crate::api::wait_change(String::new(), seen).await {
            if now != seen {
                seen = now;
                world.restart();
            }
        }
    });
    // Save a change to the layout (order and/or one size), then redraw.
    let save = move |order: Vec<String>, size: Option<(String, Size)>| async move {
        let mut l = layout().await.unwrap_or_default();
        l.order = order;
        if let Some((p, s)) = size {
            l.sizes.insert(p, s);
        }
        let _ = save_layout(l).await;
        world.restart();
    };
    let w = world.read();
    let Some(Ok(w)) = w.as_ref() else {
        return rsx! { Pane { p { class: "dim", "{ui.t(\"loading\")}" } } };
    };
    let paths = w.paths.clone();
    rsx! {
        if !w.error.is_empty() { Pane { pre { class: "reply", "{w.error}" } } }
        if w.engines.is_empty() { Pane { p { class: "dim", "{ui.t(\"no-engines\")}" } } }
        div { class: if edit() { "board editing" } else { "board" },
            // Long press anywhere on the board: 450 ms held, not moved.
            onpointerdown: move |_| {
                let id = pressing() + 1;
                pressing.set(id);
                spawn(async move {
                    let _ = document::eval("await new Promise(r => setTimeout(r, 450)); return 0;").await;
                    if pressing() == id { edit.set(true); }
                });
            },
            onpointerup: move |_| pressing += 1,
            onpointerleave: move |_| pressing += 1,
            onpointermove: move |e| { if e.held_buttons().is_empty() { return; } pressing += 1; },
            for (i, n) in w.engines.clone().into_iter().enumerate() {
                div { class: "cell size-{n.size}", key: "{paths[i]}", draggable: edit(),
                    ondragstart: move |_| dragged.set(Some(i)),
                    ondragover: move |e| e.prevent_default(),
                    ondrop: { let paths = paths.clone(); move |e: DragEvent| {
                        e.prevent_default();
                        let paths = paths.clone();
                        async move {
                            if let Some(from) = dragged.take() {
                                let mut order = paths.clone();
                                let p = order.remove(from);
                                order.insert(i.min(order.len()), p);
                                save(order, None).await;
                            }
                        }
                    } },
                    if edit() {
                        div { class: "cell-tools glass", role: "group", "aria-label": "Size of {n.label}",
                            for s in Size::ALL {
                                button { class: "seg", "aria-pressed": "{n.size == s.as_str()}",
                                    onclick: { let paths = paths.clone(); move |_| { let order = paths.clone(); let p = order[i].clone(); async move { save(order, Some((p, s))).await } } },
                                    {s.as_str().chars().next().unwrap().to_uppercase().to_string()}
                                }
                            }
                        }
                    }
                    Render { node: n.clone() }
                }
            }
        }
        div { class: "board-foot",
            if edit() {
                button { class: "btn primary", onclick: move |_| edit.set(false), "Done" }
                span { class: "dim", "Drag to reorder · S M L sets each engine's size" }
            } else {
                button { class: "btn", onclick: move |_| edit.set(true), Icon { name: "layout", size: 18 } "Edit layout" }
                span { class: "dim", "or press and hold the board" }
            }
        }
    }
}
