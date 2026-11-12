//! An engine, drawn small: who a person is talking to, and the choice between engines.
use crate::api::Mode;
use crate::ui::features::run as words;
use crate::ui::web::kit::{Avatar, AvatarBadge, AvatarFallback, Button, ButtonSize, ButtonVariant};
use dioxus::prelude::*;

/// The letter or emoji that stands for an engine.
fn face(engine: &Mode) -> String {
    if engine.icon.is_empty() { engine.name.chars().next().map(|c| c.to_uppercase().to_string()).unwrap_or_default() } else { engine.icon.clone() }
}

/// One engine: its face with a dot for its state, its name, and what it is doing now.
/// `activity` and `detail` are the engine's live state as the service gives it.
#[component]
pub fn EngineChip(engine: Mode, #[props(default)] activity: String, #[props(default)] detail: String) -> Element {
    let state = if activity.is_empty() { "idle" } else { activity.as_str() };
    rsx! {
        div { class: "engine-chip act-{state}", title: "{engine.about}",
            Avatar {
                AvatarFallback { class: "emoji", "{face(&engine)}" }
                AvatarBadge { class: if words::at_work(&activity) { "engine-dot working" } else { "engine-dot" } }
            }
            div { class: "engine-words",
                b { class: "engine-name", "{engine.name}" }
                span { class: "engine-doing", role: "status", "{words::doing(&activity, &detail)}" }
            }
        }
    }
}

/// The engines a person can talk to, as a row of choices; `chosen` is the path of the one in
/// use. Choosing another calls `on_pick` with its path.
#[component]
pub fn EnginePick(engines: Vec<Mode>, chosen: String, on_pick: EventHandler<String>) -> Element {
    rsx! {
        div { class: "engine-pick-row", role: "group", "aria-label": "Engine to talk to",
            for m in engines {
                Button {
                    key: "{m.path}",
                    variant: ButtonVariant::Ghost,
                    size: ButtonSize::Sm,
                    class: if m.path == chosen { "pick is-on" } else { "pick" },
                    aria_pressed: m.path == chosen,
                    title: "{m.about}",
                    onclick: { let p = m.path.clone(); move |_| on_pick.call(p.clone()) },
                    if !m.icon.is_empty() { span { class: "emoji", "aria-hidden": "true", "{m.icon}" } }
                    "{m.name}"
                }
            }
        }
    }
}
