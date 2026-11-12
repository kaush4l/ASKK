//! # Render: the one place a [`Node`] becomes pixels
//!
//! Each primitive maps to a fixed, styled element. A new look for a primitive is changed here
//! and nowhere else.
use crate::api::list_components;
use crate::core::node::Node;
use dioxus::prelude::*;

/// Draws any node tree with the fixed primitives.
#[component]
pub fn Render(node: Node) -> Element {
    let kids = rsx! { for c in node.children.clone() { Render { node: c } } };
    match node.kind.as_str() {
        "object" => rsx! { Object { node: node.clone() } },
        "marks" => rsx! { div { class: "marks", role: "group", "aria-label": "{node.label}", if !node.label.is_empty() { span { class: "marks-label", "{node.label}" } } {kids} } },
        "mark" => rsx! { span { class: "mark", title: "{node.label}", "aria-label": "{node.label}", Art { icon: node.icon.clone(), size: 16 } } },
        "pane" => rsx! { crate::ui::web::components::Pane { class: "stack", {kids} } },
        "glass" => rsx! { crate::ui::web::components::Glass { class: "stack pad", {kids} } },
        "row" => rsx! { div { class: "row", {kids} } },
        "stack" => rsx! { div { class: "stack", {kids} } },
        "grid" => rsx! { div { class: "grid", {kids} } },
        "tile" => rsx! { div { class: "tile", div { class: "tile-head", span { "{node.label}" } span { class: "dim", "{node.text}" } } {kids} } },
        "heading" => rsx! { h3 { "{node.text}" } },
        "muted" => rsx! { p { class: "dim", "{node.text}" } },
        "badge" => rsx! { span { class: "badge", "{node.text}" } },
        "link" => rsx! { Link { to: node.text.clone(), class: "link", "{node.label}" } },
        "text" => rsx! { p { "{node.text}" } },
        "stat" => rsx! { crate::ui::web::components::Stat { label: node.label.clone(), value: node.text.clone() } },
        "button" => rsx! { button { class: "btn", "{node.label}" } },
        "view" => rsx! { crate::ui::web::views::Builtin { name: node.text.clone(), arg: node.label.clone() } },
        "figure" => rsx! { crate::ui::web::figure::FigureView { node: node.clone() } },
        "use" => rsx! { Use { name: node.text.clone() } },
        "calls" => rsx! { ol { class: "calls", "aria-label": "{node.label}", {kids} } },
        "call" => rsx! {
            li { class: "call",
                span { class: "call-icon", "aria-hidden": "true", Art { icon: "wrench".to_string(), size: 14 } }
                code { class: "call-sig", title: "{node.label}", "{node.label}" }
                if !node.text.is_empty() { p { class: "call-result", title: "{node.text}", "{node.text}" } }
            }
        },
        "summary" => rsx! { p { class: "obj-summary", "{node.text}" } },
        other => rsx! { p { class: "dim", "unknown primitive {other}" } },
    }
}

/// A created component, by name.
#[component]
pub fn Use(name: String) -> Element {
    let all = use_resource(list_components);
    let found = all.read().as_ref().and_then(|r| r.as_ref().ok()).and_then(|v| v.iter().find(|s| s.name == name).cloned());
    match found {
        Some(s) => rsx! { Render { node: s.root } },
        None => rsx! {},
    }
}

/// An icon name from the icon set, or an emoji drawn as text.
#[component]
pub fn Art(icon: String, #[props(default = 20)] size: u32) -> Element {
    if crate::ui::web::components::ICONS.iter().any(|(n, _)| *n == icon) || icon.is_empty() {
        rsx! { crate::ui::web::components::Icon { name: icon, size } }
    } else {
        rsx! { span { class: "emoji", style: "font-size:{size}px", "{icon}" } }
    }
}

/// A backend object at its size, carrying its own activity (class `act-<activity>` drives the
/// orb's colour and motion). Medium cards have fixed rows; the body scrolls inside.
#[component]
fn Object(node: Node) -> Element {
    let act = if node.state.is_empty() { "idle".to_string() } else { node.state.clone() };
    let cls = format!("obj size-{} kind-{} act-{act}", node.size, node.text);
    let mut open = use_signal(|| false);
    let expand = node.children.iter().find(|c| c.kind == "expand").cloned();
    let (marks, body): (Vec<Node>, Vec<Node>) = node.children.iter().cloned().filter(|c| c.kind != "summary" && c.kind != "expand").partition(|c| c.kind == "marks");
    let summary = node.children.iter().find(|c| c.kind == "summary").map(|c| c.text.clone()).unwrap_or_default();
    let art = rsx! {
        div { class: "obj-art", "aria-hidden": "true",
            span { class: "orb" }
            Art { icon: node.icon.clone(), size: if node.size == "small" { 26 } else { 30 } }
            span { class: "dot" }
        }
    };
    match node.size.as_str() {
        "small" => rsx! {
            div { class: "{cls}", title: "{node.label} · {act}", role: "img", "aria-label": "{node.label}, {node.text}, {act}",
                {art}
                span { class: "obj-cap", "{node.label}" }
            }
        },
        _ => rsx! {
            article { class: if open() { "{cls} expanded" } else { "{cls}" }, "aria-label": "{node.label}",
                {art}
                div { class: "obj-meta",
                    div { class: "obj-head", b { class: "obj-name", "{node.label}" } span { class: "obj-state", "{act}" }
                        if expand.is_some() {
                            button { class: "obj-toggle", title: if open() { "Minimize" } else { "Expand" },
                                "aria-label": if open() { "Minimize" } else { "Expand" }, "aria-expanded": "{open}",
                                onclick: move |_| open.toggle(),
                                if open() { "⤡" } else { "⤢" }
                            }
                        }
                    }
                    if !node.note.is_empty() { span { class: "obj-note", "{node.note}" } }
                    if !summary.is_empty() { p { class: "obj-summary", "{summary}" } }
                }
                div { class: "obj-marks", for m in marks { Render { node: m } } }
                div { class: "obj-body", for c in body { Render { node: c } } }
                if let Some(x) = expand.filter(|_| open()) {
                    div { class: "obj-expand", for c in x.children { Render { node: c } } }
                }
            }
        },
    }
}

/// The icon for a tool by what its name says it does (not in use: every tool draws a wrench).
#[allow(dead_code)]
fn tool_icon_by_name(name: &str) -> &'static str {
    let has = |w: &[&str]| w.iter().any(|x| name.contains(x));
    if has(&["file", "dir"]) { "file" }
    else if has(&["run", "spawn", "job", "stop"]) { "terminal" }
    else if has(&["alarm"]) { "bell" }
    else if has(&["parallel"]) { "split" }
    else if has(&["restart"]) { "refresh" }
    else if has(&["view", "component"]) { "shapes" }
    else if has(&["quote", "price"]) { "chart" }
    else if has(&["now", "time"]) { "clock" }
    else if has(&["learn"]) { "book" }
    else if has(&["remember", "memory"]) { "database" }
    else if has(&["phase"]) { "flag" }
    else if has(&["set_", "goal", "focus"]) { "pencil" }
    else { "wrench" }
}
