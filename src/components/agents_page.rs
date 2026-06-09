use super::save_snapshot;
use super::shared::set_status;
use crate::responses::ResponseFormat;
use crate::state::{Agent, AppSnapshot, default_tool_names};
use crate::storage::workspace_files::{
    apply_workspace_files, load_workspace_files, save_agent_files,
};
use dioxus::prelude::*;
use wasm_bindgen_futures::spawn_local;

#[component]
pub fn AgentsPage(
    mut snapshot: Signal<AppSnapshot>,
    mut new_agent_name: Signal<String>,
    mut new_agent_role: Signal<String>,
) -> Element {
    let current = snapshot.read().clone();
    let tool_names = default_tool_names();

    rsx! {
        section { class: "panel page-panel agents-page",
            div { class: "page-heading",
                div {
                    h2 { "Agents" }
                }
                div { class: "button-row",
                    button {
                        class: "ghost-button",
                        onclick: move |_| {
                            let mut snapshot = snapshot;
                            spawn_local(async move {
                                set_status(&mut snapshot, "Loading agents and skills from Markdown files...".to_string());
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
                        class: "ghost-button",
                        onclick: move |_| {
                            let agents = snapshot.read().agents.clone();
                            let mut snapshot = snapshot;
                            spawn_local(async move {
                                match save_agent_files(&agents).await {
                                    Ok(status) => set_status(&mut snapshot, status),
                                    Err(err) => set_status(&mut snapshot, err),
                                }
                            });
                        },
                        "Save Agents"
                    }
                    button {
                        onclick: move |_| {
                            let agent = Agent::new(
                                new_agent_name.read().clone(),
                                new_agent_role.read().clone(),
                                default_tool_names(),
                            );
                            snapshot.write().agents.push(agent);
                        },
                        "Add Agent"
                    }
                }
            }

            div { class: "new-agent-row",
                input {
                    value: "{new_agent_name.read()}",
                    oninput: move |event| new_agent_name.set(event.value())
                }
                input {
                    value: "{new_agent_role.read()}",
                    oninput: move |event| new_agent_role.set(event.value())
                }
            }

            div { class: "agent-list scroll-area",
                for (agent_index, agent) in current.agents.iter().enumerate() {
                    article { class: "agent-card", key: "{agent.id}",
                        div { class: "agent-card-head",
                            label { class: "checkbox-line",
                                input {
                                    r#type: "checkbox",
                                    checked: agent.enabled,
                                    onchange: move |event| {
                                        if let Some(agent) = snapshot.write().agents.get_mut(agent_index) {
                                            agent.enabled = event.checked();
                                        }
                                    }
                                }
                                strong { "{agent.name}" }
                            }
                            if let Some(path) = agent.source_path.as_ref() {
                                span { class: "source-path", "{path}" }
                            }
                            button {
                                class: "ghost-button",
                                onclick: move |_| {
                                    if snapshot.read().agents.len() > 1 {
                                        snapshot.write().agents.remove(agent_index);
                                    } else {
                                        set_status(&mut snapshot, "Keep at least one agent.".to_string());
                                    }
                                },
                                "Remove"
                            }
                        }
                        div { class: "agent-fields",
                            label {
                                "Name"
                                input {
                                    value: "{agent.name}",
                                    oninput: move |event| {
                                        if let Some(agent) = snapshot.write().agents.get_mut(agent_index) {
                                            agent.name = event.value();
                                        }
                                    }
                                }
                            }
                            label {
                                "Response format"
                                select {
                                    value: "{agent.response_format.as_form_value()}",
                                    onchange: move |event| {
                                        if let Some(agent) = snapshot.write().agents.get_mut(agent_index) {
                                            agent.response_format = ResponseFormat::from_form_value(&event.value());
                                        }
                                    },
                                    option { value: "toon", "TOON" }
                                    option { value: "json", "JSON" }
                                }
                            }
                            label {
                                "Strategy"
                                select {
                                    value: "{agent.strategy_id.clone().unwrap_or_else(|| \"react\".to_string())}",
                                    onchange: move |event| {
                                        if let Some(agent) = snapshot.write().agents.get_mut(agent_index) {
                                            let value = event.value();
                                            agent.strategy_id =
                                                if value == "react" { None } else { Some(value) };
                                        }
                                    },
                                    option { value: "react", "ReAct (default)" }
                                    option { value: "plan-act-review", "Plan – Act – Review" }
                                    option { value: "skills-work-critique", "Skills – Work – Critique" }
                                    option { value: "orchestrate", "Orchestrate" }
                                }
                            }
                            label {
                                "Agent prompt"
                                textarea {
                                    value: "{agent.role}",
                                    oninput: move |event| {
                                        if let Some(agent) = snapshot.write().agents.get_mut(agent_index) {
                                            agent.role = event.value();
                                        }
                                    }
                                }
                            }
                        }
                        div { class: "tool-grid",
                            for tool_name in tool_names.iter() {
                                label { class: "checkbox-line tool-checkbox", key: "{agent.id}-{tool_name}",
                                    input {
                                        r#type: "checkbox",
                                        checked: agent.enabled_tools.iter().any(|enabled| enabled == tool_name),
                                        disabled: true,
                                    }
                                    "{tool_name}"
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
