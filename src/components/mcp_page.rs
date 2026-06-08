use super::save_snapshot;
use super::shared::set_status;
use crate::state::AppSnapshot;
use dioxus::prelude::*;
use std::collections::HashMap;
use wasm_bindgen_futures::spawn_local;

/// Dashboard section for browser-hosted MCP servers: list, add, remove, enable, and
/// probe each server's tools. Configured servers persist in the snapshot; their
/// tools are offered to the agent at run start (see `crate::mcp::registry`).
#[component]
pub fn McpPage(mut snapshot: Signal<AppSnapshot>) -> Element {
    let current = snapshot.read().clone();
    // Server id -> a human-readable "discovered tools" / error line, filled by the
    // per-server Discover button (a main-thread probe of the worker).
    let discovered = use_signal(HashMap::<String, String>::new);

    rsx! {
        section { class: "panel page-panel mcp-page",
            div { class: "page-heading",
                div {
                    h2 { "MCP servers" }
                    p { class: "muted",
                        "Browser-hosted Model Context Protocol servers. Each enabled server is connected at run start and its tools are offered to the agent."
                    }
                }
                div { class: "button-row",
                    button {
                        onclick: move |_| {
                            let status = snapshot.write().add_mcp_server();
                            set_status(&mut snapshot, status);
                        },
                        "Add server"
                    }
                    button {
                        onclick: move |_| {
                            let save_data = snapshot.read().clone();
                            let mut snapshot = snapshot;
                            spawn_local(async move {
                                let status = save_snapshot(save_data).await;
                                set_status(&mut snapshot, status);
                            });
                        },
                        "Save"
                    }
                }
            }

            if current.mcp_servers.is_empty() {
                p { class: "muted",
                    "No MCP servers configured. Add one (it defaults to the bundled reference server) to expose its tools to the agent."
                }
            }

            for (index, server) in current.mcp_servers.iter().enumerate() {
                {
                    let id_toggle = server.id.clone();
                    let id_remove = server.id.clone();
                    let id_rename = server.id.clone();
                    let config_probe = server.clone();
                    let id_probe = server.id.clone();
                    let discovery_line = discovered.read().get(&server.id).cloned();
                    rsx! {
                        article { class: "settings-card mcp-card", key: "{server.id}",
                            div { class: "card-heading",
                                label { class: "checkbox-line",
                                    input {
                                        r#type: "checkbox",
                                        checked: server.enabled,
                                        onchange: move |event| {
                                            let status = snapshot
                                                .write()
                                                .toggle_mcp_server(&id_toggle, event.checked());
                                            set_status(&mut snapshot, status);
                                        }
                                    }
                                    strong { "{server.name}" }
                                }
                                button {
                                    class: "ghost-button",
                                    onclick: move |_| {
                                        let status = snapshot.write().remove_mcp_server(&id_remove);
                                        set_status(&mut snapshot, status);
                                    },
                                    "Remove"
                                }
                            }
                            label {
                                "Name"
                                input {
                                    value: "{server.name}",
                                    oninput: move |event| {
                                        snapshot.write().rename_mcp_server(&id_rename, &event.value());
                                    }
                                }
                            }
                            label {
                                "Module path"
                                input {
                                    value: "{server.module_path}",
                                    placeholder: "/assets/mcp_reference_server.js",
                                    oninput: move |event| {
                                        if let Some(server) =
                                            snapshot.write().mcp_servers.get_mut(index)
                                        {
                                            server.module_path = event.value();
                                        }
                                    }
                                }
                            }
                            div { class: "button-row",
                                button {
                                    class: "ghost-button",
                                    onclick: move |_| {
                                        let config = config_probe.clone();
                                        let id = id_probe.clone();
                                        let mut discovered = discovered;
                                        spawn_local(async move {
                                            discovered.write().insert(id.clone(), "Discovering…".to_string());
                                            let line = match crate::mcp::probe_tools(&config).await {
                                                Ok(tools) if tools.is_empty() => {
                                                    "Connected — server advertised no tools.".to_string()
                                                }
                                                Ok(tools) => format!("Tools: {}", tools.join(", ")),
                                                Err(err) => format!("Error: {err}"),
                                            };
                                            discovered.write().insert(id, line);
                                        });
                                    },
                                    "Discover tools"
                                }
                            }
                            if let Some(line) = discovery_line {
                                pre { class: "tool-test-output", "{line}" }
                            }
                        }
                    }
                }
            }
        }
    }
}
