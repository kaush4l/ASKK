//! CodeMirror 6 editor pane.
//!
//! Bridges the bundled CodeMirror 6 asset (`assets/cm6_editor.js`, built from
//! `scripts/cm6-editor/` — see its package.json) into the Dioxus UI. The
//! bundle exposes a small `window.AskkCM` API; this component mounts an editor
//! into a host `div` and keeps one persistent `document::eval` channel open:
//! JS pushes user edits and Mod-S saves up via `dioxus.send`, Rust pushes
//! "open this document" commands down via [`document::Eval::send`].

use dioxus::prelude::*;
use serde::Deserialize;

const CM6_BUNDLE: Asset = asset!("/assets/cm6_editor.js");

/// Python diagnostics language-service worker (Ruff WASM), built from
/// `scripts/lsp-python/` — `bun run build` there regenerates both assets.
const LSP_PY_WORKER_JS: Asset = asset!("/assets/lsp_py_worker.js");
/// The Ruff engine the worker loads. Shipped as its own asset because Dioxus
/// content-hashes filenames, so the worker can't find it by its canonical
/// sibling name; we pass this URL via the worker's `?wasm=` query parameter.
const LSP_PY_RUFF_WASM: Asset = asset!("/assets/lsp_py_ruff.wasm");

/// An event reported by the mounted editor.
#[derive(Clone, PartialEq, Deserialize)]
pub struct EditorEvent {
    /// `true` once, right after the editor finishes mounting. The page should
    /// respond by (re)opening its active tab so a remount (e.g. navigating
    /// away and back) never shows a stale or empty document.
    #[serde(default)]
    pub ready: bool,
    /// Path of the file that was active in the editor when the edit happened.
    /// Reported by JS so a late event can't be misattributed after a tab
    /// switch.
    #[serde(default)]
    pub path: String,
    /// Full document text after the edit.
    #[serde(default)]
    pub text: String,
    /// `true` when the user pressed Mod-S (save) rather than typing.
    #[serde(default)]
    pub save: bool,
}

/// Glue executed via `document::eval`. Waits for the bundle global and the
/// host element (the `<script>` may still be loading when this runs), mounts
/// the editor, then services both directions of the channel until told to
/// close.
const EDITOR_GLUE: &str = r#"
const HOST = "askk-cm-host";
while (!(window.AskkCM && document.getElementById(HOST))) {
    await new Promise((resolve) => setTimeout(resolve, 50));
}
const token = window.AskkCM.mount(HOST, {
    onChange: (path, text) => dioxus.send({ path, text, save: false }),
    onSave: (path, text) => dioxus.send({ path, text, save: true }),
});
dioxus.send({ ready: true });
for (;;) {
    const msg = await dioxus.recv();
    if (!msg || msg.cmd === "close") break;
    if (msg.cmd === "open") window.AskkCM.open(HOST, msg.path, msg.content);
}
// Token-guarded: if a newer mount already replaced this editor (remount race),
// this teardown is stale and must not destroy the new instance.
window.AskkCM.destroy(HOST, token);
"#;

/// Ask the mounted editor to display `content` as the document for `path`
/// (replaces the buffer, switches syntax highlighting by extension, resets
/// undo history). A `None` controller (editor not mounted yet) is fine to
/// ignore: the mount handshake emits [`EditorEvent::ready`] and the page
/// re-opens its active tab then.
pub fn editor_open(controller: &Signal<Option<document::Eval>>, path: &str, content: &str) {
    if let Some(eval) = controller.peek().as_ref() {
        let _ = eval.send(serde_json::json!({
            "cmd": "open",
            "path": path,
            "content": content,
        }));
    }
}

/// Offer the Python diagnostics worker to the editor bundle, exactly once per
/// page. The current CM6 bundle (v1) exposes no language-service hook, so the
/// guarded JS resolves as a deliberate no-op and the app runs unchanged.
fn attach_python_language_service() {
    let glue = format!(
        r#"
const workerUrl = {worker} + "?wasm=" + encodeURIComponent({wasm});
// Same handshake as the editor glue: wait (bounded) for the bundle global.
for (let i = 0; i < 100 && !window.AskkCM; i += 1) {{
    await new Promise((resolve) => setTimeout(resolve, 50));
}}
// COORDINATOR: lights up when CM6 bundle v2 lands with
// `AskkCM.attachLanguageService(languages, workerUrl)`.
if (typeof window.AskkCM?.attachLanguageService === "function" && !window.__askkLspPyAttached) {{
    window.__askkLspPyAttached = true;
    window.AskkCM.attachLanguageService(["python"], workerUrl);
}}
"#,
        worker = serde_json::json!(LSP_PY_WORKER_JS.to_string()),
        wasm = serde_json::json!(LSP_PY_RUFF_WASM.to_string()),
    );
    document::eval(&glue);
}

/// The CodeMirror host pane. `controller` is owned by the parent so it can
/// push documents into the editor; `on_event` receives edits, saves and the
/// mount handshake.
#[component]
pub fn CodeEditor(
    mut controller: Signal<Option<document::Eval>>,
    on_event: EventHandler<EditorEvent>,
) -> Element {
    // Tell the JS side to stop its receive loop and tear the editor down when
    // this pane unmounts; the spawned forwarder below ends with the scope.
    use_drop(move || {
        if let Some(eval) = controller.peek().as_ref() {
            let _ = eval.send(serde_json::json!({ "cmd": "close" }));
        }
        controller.set(None);
    });

    rsx! {
        document::Script { src: CM6_BUNDLE }
        div {
            // Shared with EDITOR_GLUE and the AskkCM editor registry.
            id: "askk-cm-host",
            class: "ide-editor-host",
            onmounted: move |_| {
                attach_python_language_service();
                let eval = document::eval(EDITOR_GLUE);
                controller.set(Some(eval));
                spawn(async move {
                    let mut eval = eval;
                    while let Ok(event) = eval.recv::<EditorEvent>().await {
                        on_event.call(event);
                    }
                });
            },
        }
    }
}
