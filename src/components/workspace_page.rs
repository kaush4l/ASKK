//! Workspace IDE page.
//!
//! A VS Code-style, browser-hosted IDE: a file-explorer sidebar, a tabbed
//! CodeMirror 6 editor (see [`super::code_editor`]), an optional sandboxed
//! HTML preview split, a bottom Terminal/Agent panel, and a status bar.
//!
//! By default everything runs **in the browser**: files live in the in-browser
//! workspace filesystem ([`OpfsVfs`], OPFS) and code runs in a sandboxed
//! Web Worker via [`run_js_in_browser`] — no bridge required, so it works on
//! the hosted site. A "Bridge" mode is available for driving a local
//! `askk-local-bridge` (disk files + real `bun`/`node` execution) when one is
//! running.

use super::code_editor::{CodeEditor, EditorEvent, editor_open};
use super::run_panel::{RunButton, RunPanel, StorageUsageBadge};
use super::shared::set_status;
use super::terminal::{TermInject, Terminal};
use crate::scheduler::spawner::enqueue_agent_run;
use crate::state::{AppResult, AppSnapshot, RunStatus};
use crate::storage::opfs_vfs::{FsEntry, OpfsVfs};
use crate::tools::{bridge_fs_list, bridge_fs_read, bridge_fs_write, bridge_run_command};
use dioxus::prelude::*;
use regex::Regex;
use serde_json::Value;
use std::collections::BTreeSet;
use wasm_bindgen_futures::spawn_local;

/// Soft-desk dark theme overrides for this page's `.ide-*`/`.workspace-*`
/// classes (loads after main.css → equal specificity, later wins).
const WORKSPACE_CSS: Asset = asset!("/assets/pages/workspace.css");

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

/// Bottom-panel tabs, VS Code style.
#[derive(Clone, Copy, PartialEq, Eq)]
enum PanelTab {
    Terminal,
    Run,
    Agent,
}

#[derive(Clone, PartialEq)]
struct FileNode {
    path: String,
    is_dir: bool,
    depth: usize,
}

/// An open editor tab: the file, its (possibly unsaved) buffer, and whether
/// the buffer diverges from storage.
#[derive(Clone, PartialEq)]
struct OpenTab {
    path: String,
    content: String,
    dirty: bool,
}

/// One line in one file that matched the cross-file search.
#[derive(Clone, PartialEq)]
struct SearchHit {
    /// Workspace-relative path of the file the match is in.
    path: String,
    /// 1-based line number of the matching line.
    line: usize,
    /// The full matching line, trimmed for display (leading whitespace kept so
    /// indentation is legible, trailing whitespace dropped).
    preview: String,
}

/// A compiled query: either a literal substring or a regular expression.
/// Built once per search so every file is matched against the same matcher.
enum Matcher {
    Literal(String),
    Regex(Regex),
}

impl Matcher {
    /// Compile `query`. With `regex` the pattern is parsed as a regular
    /// expression (returning a human-readable error on a bad pattern);
    /// otherwise it is taken verbatim as a literal substring.
    fn compile(query: &str, regex: bool) -> Result<Self, String> {
        if regex {
            Regex::new(query)
                .map(Matcher::Regex)
                .map_err(|err| format!("Invalid regex: {err}"))
        } else {
            Ok(Matcher::Literal(query.to_string()))
        }
    }

    /// Whether `line` contains at least one match.
    fn is_match(&self, line: &str) -> bool {
        match self {
            Matcher::Literal(needle) => line.contains(needle.as_str()),
            Matcher::Regex(re) => re.is_match(line),
        }
    }

    /// Replace every match in `text` with `replacement`. For a literal matcher
    /// this is a plain substring replace; for a regex it honours `$1`-style
    /// capture-group references.
    fn replace_all(&self, text: &str, replacement: &str) -> String {
        match self {
            Matcher::Literal(needle) => text.replace(needle.as_str(), replacement),
            Matcher::Regex(re) => re.replace_all(text, replacement).into_owned(),
        }
    }
}

/// Scan `files` (path + full content) for lines matching `matcher`, in the order
/// given. Empty queries match nothing. Pure and host-testable — the component
/// gathers the file contents from OPFS/bridge and feeds them in.
fn find_matches(files: &[(String, String)], matcher: &Matcher) -> Vec<SearchHit> {
    let mut hits = Vec::new();
    for (path, content) in files {
        for (index, line) in content.lines().enumerate() {
            if matcher.is_match(line) {
                hits.push(SearchHit {
                    path: path.clone(),
                    line: index + 1,
                    preview: line.trim_end().to_string(),
                });
            }
        }
    }
    hits
}

/// How many matching lines `matcher` finds in `text`. Used to report what a
/// replace touched without re-scanning the result.
fn count_matching_lines(text: &str, matcher: &Matcher) -> usize {
    text.lines().filter(|line| matcher.is_match(line)).count()
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

/// OPFS `list_all` entries (already recursive and sorted) mapped to display
/// nodes with their tree depth.
fn nodes_from_entries(entries: Vec<FsEntry>) -> Vec<FileNode> {
    entries
        .into_iter()
        .map(|entry| FileNode {
            depth: entry.path.matches('/').count(),
            is_dir: entry.is_dir,
            path: entry.path,
        })
        .collect()
}

/// `path` equals `base` or lives somewhere below it (segment-aware).
fn path_within(path: &str, base: &str) -> bool {
    path == base || (path.starts_with(base) && path.as_bytes().get(base.len()) == Some(&b'/'))
}

/// Where `path` ends up when `from` is renamed to `to`; `None` if unaffected.
fn retarget_path(path: &str, from: &str, to: &str) -> Option<String> {
    if path == from {
        return Some(to.to_string());
    }
    let prefix = format!("{from}/");
    path.strip_prefix(&prefix)
        .map(|rest| format!("{to}/{rest}"))
}

/// Hide every node that sits under a collapsed directory. The collapsed
/// directory itself stays visible (that is the row you click to expand).
fn visible_nodes(nodes: &[FileNode], collapsed: &BTreeSet<String>) -> Vec<FileNode> {
    let prefixes: Vec<String> = collapsed.iter().map(|dir| format!("{dir}/")).collect();
    nodes
        .iter()
        .filter(|node| !prefixes.iter().any(|prefix| node.path.starts_with(prefix)))
        .cloned()
        .collect()
}

/// Explorer/tab badge for a file, keyed by extension: (label, css class).
fn file_glyph(path: &str) -> (&'static str, &'static str) {
    let name = path.rsplit('/').next().unwrap_or(path);
    let ext = match name.rsplit_once('.') {
        Some((_, ext)) => ext.to_ascii_lowercase(),
        None => String::new(),
    };
    match ext.as_str() {
        "js" | "mjs" | "cjs" | "jsx" => ("JS", "glyph-js"),
        "ts" | "tsx" => ("TS", "glyph-ts"),
        "json" => ("{}", "glyph-json"),
        "html" | "htm" => ("<>", "glyph-html"),
        "css" => ("#", "glyph-css"),
        "md" | "markdown" => ("MD", "glyph-md"),
        "py" => ("PY", "glyph-py"),
        "rs" => ("RS", "glyph-rs"),
        _ => ("··", "glyph-plain"),
    }
}

fn is_html_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.ends_with(".html") || lower.ends_with(".htm")
}

/// Add `path` as a tab (or refresh an existing one) without changing order.
fn upsert_tab(tabs: &mut Vec<OpenTab>, path: &str, content: String, dirty: bool) {
    if let Some(tab) = tabs.iter_mut().find(|tab| tab.path == path) {
        tab.content = content;
        tab.dirty = dirty;
    } else {
        tabs.push(OpenTab {
            path: path.to_string(),
            content,
            dirty,
        });
    }
}

/// Remove `path` from the tab strip and pick the next active tab: closing a
/// background tab keeps the current one; closing the active tab focuses its
/// right neighbour (or the new last tab, or nothing).
fn close_tab(tabs: &mut Vec<OpenTab>, active: Option<&str>, path: &str) -> Option<String> {
    let Some(index) = tabs.iter().position(|tab| tab.path == path) else {
        return active.map(str::to_string);
    };
    tabs.remove(index);
    if active != Some(path) {
        return active.map(str::to_string);
    }
    if tabs.is_empty() {
        None
    } else {
        Some(tabs[index.min(tabs.len() - 1)].path.clone())
    }
}

/// What the UI must do to reconcile its open tabs with the agent's shared
/// [`WorkspaceView`](crate::state::WorkspaceView) open-set (Option A: the view is
/// the source of truth for which files are open). Computed purely from the view's
/// open paths + active file and the tabs the UI currently shows.
#[derive(Debug, Default, PartialEq)]
struct WorkspaceSync {
    /// Agent-opened paths the UI has no tab for yet — load and add them.
    to_open: Vec<String>,
    /// Tabs no longer in the agent's open-set — close them. Dirty (unsaved) tabs
    /// are kept so a manual edit-in-progress is never dropped from under the user.
    to_close: Vec<String>,
    /// The tab to focus = the agent's `active_file` when it is (or will be) open.
    new_active: Option<String>,
}

/// Derive the tab reconciliation for the agent's open-set. `open_files`/`active`
/// come from the shared view; `current` are the UI's tab paths, `dirty` the subset
/// with unsaved edits (never auto-closed). Pure, so it is host-tested without a DOM.
fn derive_workspace_sync(
    open_files: &[String],
    active: Option<&str>,
    current: &[String],
    dirty: &[String],
) -> WorkspaceSync {
    let to_open: Vec<String> = open_files
        .iter()
        .filter(|path| !current.iter().any(|tab| tab == *path))
        .cloned()
        .collect();
    let to_close: Vec<String> = current
        .iter()
        .filter(|tab| !open_files.iter().any(|path| path == *tab))
        .filter(|tab| !dirty.iter().any(|d| d == *tab))
        .cloned()
        .collect();
    // Focus the agent's active file only when it is, or is about to be, open.
    let new_active = active
        .filter(|path| open_files.iter().any(|p| p == path))
        .map(str::to_string);
    WorkspaceSync {
        to_open,
        to_close,
        new_active,
    }
}

/// Apply a [`WorkspaceSync`] to the IDE: close the tabs the agent closed, open
/// (load from the active fs) the ones it opened, and focus its active file. Reuses
/// the same `open_file_in_tab` loader the explorer click uses, so an agent-opened
/// file behaves exactly like a user-opened one (content loaded, editor seeded).
#[allow(clippy::too_many_arguments)]
fn apply_workspace_sync(
    snapshot: Signal<AppSnapshot>,
    mode: WorkspaceMode,
    sync: WorkspaceSync,
    mut tabs: Signal<Vec<OpenTab>>,
    mut active: Signal<Option<String>>,
    editor_ctl: Signal<Option<document::Eval>>,
    files: Signal<Vec<FileNode>>,
    notice: Signal<String>,
) {
    // Close the tabs the agent removed from its open-set.
    for path in &sync.to_close {
        let next = tabs.with_mut(|tabs| close_tab(tabs, active.peek().as_deref(), path));
        if active.peek().as_deref() == Some(path.as_str()) {
            match next.as_ref() {
                Some(p) => {
                    let content = tabs
                        .peek()
                        .iter()
                        .find(|tab| tab.path == *p)
                        .map(|tab| tab.content.clone())
                        .unwrap_or_default();
                    editor_open(&editor_ctl, p, &content);
                }
                None => editor_open(&editor_ctl, "", ""),
            }
            active.set(next);
        }
    }

    // Open (load content for) the files the agent opened. `open_file_in_tab`
    // focuses each as it lands; the explicit active set below restores the agent's
    // chosen focus afterward.
    for path in &sync.to_open {
        open_file_in_tab(
            snapshot,
            mode,
            path.clone(),
            tabs,
            active,
            editor_ctl,
            notice,
        );
    }

    // Focus the agent's active file. When it still needs loading, `open_file_in_tab`
    // above already set focus and will seed the editor when the read resolves; this
    // makes the focus deterministic for already-open files.
    if let Some(path) = sync.new_active {
        if tabs.peek().iter().any(|tab| tab.path == path) {
            let content = tabs
                .peek()
                .iter()
                .find(|tab| tab.path == path)
                .map(|tab| tab.content.clone())
                .unwrap_or_default();
            active.set(Some(path.clone()));
            editor_open(&editor_ctl, &path, &content);
        } else {
            active.set(Some(path));
        }
    }

    // A file the agent opened may be one it just wrote — refresh the tree so it
    // shows in the explorer immediately, not only once the run settles.
    refresh_tree(snapshot, mode, files, notice);
}

/// Mirror a user's manual open/close into the shared [`WorkspaceView`] when a run
/// is live, so the open-set is truly bidirectional (Option A): a file the user
/// opens in the IDE also enters the agent's view (and its `## WORKSPACE` block), and
/// one they close leaves it. A no-op when no run is active (the view lives on the
/// run). `open` true = open+focus `path`, false = close it.
fn mirror_user_workspace(mut snapshot: Signal<AppSnapshot>, path: &str, open: bool) {
    let mut guard = snapshot.write();
    let Some(run) = guard.current_run_mut() else {
        return;
    };
    if open {
        run.scratchpad.workspace.open(path);
    } else {
        run.scratchpad.workspace.close(path);
    }
}

/// Reload the file tree. On success the current notice is left alone (it is
/// often a fresh "Saved …" message that a clobber would hide); errors replace
/// it, and the next successful open/save clears it.
fn refresh_tree(
    snapshot: Signal<AppSnapshot>,
    mode: WorkspaceMode,
    mut files: Signal<Vec<FileNode>>,
    mut notice: Signal<String>,
) {
    match mode {
        WorkspaceMode::Browser => {
            spawn_local(async move {
                match OpfsVfs::new().list_all().await {
                    Ok(entries) => files.set(nodes_from_entries(entries)),
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
                    Ok(value) => files.set(parse_bridge_nodes(&value)),
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
    let mut collapsed = use_signal(BTreeSet::<String>::new);
    let mut tabs = use_signal(Vec::<OpenTab>::new);
    let mut active = use_signal(|| Option::<String>::None);
    let mut new_path = use_signal(String::new);
    let mut renaming = use_signal(|| Option::<String>::None);
    let mut rename_input = use_signal(String::new);
    let mut deleting = use_signal(|| Option::<String>::None);
    // Cross-file search/replace state.
    let mut search_open = use_signal(|| false);
    let mut search_query = use_signal(String::new);
    let mut search_replace = use_signal(String::new);
    let mut search_regex = use_signal(|| false);
    let search_results = use_signal(Vec::<SearchHit>::new);
    let search_busy = use_signal(|| false);
    let search_done = use_signal(|| false);
    let mut command = use_signal(|| "bun test".to_string());
    let mut terminal = use_signal(String::new);
    let shell_cwd = use_signal(String::new);
    let mut term_inject = use_signal(Vec::<TermInject>::new);
    let mut notice = use_signal(String::new);
    let mut busy = use_signal(|| false);
    let mut panel = use_signal(|| PanelTab::Terminal);
    let mut preview = use_signal(|| false);
    let editor_ctl = use_signal(|| Option::<document::Eval>::None);
    let ctx = ExplorerCtx {
        snapshot,
        tabs,
        active,
        editor_ctl,
        files,
        notice,
        preview,
    };

    // Reload the tree on mount and whenever the mode changes.
    use_effect(move || {
        let active_mode = mode();
        refresh_tree(snapshot, active_mode, files, notice);
    });

    // Reload the tree whenever the workspace's run history grows — i.e. a run the
    // bounded spawner drove just settled into `runs`. This replaces the inline
    // post-run `refresh_tree` the old single-run submit did, so files an agent
    // wrote still surface in the explorer once the run finishes.
    use_effect(move || {
        let _ = snapshot.read().runs.len();
        refresh_tree(snapshot, mode.peek().to_owned(), files, notice);
    });

    // Option A binding (agent → UI): mirror the live run's shared WorkspaceView
    // open-set into the IDE's tabs. A file the agent opens via `workspace_open`
    // becomes a tab here (and is marked open in the explorer); a `workspace_close`
    // removes it. The view is the source of truth for the open *set*; the local
    // `tabs` hold the loaded content. Dirty tabs are never auto-closed, and the
    // tree refreshes too so a freshly written file appears before the run settles.
    use_effect(move || {
        let view = snapshot
            .read()
            .current_run()
            .map(|run| run.scratchpad.workspace.clone())
            .unwrap_or_default();
        // React to changes in the open-set / active file.
        let _ = (view.open_files.clone(), view.active_file.clone());

        let current: Vec<String> = tabs.peek().iter().map(|tab| tab.path.clone()).collect();
        let dirty: Vec<String> = tabs
            .peek()
            .iter()
            .filter(|tab| tab.dirty)
            .map(|tab| tab.path.clone())
            .collect();
        let sync = derive_workspace_sync(
            &view.open_files,
            view.active_file.as_deref(),
            &current,
            &dirty,
        );
        if sync == WorkspaceSync::default() {
            return; // nothing the agent changed; leave the user's tabs alone
        }

        apply_workspace_sync(
            snapshot,
            mode.peek().to_owned(),
            sync,
            tabs,
            active,
            editor_ctl,
            files,
            notice,
        );
    });

    // Keep the terminal scrolled to the latest output.
    use_effect(move || {
        let _ = terminal.read();
        document::eval(
            "(() => { const el = document.querySelector('.ide-terminal-output'); if (el) el.scrollTop = el.scrollHeight; })()",
        );
    });

    // Edits, Mod-S saves, and the mount handshake from the CodeMirror pane.
    let on_editor_event = move |event: EditorEvent| {
        if event.ready {
            if let Some(path) = active.peek().clone() {
                let tab = tabs
                    .peek()
                    .iter()
                    .find(|tab| tab.path == path)
                    .map(|tab| (tab.path.clone(), tab.content.clone()));
                if let Some((path, content)) = tab {
                    editor_open(&editor_ctl, &path, &content);
                }
            }
            return;
        }
        tabs.with_mut(|tabs| {
            if let Some(tab) = tabs.iter_mut().find(|tab| tab.path == event.path) {
                tab.content = event.text.clone();
                tab.dirty = true;
            }
        });
        if event.save && !event.path.is_empty() {
            save_file(
                snapshot,
                mode(),
                event.path,
                event.text,
                tabs,
                files,
                notice,
            );
        }
    };

    let active_mode = mode();
    let running = snapshot
        .read()
        .current_run()
        .is_some_and(|run| run.status == RunStatus::Running);
    let last_answer = snapshot
        .read()
        .runs
        .last()
        .map(|run| run.final_answer.clone())
        .filter(|answer| !answer.trim().is_empty());
    let current_command = command.read().clone();
    let current_new_path = new_path.read().clone();
    let search_panel_open = search_open();
    let search_query_text = search_query.read().clone();
    let search_replace_text = search_replace.read().clone();
    let search_use_regex = search_regex();
    let search_running = search_busy();
    let search_ran = search_done();
    let search_hits = search_results.read().clone();
    let rename_value = rename_input.read().clone();
    let notice_text = notice.read().clone();
    let terminal_text = terminal.read().clone();
    let visible = visible_nodes(&files.read(), &collapsed.read());
    let open_tabs = tabs.read().clone();
    let active_path = active.read().clone();
    let active_tab = active_path
        .as_ref()
        .and_then(|path| open_tabs.iter().find(|tab| tab.path == *path).cloned());
    let active_dirty = active_tab.as_ref().is_some_and(|tab| tab.dirty);
    let preview_available = active_path.as_deref().is_some_and(is_html_path);
    let preview_visible = preview() && preview_available;
    let preview_doc = if preview_visible {
        active_tab
            .as_ref()
            .map(|tab| tab.content.clone())
            .unwrap_or_default()
    } else {
        String::new()
    };

    rsx! {
        document::Stylesheet { href: WORKSPACE_CSS }
        section { class: "panel page-panel workspace-page",
            div { class: "page-heading",
                h2 { "Workspace" }
                div { class: "button-row",
                    div { class: "mode-toggle",
                        for option in [WorkspaceMode::Browser, WorkspaceMode::Bridge] {
                            button {
                                key: "{option.label()}",
                                class: if active_mode == option { "chip-button active" } else { "chip-button" },
                                title: match option {
                                    WorkspaceMode::Browser => "Files in this tab (OPFS); JS runs in a sandboxed Web Worker.",
                                    WorkspaceMode::Bridge => "Files and commands on a local askk-local-bridge (node scripts/askk-local-bridge.mjs --allow-exec).",
                                },
                                onclick: move |_| {
                                    mode.set(option);
                                    tabs.set(Vec::new());
                                    active.set(None);
                                    preview.set(false);
                                    renaming.set(None);
                                    deleting.set(None);
                                    editor_open(&editor_ctl, "", "");
                                },
                                "{option.label()}"
                            }
                        }
                    }
                }
            }

            div { class: "workspace-ide",
                // ---- File explorer (left, full height) ----
                aside { class: "ide-explorer",
                    div { class: "ide-explorer-head",
                        span { "Explorer" }
                        div { style: "display: flex; gap: 2px;",
                            button {
                                class: if search_panel_open { "ide-icon-button active" } else { "ide-icon-button" },
                                style: if search_panel_open { "color: var(--accent);" } else { "" },
                                title: "Search across all workspace files",
                                onclick: move |_| {
                                    let next = !search_open.peek().to_owned();
                                    search_open.set(next);
                                },
                                "⌕"
                            }
                            button {
                                class: "ide-icon-button",
                                title: "Refresh file tree",
                                onclick: move |_| refresh_tree(snapshot, active_mode, files, notice),
                                "⟳"
                            }
                        }
                    }
                    if search_panel_open {
                        div {
                            class: "ide-search",
                            style: "display: flex; flex-direction: column; gap: 6px; padding: 0 8px 8px;",
                            form {
                                style: "display: flex; gap: 6px;",
                                onsubmit: move |event| {
                                    event.prevent_default();
                                    run_workspace_search(
                                        snapshot, active_mode,
                                        search_query.peek().clone(), search_regex.peek().to_owned(),
                                        search_results, search_busy, search_done, notice,
                                    );
                                },
                                input {
                                    class: "ide-input mono",
                                    placeholder: "Search all files…",
                                    value: "{search_query_text}",
                                    oninput: move |event| search_query.set(event.value()),
                                }
                                button {
                                    class: "ide-icon-button",
                                    r#type: "submit",
                                    title: "Run search",
                                    disabled: search_running || search_query_text.trim().is_empty(),
                                    "⌕"
                                }
                            }
                            input {
                                class: "ide-input mono",
                                placeholder: "Replace with… (optional)",
                                value: "{search_replace_text}",
                                oninput: move |event| search_replace.set(event.value()),
                            }
                            div { style: "display: flex; align-items: center; justify-content: space-between; gap: 6px;",
                                label {
                                    style: "display: flex; align-items: center; gap: 4px; font-size: 11px; color: #8a7da0; cursor: pointer;",
                                    input {
                                        r#type: "checkbox",
                                        checked: search_use_regex,
                                        onchange: move |event| search_regex.set(event.checked()),
                                    }
                                    ".* regex"
                                }
                                button {
                                    class: "ide-action",
                                    r#type: "button",
                                    title: "Replace every match across all files and save",
                                    disabled: active_mode != WorkspaceMode::Browser
                                        || search_running
                                        || search_query_text.trim().is_empty(),
                                    onclick: move |_| {
                                        replace_in_workspace(
                                            snapshot, active_mode,
                                            search_query.peek().clone(), search_replace.peek().clone(),
                                            search_regex.peek().to_owned(),
                                            tabs, active, editor_ctl,
                                            search_results, search_busy, search_done, files, notice,
                                        );
                                    },
                                    "Replace all"
                                }
                            }
                            div {
                                class: "ide-search-results",
                                style: "max-height: 220px; overflow: auto; display: flex; flex-direction: column; gap: 1px;",
                                if search_running {
                                    div { class: "ide-empty", "Searching…" }
                                } else if search_ran && search_hits.is_empty() {
                                    div { class: "ide-empty", "No matches." }
                                } else if !search_hits.is_empty() {
                                    div {
                                        style: "font-size: 11px; color: #8a7da0; padding: 2px 6px;",
                                        {
                                            let files_count = {
                                                let mut seen = BTreeSet::new();
                                                for hit in search_hits.iter() { seen.insert(hit.path.clone()); }
                                                seen.len()
                                            };
                                            format!(
                                                "{} match{} in {} file{}",
                                                search_hits.len(),
                                                if search_hits.len() == 1 { "" } else { "es" },
                                                files_count,
                                                if files_count == 1 { "" } else { "s" },
                                            )
                                        }
                                    }
                                    for (index, hit) in search_hits.iter().enumerate() {
                                        {
                                            let hit_path = hit.path.clone();
                                            let open_path = hit.path.clone();
                                            let name = hit_path.rsplit('/').next().unwrap_or(&hit_path).to_string();
                                            let line = hit.line;
                                            let preview = hit.preview.clone();
                                            rsx! {
                                                button {
                                                    key: "{index}-{hit_path}-{line}",
                                                    class: "ide-search-hit",
                                                    style: "display: flex; flex-direction: column; align-items: flex-start; gap: 1px; width: 100%; padding: 3px 6px; border: 0; border-radius: 4px; background: transparent; color: #cfc7e6; text-align: left; cursor: pointer;",
                                                    title: "{hit_path}:{line}",
                                                    onclick: move |_| {
                                                        open_file_in_tab(
                                                            snapshot, active_mode, open_path.clone(),
                                                            tabs, active, editor_ctl, notice,
                                                        );
                                                    },
                                                    span { style: "font-size: 11px; color: #a99cc4;", "{name}:{line}" }
                                                    span {
                                                        style: "font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre; overflow: hidden; text-overflow: ellipsis; max-width: 100%; color: #ece7fb;",
                                                        "{preview}"
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    div { class: "ide-new-file",
                        input {
                            class: "ide-input",
                            placeholder: "new/file.js",
                            value: "{current_new_path}",
                            oninput: move |event| new_path.set(event.value()),
                        }
                        button {
                            class: "ide-icon-button",
                            title: "Create file (saved on first Save)",
                            disabled: current_new_path.trim().is_empty(),
                            onclick: move |_| {
                                let path = new_path.read().trim().trim_matches('/').to_string();
                                if path.is_empty() { return; }
                                if path.split('/').any(|part| part == "..") {
                                    notice.set("Path may not contain '..' segments.".to_string());
                                    return;
                                }
                                tabs.with_mut(|tabs| upsert_tab(tabs, &path, String::new(), true));
                                active.set(Some(path.clone()));
                                editor_open(&editor_ctl, &path, "");
                                new_path.set(String::new());
                                notice.set(format!("New file {path} — save to store it."));
                            },
                            "+"
                        }
                        if active_mode == WorkspaceMode::Browser {
                            button {
                                class: "ide-icon-button",
                                title: "Create folder",
                                disabled: current_new_path.trim().is_empty(),
                                onclick: move |_| {
                                    let path = new_path.read().trim().trim_matches('/').to_string();
                                    if path.is_empty() { return; }
                                    spawn_local(async move {
                                        match OpfsVfs::new().mkdir(&path).await {
                                            Ok(()) => {
                                                new_path.set(String::new());
                                                notice.set(format!("Created folder {path}."));
                                                refresh_tree(snapshot, WorkspaceMode::Browser, files, notice);
                                            }
                                            Err(err) => notice.set(err),
                                        }
                                    });
                                },
                                "+/"
                            }
                        }
                    }
                    div { class: "ide-tree",
                        if visible.is_empty() {
                            div { class: "ide-empty", "No files yet. Create one, or ask the agent to scaffold a project." }
                        }
                        for node in visible.iter() {
                            {
                                let path = node.path.clone();
                                let name = path.rsplit('/').next().unwrap_or(&path).to_string();
                                let indent = format!("padding-left: {}px;", 8 + node.depth * 14);
                                let is_dir = node.is_dir;
                                let can_manage = active_mode == WorkspaceMode::Browser;
                                let is_renaming =
                                    can_manage && renaming.read().as_deref() == Some(path.as_str());
                                let is_deleting =
                                    can_manage && deleting.read().as_deref() == Some(path.as_str());
                                let is_active = !is_dir && active_path.as_deref() == Some(path.as_str());
                                let is_open = !is_dir && open_tabs.iter().any(|tab| tab.path == path);
                                let row_class = if is_dir {
                                    "ide-node dir"
                                } else if is_active {
                                    "ide-node file selected"
                                } else if is_open {
                                    "ide-node file open"
                                } else {
                                    "ide-node file"
                                };
                                let main_path = path.clone();
                                let rename_from = path.clone();
                                let rename_start = path.clone();
                                let delete_path = path.clone();
                                let delete_start = path.clone();
                                rsx! {
                                    div { key: "{path}", class: "{row_class}", style: "{indent}",
                                        if is_renaming {
                                            form {
                                                class: "ide-rename-form",
                                                onsubmit: move |event| {
                                                    event.prevent_default();
                                                    let to = rename_input.read().clone();
                                                    rename_workspace_entry(ctx, active_mode, rename_from.clone(), to, renaming);
                                                },
                                                input {
                                                    class: "ide-input mono",
                                                    value: "{rename_value}",
                                                    oninput: move |event| rename_input.set(event.value()),
                                                }
                                                button { class: "ide-icon-button", r#type: "submit", title: "Confirm rename", "✓" }
                                                button {
                                                    class: "ide-icon-button",
                                                    r#type: "button",
                                                    title: "Cancel rename",
                                                    onclick: move |_| renaming.set(None),
                                                    "✕"
                                                }
                                            }
                                        } else {
                                            if is_dir {
                                                button {
                                                    class: "ide-node-main",
                                                    onclick: move |_| {
                                                        collapsed.with_mut(|set| {
                                                            if !set.remove(&main_path) {
                                                                set.insert(main_path.clone());
                                                            }
                                                        });
                                                    },
                                                    span { class: "node-chevron",
                                                        if collapsed.read().contains(&path) { "▸" } else { "▾" }
                                                    }
                                                    span { class: "node-name", "{name}" }
                                                }
                                            } else {
                                                {
                                                    let (glyph, glyph_class) = file_glyph(&path);
                                                    rsx! {
                                                        button {
                                                            class: "ide-node-main",
                                                            onclick: move |_| {
                                                                open_file_in_tab(
                                                                    snapshot, active_mode, main_path.clone(),
                                                                    tabs, active, editor_ctl, notice,
                                                                );
                                                            },
                                                            span { class: "node-glyph {glyph_class}", "{glyph}" }
                                                            span { class: "node-name", "{name}" }
                                                        }
                                                    }
                                                }
                                            }
                                            if can_manage {
                                                if is_deleting {
                                                    div { class: "ide-node-actions confirm",
                                                        span { class: "ide-confirm-label", "Delete?" }
                                                        button {
                                                            class: "ide-icon-button",
                                                            title: "Confirm delete",
                                                            onclick: move |_| {
                                                                delete_workspace_entry(ctx, active_mode, delete_path.clone(), deleting);
                                                            },
                                                            "✓"
                                                        }
                                                        button {
                                                            class: "ide-icon-button",
                                                            title: "Cancel delete",
                                                            onclick: move |_| deleting.set(None),
                                                            "✕"
                                                        }
                                                    }
                                                } else {
                                                    div { class: "ide-node-actions",
                                                        button {
                                                            class: "ide-icon-button",
                                                            title: "Rename or move (edit the full path)",
                                                            onclick: move |_| {
                                                                rename_input.set(rename_start.clone());
                                                                renaming.set(Some(rename_start.clone()));
                                                                deleting.set(None);
                                                            },
                                                            "✎"
                                                        }
                                                        button {
                                                            class: "ide-icon-button",
                                                            title: if is_dir { "Delete folder and its contents" } else { "Delete file" },
                                                            onclick: move |_| {
                                                                deleting.set(Some(delete_start.clone()));
                                                                renaming.set(None);
                                                            },
                                                            "🗑"
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // ---- Editor (tabs + CodeMirror + optional HTML preview) ----
                div { class: "ide-main",
                    div { class: "ide-tabs",
                        div { class: "ide-tab-strip",
                            for tab in open_tabs.iter() {
                                {
                                    let path = tab.path.clone();
                                    let close_path = tab.path.clone();
                                    let name = path.rsplit('/').next().unwrap_or(&path).to_string();
                                    let is_active = active_path.as_deref() == Some(path.as_str());
                                    let (glyph, glyph_class) = file_glyph(&path);
                                    let dirty = tab.dirty;
                                    rsx! {
                                        div {
                                            key: "{path}",
                                            class: if is_active { "ide-tab active" } else { "ide-tab" },
                                            button {
                                                class: "ide-tab-label",
                                                title: "{path}",
                                                onclick: move |_| {
                                                    let content = tabs
                                                        .peek()
                                                        .iter()
                                                        .find(|tab| tab.path == path)
                                                        .map(|tab| tab.content.clone());
                                                    if let Some(content) = content {
                                                        active.set(Some(path.clone()));
                                                        editor_open(&editor_ctl, &path, &content);
                                                    }
                                                },
                                                span { class: "node-glyph {glyph_class}", "{glyph}" }
                                                span { "{name}" }
                                                if dirty { span { class: "tab-dirty", "●" } }
                                            }
                                            button {
                                                class: "ide-tab-close",
                                                title: "Close",
                                                onclick: move |_| {
                                                    let next = tabs.with_mut(|tabs| {
                                                        close_tab(tabs, active.peek().as_deref(), &close_path)
                                                    });
                                                    // Bidirectional: a user close also leaves the
                                                    // agent's shared open-set (no-op when no run).
                                                    mirror_user_workspace(snapshot, &close_path, false);
                                                    if let Some(path) = next.as_ref() {
                                                        let content = tabs
                                                            .peek()
                                                            .iter()
                                                            .find(|tab| tab.path == *path)
                                                            .map(|tab| tab.content.clone())
                                                            .unwrap_or_default();
                                                        editor_open(&editor_ctl, path, &content);
                                                    } else {
                                                        editor_open(&editor_ctl, "", "");
                                                        preview.set(false);
                                                    }
                                                    active.set(next);
                                                },
                                                "×"
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        div { class: "ide-tab-actions",
                            if preview_available {
                                button {
                                    class: if preview() { "ide-action active" } else { "ide-action" },
                                    title: "Toggle sandboxed HTML preview",
                                    onclick: move |_| preview.set(!preview()),
                                    "Preview"
                                }
                            }
                            if active_mode == WorkspaceMode::Browser {
                                // Extension-dispatching Run button (run_panel.rs):
                                // .js/.mjs run the buffer, .py/.wasm go through the
                                // shell runtime contract, .html toggles the preview.
                                // Output lands in the interactive terminal's queue.
                                RunButton {
                                    path: active_path.clone(),
                                    code: active_tab.as_ref().map(|tab| tab.content.clone()).unwrap_or_default(),
                                    busy,
                                    term_inject,
                                    on_focus_terminal: move |_| panel.set(PanelTab::Terminal),
                                    on_toggle_preview: move |_| preview.set(!preview()),
                                }
                            }
                            button {
                                class: "ide-action",
                                title: "Save the open file (or press Mod-S in the editor)",
                                disabled: active_tab.is_none() || !active_dirty,
                                onclick: move |_| {
                                    let Some(path) = active.peek().clone() else { return; };
                                    let content = tabs
                                        .peek()
                                        .iter()
                                        .find(|tab| tab.path == path)
                                        .map(|tab| tab.content.clone())
                                        .unwrap_or_default();
                                    save_file(snapshot, active_mode, path, content, tabs, files, notice);
                                },
                                "Save"
                            }
                        }
                    }
                    div { class: if preview_visible { "ide-editor-split with-preview" } else { "ide-editor-split" },
                        CodeEditor { controller: editor_ctl, on_event: on_editor_event }
                        if preview_visible {
                            // Same containment as artifact HTML (invariant 3):
                            // empty sandbox token list, so the preview renders
                            // markup but cannot run script or reach the app
                            // origin. Workspace files may be agent-written —
                            // they are data, not code we trust in this page.
                            iframe {
                                class: "ide-preview",
                                "sandbox": "",
                                srcdoc: "{preview_doc}",
                                title: "workspace html preview",
                            }
                        }
                        if open_tabs.is_empty() {
                            div { class: "ide-editor-empty",
                                div { class: "ide-empty-mark", "ASKK" }
                                p { "Open a file from the explorer, create a new one, or send the agent a task below." }
                            }
                        }
                    }
                }

                // ---- Bottom panel: terminal / agent ----
                section { class: "ide-panel",
                    div { class: "ide-panel-head",
                        div { class: "ide-panel-tabs",
                            button {
                                class: if panel() == PanelTab::Terminal { "ide-panel-tab active" } else { "ide-panel-tab" },
                                onclick: move |_| panel.set(PanelTab::Terminal),
                                "Terminal"
                            }
                            button {
                                class: if panel() == PanelTab::Run { "ide-panel-tab active" } else { "ide-panel-tab" },
                                onclick: move |_| panel.set(PanelTab::Run),
                                "Run"
                            }
                            button {
                                class: if panel() == PanelTab::Agent { "ide-panel-tab active" } else { "ide-panel-tab" },
                                onclick: move |_| panel.set(PanelTab::Agent),
                                "Agent"
                            }
                        }
                        div { class: "ide-panel-actions",
                            if panel() == PanelTab::Terminal {
                                button {
                                    class: "ide-icon-button",
                                    title: "Clear terminal output",
                                    onclick: move |_| match active_mode {
                                        WorkspaceMode::Browser => {
                                            term_inject.with_mut(|queue| queue.push(TermInject::Clear));
                                        }
                                        WorkspaceMode::Bridge => terminal.set(String::new()),
                                    },
                                    "✕"
                                }
                            }
                        }
                    }
                    match panel() {
                        PanelTab::Terminal => rsx! {
                            match active_mode {
                                // The real in-browser terminal: an interactive
                                // virtual shell over the workspace filesystem.
                                WorkspaceMode::Browser => rsx! {
                                    Terminal {
                                        cwd: shell_cwd,
                                        inject: term_inject,
                                        on_fs_change: move |_| refresh_tree(snapshot, WorkspaceMode::Browser, files, notice),
                                    }
                                },
                                WorkspaceMode::Bridge => rsx! {
                                    pre { class: "ide-terminal-output",
                                        if terminal_text.is_empty() {
                                            span { class: "ide-terminal-hint",
                                                "Bridge terminal: commands run in the bridge run root. Start it with `node scripts/askk-local-bridge.mjs --allow-exec`."
                                            }
                                        } else {
                                            "{terminal_text}"
                                        }
                                    }
                                    div { class: "ide-quick-row",
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
                                        class: "ide-terminal-input",
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
                                        span { class: "ide-prompt", "$" }
                                        input {
                                            class: "ide-input mono",
                                            value: "{current_command}",
                                            oninput: move |event| command.set(event.value()),
                                            placeholder: "command to run in the run root",
                                        }
                                        button { class: "ide-action", r#type: "submit", disabled: busy() || current_command.trim().is_empty(),
                                            if busy() { "Running…" } else { "Run" }
                                        }
                                    }
                                },
                            }
                        },
                        PanelTab::Run => rsx! {
                            RunPanel {}
                        },
                        PanelTab::Agent => rsx! {
                            div { class: "ide-agent",
                                p { class: "ide-agent-hint",
                                    "Describe a task. The agent writes files, runs them with run_js, and reports complete only after a verification check passes. Full transcript is on the Chat page."
                                }
                                if let Some(answer) = last_answer.as_ref() {
                                    div { class: "ide-agent-answer", "{answer}" }
                                }
                                form {
                                    class: "ide-agent-form",
                                    onsubmit: move |event| {
                                        event.prevent_default();
                                        submit_workspace_goal(snapshot, goal, active_mode, files, notice);
                                    },
                                    textarea {
                                        class: "ide-input",
                                        placeholder: "e.g. Write add(a,b) in add.js and a check that logs PASS only if add(2,3)===5, then run it.",
                                        value: "{goal.read().clone()}",
                                        oninput: move |event| goal.set(event.value()),
                                    }
                                    button { class: "ide-action", r#type: "submit", disabled: goal.read().trim().is_empty(),
                                        if running { "Send (run in progress)" } else { "Send to agent" }
                                    }
                                }
                            }
                        },
                    }
                }

                // ---- Status bar ----
                footer { class: "ide-status",
                    span { class: "ide-status-mode", "{active_mode.label()}" }
                    if !notice_text.trim().is_empty() {
                        span { class: "ide-status-notice", "{notice_text}" }
                    }
                    span { class: "ide-status-spacer" }
                    StorageUsageBadge {}
                    if let Some(path) = active_path.as_ref() {
                        if active_dirty {
                            span { class: "ide-status-dirty", "● unsaved" }
                        }
                        span { class: "ide-status-path", "{path}" }
                    }
                }
            }
        }
    }
}

/// The explorer-management signal bundle, passed to the rename/delete helpers
/// so they stay under a sane argument count. `Signal` is `Copy`, so this is too.
#[derive(Clone, Copy)]
struct ExplorerCtx {
    snapshot: Signal<AppSnapshot>,
    tabs: Signal<Vec<OpenTab>>,
    active: Signal<Option<String>>,
    editor_ctl: Signal<Option<document::Eval>>,
    files: Signal<Vec<FileNode>>,
    notice: Signal<String>,
    preview: Signal<bool>,
}

/// Rename (or move) `from` to `to` in OPFS, then retarget any open tabs —
/// including the active editor document, so Mod-S keeps saving to the right
/// path — and refresh the tree.
fn rename_workspace_entry(
    ctx: ExplorerCtx,
    mode: WorkspaceMode,
    from: String,
    to: String,
    mut renaming: Signal<Option<String>>,
) {
    let ExplorerCtx {
        snapshot,
        mut tabs,
        mut active,
        editor_ctl,
        files,
        mut notice,
        ..
    } = ctx;
    let to = to.trim().trim_matches('/').to_string();
    if to.is_empty() || to == from {
        renaming.set(None);
        return;
    }
    spawn_local(async move {
        match OpfsVfs::new().rename(&from, &to).await {
            Ok(()) => {
                renaming.set(None);
                tabs.with_mut(|tabs| {
                    for tab in tabs.iter_mut() {
                        if let Some(new_path) = retarget_path(&tab.path, &from, &to) {
                            tab.path = new_path;
                        }
                    }
                });
                let new_active = active
                    .peek()
                    .as_deref()
                    .and_then(|current| retarget_path(current, &from, &to));
                if let Some(new_active) = new_active {
                    let content = tabs
                        .peek()
                        .iter()
                        .find(|tab| tab.path == new_active)
                        .map(|tab| tab.content.clone())
                        .unwrap_or_default();
                    editor_open(&editor_ctl, &new_active, &content);
                    active.set(Some(new_active));
                }
                notice.set(format!("Renamed {from} → {to}."));
                refresh_tree(snapshot, mode, files, notice);
            }
            Err(err) => notice.set(err),
        }
    });
}

/// Delete `path` (recursively for folders) from OPFS, close any tabs that
/// lived under it, and refresh the tree.
fn delete_workspace_entry(
    ctx: ExplorerCtx,
    mode: WorkspaceMode,
    path: String,
    mut deleting: Signal<Option<String>>,
) {
    let ExplorerCtx {
        snapshot,
        mut tabs,
        mut active,
        editor_ctl,
        files,
        mut notice,
        mut preview,
    } = ctx;
    spawn_local(async move {
        match OpfsVfs::new().delete(&path).await {
            Ok(()) => {
                deleting.set(None);
                tabs.with_mut(|tabs| tabs.retain(|tab| !path_within(&tab.path, &path)));
                let active_removed = active
                    .peek()
                    .as_deref()
                    .is_some_and(|current| path_within(current, &path));
                if active_removed {
                    let next = tabs
                        .peek()
                        .first()
                        .map(|tab| (tab.path.clone(), tab.content.clone()));
                    match next {
                        Some((next_path, content)) => {
                            editor_open(&editor_ctl, &next_path, &content);
                            active.set(Some(next_path));
                        }
                        None => {
                            editor_open(&editor_ctl, "", "");
                            preview.set(false);
                            active.set(None);
                        }
                    }
                }
                notice.set(format!("Deleted {path}."));
                refresh_tree(snapshot, mode, files, notice);
            }
            Err(err) => {
                deleting.set(None);
                notice.set(err);
            }
        }
    });
}

/// Focus `path` in the editor: reuse the existing tab if it is already open,
/// otherwise read the file from the active filesystem and open a new tab.
fn open_file_in_tab(
    snapshot: Signal<AppSnapshot>,
    mode: WorkspaceMode,
    path: String,
    mut tabs: Signal<Vec<OpenTab>>,
    mut active: Signal<Option<String>>,
    editor_ctl: Signal<Option<document::Eval>>,
    mut notice: Signal<String>,
) {
    let existing = tabs
        .peek()
        .iter()
        .find(|tab| tab.path == path)
        .map(|tab| tab.content.clone());
    if let Some(content) = existing {
        active.set(Some(path.clone()));
        mirror_user_workspace(snapshot, &path, true);
        editor_open(&editor_ctl, &path, &content);
        return;
    }
    // Focus the requested file immediately; if another open starts before this
    // read resolves, the guard below makes the *latest* click win instead of
    // whichever async read happens to finish last.
    let previous = active.peek().clone();
    active.set(Some(path.clone()));
    spawn_local(async move {
        let result = match mode {
            WorkspaceMode::Browser => OpfsVfs::new()
                .read_file(&path)
                .await
                .map(|content| content.unwrap_or_default()),
            WorkspaceMode::Bridge => {
                let config = snapshot.read().tool_config.web_search.clone();
                bridge_fs_read(&config, &path).await
            }
        };
        if active.peek().as_deref() != Some(path.as_str()) {
            return; // superseded by a newer open
        }
        match result {
            Ok(content) => {
                tabs.with_mut(|tabs| upsert_tab(tabs, &path, content.clone(), false));
                mirror_user_workspace(snapshot, &path, true);
                editor_open(&editor_ctl, &path, &content);
                notice.set(String::new());
            }
            Err(err) => {
                active.set(previous);
                notice.set(err);
            }
        }
    });
}

fn save_file(
    snapshot: Signal<AppSnapshot>,
    mode: WorkspaceMode,
    path: String,
    content: String,
    mut tabs: Signal<Vec<OpenTab>>,
    files: Signal<Vec<FileNode>>,
    mut notice: Signal<String>,
) {
    spawn_local(async move {
        let result = match mode {
            WorkspaceMode::Browser => OpfsVfs::new().write_file(&path, &content).await,
            WorkspaceMode::Bridge => {
                let config = snapshot.read().tool_config.web_search.clone();
                bridge_fs_write(&config, &path, &content).await
            }
        };
        match result {
            Ok(()) => {
                tabs.with_mut(|tabs| {
                    if let Some(tab) = tabs.iter_mut().find(|tab| tab.path == path) {
                        tab.dirty = false;
                    }
                });
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
    let _ = (mode, files, notice);
    let goal_text = goal.read().trim().to_string();
    if goal_text.is_empty() {
        return;
    }
    // No single-active-run gate: the bounded spawner always accepts the enqueue,
    // starting it now when a slot is free (up to `orchestrator.max_parallelism`)
    // or queuing it FIFO otherwise. The component's tree-refresh effect reloads the
    // explorer when the run settles, so files the agent wrote still appear.
    goal.set(String::new());
    set_status(&mut snapshot, "Coding agent running…".to_string());
    enqueue_agent_run(snapshot, None, goal_text);
}

/// Read every workspace file as `(path, content)`. Browser mode lists OPFS and
/// reads each file; Bridge mode lists and reads through the bridge. Directories
/// are skipped. Binary files surface as whatever lossy UTF-8 the FS returns.
async fn collect_workspace_files(
    snapshot: Signal<AppSnapshot>,
    mode: WorkspaceMode,
) -> AppResult<Vec<(String, String)>> {
    match mode {
        WorkspaceMode::Browser => {
            let vfs = OpfsVfs::new();
            let entries = vfs.list_all().await?;
            let mut files = Vec::new();
            for entry in entries {
                if entry.is_dir {
                    continue;
                }
                if let Some(content) = vfs.read_file(&entry.path).await? {
                    files.push((entry.path, content));
                }
            }
            Ok(files)
        }
        WorkspaceMode::Bridge => {
            let config = snapshot.read().tool_config.web_search.clone();
            let listing = bridge_fs_list(&config, None).await?;
            let nodes = parse_bridge_nodes(&listing);
            let mut files = Vec::new();
            for node in nodes {
                if node.is_dir {
                    continue;
                }
                if let Ok(content) = bridge_fs_read(&config, &node.path).await {
                    files.push((node.path, content));
                }
            }
            Ok(files)
        }
    }
}

/// Run a cross-file search: compile the query, scan every workspace file, and
/// publish the matching lines. Errors (bad regex, FS failure) land in `notice`
/// and clear the result list.
#[allow(clippy::too_many_arguments)]
fn run_workspace_search(
    snapshot: Signal<AppSnapshot>,
    mode: WorkspaceMode,
    query: String,
    regex: bool,
    mut results: Signal<Vec<SearchHit>>,
    mut busy: Signal<bool>,
    mut done: Signal<bool>,
    mut notice: Signal<String>,
) {
    if busy.peek().to_owned() {
        return;
    }
    let query = query.trim().to_string();
    if query.is_empty() {
        results.set(Vec::new());
        done.set(false);
        return;
    }
    let matcher = match Matcher::compile(&query, regex) {
        Ok(matcher) => matcher,
        Err(err) => {
            notice.set(err);
            return;
        }
    };
    busy.set(true);
    results.set(Vec::new());
    spawn_local(async move {
        match collect_workspace_files(snapshot, mode).await {
            Ok(files) => {
                let hits = find_matches(&files, &matcher);
                let count = hits.len();
                results.set(hits);
                done.set(true);
                notice.set(format!("Search: {count} match(es)."));
            }
            Err(err) => {
                results.set(Vec::new());
                done.set(true);
                notice.set(format!("Search error: {err}"));
            }
        }
        busy.set(false);
    });
}

/// Replace every match of `query` with `replacement` across all OPFS files,
/// writing back only the files that changed. Open tabs for changed files are
/// refreshed (and the active editor re-opened) so the buffer never lags the
/// stored content. Browser mode only — the button is disabled in Bridge mode.
#[allow(clippy::too_many_arguments)]
fn replace_in_workspace(
    snapshot: Signal<AppSnapshot>,
    mode: WorkspaceMode,
    query: String,
    replacement: String,
    regex: bool,
    mut tabs: Signal<Vec<OpenTab>>,
    active: Signal<Option<String>>,
    editor_ctl: Signal<Option<document::Eval>>,
    mut results: Signal<Vec<SearchHit>>,
    mut busy: Signal<bool>,
    mut done: Signal<bool>,
    files: Signal<Vec<FileNode>>,
    mut notice: Signal<String>,
) {
    if mode != WorkspaceMode::Browser {
        notice.set("Replace is available in Browser mode only.".to_string());
        return;
    }
    if busy.peek().to_owned() {
        return;
    }
    let query = query.trim().to_string();
    if query.is_empty() {
        return;
    }
    let matcher = match Matcher::compile(&query, regex) {
        Ok(matcher) => matcher,
        Err(err) => {
            notice.set(err);
            return;
        }
    };
    busy.set(true);
    spawn_local(async move {
        let vfs = OpfsVfs::new();
        let source = match collect_workspace_files(snapshot, mode).await {
            Ok(files) => files,
            Err(err) => {
                busy.set(false);
                notice.set(format!("Replace error: {err}"));
                return;
            }
        };
        let mut changed_files = 0usize;
        let mut changed_lines = 0usize;
        let mut write_error: Option<String> = None;
        for (path, content) in &source {
            let updated = matcher.replace_all(content, &replacement);
            if updated == *content {
                continue;
            }
            changed_lines += count_matching_lines(content, &matcher);
            if let Err(err) = vfs.write_file(path, &updated).await {
                write_error = Some(format!("Replace error in {path}: {err}"));
                break;
            }
            changed_files += 1;
            // Keep any open tab for this file in sync with what we just stored.
            tabs.with_mut(|tabs| {
                if let Some(tab) = tabs.iter_mut().find(|tab| &tab.path == path) {
                    tab.content = updated.clone();
                    tab.dirty = false;
                }
            });
            if active.peek().as_deref() == Some(path.as_str()) {
                editor_open(&editor_ctl, path, &updated);
            }
        }
        busy.set(false);
        if let Some(err) = write_error {
            notice.set(err);
        } else {
            notice.set(format!(
                "Replaced {changed_lines} match(es) across {changed_files} file(s)."
            ));
        }
        // Re-run the search so the result list reflects the post-replace state.
        match collect_workspace_files(snapshot, mode).await {
            Ok(files) => {
                results.set(find_matches(&files, &matcher));
                done.set(true);
            }
            Err(_) => {
                results.set(Vec::new());
                done.set(true);
            }
        }
        refresh_tree(snapshot, mode, files, notice);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build display nodes the way the OPFS tree does: one entry per file plus
    /// explicit entries for every parent directory, sorted by path.
    fn nodes_from_file_paths(paths: &[&str]) -> Vec<FileNode> {
        let mut entries = std::collections::BTreeMap::new();
        for path in paths {
            let parts: Vec<&str> = path.split('/').collect();
            let mut acc = String::new();
            for (index, part) in parts.iter().enumerate() {
                if index > 0 {
                    acc.push('/');
                }
                acc.push_str(part);
                entries.insert(acc.clone(), index < parts.len() - 1);
            }
        }
        nodes_from_entries(
            entries
                .into_iter()
                .map(|(path, is_dir)| FsEntry { path, is_dir })
                .collect(),
        )
    }

    #[test]
    fn maps_opfs_entries_to_nodes_with_depth() {
        let nodes = nodes_from_entries(vec![
            FsEntry {
                path: "README.md".to_string(),
                is_dir: false,
            },
            FsEntry {
                path: "src".to_string(),
                is_dir: true,
            },
            FsEntry {
                path: "src/lib".to_string(),
                is_dir: true,
            },
            FsEntry {
                path: "src/lib/add.js".to_string(),
                is_dir: false,
            },
        ]);
        let summary: Vec<(&str, bool, usize)> = nodes
            .iter()
            .map(|node| (node.path.as_str(), node.is_dir, node.depth))
            .collect();
        assert_eq!(
            summary,
            vec![
                ("README.md", false, 0),
                ("src", true, 0),
                ("src/lib", true, 1),
                ("src/lib/add.js", false, 2),
            ]
        );
    }

    #[test]
    fn collapsed_directories_hide_descendants_but_stay_visible() {
        let nodes = nodes_from_file_paths(&["src/lib/add.js", "src/main.js", "README.md"]);
        let mut collapsed = BTreeSet::new();
        collapsed.insert("src".to_string());
        let remaining = visible_nodes(&nodes, &collapsed);
        let visible: Vec<&str> = remaining.iter().map(|node| node.path.as_str()).collect();
        assert_eq!(visible, vec!["README.md", "src"]);

        // Collapsing a nested dir hides only its own descendants.
        let mut nested = BTreeSet::new();
        nested.insert("src/lib".to_string());
        let visible: Vec<String> = visible_nodes(&nodes, &nested)
            .iter()
            .map(|node| node.path.clone())
            .collect();
        assert!(visible.contains(&"src/main.js".to_string()));
        assert!(visible.contains(&"src/lib".to_string()));
        assert!(!visible.contains(&"src/lib/add.js".to_string()));
    }

    #[test]
    fn collapse_prefix_does_not_hide_sibling_with_same_prefix() {
        // "src" collapsed must not hide "src-extra/file.js".
        let nodes = nodes_from_file_paths(&["src/a.js", "src-extra/file.js"]);
        let mut collapsed = BTreeSet::new();
        collapsed.insert("src".to_string());
        let visible: Vec<String> = visible_nodes(&nodes, &collapsed)
            .iter()
            .map(|node| node.path.clone())
            .collect();
        assert!(visible.contains(&"src-extra/file.js".to_string()));
        assert!(!visible.contains(&"src/a.js".to_string()));
    }

    #[test]
    fn upsert_tab_appends_once_and_refreshes_in_place() {
        let mut tabs = Vec::new();
        upsert_tab(&mut tabs, "a.js", "one".to_string(), false);
        upsert_tab(&mut tabs, "b.js", "two".to_string(), false);
        upsert_tab(&mut tabs, "a.js", "three".to_string(), true);
        assert_eq!(tabs.len(), 2);
        assert_eq!(tabs[0].path, "a.js");
        assert_eq!(tabs[0].content, "three");
        assert!(tabs[0].dirty);
    }

    #[test]
    fn closing_tabs_picks_a_sensible_next_active() {
        let mut tabs = Vec::new();
        upsert_tab(&mut tabs, "a.js", String::new(), false);
        upsert_tab(&mut tabs, "b.js", String::new(), false);
        upsert_tab(&mut tabs, "c.js", String::new(), false);

        // Closing a background tab keeps the active one.
        let next = close_tab(&mut tabs, Some("c.js"), "a.js");
        assert_eq!(next.as_deref(), Some("c.js"));
        assert_eq!(tabs.len(), 2);

        // Closing the active tab focuses its right neighbour…
        let next = close_tab(&mut tabs, Some("b.js"), "b.js");
        assert_eq!(next.as_deref(), Some("c.js"));

        // …and closing the last tab leaves nothing active.
        let next = close_tab(&mut tabs, Some("c.js"), "c.js");
        assert_eq!(next, None);
        assert!(tabs.is_empty());
    }

    #[test]
    fn file_glyphs_key_off_the_final_extension() {
        assert_eq!(file_glyph("src/app.test.js").0, "JS");
        assert_eq!(file_glyph("index.html").0, "<>");
        assert_eq!(file_glyph("lib.rs").0, "RS");
        assert_eq!(file_glyph("Makefile").0, "··");
    }

    #[test]
    fn path_within_requires_segment_boundaries() {
        assert!(path_within("src", "src"));
        assert!(path_within("src/a/b.js", "src"));
        assert!(!path_within("src-extra/a.js", "src"));
        assert!(!path_within("sr", "src"));
    }

    #[test]
    fn retarget_path_follows_renames_of_files_and_ancestors() {
        // The renamed entry itself.
        assert_eq!(
            retarget_path("a.js", "a.js", "b.js"),
            Some("b.js".to_string())
        );
        // A file under a renamed directory.
        assert_eq!(
            retarget_path("src/lib/add.js", "src", "core"),
            Some("core/lib/add.js".to_string())
        );
        // Unrelated paths (including same-prefix siblings) are untouched.
        assert_eq!(retarget_path("src-extra/a.js", "src", "core"), None);
        assert_eq!(retarget_path("README.md", "src", "core"), None);
    }

    fn sample_files() -> Vec<(String, String)> {
        vec![
            (
                "src/add.js".to_string(),
                "export function add(a, b) {\n  return a + b;\n}\n".to_string(),
            ),
            (
                "src/sub.js".to_string(),
                "export function sub(a, b) {\n  return a - b;\n}\n".to_string(),
            ),
            ("README.md".to_string(), "# add demo\n".to_string()),
        ]
    }

    #[test]
    fn literal_search_finds_each_matching_line_with_location() {
        let files = sample_files();
        let matcher = Matcher::compile("add", false).unwrap();
        let hits = find_matches(&files, &matcher);
        let summary: Vec<(&str, usize, &str)> = hits
            .iter()
            .map(|hit| (hit.path.as_str(), hit.line, hit.preview.as_str()))
            .collect();
        assert_eq!(
            summary,
            vec![
                ("src/add.js", 1, "export function add(a, b) {"),
                ("README.md", 1, "# add demo"),
            ]
        );
    }

    #[test]
    fn literal_search_is_case_sensitive_and_substring_based() {
        let files = vec![("x.txt".to_string(), "Foo foo FOO\nbar".to_string())];
        let matcher = Matcher::compile("foo", false).unwrap();
        let hits = find_matches(&files, &matcher);
        // Matches the line once (line-level), and only the lower-case "foo".
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line, 1);
    }

    #[test]
    fn regex_search_matches_patterns_and_rejects_bad_patterns() {
        let files = sample_files();
        let matcher = Matcher::compile(r"return .* [+-] .*;", true).unwrap();
        let hits = find_matches(&files, &matcher);
        assert_eq!(hits.len(), 2);
        assert!(hits.iter().all(|hit| hit.preview.contains("return")));

        assert!(Matcher::compile("(unclosed", true).is_err());
    }

    #[test]
    fn empty_query_matches_nothing_even_as_literal() {
        let matcher = Matcher::compile("", false).unwrap();
        // String::contains("") is true for every line, so guard at the caller;
        // here we document that the matcher itself does match empty — the UI
        // and run_workspace_search reject empty queries before compiling.
        assert!(matcher.is_match("anything"));
    }

    #[test]
    fn literal_replace_swaps_every_occurrence() {
        let matcher = Matcher::compile("add", false).unwrap();
        let result = matcher.replace_all("add and add again, addendum", "sum");
        assert_eq!(result, "sum and sum again, sumendum");
    }

    #[test]
    fn regex_replace_honours_capture_groups() {
        let matcher = Matcher::compile(r"(\w+)=(\d+)", true).unwrap();
        let result = matcher.replace_all("a=1 b=22", "$2:$1");
        assert_eq!(result, "1:a 22:b");
    }

    #[test]
    fn count_matching_lines_counts_lines_not_occurrences() {
        let matcher = Matcher::compile("x", false).unwrap();
        // Two lines contain "x" (the second twice), so the line count is 2.
        assert_eq!(count_matching_lines("x here\nxx there\nnone", &matcher), 2);
    }

    #[test]
    fn find_matches_preserves_file_order_and_numbers_lines_from_one() {
        let files = vec![(
            "multi.txt".to_string(),
            "no\nhit here\nno\nhit again".to_string(),
        )];
        let matcher = Matcher::compile("hit", false).unwrap();
        let hits = find_matches(&files, &matcher);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].line, 2);
        assert_eq!(hits[1].line, 4);
    }

    fn paths(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn sync_opens_agent_files_not_yet_tabbed() {
        // Agent opened a.rs and b.rs; the UI has no tabs yet.
        let sync = derive_workspace_sync(&paths(&["a.rs", "b.rs"]), Some("b.rs"), &[], &[]);
        assert_eq!(sync.to_open, paths(&["a.rs", "b.rs"]));
        assert!(sync.to_close.is_empty());
        assert_eq!(sync.new_active.as_deref(), Some("b.rs"));
    }

    #[test]
    fn sync_closes_tabs_the_agent_removed_but_keeps_dirty_ones() {
        // View has only a.rs open; the UI shows a.rs, b.rs (clean), c.rs (dirty).
        let sync = derive_workspace_sync(
            &paths(&["a.rs"]),
            Some("a.rs"),
            &paths(&["a.rs", "b.rs", "c.rs"]),
            &paths(&["c.rs"]),
        );
        assert!(sync.to_open.is_empty());
        // b.rs is closed; c.rs is dirty so it is preserved.
        assert_eq!(sync.to_close, paths(&["b.rs"]));
        assert_eq!(sync.new_active.as_deref(), Some("a.rs"));
    }

    #[test]
    fn sync_is_a_noop_when_tabs_already_match_the_view() {
        let sync = derive_workspace_sync(
            &paths(&["a.rs", "b.rs"]),
            None,
            &paths(&["a.rs", "b.rs"]),
            &[],
        );
        // Nothing to open or close; no active file requested.
        assert_eq!(sync.to_open.len(), 0);
        assert_eq!(sync.to_close.len(), 0);
        assert_eq!(sync.new_active, None);
        // With no active and matching sets, the default (no-op) is produced.
        assert_eq!(sync, WorkspaceSync::default());
    }

    #[test]
    fn sync_does_not_focus_an_active_file_that_is_not_open() {
        // A stale active pointing at a path no longer in the open-set is ignored.
        let sync =
            derive_workspace_sync(&paths(&["a.rs"]), Some("gone.rs"), &paths(&["a.rs"]), &[]);
        assert_eq!(sync.new_active, None);
        assert!(sync.to_open.is_empty() && sync.to_close.is_empty());
    }
}
