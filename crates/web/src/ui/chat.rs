//! Chat stage (kiln `chatStage`): the cross-run message log, the streaming
//! draft bubble, and the composer with Send/Stop. Pure view over the folds
//! passed down from `app.rs` — every command goes back through handlers.

use dioxus::prelude::*;

use askk_core::{ActionRecord, Role, RunProjection, RunStatus};

use crate::ui::actions::PendingActionsBar;

pub struct ChatItem {
    pub class: &'static str,
    pub role: &'static str,
    pub content: String,
}

/// Flatten the run folds (oldest first) into one bubble list: messages in
/// their real interleaved order, then error rows, then "Stopped." for an
/// interrupted run — kiln's `buildItems`, over our projection.
pub fn build_items(runs: &[RunProjection]) -> Vec<ChatItem> {
    let mut out = Vec::new();
    for run in runs {
        for m in &run.messages {
            let (class, role) = match m.role {
                Role::User => ("msg role-user", "user"),
                Role::Assistant => ("msg role-assistant", "assistant"),
                Role::Tool => ("msg role-tool", "tool"),
                Role::System => continue,
            };
            out.push(ChatItem {
                class,
                role,
                content: m.content.clone(),
            });
        }
        for line in &run.timeline {
            if let Some(message) = line.strip_prefix("error: ") {
                out.push(ChatItem {
                    class: "msg role-error",
                    role: "error",
                    content: message.to_string(),
                });
            }
        }
        if run.status == RunStatus::Interrupted {
            out.push(ChatItem {
                class: "msg role-error",
                role: "error",
                content: "Stopped.".into(),
            });
        }
    }
    out
}

#[component]
#[allow(clippy::too_many_arguments)] // ponytail: the stage's full data surface
pub fn ChatStage(
    runs: Vec<RunProjection>,
    busy: bool,
    draft: String,
    phase: String,
    warm: bool,
    agent: String,
    elapsed: String,
    notice: Option<String>,
    pending: Vec<ActionRecord>,
    on_send: EventHandler<String>,
    on_stop: EventHandler<()>,
    on_resolve: EventHandler<(String, bool)>,
) -> Element {
    let mut input = use_signal(String::new);
    let items = build_items(&runs);
    let empty = items.is_empty() && !busy && notice.is_none();
    let send = move |_| {
        let text = input().trim().to_string();
        if !text.is_empty() {
            input.set(String::new());
            on_send.call(text);
        }
    };
    rsx! {
        div { class: "chat",
            div { class: "log",
                if empty {
                    div { class: "chat-empty",
                        div { class: "chat-empty-title", "ASKK" }
                        div { class: "chat-empty-sub",
                            "ask the assistant anything — set your model endpoint in Settings first"
                        }
                    }
                }
                for (i, item) in items.iter().enumerate() {
                    div { key: "{i}", class: "{item.class}",
                        div { class: "msg-role", "{item.role}" }
                        div { class: "msg-body", "{item.content}" }
                    }
                }
                if let Some(text) = notice {
                    div { class: "msg role-error",
                        div { class: "msg-role", "error" }
                        div { class: "msg-body", "{text}" }
                    }
                }
                if busy {
                    div { class: "msg role-assistant draft",
                        div { class: "msg-role", "{agent} · {elapsed}" }
                        div { class: "msg-body",
                            if draft.is_empty() {
                                span { class: "phase-row",
                                    span { class: if warm { "pulse-dot warm" } else { "pulse-dot" } }
                                    span { class: "phase-label", "{phase}" }
                                }
                            } else {
                                "{draft}"
                                span { class: "caret" }
                            }
                        }
                    }
                }
            }
            if !pending.is_empty() {
                PendingActionsBar { records: pending, on_resolve }
            }
            div { class: "composer",
                textarea {
                    class: "input",
                    rows: 1,
                    placeholder: "Message the assistant…",
                    value: "{input}",
                    oninput: move |e| input.set(e.value()),
                }
                if busy {
                    button { class: "send stop", onclick: move |_| on_stop.call(()), "Stop" }
                }
                button { class: "send", disabled: busy, onclick: send, "Send" }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use askk_core::Message;

    #[test]
    fn items_keep_order_and_role_classes_across_runs() {
        let mut first = RunProjection {
            messages: vec![
                Message::new(Role::User, "hi"),
                Message::new(Role::Tool, "obs"),
                Message::new(Role::Assistant, "done"),
            ],
            ..Default::default()
        };
        first.timeline.push("error: boom".into());
        let second = RunProjection {
            status: RunStatus::Interrupted,
            ..Default::default()
        };
        let items = build_items(&[first, second]);
        let classes: Vec<&str> = items.iter().map(|i| i.class).collect();
        assert_eq!(
            classes,
            vec![
                "msg role-user",
                "msg role-tool",
                "msg role-assistant",
                "msg role-error",
                "msg role-error",
            ]
        );
        assert_eq!(items[4].content, "Stopped.");
    }
}
