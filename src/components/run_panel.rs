//! Run & process management UI for the Workspace IDE.
//!
//! Three pieces, mounted from `workspace_page` so its own edits stay surgical:
//!
//! - [`RunButton`] — the editor-toolbar Run button. Dispatches by the active
//!   file's extension: `.js`/`.mjs` execute the open buffer in the sandboxed
//!   exec Web Worker, `.py`/`.wasm` go through the shell runtime contract
//!   ([`run_runtime`], stubbed until the sibling runtimes land), and `.html`
//!   toggles the existing sandboxed preview.
//! - [`RunPanel`] — the "Run" bottom-panel tab: the live process list (with
//!   Kill buttons backed by `process_registry`) and the runtime status strip.
//! - [`StorageUsageBadge`] — origin storage usage for the status bar, from
//!   `navigator.storage.estimate()`.
//!
//! The registry and status stores are Dioxus-free; this module subscribes by
//! polling them from short-interval futures (cancelled automatically on
//! unmount), which doubles as the tick that advances elapsed-time labels.

use crate::engine::browser_exec::{format_run_js, run_js_in_browser};
use crate::engine::process_registry::{self, ProcessInfo};
use crate::engine::runtime_status::{self, RuntimeAssetState};
use crate::shell::runtime::{RuntimeKind, ShellExecCtx, run_runtime};
use dioxus::prelude::*;
use wasm_bindgen_futures::spawn_local;

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

/// The editor-toolbar Run button: dispatches the active file by extension and
/// appends results to the shared terminal log. `code` is the active buffer
/// (possibly unsaved), so JS runs exactly what the editor shows.
#[component]
pub fn RunButton(
    path: Option<String>,
    code: String,
    mut busy: Signal<bool>,
    mut terminal: Signal<String>,
    on_focus_terminal: EventHandler<()>,
    on_toggle_preview: EventHandler<()>,
) -> Element {
    let dispatch = path
        .as_deref()
        .map(dispatch_for)
        .unwrap_or(RunDispatch::NoFile);
    let disabled = busy() || matches!(dispatch, RunDispatch::Unsupported | RunDispatch::NoFile);
    rsx! {
        button {
            class: "ide-action",
            title: run_tooltip(dispatch),
            disabled,
            onclick: move |_| {
                if busy() {
                    return;
                }
                let Some(path) = path.clone() else { return };
                match dispatch {
                    RunDispatch::Html => on_toggle_preview.call(()),
                    RunDispatch::Js => {
                        let code = code.clone();
                        on_focus_terminal.call(());
                        busy.set(true);
                        terminal.with_mut(|log| log.push_str(&format!("> run {path}\n")));
                        spawn_local(async move {
                            match run_js_in_browser(&code, 10_000).await {
                                Ok(value) => {
                                    let (_ok, text) = format_run_js(&value);
                                    terminal.with_mut(|log| {
                                        log.push_str(&text);
                                        log.push_str("\n\n");
                                    });
                                }
                                Err(err) => terminal
                                    .with_mut(|log| log.push_str(&format!("error: {err}\n\n"))),
                            }
                            busy.set(false);
                        });
                    }
                    RunDispatch::Python | RunDispatch::Wasm => {
                        let kind = if dispatch == RunDispatch::Python {
                            RuntimeKind::Python
                        } else {
                            RuntimeKind::Wasm
                        };
                        on_focus_terminal.call(());
                        busy.set(true);
                        terminal.with_mut(|log| log.push_str(&format!("> run {path}\n")));
                        spawn_local(async move {
                            let response =
                                run_runtime(kind, &[path], &ShellExecCtx::default()).await;
                            terminal.with_mut(|log| {
                                log.push_str(&response.to_transcript());
                                log.push_str("\n\n");
                            });
                            busy.set(false);
                        });
                    }
                    RunDispatch::Unsupported | RunDispatch::NoFile => {}
                }
            },
            if busy() { "Running…" } else { "▶ Run" }
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
        div { class: "ide-run",
            div { class: "ide-run-section",
                div { class: "ide-run-title", "Processes" }
                if process_rows.is_empty() {
                    div { class: "ide-run-empty",
                        "Nothing is running. Press ▶ Run on an open file to start an in-browser process."
                    }
                }
                for info in process_rows.iter() {
                    {
                        let id = info.id;
                        let elapsed = format_elapsed(info.started_ms, clock);
                        rsx! {
                            div { key: "{id}", class: "ide-run-proc",
                                span { class: "ide-run-kind", "{info.kind}" }
                                span { class: "ide-run-label", title: "{info.label}", "{info.label}" }
                                span { class: "ide-run-elapsed", "{elapsed}" }
                                button {
                                    class: "ide-kill-button",
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
            div { class: "ide-run-section",
                div { class: "ide-run-title", "Runtimes" }
                div { class: "ide-runtime-strip",
                    for (id, state) in runtime_chips.iter() {
                        {
                            let (state_text, modifier) = runtime_chip_parts(*state);
                            let name = runtime_display_name(id).to_string();
                            rsx! {
                                span { key: "{id}", class: "ide-runtime-chip {modifier}",
                                    span { class: "ide-runtime-name", "{name}" }
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
            span {
                class: "ide-status-storage",
                title: "Origin storage, from navigator.storage.estimate()",
                "{format_bytes(used)} used of {format_bytes(quota)}"
            }
        },
        None => rsx! {
            span { class: "ide-status-storage", title: "Origin storage estimate unavailable",
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
