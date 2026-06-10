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

/// TypeScript/JavaScript language-service worker (built from `scripts/lsp-ts/`,
/// see its package.json). Referenced via `asset!` so the bundler ships it; the
/// editor glue attaches it only once the CM6 bundle exposes
/// `attachLanguageService`.
const LSP_TS_WORKER: Asset = asset!("/assets/lsp_ts_worker.js");

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
// COORDINATOR: lights up when CM6 bundle v2 lands (AskkCM.attachLanguageService).
// The worker asset (assets/lsp_ts_worker.js, built from scripts/lsp-ts/) is a
// TS/JS language service; until the bundle exposes the hook this is a no-op.
if (typeof window.AskkCM?.attachLanguageService === "function") {
    window.AskkCM.attachLanguageService(HOST, {
        languages: ["typescript", "javascript"],
        workerUrl: "__ASKK_LSP_TS_WORKER__",
    });
}
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
                let glue =
                    EDITOR_GLUE.replace("__ASKK_LSP_TS_WORKER__", &LSP_TS_WORKER.to_string());
                let eval = document::eval(&glue);
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
