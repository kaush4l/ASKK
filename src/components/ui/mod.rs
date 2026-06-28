//! Soft-desk UI primitive library. Class-based components over the shared
//! design tokens in `assets/main.css` / `assets/ui/primitives.css`. Variant and
//! tone are `&'static str`-into-`String` so pages don't import enums; styling
//! lives entirely in CSS keyed off the `ui-*` classes.
//!
//! ponytail: `allow(dead_code)` — this is the shared foundation; downstream page
//! workers consume these primitives. Drop the allow once a page imports them.
#![allow(dead_code)]

use dioxus::prelude::*;

/// A soft-elevated surface card. Append `class` for layout tweaks at the call site.
#[component]
pub fn Card(#[props(default)] class: String, children: Element) -> Element {
    rsx! {
        div { class: "ui-card {class}", {children} }
    }
}

/// A card with a heading row above its content.
#[component]
pub fn Panel(title: String, #[props(default)] class: String, children: Element) -> Element {
    rsx! {
        section { class: "ui-panel {class}",
            h2 { class: "ui-panel-title", "{title}" }
            {children}
        }
    }
}

/// Pill button. `variant` is one of primary|secondary|ghost|icon.
#[component]
pub fn Button(
    #[props(default = "primary".to_string())] variant: String,
    #[props(default)] disabled: bool,
    onclick: EventHandler<MouseEvent>,
    children: Element,
) -> Element {
    let class = format!("ui-btn ui-btn-{variant}");
    rsx! {
        button {
            class,
            disabled,
            onclick: move |e| onclick.call(e),
            {children}
        }
    }
}

/// Switch-style toggle. Emits the flipped value on click.
#[component]
pub fn Toggle(
    checked: bool,
    onchange: EventHandler<bool>,
    #[props(default)] label: String,
) -> Element {
    let class = if checked { "ui-toggle on" } else { "ui-toggle" };
    rsx! {
        button {
            class,
            role: "switch",
            "aria-checked": "{checked}",
            onclick: move |_| onchange.call(!checked),
            span { class: "ui-toggle-track",
                span { class: "ui-toggle-thumb" }
            }
            if !label.is_empty() {
                span { "{label}" }
            }
        }
    }
}

/// Range slider. Emits the parsed value on input.
#[component]
pub fn Slider(
    value: f64,
    min: f64,
    max: f64,
    #[props(default = 1.0)] step: f64,
    onchange: EventHandler<f64>,
) -> Element {
    rsx! {
        input {
            class: "ui-slider",
            r#type: "range",
            min: "{min}",
            max: "{max}",
            step: "{step}",
            value: "{value}",
            oninput: move |e| {
                if let Ok(v) = e.value().parse::<f64>() {
                    onchange.call(v);
                }
            },
        }
    }
}

/// Pill badge. `tone` is one of neutral|info|warn|error|success.
#[component]
pub fn Badge(#[props(default = "neutral".to_string())] tone: String, children: Element) -> Element {
    let class = format!("ui-badge ui-badge-{tone}");
    rsx! {
        span { class, {children} }
    }
}

/// A coloured dot with an optional text label. `tone` keys the dot colour.
#[component]
pub fn StatusDot(tone: String, #[props(default)] label: String) -> Element {
    let class = format!("ui-status-dot ui-status-dot-{tone}");
    rsx! {
        span { class,
            if !label.is_empty() {
                span { "{label}" }
            }
        }
    }
}

/// Segmented control. Renders each option as a button; marks the selected one.
#[component]
pub fn SegmentedControl(
    options: Vec<String>,
    selected: String,
    onselect: EventHandler<String>,
) -> Element {
    rsx! {
        div { class: "ui-segmented",
            for option in options.iter() {
                button {
                    key: "{option}",
                    class: if *option == selected { "ui-segmented-option active" } else { "ui-segmented-option" },
                    onclick: {
                        let option = option.clone();
                        move |_| onselect.call(option.clone())
                    },
                    "{option}"
                }
            }
        }
    }
}

/// Heading row with an optional right-aligned actions slot (`children`).
#[component]
pub fn SectionHeading(title: String, #[props(default)] children: Element) -> Element {
    rsx! {
        div { class: "ui-section-heading",
            h2 { "{title}" }
            div { class: "ui-section-heading-actions", {children} }
        }
    }
}

/// A rounded search field. Emits the current value string on input.
#[component]
pub fn SearchInput(
    value: String,
    #[props(default = "Search…".to_string())] placeholder: String,
    oninput: EventHandler<String>,
) -> Element {
    rsx! {
        input {
            class: "ui-search",
            r#type: "search",
            value: "{value}",
            placeholder: "{placeholder}",
            oninput: move |e| oninput.call(e.value()),
        }
    }
}

/// A selectable list row. `onclick` is optional (defaults to a no-op).
#[component]
pub fn ListRow(
    #[props(default)] selected: bool,
    #[props(default)] onclick: EventHandler<MouseEvent>,
    children: Element,
) -> Element {
    let class = if selected {
        "ui-list-row selected"
    } else {
        "ui-list-row"
    };
    rsx! {
        button {
            class,
            onclick: move |e| onclick.call(e),
            {children}
        }
    }
}
