//! Timeline: one run's `RunProjection` rendered as phase chips, activity
//! rows, message bubbles (tool output monospace), error rows, and the final
//! answer highlighted. Pure view over the fold — no commands here.

use dioxus::prelude::*;

use askk_core::{Role, RunProjection, RunStatus};

fn role_label(role: Role) -> &'static str {
    match role {
        Role::System => "system",
        Role::User => "you",
        Role::Assistant => "model",
        Role::Tool => "tool",
    }
}

fn bubble_class(role: Role, is_final: bool) -> String {
    let base = match role {
        Role::System => "bubble system",
        Role::User => "bubble user",
        Role::Assistant => "bubble assistant",
        Role::Tool => "bubble tool",
    };
    if is_final {
        format!("{base} final")
    } else {
        base.to_string()
    }
}

#[component]
pub fn Timeline(projection: RunProjection) -> Element {
    let phases: Vec<String> = projection
        .timeline
        .iter()
        .filter_map(|t| t.strip_prefix("phase: ").map(str::to_string))
        .collect();
    let activity: Vec<String> = projection
        .timeline
        .iter()
        .filter(|t| t.starts_with("tool "))
        .cloned()
        .collect();
    let errors: Vec<String> = projection
        .timeline
        .iter()
        .filter_map(|t| t.strip_prefix("error: ").map(str::to_string))
        .collect();
    let final_idx = if projection.status == RunStatus::Answered {
        projection
            .messages
            .iter()
            .rposition(|m| m.role == Role::Assistant)
    } else {
        None
    };

    rsx! {
        section { class: "timeline",
            if !phases.is_empty() {
                div { class: "chips",
                    for (i, name) in phases.iter().enumerate() {
                        span { key: "{i}", class: "chip", "{name}" }
                    }
                }
            }
            for (i, msg) in projection.messages.iter().enumerate() {
                div { key: "{i}", class: bubble_class(msg.role, Some(i) == final_idx),
                    span { class: "who", "{role_label(msg.role)}" }
                    pre { class: "content", "{msg.content}" }
                }
            }
            if !activity.is_empty() {
                div { class: "activity-list",
                    for (i, line) in activity.iter().enumerate() {
                        p { key: "{i}", class: "activity", "{line}" }
                    }
                }
            }
            for (i, message) in errors.iter().enumerate() {
                div { key: "{i}", class: "row error", "{message}" }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn final_bubble_gets_the_highlight_class() {
        assert_eq!(
            bubble_class(Role::Assistant, true),
            "bubble assistant final"
        );
        assert_eq!(bubble_class(Role::Tool, false), "bubble tool");
        assert_eq!(role_label(Role::Assistant), "model");
    }
}
