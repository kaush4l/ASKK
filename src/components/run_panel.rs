//! Run & process management UI for the Workspace IDE.
//!
//! Three pieces, mounted from `workspace_page` so its own edits stay surgical:
//!
//! - [`RunButton`] — the editor-toolbar Run group. The per-file Run button
//!   dispatches by the active file's extension: `.js`/`.mjs` execute the open
//!   buffer in the sandboxed exec Web Worker, `.py`/`.wasm` go through the shell
//!   runtime contract ([`run_runtime`], stubbed until the sibling runtimes
//!   land), and `.html` toggles the existing sandboxed preview. Alongside it,
//!   "Run project" detects the workspace's entry point ([`detect_project_entry`])
//!   from the OPFS root and runs it through the very same dispatch; if the entry
//!   is ambiguous it drops a picker so the user chooses.
//! - [`RunPanel`] — the "Run" bottom-panel tab: the live process list (with
//!   Kill buttons backed by `process_registry`) and the runtime status strip.
//! - [`StorageUsageBadge`] — origin storage usage for the status bar, from
//!   `navigator.storage.estimate()`.
//!
//! The registry and status stores are Dioxus-free; this module subscribes by
//! polling them from short-interval futures (cancelled automatically on
//! unmount), which doubles as the tick that advances elapsed-time labels.

use super::terminal::TermInject;
use crate::engine::browser_exec::{format_run_js, run_js_in_browser};
use crate::engine::process_registry::{self, ProcessInfo};
use crate::engine::runtime_status::{self, RuntimeAssetState};
use crate::shell::runtime::{RuntimeKind, ShellExecCtx, run_runtime};
use dioxus::prelude::*;
use wasm_bindgen_futures::spawn_local;

/// Soft-desk styling for the run/process UI; hoisted into <head> by every
/// top-level run component so it loads wherever the run UI mounts.
const RUN_CSS: Asset = asset!("/assets/pages/run.css");

/// How often the run panel re-reads the registry/status stores, in ms.
const POLL_INTERVAL_MS: u32 = 400;
/// How often the storage badge refreshes `navigator.storage.estimate()`, in ms.
const STORAGE_REFRESH_MS: u32 = 5_000;

/// Browser sleep for the polling loops.
#[cfg(target_arch = "wasm32")]
async fn sleep_ms(ms: u32) {
    gloo_timers::future::TimeoutFuture::new(ms).await;
}

/// Host fallback: components never render on the host, but the loops must
/// still compile; parking forever keeps a stray poll from spinning hot.
#[cfg(not(target_arch = "wasm32"))]
async fn sleep_ms(_ms: u32) {
    std::future::pending::<()>().await;
}

/// What the Run button would do for the active file.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RunDispatch {
    /// Execute the open buffer in the sandboxed exec Web Worker.
    Js,
    /// Dispatch to the (stubbed) in-browser Python runtime.
    Python,
    /// Dispatch to the (stubbed) in-browser WASI harness.
    Wasm,
    /// Toggle the sandboxed HTML preview split.
    Html,
    /// Extension has no runner; the button renders disabled with a tooltip.
    Unsupported,
    /// No file is open.
    NoFile,
}

/// Pick the run dispatch for a path by its final extension.
fn dispatch_for(path: &str) -> RunDispatch {
    let name = path.rsplit('/').next().unwrap_or(path);
    let ext = name
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "js" | "mjs" => RunDispatch::Js,
        "py" => RunDispatch::Python,
        "wasm" => RunDispatch::Wasm,
        "html" | "htm" => RunDispatch::Html,
        _ => RunDispatch::Unsupported,
    }
}

/// A runnable project entry: the workspace-relative path of the entry file and
/// the dispatch that runs it. The dispatch is reused from [`dispatch_for`], so a
/// project run goes through the exact same per-file run path.
#[derive(Clone, Debug, PartialEq, Eq)]
struct ProjectEntry {
    path: String,
    dispatch: RunDispatch,
}

/// Result of scanning the workspace root for a runnable entry point.
#[derive(Clone, Debug, PartialEq, Eq)]
enum ProjectRun {
    /// Exactly one entry point was detected; "Run project" runs it directly.
    One(ProjectEntry),
    /// Several plausible entry points; the user picks which one to run. Sorted
    /// by path for a stable menu.
    Ambiguous(Vec<ProjectEntry>),
    /// No runnable entry point at the workspace root.
    None,
}

/// True for a path that lives directly at the workspace root (no `/`), i.e. a
/// top-level file. Project detection only considers root files so a stray
/// `tests/foo.py` or `node_modules/.../index.js` never masquerades as the entry.
fn is_root_file(path: &str) -> bool {
    !path.contains('/')
}

/// Detect the project's run target from a workspace file list.
///
/// `files` is the flat `(path, is_dir)` listing from `OpfsVfs::list_all`, and
/// `package_main` is the `"main"` field parsed from a root `package.json`, when
/// one exists. Detection order, each restricted to the workspace root:
///
/// 1. **Python** — `main.py`, else a single `*.py` file. Two or more `*.py`
///    files (with no `main.py`) is ambiguous.
/// 2. **JS** — `package.json`'s `"main"` (if it resolves to a real `.js`/`.mjs`
///    root file), else `index.js`, else a single `*.js`/`*.mjs` file. Multiple
///    JS files with none of those markers is ambiguous.
/// 3. **WASI** — a single `*.wasm` file; multiple is ambiguous.
///
/// Cross-language ties (e.g. both a clear Python and a clear JS entry) surface
/// as [`ProjectRun::Ambiguous`] so the user picks rather than us guessing.
fn detect_project_entry(files: &[(String, bool)], package_main: Option<&str>) -> ProjectRun {
    let root_files: Vec<&str> = files
        .iter()
        .filter(|(path, is_dir)| !*is_dir && is_root_file(path))
        .map(|(path, _)| path.as_str())
        .collect();
    let has_root = |name: &str| root_files.contains(&name);

    // Python: explicit main.py wins, else a lone *.py.
    let py: Vec<&str> = root_files
        .iter()
        .copied()
        .filter(|p| dispatch_for(p) == RunDispatch::Python)
        .collect();
    let python_entry: Option<&str> = if has_root("main.py") {
        Some("main.py")
    } else if py.len() == 1 {
        Some(py[0])
    } else {
        None
    };

    // JS: package.json "main" wins (when it resolves to a real root JS file),
    // else index.js, else a lone *.js / *.mjs.
    let js: Vec<&str> = root_files
        .iter()
        .copied()
        .filter(|p| dispatch_for(p) == RunDispatch::Js)
        .collect();
    let main_entry = package_main
        .map(|m| m.trim_start_matches("./"))
        .filter(|m| dispatch_for(m) == RunDispatch::Js && has_root(m));
    let js_entry: Option<&str> = if let Some(m) = main_entry {
        Some(m)
    } else if has_root("index.js") {
        Some("index.js")
    } else if js.len() == 1 {
        Some(js[0])
    } else {
        None
    };

    // WASI: a lone *.wasm.
    let wasm: Vec<&str> = root_files
        .iter()
        .copied()
        .filter(|p| dispatch_for(p) == RunDispatch::Wasm)
        .collect();
    let wasm_entry: Option<&str> = if wasm.len() == 1 { Some(wasm[0]) } else { None };

    // Collect the unambiguous winners across languages.
    let mut winners: Vec<ProjectEntry> = [
        python_entry.map(|p| (p, RunDispatch::Python)),
        js_entry.map(|p| (p, RunDispatch::Js)),
        wasm_entry.map(|p| (p, RunDispatch::Wasm)),
    ]
    .into_iter()
    .flatten()
    .map(|(path, dispatch)| ProjectEntry {
        path: path.to_string(),
        dispatch,
    })
    .collect();

    match winners.len() {
        0 => {
            // No clean winner. Offer every runnable root file (py/js/wasm) as a
            // pick list, so a multi-file project is still one click from a run.
            let mut candidates: Vec<ProjectEntry> = root_files
                .iter()
                .copied()
                .filter_map(|p| {
                    let dispatch = dispatch_for(p);
                    matches!(
                        dispatch,
                        RunDispatch::Js | RunDispatch::Python | RunDispatch::Wasm
                    )
                    .then(|| ProjectEntry {
                        path: p.to_string(),
                        dispatch,
                    })
                })
                .collect();
            candidates.sort_by(|a, b| a.path.cmp(&b.path));
            match candidates.len() {
                0 => ProjectRun::None,
                1 => ProjectRun::One(candidates.remove(0)),
                _ => ProjectRun::Ambiguous(candidates),
            }
        }
        1 => ProjectRun::One(winners.remove(0)),
        _ => {
            winners.sort_by(|a, b| a.path.cmp(&b.path));
            ProjectRun::Ambiguous(winners)
        }
    }
}

/// Parse the `"main"` field out of a root `package.json`'s raw text. Returns
/// `None` when the file is absent, unparseable, or has no string `"main"`.
fn package_main_field(package_json: Option<&str>) -> Option<String> {
    let text = package_json?;
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    value
        .get("main")?
        .as_str()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Tooltip text for each dispatch (the disabled states explain themselves).
fn run_tooltip(dispatch: RunDispatch) -> &'static str {
    match dispatch {
        RunDispatch::Js => "Run the open file in the sandboxed Web Worker",
        RunDispatch::Python => "Run with the in-browser Python runtime",
        RunDispatch::Wasm => "Run with the in-browser WASI harness",
        RunDispatch::Html => "Toggle the sandboxed HTML preview",
        RunDispatch::Unsupported => "Run supports .js, .mjs, .py, .wasm, and .html files",
        RunDispatch::NoFile => "Open a file to run it",
    }
}

/// Compact elapsed-time label ("7s", "1m 12s", "1h 03m").
fn format_elapsed(started_ms: f64, now_ms: f64) -> String {
    let secs = ((now_ms - started_ms) / 1000.0).max(0.0) as u64;
    if secs >= 3600 {
        format!("{}h {:02}m", secs / 3600, (secs % 3600) / 60)
    } else if secs >= 60 {
        format!("{}m {:02}s", secs / 60, secs % 60)
    } else {
        format!("{secs}s")
    }
}

/// Render a byte count as "12.3 MB" / "1.2 GB" for the storage badge.
fn format_bytes(bytes: f64) -> String {
    const MB: f64 = 1024.0 * 1024.0;
    const GB: f64 = MB * 1024.0;
    if bytes >= GB {
        format!("{:.1} GB", bytes / GB)
    } else {
        format!("{:.1} MB", bytes / MB)
    }
}

/// Display name for a runtime id in the status strip.
fn runtime_display_name(id: &str) -> &str {
    match id {
        "js" => "JS",
        "python" => "Python",
        "wasi" => "WASI",
        other => other,
    }
}

/// `(state text, chip css modifier)` for a runtime chip.
fn runtime_chip_parts(state: RuntimeAssetState) -> (String, &'static str) {
    match state {
        RuntimeAssetState::Ready => ("Ready".to_string(), "ready"),
        RuntimeAssetState::Downloading { pct } => (format!("Downloading {pct}%"), "downloading"),
        RuntimeAssetState::NotInstalled => ("Not installed".to_string(), "notinstalled"),
    }
}

/// Run a runnable dispatch (`Js`/`Python`/`Wasm`) and stream its output into the
/// terminal — the single execution path shared by the per-file Run button and
/// the "Run project" affordance. `js_code` is the source to execute for a JS
/// dispatch (the editor buffer for a file run, the on-disk content for a project
/// run); it is ignored for Python/Wasm, which run by path through the shell
/// runtime contract. `Html`/`Unsupported`/`NoFile` are not runnable here and are
/// no-ops, so callers handle the preview toggle themselves.
fn run_entry(
    dispatch: RunDispatch,
    path: String,
    js_code: String,
    mut busy: Signal<bool>,
    mut term_inject: Signal<Vec<TermInject>>,
    on_focus_terminal: &EventHandler<()>,
) {
    match dispatch {
        RunDispatch::Js => {
            on_focus_terminal.call(());
            busy.set(true);
            term_inject.with_mut(|queue| queue.push(TermInject::Write(format!("> run {path}\n"))));
            spawn_local(async move {
                match run_js_in_browser(&js_code, 10_000).await {
                    Ok(value) => {
                        let (_ok, text) = format_run_js(&value);
                        term_inject.with_mut(|queue| {
                            queue.push(TermInject::Write(format!("{text}\n")));
                        });
                    }
                    Err(err) => term_inject.with_mut(|queue| {
                        queue.push(TermInject::Write(format!("error: {err}\n")));
                    }),
                }
                busy.set(false);
            });
        }
        RunDispatch::Python | RunDispatch::Wasm => {
            // Shell argv convention: argv[0] is the command name, the file is
            // argv[1] (see `shell::runtime::run_runtime`).
            let (kind, command) = if dispatch == RunDispatch::Python {
                (RuntimeKind::Python, "python")
            } else {
                (RuntimeKind::Wasm, "run")
            };
            on_focus_terminal.call(());
            busy.set(true);
            term_inject.with_mut(|queue| queue.push(TermInject::Write(format!("> run {path}\n"))));
            spawn_local(async move {
                let argv = vec![command.to_string(), path];
                let response = run_runtime(kind, &argv, &ShellExecCtx::default()).await;
                term_inject.with_mut(|queue| {
                    queue.push(TermInject::Write(format!("{}\n", response.to_transcript())));
                });
                busy.set(false);
            });
        }
        RunDispatch::Html | RunDispatch::Unsupported | RunDispatch::NoFile => {}
    }
}

/// Scan the OPFS workspace root for a runnable entry point. Reads the file
/// listing (and a root `package.json`, when present) and folds them through the
/// pure [`detect_project_entry`]; this is the only async/`OpfsVfs`-touching step
/// of the project run.
async fn detect_project_run() -> ProjectRun {
    let files = match crate::storage::opfs_vfs::OpfsVfs::new().list_all().await {
        Ok(entries) => entries
            .into_iter()
            .map(|entry| (entry.path, entry.is_dir))
            .collect::<Vec<_>>(),
        Err(_) => return ProjectRun::None,
    };
    let package_json = if files.iter().any(|(p, d)| !*d && p == "package.json") {
        crate::storage::opfs_vfs::OpfsVfs::new()
            .read_file("package.json")
            .await
            .ok()
            .flatten()
    } else {
        None
    };
    let package_main = package_main_field(package_json.as_deref());
    detect_project_entry(&files, package_main.as_deref())
}

/// Read the source a JS project entry should execute (the on-disk file), so a
/// project JS run goes through the same `run_js_in_browser` path as a file run.
async fn read_entry_js(path: &str) -> String {
    crate::storage::opfs_vfs::OpfsVfs::new()
        .read_file(path)
        .await
        .ok()
        .flatten()
        .unwrap_or_default()
}

/// Run a detected project entry, fetching the JS source from disk when needed.
/// `run_entry` itself owns the `busy` lifecycle (set on dispatch, cleared when
/// its spawned future finishes), so this only primes the JS source first.
fn run_project_entry(
    entry: ProjectEntry,
    mut busy: Signal<bool>,
    term_inject: Signal<Vec<TermInject>>,
    on_focus_terminal: EventHandler<()>,
) {
    spawn_local(async move {
        // Detection only ever yields runnable dispatches; guard anyway so a
        // future non-runnable entry can't strand the held `busy` flag.
        if !matches!(
            entry.dispatch,
            RunDispatch::Js | RunDispatch::Python | RunDispatch::Wasm
        ) {
            busy.set(false);
            return;
        }
        let js_code = if entry.dispatch == RunDispatch::Js {
            read_entry_js(&entry.path).await
        } else {
            String::new()
        };
        run_entry(
            entry.dispatch,
            entry.path,
            js_code,
            busy,
            term_inject,
            &on_focus_terminal,
        );
    });
}

/// The editor-toolbar Run group: the per-file Run button (dispatches the active
/// file by extension) plus "Run project" (detects the workspace entry point and
/// runs it through the same dispatch). Both write results into the interactive
/// terminal via its inject queue. `code` is the active buffer (possibly
/// unsaved), so a file JS run executes exactly what the editor shows.
#[component]
pub fn RunButton(
    path: Option<String>,
    code: String,
    mut busy: Signal<bool>,
    term_inject: Signal<Vec<TermInject>>,
    on_focus_terminal: EventHandler<()>,
    on_toggle_preview: EventHandler<()>,
) -> Element {
    let dispatch = path
        .as_deref()
        .map(dispatch_for)
        .unwrap_or(RunDispatch::NoFile);
    let disabled = busy() || matches!(dispatch, RunDispatch::Unsupported | RunDispatch::NoFile);

    // Detected project entry, refreshed each render-triggered scan. `None` until
    // the first scan resolves; the picker for an ambiguous result lives here too.
    let mut project = use_signal(|| ProjectRun::None);
    let mut picking = use_signal(|| false);

    rsx! {
        document::Stylesheet { href: RUN_CSS }
        button {
            class: "ide-action run-action run-action-primary",
            title: run_tooltip(dispatch),
            disabled,
            onclick: move |_| {
                if busy() {
                    return;
                }
                let Some(path) = path.clone() else { return };
                if dispatch == RunDispatch::Html {
                    on_toggle_preview.call(());
                    return;
                }
                run_entry(dispatch, path, code.clone(), busy, term_inject, &on_focus_terminal);
            },
            if busy() { "Running…" } else { "▶ Run" }
        }
        // Project run: detect the workspace entry point on click, then run it (or
        // open a picker when the entry is ambiguous).
        div { class: "run-project",
            button {
                class: "ide-action run-action",
                title: "Detect the project's entry point and run it",
                disabled: busy(),
                onclick: move |_| {
                    if busy() {
                        return;
                    }
                    picking.set(false);
                    // Hold `busy` across the async detect so a second click can't
                    // launch a parallel scan. `run_entry` re-asserts and then
                    // clears it for a One result; the other arms clear it here.
                    busy.set(true);
                    spawn_local(async move {
                        let detected = detect_project_run().await;
                        match detected {
                            ProjectRun::One(entry) => {
                                project.set(ProjectRun::One(entry.clone()));
                                run_project_entry(entry, busy, term_inject, on_focus_terminal);
                            }
                            ProjectRun::Ambiguous(entries) => {
                                project.set(ProjectRun::Ambiguous(entries));
                                picking.set(true);
                                busy.set(false);
                            }
                            ProjectRun::None => {
                                project.set(ProjectRun::None);
                                term_inject.with_mut(|queue| {
                                    queue.push(TermInject::Write(
                                        "no runnable project entry found at the workspace root\n"
                                            .to_string(),
                                    ));
                                });
                                busy.set(false);
                            }
                        }
                    });
                },
                "▶ Run project"
            }
            // Which entry the last scan detected — shown so the run target is
            // never a mystery.
            {
                let label = match &*project.read() {
                    ProjectRun::One(entry) => Some(format!("entry: {}", entry.path)),
                    ProjectRun::Ambiguous(_) => Some("entry: pick one".to_string()),
                    ProjectRun::None => None,
                };
                rsx! {
                    if let Some(label) = label {
                        span { class: "run-entry", title: "Detected project entry point", "{label}" }
                    }
                }
            }
            // Ambiguous: a small menu so the user picks the entry to run.
            if picking() {
                {
                    let entries = match &*project.read() {
                        ProjectRun::Ambiguous(entries) => entries.clone(),
                        _ => Vec::new(),
                    };
                    rsx! {
                        div { class: "run-picker",
                            for entry in entries.into_iter() {
                                {
                                    let entry = entry.clone();
                                    let label = entry.path.clone();
                                    rsx! {
                                        button {
                                            key: "{label}",
                                            class: "ide-action run-action",
                                            title: "Run this entry point",
                                            onclick: move |_| {
                                                if busy() {
                                                    return;
                                                }
                                                // Hold `busy` across the async source
                                                // read so a second click can't double
                                                // launch; `run_entry` then clears it.
                                                busy.set(true);
                                                picking.set(false);
                                                project.set(ProjectRun::One(entry.clone()));
                                                run_project_entry(
                                                    entry.clone(),
                                                    busy,
                                                    term_inject,
                                                    on_focus_terminal,
                                                );
                                            },
                                            "{label}"
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

/// The "Run" bottom-panel tab: live process list with Kill buttons, plus the
/// per-runtime asset-state strip.
#[component]
pub fn RunPanel() -> Element {
    let mut processes = use_signal(Vec::<ProcessInfo>::new);
    let mut runtimes = use_signal(runtime_status::snapshot);
    let mut now_ms = use_signal(process_registry::now_ms);

    // Poll the Dioxus-free stores; cancelled automatically on unmount. The
    // registry's change counter is the subscription point — the list is only
    // re-read when it moves — and the clock tick advances elapsed labels
    // whenever something is running.
    use_future(move || async move {
        let mut seen_version: Option<u64> = None;
        loop {
            let version = process_registry::version();
            if seen_version != Some(version) {
                seen_version = Some(version);
                processes.set(process_registry::list());
            }
            let next_runtimes = runtime_status::snapshot();
            if *runtimes.peek() != next_runtimes {
                runtimes.set(next_runtimes);
            }
            if !processes.peek().is_empty() {
                now_ms.set(process_registry::now_ms());
            }
            sleep_ms(POLL_INTERVAL_MS).await;
        }
    });

    let process_rows = processes.read().clone();
    let runtime_chips = runtimes.read().clone();
    let clock = now_ms();

    rsx! {
        document::Stylesheet { href: RUN_CSS }
        div { class: "run-panel",
            div { class: "run-section",
                div { class: "run-section-title", "Processes" }
                if process_rows.is_empty() {
                    div { class: "run-empty",
                        "Nothing is running. Press ▶ Run on an open file to start an in-browser process."
                    }
                }
                for info in process_rows.iter() {
                    {
                        let id = info.id;
                        let elapsed = format_elapsed(info.started_ms, clock);
                        rsx! {
                            div { key: "{id}", class: "run-proc",
                                span { class: "run-proc-kind", "{info.kind}" }
                                span { class: "run-proc-label", title: "{info.label}", "{info.label}" }
                                span { class: "run-proc-elapsed", "{elapsed}" }
                                button {
                                    class: "run-kill",
                                    title: "Terminate this process",
                                    onclick: move |_| {
                                        process_registry::kill(id);
                                        processes.set(process_registry::list());
                                    },
                                    "Kill"
                                }
                            }
                        }
                    }
                }
            }
            div { class: "run-section",
                div { class: "run-section-title", "Runtimes" }
                div { class: "run-runtime-strip",
                    for (id, state) in runtime_chips.iter() {
                        {
                            let (state_text, modifier) = runtime_chip_parts(*state);
                            let name = runtime_display_name(id).to_string();
                            rsx! {
                                span { key: "{id}", class: "run-runtime-chip {modifier}",
                                    span { class: "run-runtime-name", "{name}" }
                                    span { "{state_text}" }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Origin storage usage from `navigator.storage.estimate()`.
#[cfg(target_arch = "wasm32")]
async fn storage_estimate() -> Option<(f64, f64)> {
    use wasm_bindgen::JsValue;
    let storage = web_sys::window()?.navigator().storage();
    let promise = storage.estimate().ok()?;
    let value = wasm_bindgen_futures::JsFuture::from(promise).await.ok()?;
    let usage = js_sys::Reflect::get(&value, &JsValue::from_str("usage"))
        .ok()?
        .as_f64()?;
    let quota = js_sys::Reflect::get(&value, &JsValue::from_str("quota"))
        .ok()?
        .as_f64()?;
    Some((usage, quota))
}

/// Host fallback: no storage estimate outside the browser.
#[cfg(not(target_arch = "wasm32"))]
async fn storage_estimate() -> Option<(f64, f64)> {
    None
}

/// Status-bar badge: "X MB used of Y" for this origin, refreshed periodically.
#[component]
pub fn StorageUsageBadge() -> Element {
    let mut estimate = use_signal(|| Option::<(f64, f64)>::None);

    use_future(move || async move {
        loop {
            if let Some(next) = storage_estimate().await
                && *estimate.peek() != Some(next)
            {
                estimate.set(Some(next));
            }
            sleep_ms(STORAGE_REFRESH_MS).await;
        }
    });

    match estimate() {
        Some((used, quota)) => rsx! {
            document::Stylesheet { href: RUN_CSS }
            span {
                class: "run-storage",
                title: "Origin storage, from navigator.storage.estimate()",
                "{format_bytes(used)} used of {format_bytes(quota)}"
            }
        },
        None => rsx! {
            document::Stylesheet { href: RUN_CSS }
            span { class: "run-storage", title: "Origin storage estimate unavailable",
                "storage: —"
            }
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dispatch_keys_off_the_final_extension() {
        assert_eq!(dispatch_for("src/app.js"), RunDispatch::Js);
        assert_eq!(dispatch_for("mod.mjs"), RunDispatch::Js);
        assert_eq!(dispatch_for("main.py"), RunDispatch::Python);
        assert_eq!(dispatch_for("bin/tool.wasm"), RunDispatch::Wasm);
        assert_eq!(dispatch_for("index.html"), RunDispatch::Html);
        assert_eq!(dispatch_for("page.htm"), RunDispatch::Html);
        assert_eq!(dispatch_for("notes.md"), RunDispatch::Unsupported);
        assert_eq!(dispatch_for("Makefile"), RunDispatch::Unsupported);
        assert_eq!(dispatch_for("app.test.JS"), RunDispatch::Js);
    }

    /// `(path, is_dir)` helpers for the detection tests.
    fn file(path: &str) -> (String, bool) {
        (path.to_string(), false)
    }
    fn dir(path: &str) -> (String, bool) {
        (path.to_string(), true)
    }
    fn entry(path: &str, dispatch: RunDispatch) -> ProjectEntry {
        ProjectEntry {
            path: path.to_string(),
            dispatch,
        }
    }

    #[test]
    fn detects_main_py_as_the_python_entry() {
        let files = [file("main.py"), file("util.py"), dir("tests")];
        assert_eq!(
            detect_project_entry(&files, None),
            ProjectRun::One(entry("main.py", RunDispatch::Python))
        );
    }

    #[test]
    fn detects_a_lone_py_as_the_python_entry() {
        let files = [file("solve.py"), file("README.md")];
        assert_eq!(
            detect_project_entry(&files, None),
            ProjectRun::One(entry("solve.py", RunDispatch::Python))
        );
    }

    #[test]
    fn package_main_picks_the_js_entry_over_index() {
        let files = [file("package.json"), file("index.js"), file("server.js")];
        assert_eq!(
            detect_project_entry(&files, Some("server.js")),
            ProjectRun::One(entry("server.js", RunDispatch::Js))
        );
    }

    #[test]
    fn package_main_strips_a_leading_dot_slash() {
        let files = [file("package.json"), file("app.js")];
        assert_eq!(
            detect_project_entry(&files, Some("./app.js")),
            ProjectRun::One(entry("app.js", RunDispatch::Js))
        );
    }

    #[test]
    fn bogus_package_main_falls_back_to_index_js() {
        // "main" points at a file that does not exist; index.js is the fallback.
        let files = [file("package.json"), file("index.js"), file("other.js")];
        assert_eq!(
            detect_project_entry(&files, Some("missing.js")),
            ProjectRun::One(entry("index.js", RunDispatch::Js))
        );
    }

    #[test]
    fn index_js_wins_when_no_package_main() {
        let files = [file("index.js"), file("helper.js")];
        assert_eq!(
            detect_project_entry(&files, None),
            ProjectRun::One(entry("index.js", RunDispatch::Js))
        );
    }

    #[test]
    fn detects_a_lone_js_as_the_js_entry() {
        let files = [file("bundle.mjs"), file("style.css")];
        assert_eq!(
            detect_project_entry(&files, None),
            ProjectRun::One(entry("bundle.mjs", RunDispatch::Js))
        );
    }

    #[test]
    fn detects_a_lone_wasm_as_the_wasi_entry() {
        let files = [file("tool.wasm"), file("notes.txt")];
        assert_eq!(
            detect_project_entry(&files, None),
            ProjectRun::One(entry("tool.wasm", RunDispatch::Wasm))
        );
    }

    #[test]
    fn multiple_py_with_no_main_is_ambiguous() {
        let files = [file("alpha.py"), file("beta.py")];
        assert_eq!(
            detect_project_entry(&files, None),
            ProjectRun::Ambiguous(vec![
                entry("alpha.py", RunDispatch::Python),
                entry("beta.py", RunDispatch::Python),
            ])
        );
    }

    #[test]
    fn a_clear_py_and_a_clear_js_entry_is_ambiguous() {
        // main.py is a clean Python winner and index.js a clean JS winner; with
        // two cross-language winners we let the user pick.
        let files = [file("main.py"), file("index.js")];
        assert_eq!(
            detect_project_entry(&files, None),
            ProjectRun::Ambiguous(vec![
                entry("index.js", RunDispatch::Js),
                entry("main.py", RunDispatch::Python),
            ])
        );
    }

    #[test]
    fn no_runnable_root_file_is_none() {
        let files = [file("README.md"), file("style.css"), dir("src")];
        assert_eq!(detect_project_entry(&files, None), ProjectRun::None);
    }

    #[test]
    fn empty_workspace_is_none() {
        assert_eq!(detect_project_entry(&[], None), ProjectRun::None);
    }

    #[test]
    fn only_nested_runnables_is_none() {
        // Runnable files exist, but none at the root, so there is no project entry.
        let files = [dir("src"), file("src/main.py"), file("src/index.js")];
        assert_eq!(detect_project_entry(&files, None), ProjectRun::None);
    }

    #[test]
    fn directories_named_like_entries_are_ignored() {
        // A directory called `main.py` must never be treated as the entry file.
        let files = [dir("main.py"), file("run.py")];
        assert_eq!(
            detect_project_entry(&files, None),
            ProjectRun::One(entry("run.py", RunDispatch::Python))
        );
    }

    #[test]
    fn package_main_pointing_at_non_js_is_ignored() {
        // "main" points at a non-JS asset; fall back to the lone real JS file.
        let files = [file("package.json"), file("styles.css"), file("app.js")];
        assert_eq!(
            detect_project_entry(&files, Some("styles.css")),
            ProjectRun::One(entry("app.js", RunDispatch::Js))
        );
    }

    #[test]
    fn parses_package_main_from_json() {
        assert_eq!(
            package_main_field(Some(r#"{"name":"x","main":"server.js"}"#)),
            Some("server.js".to_string())
        );
        // Trimmed, and blank/missing/garbage all yield None.
        assert_eq!(
            package_main_field(Some(r#"{"main":"  app.js  "}"#)),
            Some("app.js".to_string())
        );
        assert_eq!(package_main_field(Some(r#"{"main":""}"#)), None);
        assert_eq!(package_main_field(Some(r#"{"name":"x"}"#)), None);
        assert_eq!(package_main_field(Some(r#"{"main":42}"#)), None);
        assert_eq!(package_main_field(Some("not json")), None);
        assert_eq!(package_main_field(None), None);
    }

    #[test]
    fn root_file_check_rejects_nested_paths() {
        assert!(is_root_file("main.py"));
        assert!(!is_root_file("src/main.py"));
        assert!(!is_root_file("a/b/c.js"));
    }

    #[test]
    fn every_dispatch_has_a_tooltip() {
        for dispatch in [
            RunDispatch::Js,
            RunDispatch::Python,
            RunDispatch::Wasm,
            RunDispatch::Html,
            RunDispatch::Unsupported,
            RunDispatch::NoFile,
        ] {
            assert!(!run_tooltip(dispatch).is_empty());
        }
    }

    #[test]
    fn elapsed_labels_cover_seconds_minutes_and_hours() {
        assert_eq!(format_elapsed(0.0, 7_000.0), "7s");
        assert_eq!(format_elapsed(0.0, 72_000.0), "1m 12s");
        assert_eq!(format_elapsed(0.0, 3_780_000.0), "1h 03m");
        // A clock that ran backwards never panics or underflows.
        assert_eq!(format_elapsed(10_000.0, 0.0), "0s");
    }

    #[test]
    fn byte_labels_pick_a_sensible_unit() {
        assert_eq!(format_bytes(12.3 * 1024.0 * 1024.0), "12.3 MB");
        assert_eq!(format_bytes(2.5 * 1024.0 * 1024.0 * 1024.0), "2.5 GB");
        assert_eq!(format_bytes(0.0), "0.0 MB");
    }

    #[test]
    fn runtime_chips_render_state_and_modifier() {
        assert_eq!(
            runtime_chip_parts(RuntimeAssetState::Ready),
            ("Ready".to_string(), "ready")
        );
        assert_eq!(
            runtime_chip_parts(RuntimeAssetState::Downloading { pct: 40 }),
            ("Downloading 40%".to_string(), "downloading")
        );
        assert_eq!(
            runtime_chip_parts(RuntimeAssetState::NotInstalled),
            ("Not installed".to_string(), "notinstalled")
        );
        assert_eq!(runtime_display_name("wasi"), "WASI");
        assert_eq!(runtime_display_name("lua"), "lua");
    }
}
