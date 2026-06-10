use super::save_snapshot;
use super::shared::set_status;
use crate::state::{AppSnapshot, McpServerKind, TOOL_HOST_SERVER_ID, tool_host_server_config};
use dioxus::prelude::*;
use std::collections::HashMap;
use wasm_bindgen_futures::spawn_local;

/// Dashboard section for browser-hosted MCP servers — list, add, remove, enable,
/// and probe each server's tools — plus the tool host's compiled functions.
/// Configured servers and functions persist in the snapshot; their tools are
/// offered to the agent at run start (see `crate::mcp::registry`).
#[component]
pub fn McpPage(mut snapshot: Signal<AppSnapshot>) -> Element {
    let current = snapshot.read().clone();
    // Server id -> a human-readable "discovered tools" / error line, filled by the
    // per-server Discover button (a main-thread probe of the worker). The tool
    // host's probe line lives under its stable server id.
    let discovered = use_signal(HashMap::<String, String>::new);
    let tool_host_line = discovered.read().get(TOOL_HOST_SERVER_ID).cloned();

    rsx! {
        section { class: "panel page-panel mcp-page",
            div { class: "page-heading",
                div {
                    h2 { "MCP servers" }
                    p { class: "muted",
                        "Browser-hosted Model Context Protocol servers. Each enabled server is connected at run start and its tools are offered to the agent. A "
                        strong { "module" }
                        " server loads a pre-written JS worker; a "
                        strong { "shellized" }
                        " server is defined by its tools alone and wrapped in a generic shell worker at run start."
                    }
                }
                div { class: "button-row",
                    button {
                        onclick: move |_| {
                            let status = snapshot.write().add_mcp_server();
                            set_status(&mut snapshot, status);
                        },
                        "Add module server"
                    }
                    button {
                        onclick: move |_| {
                            let status = snapshot.write().add_shellized_mcp_server();
                            set_status(&mut snapshot, status);
                        },
                        "Add shellized server"
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
                    "No MCP servers configured. Add a module server (defaults to the bundled reference server) or a shellized server (defaults to an editable example tool) to expose its tools to the agent."
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
                    let kind_label = match server.kind {
                        McpServerKind::Browser => "module",
                        McpServerKind::Shellized => "shellized",
                        McpServerKind::Workspace => "built-in",
                    };
                    let is_builtin = server.kind == McpServerKind::Workspace;
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
                                    span { class: "pill", "{kind_label}" }
                                }
                                if !is_builtin {
                                    button {
                                        class: "ghost-button",
                                        onclick: move |_| {
                                            let status = snapshot.write().remove_mcp_server(&id_remove);
                                            set_status(&mut snapshot, status);
                                        },
                                        "Remove"
                                    }
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
                            match server.kind {
                                McpServerKind::Browser => rsx! {
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
                                },
                                McpServerKind::Shellized => rsx! {
                                    label {
                                        "Definition (JSON)"
                                        textarea {
                                            class: "mcp-definition",
                                            rows: "12",
                                            spellcheck: "false",
                                            value: "{server.definition}",
                                            oninput: move |event| {
                                                if let Some(server) =
                                                    snapshot.write().mcp_servers.get_mut(index)
                                                {
                                                    server.definition = event.value();
                                                }
                                            }
                                        }
                                    }
                                    p { class: "muted",
                                        "Each tool's "
                                        code { "handler" }
                                        " is a JS function body that receives "
                                        code { "args" }
                                        " and returns a string, number, or object. The shell worker supplies the MCP protocol around it."
                                    }
                                },
                                McpServerKind::Workspace => rsx! {
                                    p { class: "muted",
                                        "Built-in, in-process server exposing the Workspace actions as MCP tools: "
                                        code { "workspace_list_files" }
                                        ", "
                                        code { "workspace_read_file" }
                                        ", "
                                        code { "workspace_create_file" }
                                        ", "
                                        code { "workspace_edit_file" }
                                        ", "
                                        code { "workspace_run_js" }
                                        ", and "
                                        code { "workspace_run_command" }
                                        ". They operate on the same files and runners as the Workspace page. Untick the checkbox to stop offering them to the agent."
                                    }
                                },
                            }
                            div { class: "button-row",
                                button {
                                    class: "ghost-button",
                                    onclick: move |_| {
                                        let config = config_probe.clone();
                                        let tool_config = snapshot.peek().tool_config.clone();
                                        let id = id_probe.clone();
                                        let mut discovered = discovered;
                                        spawn_local(async move {
                                            discovered.write().insert(id.clone(), "Discovering…".to_string());
                                            let line = match crate::mcp::probe_tools(&config, &tool_config).await {
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

            div { class: "page-heading",
                div {
                    h2 { "Tool host — compiled functions" }
                    p { class: "muted",
                        "User-defined functions, compiled once and hosted together in a single dedicated, stateful Web Worker (the tool host) at run start. Each handler receives "
                        code { "args" }
                        " and a shared "
                        code { "state" }
                        " object that persists across calls and across runs — until a function is edited or the page reloads. Every enabled function is offered to the agent as a tool, in parity with the built-ins."
                    }
                }
                div { class: "button-row",
                    button {
                        onclick: move |_| {
                            let status = snapshot.write().add_compiled_function();
                            set_status(&mut snapshot, status);
                        },
                        "Add function"
                    }
                    button {
                        class: "ghost-button",
                        onclick: move |_| {
                            let functions = snapshot.peek().compiled_functions.clone();
                            let tool_config = snapshot.peek().tool_config.clone();
                            let mut discovered = discovered;
                            spawn_local(async move {
                                let key = TOOL_HOST_SERVER_ID.to_string();
                                discovered.write().insert(key.clone(), "Discovering…".to_string());
                                let line = match tool_host_server_config(&functions) {
                                    Ok(Some(config)) => {
                                        match crate::mcp::probe_tools(&config, &tool_config).await {
                                            Ok(tools) if tools.is_empty() => {
                                                "Connected — the tool host advertised no tools.".to_string()
                                            }
                                            Ok(tools) => format!("Tools: {}", tools.join(", ")),
                                            Err(err) => format!("Error: {err}"),
                                        }
                                    }
                                    Ok(None) => {
                                        "No enabled functions — add or enable one first.".to_string()
                                    }
                                    Err(err) => format!("Error: {err}"),
                                };
                                discovered.write().insert(key, line);
                            });
                        },
                        "Test tool host"
                    }
                }
            }

            if current.compiled_functions.is_empty() {
                p { class: "muted",
                    "No compiled functions yet. Add one to spin up the tool host — the example function shows how to keep state between calls."
                }
            }

            for (index, function) in current.compiled_functions.iter().enumerate() {
                {
                    let id_toggle = function.id.clone();
                    let id_remove = function.id.clone();
                    rsx! {
                        article { class: "settings-card mcp-card", key: "{function.id}",
                            div { class: "card-heading",
                                label { class: "checkbox-line",
                                    input {
                                        r#type: "checkbox",
                                        checked: function.enabled,
                                        onchange: move |event| {
                                            let status = snapshot
                                                .write()
                                                .toggle_compiled_function(&id_toggle, event.checked());
                                            set_status(&mut snapshot, status);
                                        }
                                    }
                                    strong { "{function.name}" }
                                    span { class: "pill", "function" }
                                }
                                button {
                                    class: "ghost-button",
                                    onclick: move |_| {
                                        let status = snapshot.write().remove_compiled_function(&id_remove);
                                        set_status(&mut snapshot, status);
                                    },
                                    "Remove"
                                }
                            }
                            label {
                                "Name"
                                input {
                                    value: "{function.name}",
                                    oninput: move |event| {
                                        if let Some(function) =
                                            snapshot.write().compiled_functions.get_mut(index)
                                        {
                                            function.name = event.value();
                                        }
                                    }
                                }
                            }
                            label {
                                "Description"
                                input {
                                    value: "{function.description}",
                                    oninput: move |event| {
                                        if let Some(function) =
                                            snapshot.write().compiled_functions.get_mut(index)
                                        {
                                            function.description = event.value();
                                        }
                                    }
                                }
                            }
                            label {
                                "Input schema (JSON object; empty means any arguments)"
                                textarea {
                                    class: "mcp-definition",
                                    rows: "4",
                                    spellcheck: "false",
                                    value: "{function.input_schema}",
                                    oninput: move |event| {
                                        if let Some(function) =
                                            snapshot.write().compiled_functions.get_mut(index)
                                        {
                                            function.input_schema = event.value();
                                        }
                                    }
                                }
                            }
                            label {
                                "Handler body (JS — receives args and state)"
                                textarea {
                                    class: "mcp-definition",
                                    rows: "6",
                                    spellcheck: "false",
                                    value: "{function.body}",
                                    oninput: move |event| {
                                        if let Some(function) =
                                            snapshot.write().compiled_functions.get_mut(index)
                                        {
                                            function.body = event.value();
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if let Some(line) = tool_host_line {
                pre { class: "tool-test-output", "{line}" }
            }
        }
    }
}
