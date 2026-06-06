//! Workspace IDE page.
//!
//! A browser-hosted text editor over the local bridge's on-disk run root: a file
//! tree, an editor pane, and a terminal that runs commands (e.g. `bun test`) in the
//! same directory the coding agent operates on. The agent and the editor share one
//! workspace, so files the agent writes appear here and edits made here are visible
//! to `run_command`.

use super::save_snapshot;
use super::shared::set_status;
use crate::orchestrator::run_goal_with_orchestrator_or_worker;
use crate::state::AppSnapshot;
use crate::tools::{bridge_fs_list, bridge_fs_read, bridge_fs_write, bridge_run_command};
use dioxus::prelude::*;
use serde_json::Value;
use wasm_bindgen_futures::spawn_local;

#[derive(Clone, PartialEq)]
struct FileNode {
    path: String,
    is_dir: bool,
    depth: usize,
}

fn parse_file_nodes(value: &Value) -> Vec<FileNode> {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let path = item.get("path").and_then(Value::as_str)?.to_string();
                    let is_dir = item.get("dir").and_then(Value::as_bool).unwrap_or(false);
                    let depth = path.matches('/').count();
                    Some(FileNode {
                        path,
                        is_dir,
                        depth,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn refresh_tree(
    snapshot: Signal<AppSnapshot>,
    mut files: Signal<Vec<FileNode>>,
    mut notice: Signal<String>,
) {
    let config = snapshot.read().tool_config.web_search.clone();
    spawn_local(async move {
        match bridge_fs_list(&config, None).await {
            Ok(value) => {
                files.set(parse_file_nodes(&value));
                notice.set(String::new());
            }
            Err(err) => {
                files.set(Vec::new());
                notice.set(err);
            }
        }
    });
}

#[component]
pub fn WorkspacePage(mut snapshot: Signal<AppSnapshot>, goal: Signal<String>) -> Element {
    let files = use_signal(Vec::<FileNode>::new);
    let mut selected = use_signal(|| Option::<String>::None);
    let mut editor = use_signal(String::new);
    let mut dirty = use_signal(|| false);
    let mut new_path = use_signal(String::new);
    let mut command = use_signal(|| "bun test".to_string());
    let mut terminal = use_signal(String::new);
    let mut notice = use_signal(String::new);
    let mut busy = use_signal(|| false);

    // Load the tree once on mount.
    use_effect(move || {
        refresh_tree(snapshot, files, notice);
    });

    let running = snapshot
        .read()
        .current_run
        .as_ref()
        .is_some_and(|run| run.status == "running");
    let last_answer = snapshot
        .read()
        .runs
        .last()
        .map(|run| run.final_answer.clone())
        .filter(|answer| !answer.trim().is_empty());
    let current_command = command.read().clone();
    let current_new_path = new_path.read().clone();
    let selected_label = selected
        .read()
        .clone()
        .unwrap_or_else(|| "No file open".to_string());
    let editor_value = editor.read().clone();
    let notice_text = notice.read().clone();
    let terminal_text = terminal.read().clone();
    let nodes = files.read().clone();

    rsx! {
        section { class: "panel page-panel workspace-page",
            div { class: "page-heading",
                h2 { "Workspace" }
                div { class: "button-row",
                    button {
                        class: "ghost-button",
                        onclick: move |_| refresh_tree(snapshot, files, notice),
                        "Refresh"
                    }
                }
            }
            p { class: "workspace-hint",
                "Files, terminal, and the coding agent all share the local bridge run root. Start the bridge with "
                code { "node scripts/askk-local-bridge.mjs --allow-exec" }
                " to enable running and testing projects (e.g. bun)."
            }
            if !notice_text.trim().is_empty() {
                div { class: "workspace-notice", "{notice_text}" }
            }

            div { class: "workspace-grid",
                aside { class: "workspace-tree",
                    div { class: "workspace-tree-head", "Files" }
                    div { class: "workspace-new-file",
                        input {
                            class: "workspace-input",
                            placeholder: "new/path.ts",
                            value: "{current_new_path}",
                            oninput: move |event| new_path.set(event.value()),
                        }
                        button {
                            class: "ghost-button",
                            disabled: current_new_path.trim().is_empty(),
                            onclick: move |_| {
                                let path = new_path.read().trim().to_string();
                                if path.is_empty() { return; }
                                selected.set(Some(path.clone()));
                                editor.set(String::new());
                                dirty.set(true);
                                new_path.set(String::new());
                                notice.set(format!("New file {path}. Edit and Save to write it to disk."));
                            },
                            "New"
                        }
                    }
                    div { class: "workspace-tree-list",
                        if nodes.is_empty() {
                            div { class: "workspace-empty", "No files yet. Create one, or ask the coding agent to scaffold a project." }
                        }
                        for node in nodes.iter() {
                            {
                                let path = node.path.clone();
                                let name = path.rsplit('/').next().unwrap_or(&path).to_string();
                                let indent = format!("padding-left: {}px;", 8 + node.depth * 14);
                                let is_selected = selected.read().as_deref() == Some(path.as_str());
                                let row_class = if node.is_dir {
                                    "workspace-node dir"
                                } else if is_selected {
                                    "workspace-node file selected"
                                } else {
                                    "workspace-node file"
                                };
                                if node.is_dir {
                                    rsx! {
                                        div { key: "{path}", class: "{row_class}", style: "{indent}",
                                            span { class: "node-glyph", "▸" }
                                            span { "{name}/" }
                                        }
                                    }
                                } else {
                                    rsx! {
                                        button {
                                            key: "{path}",
                                            class: "{row_class}",
                                            style: "{indent}",
                                            onclick: move |_| {
                                                let path = path.clone();
                                                let config = snapshot.read().tool_config.web_search.clone();
                                                selected.set(Some(path.clone()));
                                                notice.set(format!("Opening {path}…"));
                                                spawn_local(async move {
                                                    match bridge_fs_read(&config, &path).await {
                                                        Ok(content) => {
                                                            editor.set(content);
                                                            dirty.set(false);
                                                            notice.set(String::new());
                                                        }
                                                        Err(err) => notice.set(err),
                                                    }
                                                });
                                            },
                                            span { class: "node-glyph", "•" }
                                            span { "{name}" }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                div { class: "workspace-editor",
                    div { class: "workspace-editor-head",
                        span { class: "editor-path", "{selected_label}" }
                        if dirty() { span { class: "editor-dirty", "● unsaved" } }
                        button {
                            class: "ghost-button",
                            disabled: selected.read().is_none(),
                            onclick: move |_| {
                                let Some(path) = selected.read().clone() else { return; };
                                let content = editor.read().clone();
                                let config = snapshot.read().tool_config.web_search.clone();
                                notice.set(format!("Saving {path}…"));
                                spawn_local(async move {
                                    match bridge_fs_write(&config, &path, &content).await {
                                        Ok(()) => {
                                            dirty.set(false);
                                            notice.set(format!("Saved {path}."));
                                            refresh_tree(snapshot, files, notice);
                                        }
                                        Err(err) => notice.set(err),
                                    }
                                });
                            },
                            "Save"
                        }
                    }
                    textarea {
                        class: "workspace-code",
                        spellcheck: false,
                        placeholder: "Select a file to edit, or create a new one.",
                        value: "{editor_value}",
                        oninput: move |event| {
                            editor.set(event.value());
                            dirty.set(true);
                        },
                    }
                }
            }

            div { class: "workspace-terminal",
                div { class: "workspace-terminal-head", "Terminal — run root" }
                div { class: "workspace-quick-row",
                    for preset in ["bun install", "bun test", "bun run index.ts", "ls -la"] {
                        button {
                            key: "{preset}",
                            class: "chip-button",
                            onclick: move |_| command.set(preset.to_string()),
                            "{preset}"
                        }
                    }
                }
                form {
                    class: "workspace-command-row",
                    onsubmit: move |event| {
                        event.prevent_default();
                        let cmd = command.read().trim().to_string();
                        if cmd.is_empty() || busy() { return; }
                        let config = snapshot.read().tool_config.web_search.clone();
                        busy.set(true);
                        terminal.with_mut(|log| log.push_str(&format!("$ {cmd}\n")));
                        spawn_local(async move {
                            match bridge_run_command(&config, &cmd, None).await {
                                Ok(data) => {
                                    let stdout = data.get("stdout").and_then(Value::as_str).unwrap_or("");
                                    let stderr = data.get("stderr").and_then(Value::as_str).unwrap_or("");
                                    let code = data.get("exit_code").and_then(Value::as_i64).unwrap_or(-1);
                                    terminal.with_mut(|log| {
                                        if !stdout.is_empty() { log.push_str(stdout); if !stdout.ends_with('\n') { log.push('\n'); } }
                                        if !stderr.is_empty() { log.push_str(stderr); if !stderr.ends_with('\n') { log.push('\n'); } }
                                        log.push_str(&format!("[exit {code}]\n\n"));
                                    });
                                }
                                Err(err) => terminal.with_mut(|log| log.push_str(&format!("error: {err}\n\n"))),
                            }
                            busy.set(false);
                            refresh_tree(snapshot, files, notice);
                        });
                    },
                    input {
                        class: "workspace-input mono",
                        value: "{current_command}",
                        oninput: move |event| command.set(event.value()),
                        placeholder: "command to run in the run root",
                    }
                    button { r#type: "submit", disabled: busy() || current_command.trim().is_empty(),
                        if busy() { "Running…" } else { "Run" }
                    }
                }
                pre { class: "workspace-terminal-output", "{terminal_text}" }
            }

            div { class: "workspace-agent",
                div { class: "workspace-agent-head", "Coding agent" }
                p { class: "workspace-hint",
                    "Describe a task. The agent writes files, runs them, and reports complete only after a verification command passes. Full transcript is on the Chat page."
                }
                if let Some(answer) = last_answer.as_ref() {
                    div { class: "workspace-agent-answer", "{answer}" }
                }
                form {
                    class: "workspace-command-row",
                    onsubmit: move |event| {
                        event.prevent_default();
                        submit_workspace_goal(snapshot, goal, files, notice);
                    },
                    textarea {
                        class: "workspace-input",
                        placeholder: "e.g. Create a bun project with an add(a,b) function and a passing test, then verify with `bun test`.",
                        value: "{goal.read().clone()}",
                        oninput: move |event| goal.set(event.value()),
                    }
                    button { r#type: "submit", disabled: running || goal.read().trim().is_empty(),
                        if running { "Working…" } else { "Send to agent" }
                    }
                }
            }
        }
    }
}

fn submit_workspace_goal(
    mut snapshot: Signal<AppSnapshot>,
    mut goal: Signal<String>,
    files: Signal<Vec<FileNode>>,
    notice: Signal<String>,
) {
    let goal_text = goal.read().trim().to_string();
    if goal_text.is_empty() {
        return;
    }
    if snapshot
        .read()
        .current_run
        .as_ref()
        .is_some_and(|run| run.status == "running")
    {
        set_status(&mut snapshot, "A run is already in progress.".to_string());
        return;
    }
    goal.set(String::new());
    set_status(&mut snapshot, "Coding agent running…".to_string());

    spawn_local(async move {
        let start = snapshot.read().clone();
        let mut live = snapshot;
        let mut finish = snapshot;
        let result = run_goal_with_orchestrator_or_worker(start, goal_text, move |run| {
            let mut next = live.read().clone();
            next.current_run = Some(run);
            next.checkpoint_current_run();
            live.set(next);
        })
        .await;

        match result {
            Ok(next) => {
                let status = next.status.clone();
                let _ = save_snapshot(next.clone()).await;
                finish.set(next);
                set_status(&mut finish, status);
            }
            Err(err) => set_status(&mut finish, format!("Run failed: {err}")),
        }
        // Show whatever the agent wrote to disk.
        refresh_tree(snapshot, files, notice);
    });
}
