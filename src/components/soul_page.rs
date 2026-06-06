use super::save_snapshot;
use super::shared::set_status;
use crate::state::AppSnapshot;
use crate::workspace_files::{apply_workspace_files, load_workspace_files, save_soul_file};
use dioxus::prelude::*;
use wasm_bindgen_futures::spawn_local;

#[component]
pub fn SoulPage(mut snapshot: Signal<AppSnapshot>) -> Element {
    let current = snapshot.read().clone();

    rsx! {
        section { class: "panel page-panel soul-page",
            div { class: "page-heading",
                div {
                    h2 { "Soul" }
                }
                div { class: "button-row",
                    button {
                        class: "ghost-button",
                        onclick: move |_| {
                            let mut snapshot = snapshot;
                            spawn_local(async move {
                                set_status(&mut snapshot, "Loading Markdown files from local bridge...".to_string());
                                match load_workspace_files().await {
                                    Ok(files) => {
                                        let mut next = snapshot.read().clone();
                                        let load_status = apply_workspace_files(&mut next, files);
                                        let save_status = save_snapshot(next.clone()).await;
                                        snapshot.set(next);
                                        set_status(&mut snapshot, format!("{load_status} {save_status}"));
                                    }
                                    Err(err) => set_status(&mut snapshot, err),
                                }
                            });
                        },
                        "Load Files"
                    }
                    button {
                        onclick: move |_| {
                            let content = snapshot.read().soul.clone();
                            let mut snapshot = snapshot;
                            spawn_local(async move {
                                match save_soul_file(content).await {
                                    Ok(status) => {
                                        let data = snapshot.read().clone();
                                        let save_status = save_snapshot(data).await;
                                        set_status(&mut snapshot, format!("{status} {save_status}"));
                                    }
                                    Err(err) => set_status(&mut snapshot, err),
                                }
                            });
                        },
                        "Save soul.md"
                    }
                }
            }

            label { class: "soul-editor",
                "soul.md"
                textarea {
                    value: "{current.soul}",
                    oninput: move |event| {
                        snapshot.write().soul = event.value();
                    }
                }
            }

            div { class: "skill-list scroll-area",
                div { class: "section-label", "Skills" }
                if current.skills.is_empty() {
                    div { class: "empty-state", "No skills loaded. Start the local bridge from the project root and load files." }
                } else {
                    for (skill_index, skill) in current.skills.iter().enumerate() {
                        article { class: "skill-card", key: "{skill.id}",
                            div { class: "agent-card-head",
                                label { class: "checkbox-line",
                                    input {
                                        r#type: "checkbox",
                                        checked: skill.enabled,
                                        onchange: move |event| {
                                            if let Some(skill) = snapshot.write().skills.get_mut(skill_index) {
                                                skill.enabled = event.checked();
                                            }
                                        }
                                    }
                                    strong { "{skill.name}" }
                                }
                                if let Some(path) = skill.source_path.as_ref() {
                                    span { class: "source-path", "{path}" }
                                }
                            }
                            pre { "{skill.content}" }
                        }
                    }
                }
            }
        }
    }
}
