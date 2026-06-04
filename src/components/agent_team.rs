use super::shared::set_status;
use crate::state::{Agent, AppSnapshot};
use dioxus::prelude::*;

#[component]
pub fn AgentTeam(
    mut snapshot: Signal<AppSnapshot>,
    mut new_agent_name: Signal<String>,
    mut new_agent_role: Signal<String>,
    tool_names: Vec<String>,
) -> Element {
    let current = snapshot.read().clone();

    rsx! {
        section { class: "panel agent-panel",
            div { class: "panel-heading",
                h2 { "Multi-Agent Team" }
                button {
                    onclick: move |_| {
                        let agent = Agent::new(
                            new_agent_name.read().clone(),
                            new_agent_role.read().clone(),
                            crate::state::default_tool_names(),
                        );
                        snapshot.write().agents.push(agent);
                    },
                    "Add Agent"
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
            div { class: "agent-list",
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
                            "Role / system prompt"
                            textarea {
                                value: "{agent.role}",
                                oninput: move |event| {
                                    if let Some(agent) = snapshot.write().agents.get_mut(agent_index) {
                                        agent.role = event.value();
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
                                        onchange: {
                                            let tool_name = tool_name.clone();
                                            move |event| {
                                                if let Some(agent) = snapshot.write().agents.get_mut(agent_index) {
                                                    if event.checked() {
                                                        if !agent.enabled_tools.iter().any(|enabled| enabled == &tool_name) {
                                                            agent.enabled_tools.push(tool_name.clone());
                                                        }
                                                    } else {
                                                        agent.enabled_tools.retain(|enabled| enabled != &tool_name);
                                                    }
                                                }
                                            }
                                        }
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
