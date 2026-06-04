use super::save_snapshot;
use super::shared::set_status;
use crate::engine::ReActEngine;
use crate::state::AppSnapshot;
use dioxus::prelude::*;
use wasm_bindgen_futures::spawn_local;

#[component]
pub fn ChatPanel(mut snapshot: Signal<AppSnapshot>, mut goal: Signal<String>) -> Element {
    let current = snapshot.read().clone();
    let current_goal = goal.read().clone();

    rsx! {
        section { class: "panel runner-panel",
            div { class: "panel-heading",
                h2 { "Task Runner" }
                div { class: "button-row",
                    button {
                        onclick: move |_| {
                            let run_goal = goal.read().trim().to_string();
                            if run_goal.is_empty() {
                                set_status(&mut snapshot, "Enter a goal before running.".to_string());
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
                        onclick: move |_| {
                            snapshot.write().current_run = None;
                            set_status(&mut snapshot, "Current run reset.".to_string());
                        },
                        "Reset"
                    }
                }
            }
            textarea {
                class: "goal-box",
                placeholder: "Describe a goal for the ASKK team...",
                value: "{current_goal}",
                oninput: move |event| goal.set(event.value())
            }

            if let Some(run) = current.current_run.as_ref() {
                div { class: "final-answer",
                    h3 { "Final Answer" }
                    p { "{run.final_answer}" }
                }
                div { class: "timeline",
                    for event in run.events.iter() {
                        article { class: "event-row", key: "{event.id}",
                            div { class: "event-meta",
                                span { "{event.created_at}" }
                                span { "{event.kind:?}" }
                            }
                            h3 { "{event.title}" }
                            pre { "{event.body}" }
                        }
                    }
                }
            } else {
                div { class: "empty-state", "No run yet. Enter a goal and run the browser agent loop." }
            }
        }
    }
}
