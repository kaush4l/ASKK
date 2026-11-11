use super::canvas_math::{self as m, Camera};
use crate::api::{engine_object, engine_paths};
use crate::{core::node::Size, ui::render::Render};
use crate::ui::components::Pane;
use dioxus::prelude::*;

/// Canvas: every engine (and sub-engine) is a frame in world space, laid out as a tidy tree with
/// edges parent -> child. Drag to pan, wheel to zoom at the cursor (0.1 to 2.5).
/// Frame positions are not saved yet: the layout is recomputed from the engine tree.
#[component]
pub fn CanvasView() -> Element {
    let m = super::live::use_manifest();
    let live = super::live::use_live(move || m.engines.clone());
    let paths = use_resource(move || {
        let _ = live();
        engine_paths()
    });
    let mut cam = use_signal(Camera::default);
    let mut origin = use_signal(|| (0.0f64, 0.0f64));
    let mut drag = use_signal(|| None::<(f64, f64)>);
    let mut fitted = use_signal(|| false);
    // Set once a press has moved: that press was a pan, not a click on a frame.
    let mut moved = use_signal(|| false);
    let mut panel = use_signal(|| None::<String>);
    let ps = paths.read();
    let Some(Ok(ps)) = ps.as_ref() else {
        return rsx! { Pane { p { class: "dim", "loading" } } };
    };
    let ps = ps.clone();
    let rects = m::auto_layout(&ps, m::FRAME_W, m::FRAME_H, m::GAP);
    let edges = m::edges(&ps);
    let b = m::bounds(&rects).unwrap_or(m::Rect { x: 0.0, y: 0.0, w: 1.0, h: 1.0 });
    let fit_rects = rects.clone();
    let c = cam();
    rsx! {
        Pane { class: "canvas-app fill",
            div { class: "canvas-view",
                onmounted: move |e| {
                    let rects = fit_rects.clone();
                    async move {
                        if let Ok(r) = e.get_client_rect().await {
                            origin.set((r.origin.x, r.origin.y));
                            if !fitted() {
                                fitted.set(true);
                                cam.set(m::fit_camera(&rects, r.size.width, r.size.height, m::GAP, 1.0));
                            }
                        }
                    }
                },
                onwheel: move |e| {
                    e.prevent_default();
                    let dy = e.delta().strip_units().y;
                    let p = e.client_coordinates();
                    let (ox, oy) = origin();
                    let factor = (-dy * 0.0015).exp();
                    cam.set(m::zoom_at(cam(), factor, p.x - ox, p.y - oy));
                },
                onpointerdown: move |e| { let p = e.client_coordinates(); drag.set(Some((p.x, p.y))); moved.set(false); },
                onpointermove: move |e| {
                    if let Some((x, y)) = drag() {
                        if e.held_buttons().is_empty() { drag.set(None); return; }
                        let p = e.client_coordinates();
                        if (p.x - x).abs() + (p.y - y).abs() > 3.0 { moved.set(true); }
                        cam.set(m::pan(cam(), p.x - x, p.y - y));
                        drag.set(Some((p.x, p.y)));
                    }
                },
                onpointerup: move |_| drag.set(None),
                onpointerleave: move |_| drag.set(None),
                div { class: "canvas-world", style: "transform: translate({c.x}px, {c.y}px) scale({c.z});",
                    svg { class: "canvas-edges", width: "{b.x + b.w}", height: "{b.y + b.h}",
                        for (a, k) in edges {
                            // Not `>` between the two: straight after a `}` it reads as a format instruction.
                            path { key: "{ps[a]} to {ps[k]}", d: m::edge_path(&rects[a], &rects[k]) }
                        }
                    }
                    for (i, path) in ps.iter().enumerate() {
                        div { key: "{path}", class: "canvas-frame",
                            style: "left: {rects[i].x}px; top: {rects[i].y}px; width: {rects[i].w}px; height: {rects[i].h}px;",
                            EngineCard { path: path.clone(), on_open: move |p| { if !moved() { panel.set(Some(p)); } } }
                        }
                    }
                }
                div { class: "canvas-zoom dim mono", "{(c.z * 100.0).round()}%" }
            }
            if let Some(p) = panel() {
                super::prompt::PromptPanel { path: p, on_close: move |_| panel.set(None) }
            }
        }
    }
}

/// One engine's medium card, live. A click on the card's empty area (not on an element)
/// calls `on_open` with the engine path.
#[component]
pub fn EngineCard(path: ReadSignal<String>, on_open: EventHandler<String>) -> Element {
    // Refetches when this engine (or a sub-engine) is marked changed, not when others are.
    let m = super::live::use_manifest();
    let live = super::live::use_live(move || m.engine(&path()));
    let node = use_resource(move || {
        let _ = live();
        engine_object(path(), Size::Medium)
    });
    let n = node.read().clone();
    rsx! {
        div { class: "engine-card",
            onclick: move |e: MouseEvent| async move {
                let p = e.client_coordinates();
                if super::prompt::empty_hit(&super::prompt::class_at(p.x, p.y).await) {
                    on_open.call(path());
                }
            },
            match n {
                Some(Ok(n)) => rsx! { Render { node: n } },
                Some(Err(e)) => rsx! { p { class: "dim", "{e}" } },
                None => rsx! { p { class: "dim", "{path}" } },
            }
        }
    }
}
