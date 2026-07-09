//! Persistent shell chrome (kiln `view.js` header/left/right/avatar): the
//! header bar, the Components rail, the Inspector rail, and the bottom
//! activity bar. Child stages render only inside `<main class="stage">`
//! (owner directive) — these regions never remount on navigation.

use dioxus::prelude::*;

use askk_core::Message;

use crate::ui::manifest::{Stage, COMPONENTS};

#[component]
pub fn Header(
    stage: Stage,
    busy: bool,
    left_open: bool,
    right_open: bool,
    on_toggle_left: EventHandler<()>,
    on_toggle_right: EventHandler<()>,
) -> Element {
    rsx! {
        header { class: "header",
            div { class: "cluster",
                button {
                    class: if left_open { "icon-btn on" } else { "icon-btn" },
                    title: "Toggle components",
                    onclick: move |_| on_toggle_left.call(()),
                    "⬛"
                }
                div { class: "brand",
                    span { class: "logo", "ASKK" }
                    span { class: "logo-sub", "harness" }
                }
                span { class: "crumb", "／ {stage.key()}" }
            }
            div { class: "cluster",
                span { class: "ready-pill",
                    span { class: if busy { "dot-busy" } else { "dot-green" } }
                    if busy { "working" } else { "ready" }
                }
                button {
                    class: if right_open { "icon-btn on" } else { "icon-btn" },
                    title: "Toggle inspector",
                    onclick: move |_| on_toggle_right.call(()),
                    "⬜"
                }
            }
        }
    }
}

#[component]
pub fn LeftRail(stage: Stage, open: bool, on_pick: EventHandler<Stage>) -> Element {
    rsx! {
        aside { class: if open { "panel panel-left" } else { "panel panel-left closed" },
            div { class: "panel-inner",
                div { class: "section-label", "Components" }
                div { class: "module-list",
                    for c in COMPONENTS {
                        button {
                            key: "{c.stage.key()}",
                            class: if stage == c.stage { "module-row active" } else { "module-row" },
                            onclick: move |_| on_pick.call(c.stage),
                            span { class: "dot", style: "background:{c.dot}" }
                            span { class: "module-name", "{c.stage.key()}" }
                            span { class: "meta-tag", "{c.meta}" }
                        }
                    }
                }
            }
        }
    }
}

/// Inspector rail. Kiln stubs Skills/Supplies; here the body shows the
/// active run's raw messages in mono when a run exists.
#[component]
pub fn RightRail(
    open: bool,
    tab: String,
    agent: Option<String>,
    messages: Vec<Message>,
    on_tab: EventHandler<String>,
) -> Element {
    let sub = agent.unwrap_or_else(|| "—".into());
    rsx! {
        aside { class: if open { "panel panel-right" } else { "panel panel-right closed" },
            div { class: "panel-inner",
                div { class: "inspector-head",
                    span { class: "inspector-title", "Inspector" }
                    span { class: "inspector-sub", "{sub}" }
                }
                div { class: "tabs",
                    for name in ["Skills", "Supplies"] {
                        button {
                            key: "{name}",
                            class: if tab == name { "tab on" } else { "tab" },
                            onclick: move |_| on_tab.call(name.to_string()),
                            "{name}"
                        }
                    }
                }
                if messages.is_empty() {
                    div { class: "inspector-empty",
                        if tab == "Skills" { "no skills loaded" } else { "nothing to inspect yet" }
                    }
                } else {
                    div { class: "prompt",
                        for (i, m) in messages.iter().enumerate() {
                            div { key: "{i}", class: "prompt-msg",
                                div { class: "prompt-role", "{m.role:?}" }
                                pre { class: "prompt-content", "{m.content}" }
                            }
                        }
                    }
                }
            }
        }
    }
}

/// The bottom bar is the persistent activity centre: idle shows the orb;
/// while a run works it becomes a CSS pulse dot + the current phase label,
/// with the elapsed clock on the right. Reduced motion → the dot goes
/// static via CSS; the label still carries the meaning.
#[component]
pub fn AvatarBar(busy: bool, label: String, warm: bool, elapsed: Option<String>) -> Element {
    rsx! {
        div { class: "avatar-bar",
            div { class: "avatar-controls",
                button { class: "icon-btn", title: "Mic input (coming soon)", disabled: true, "🎙" }
                button { class: "icon-btn", title: "Read aloud (coming soon)", disabled: true, "🔊" }
            }
            div { class: "activity-center",
                if busy {
                    span { class: if warm { "pulse-dot lg warm" } else { "pulse-dot lg" } }
                } else {
                    div { class: "avatar-orb" }
                }
                div { class: "orb-label", if busy { "{label}" } else { "idle" } }
            }
            div { class: "avatar-controls right",
                if busy {
                    if let Some(t) = elapsed {
                        span { class: "activity-elapsed", "{t}" }
                    }
                }
            }
        }
    }
}
