//! Workspace IDE page.
//!
//! A browser-hosted text editor with a file tree, an editor pane, and a runner.
//! By default everything runs **in the browser**: files live in the in-browser
//! virtual filesystem ([`ProjectVfs`], IndexedDB) and code runs in a sandboxed Web
//! Worker via [`run_js_in_browser`] — no bridge required, so it works on the hosted
//! site. A "Bridge" mode is available for driving a local `askk-local-bridge`
//! (disk files + real `bun`/`node` execution) when one is running.

use super::save_snapshot;
use super::shared::set_status;
use crate::browser_exec::{format_run_js, run_js_in_browser};
use crate::orchestrator::run_goal_with_orchestrator_or_worker;
use crate::state::{AppSnapshot, RunStatus};
use crate::storage::vfs::ProjectVfs;
use crate::tools::{bridge_fs_list, bridge_fs_read, bridge_fs_write, bridge_run_command};
use dioxus::prelude::*;
use serde_json::Value;
use std::collections::BTreeSet;
use wasm_bindgen_futures::spawn_local;

#[derive(Clone, Copy, PartialEq, Eq)]
enum WorkspaceMode {
    Browser,
    Bridge,
}

impl WorkspaceMode {
    fn label(self) -> &'static str {
        match self {
            Self::Browser => "Browser",
            Self::Bridge => "Bridge",
        }
    }
}

#[derive(Clone, PartialEq)]
struct FileNode {
    path: String,
    is_dir: bool,
    depth: usize,
}

/// Bridge `fs_list` returns `[{ path, dir }]`; map it to display nodes.
fn parse_bridge_nodes(value: &Value) -> Vec<FileNode> {
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

/// The in-browser VFS stores flat path keys; synthesize the parent directories so
/// the tree renders with structure.
fn nodes_from_paths(paths: Vec<String>) -> Vec<FileNode> {
    let mut entries: BTreeSet<(String, bool)> = BTreeSet::new();
    for path in paths {
        let parts: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
        let mut acc = String::new();
        for (index, part) in parts.iter().enumerate() {
            if index > 0 {
                acc.push('/');
            }
            acc.push_str(part);
            entries.insert((acc.clone(), index < parts.len() - 1));
        }
    }
    entries
        .into_iter()
        .map(|(path, is_dir)| {
            let depth = path.matches('/').count();
            FileNode {
                path,
                is_dir,
                depth,
            }
        })
        .collect()
}

fn refresh_tree(
    snapshot: Signal<AppSnapshot>,
    mode: WorkspaceMode,
    mut files: Signal<Vec<FileNode>>,
    mut notice: Signal<String>,
) {
    match mode {
        WorkspaceMode::Browser => {
            spawn_local(async move {
                match ProjectVfs::new().list_files().await {
                    Ok(paths) => {
                        files.set(nodes_from_paths(paths));
                        notice.set(String::new());
                    }
                    Err(err) => {
                        files.set(Vec::new());
                        notice.set(format!("Filesystem error: {err}"));
                    }
                }
            });
        }
        WorkspaceMode::Bridge => {
            let config = snapshot.read().tool_config.web_search.clone();
            spawn_local(async move {
                match bridge_fs_list(&config, None).await {
                    Ok(value) => {
                        files.set(parse_bridge_nodes(&value));
                        notice.set(String::new());
                    }
                    Err(err) => {
                        files.set(Vec::new());
                        notice.set(err);
                    }
                }
            });
        }
    }
}

#[component]
pub fn WorkspacePage(mut snapshot: Signal<AppSnapshot>, goal: Signal<String>) -> Element {
    let mut mode = use_signal(|| WorkspaceMode::Browser);
    let files = use_signal(Vec::<FileNode>::new);
    let mut selected = use_signal(|| Option::<String>::None);
    let mut editor = use_signal(String::new);
    let mut dirty = use_signal(|| false);
    let mut new_path = use_signal(String::new);
    let mut command = use_signal(|| "bun test".to_string());
    let mut terminal = use_signal(String::new);
    let mut notice = use_signal(String::new);
    let mut busy = use_signal(|| false);

    // Reload the tree on mount and whenever the mode changes.
    use_effect(move || {
        let active = mode();
        refresh_tree(snapshot, active, files, notice);
    });

    let active_mode = mode();
    let running = snapshot
        .read()
        .current_run
        .as_ref()
        .is_some_and(|run| run.status == RunStatus::Running);
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
                    div { class: "mode-toggle",
                        for option in [WorkspaceMode::Browser, WorkspaceMode::Bridge] {
                            button {
                                key: "{option.label()}",
                                class: if active_mode == option { "chip-button active" } else { "chip-button" },
                                onclick: move |_| {
                                    mode.set(option);
                                    selected.set(None);
                                    editor.set(String::new());
                                    dirty.set(false);
                                },
                                "{option.label()}"
                            }
                        }
                    }
                    button {
                        class: "ghost-button",
                        onclick: move |_| refresh_tree(snapshot, active_mode, files, notice),
                        "Refresh"
                    }
                }
            }
            p { class: "workspace-hint",
                match active_mode {
                    WorkspaceMode::Browser => rsx! {
                        "Browser mode: files live in this tab and code runs natively in a sandboxed Web Worker — no bridge or install needed. Create a file, write JavaScript, and press Run."
                    },
                    WorkspaceMode::Bridge => rsx! {
                        "Bridge mode: files and commands run on a local bridge. Start it with "
                        code { "node scripts/askk-local-bridge.mjs --allow-exec" }
                        " to run real bun/node projects on disk."
                    },
                }
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
                            placeholder: "new/file.js",
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
                                notice.set(format!("New file {path}. Edit and Save to store it."));
                            },
                            "New"
                        }
                    }
                    div { class: "workspace-tree-list",
                        if nodes.is_empty() {
                            div { class: "workspace-empty", "No files yet. Create one, or ask the agent to scaffold a project." }
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
                                                selected.set(Some(path.clone()));
                                                notice.set(format!("Opening {path}…"));
                                                open_file(snapshot, active_mode, path, editor, dirty, notice);
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
                                notice.set(format!("Saving {path}…"));
                                save_file(snapshot, active_mode, path, content, dirty, files, notice);
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
                div { class: "workspace-terminal-head",
                    match active_mode {
                        WorkspaceMode::Browser => "Output — in-browser JavaScript",
                        WorkspaceMode::Bridge => "Terminal — bridge run root",
                    }
                }
                match active_mode {
                    WorkspaceMode::Browser => rsx! {
                        div { class: "workspace-command-row",
                            button {
                                disabled: busy() || selected.read().is_none(),
                                onclick: move |_| {
                                    if busy() { return; }
                                    let code = editor.read().clone();
                                    let label = selected.read().clone().unwrap_or_else(|| "snippet".to_string());
                                    busy.set(true);
                                    terminal.with_mut(|log| log.push_str(&format!("> run {label}\n")));
                                    spawn_local(async move {
                                        match run_js_in_browser(&code, 10_000).await {
                                            Ok(value) => {
                                                let (_ok, text) = format_run_js(&value);
                                                terminal.with_mut(|log| { log.push_str(&text); log.push_str("\n\n"); });
                                            }
                                            Err(err) => terminal.with_mut(|log| log.push_str(&format!("error: {err}\n\n"))),
                                        }
                                        busy.set(false);
                                    });
                                },
                                if busy() { "Running…" } else { "Run file" }
                            }
                            button {
                                class: "ghost-button",
                                onclick: move |_| terminal.set(String::new()),
                                "Clear"
                            }
                        }
                    },
                    WorkspaceMode::Bridge => rsx! {
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
                                    refresh_tree(snapshot, WorkspaceMode::Bridge, files, notice);
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
                    },
                }
                pre { class: "workspace-terminal-output", "{terminal_text}" }
            }

            div { class: "workspace-agent",
                div { class: "workspace-agent-head", "Coding agent" }
                p { class: "workspace-hint",
                    "Describe a task. The agent writes files, runs them with run_js, and reports complete only after a verification check passes. Full transcript is on the Chat page."
                }
                if let Some(answer) = last_answer.as_ref() {
                    div { class: "workspace-agent-answer", "{answer}" }
                }
                form {
                    class: "workspace-command-row",
                    onsubmit: move |event| {
                        event.prevent_default();
                        submit_workspace_goal(snapshot, goal, active_mode, files, notice);
                    },
                    textarea {
                        class: "workspace-input",
                        placeholder: "e.g. Write add(a,b) in add.js and a check that logs PASS only if add(2,3)===5, then run it.",
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

fn open_file(
    snapshot: Signal<AppSnapshot>,
    mode: WorkspaceMode,
    path: String,
    mut editor: Signal<String>,
    mut dirty: Signal<bool>,
    mut notice: Signal<String>,
) {
    spawn_local(async move {
        let result = match mode {
            WorkspaceMode::Browser => ProjectVfs::new()
                .read_file(&path)
                .await
                .map(|content| content.unwrap_or_default()),
            WorkspaceMode::Bridge => {
                let config = snapshot.read().tool_config.web_search.clone();
                bridge_fs_read(&config, &path).await
            }
        };
        match result {
            Ok(content) => {
                editor.set(content);
                dirty.set(false);
                notice.set(String::new());
            }
            Err(err) => notice.set(err),
        }
    });
}

fn save_file(
    snapshot: Signal<AppSnapshot>,
    mode: WorkspaceMode,
    path: String,
    content: String,
    mut dirty: Signal<bool>,
    files: Signal<Vec<FileNode>>,
    mut notice: Signal<String>,
) {
    spawn_local(async move {
        let result = match mode {
            WorkspaceMode::Browser => ProjectVfs::new().write_file(&path, &content).await,
            WorkspaceMode::Bridge => {
                let config = snapshot.read().tool_config.web_search.clone();
                bridge_fs_write(&config, &path, &content).await
            }
        };
        match result {
            Ok(()) => {
                dirty.set(false);
                notice.set(format!("Saved {path}."));
                refresh_tree(snapshot, mode, files, notice);
            }
            Err(err) => notice.set(err),
        }
    });
}

fn submit_workspace_goal(
    mut snapshot: Signal<AppSnapshot>,
    mut goal: Signal<String>,
    mode: WorkspaceMode,
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
        .is_some_and(|run| run.status == RunStatus::Running)
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
        // Show whatever the agent wrote.
        refresh_tree(snapshot, mode, files, notice);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn synthesizes_directory_nodes_from_flat_paths() {
        let nodes = nodes_from_paths(vec!["src/lib/add.js".to_string(), "README.md".to_string()]);
        let paths: Vec<(&str, bool)> = nodes
            .iter()
            .map(|node| (node.path.as_str(), node.is_dir))
            .collect();
        assert!(paths.contains(&("src", true)));
        assert!(paths.contains(&("src/lib", true)));
        assert!(paths.contains(&("src/lib/add.js", false)));
        assert!(paths.contains(&("README.md", false)));
    }
}
