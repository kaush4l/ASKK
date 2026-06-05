use super::save_snapshot;
use super::shared::set_status;
use crate::engine::ReActEngine;
use crate::state::{AppSnapshot, Message};
use dioxus::prelude::*;
use wasm_bindgen_futures::spawn_local;

#[component]
pub fn ChatPanel(mut snapshot: Signal<AppSnapshot>, mut goal: Signal<String>) -> Element {
    let current = snapshot.read().clone();
    let current_goal = goal.read().clone();

    rsx! {
        section { class: "panel page-panel chat-panel",
            div { class: "page-heading",
                div {
                    h2 { "Chat" }
                }
                div { class: "button-row",
                    button {
                        onclick: move |_| {
                            let run_goal = goal.read().trim().to_string();
                            if run_goal.is_empty() {
                                set_status(&mut snapshot, "Enter a message before running.".to_string());
                                return;
                            }
                            let start_data = snapshot.read().clone();
                            let mut snapshot = snapshot;
                            spawn_local(async move {
                                set_status(&mut snapshot, "Running agent loop...".to_string());
                                let runtime = ReActEngine::new();
                                match runtime.run_goal(start_data, run_goal).await {
                                    Ok(next) => {
                                        let run_status = next.status.clone();
                                        let save_status = save_snapshot(next.clone()).await;
                                        snapshot.set(next);
                                        set_status(&mut snapshot, format!("{run_status}. {save_status}"));
                                    }
                                    Err(err) => set_status(&mut snapshot, format!("Run failed: {err}")),
                                }
                            });
                        },
                        "Run"
                    }
                    button {
                        class: "ghost-button",
                        onclick: move |_| {
                            snapshot.write().current_run = None;
                            set_status(&mut snapshot, "Current run reset.".to_string());
                        },
                        "Reset"
                    }
                }
            }

            div { class: "composer",
                textarea {
                    class: "goal-box",
                    placeholder: "Describe a goal or message for the agent...",
                    value: "{current_goal}",
                    oninput: move |event| goal.set(event.value())
                }
            }

            div { class: "conversation-scroll",
                if let Some(run) = current.current_run.as_ref() {
                    article { class: "message-bubble user-message",
                        div { class: "message-author", "You" }
                        p { "{run.goal}" }
                    }
                    for (index, message) in run.messages.iter().enumerate() {
                        MessageBubble {
                            key: "{index}",
                            message: message.clone(),
                        }
                    }
                    if !run.final_answer.trim().is_empty() {
                        article { class: "message-bubble final-message",
                            div { class: "message-author", "Final" }
                            p { "{run.final_answer}" }
                        }
                    }
                } else if current_goal.trim().is_empty() {
                    div { class: "empty-state", "No chat yet. Enter a message to start a run." }
                } else {
                    article { class: "message-bubble draft-message",
                        div { class: "message-author", "Draft" }
                        p { "{current_goal}" }
                    }
                }
            }
        }
    }
}

#[component]
fn MessageBubble(message: Message) -> Element {
    let class = match message.role.as_str() {
        "tool" => "message-bubble tool-message",
        "user" => "message-bubble user-message",
        _ => "message-bubble assistant-message",
    };
    let author = match message.role.as_str() {
        "tool" => "Tool",
        "user" => "You",
        _ => "Agent",
    };

    rsx! {
        article { class: "{class}",
            div { class: "message-author", "{author}" }
            p { "{message.content}" }
        }
    }
}
