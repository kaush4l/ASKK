// ASKK CodeMirror 6 editor bundle entry.
//
// Compiled to a single IIFE asset (`assets/cm6_editor.js`) with
// `bun run build`, loaded by the WASM app via `asset!()` + `document::Script`,
// and driven from Rust through `document::eval` (see
// `src/components/code_editor.rs`). The wire contract:
//
//   window.AskkCM.mount(hostId, { onChange(path, text), onSave(path, text) })
//       -> token (0 if the host element is missing)
//   window.AskkCM.open(hostId, path, content)   // replace doc, reset history
//   window.AskkCM.getValue(hostId) -> string | null
//   window.AskkCM.destroy(hostId, token?)       // token-guarded teardown
//
// `onChange` fires only for user edits (never for programmatic `open`), and
// `onSave` fires on Mod-S inside the editor. Both report the path that was
// active when the edit happened so late events can't be misattributed after
// a tab switch.

import { basicSetup } from "codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { indentWithTab } from "@codemirror/commands";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";

function languageFor(path) {
  const name = (path || "").toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  switch (ext) {
    case "js":
    case "mjs":
    case "cjs":
      return javascript();
    case "jsx":
      return javascript({ jsx: true });
    case "ts":
      return javascript({ typescript: true });
    case "tsx":
      return javascript({ typescript: true, jsx: true });
    case "json":
      return json();
    case "html":
    case "htm":
      return html();
    case "css":
      return css();
    case "md":
    case "markdown":
      return markdown();
    case "py":
      return python();
    case "rs":
      return rust();
    default:
      return [];
  }
}

// Layered after oneDark so the editor chrome matches the ASKK dark palette.
const askkTheme = EditorView.theme(
  {
    "&": { backgroundColor: "#16131f", fontSize: "13px", height: "100%" },
    ".cm-gutters": {
      backgroundColor: "#131019",
      color: "#564b6e",
      border: "none",
    },
    ".cm-activeLine": { backgroundColor: "#231d33" },
    ".cm-activeLineGutter": { backgroundColor: "#231d33", color: "#a99cc4" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
  },
  { dark: true },
);

// hostId -> { view, language: Compartment, path, silent, callbacks, token }
const editors = new Map();

// Monotonic mount token. A remount (page navigation) can leave the previous
// mount's teardown running *after* the new mount; tokens let stale teardowns
// no-op instead of destroying the editor that just replaced them.
let mountCounter = 0;

function extensionsFor(record, path) {
  return [
    basicSetup,
    keymap.of([
      {
        key: "Mod-s",
        run: (view) => {
          const cb = record.callbacks.onSave;
          if (cb) cb(record.path, view.state.doc.toString());
          return true;
        },
      },
      indentWithTab,
    ]),
    oneDark,
    askkTheme,
    record.language.of(languageFor(path)),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged || record.silent) return;
      const cb = record.callbacks.onChange;
      if (cb) cb(record.path, update.state.doc.toString());
    }),
  ];
}

const api = {
  // Returns a mount token (> 0) on success, 0 when the host is missing. Pass
  // the token back to destroy() so a stale teardown cannot kill a newer mount.
  mount(hostId, callbacks) {
    const host = document.getElementById(hostId);
    if (!host) return 0;
    this.destroy(hostId);
    const record = {
      view: null,
      language: new Compartment(),
      path: "",
      silent: false,
      callbacks: callbacks || {},
      token: ++mountCounter,
    };
    record.view = new EditorView({
      state: EditorState.create({ doc: "", extensions: extensionsFor(record, "") }),
      parent: host,
    });
    editors.set(hostId, record);
    return record.token;
  },

  // Replace the document (fresh EditorState so undo history does not leak
  // across files) and switch the language by extension.
  open(hostId, path, content) {
    const record = editors.get(hostId);
    if (!record) return false;
    record.silent = true;
    record.path = path || "";
    record.view.setState(
      EditorState.create({
        doc: content || "",
        extensions: extensionsFor(record, record.path),
      }),
    );
    record.silent = false;
    return true;
  },

  getValue(hostId) {
    const record = editors.get(hostId);
    return record ? record.view.state.doc.toString() : null;
  },

  // Without a token this force-destroys (used by mount to replace an editor);
  // with a token it only destroys the mount that token belongs to.
  destroy(hostId, token) {
    const record = editors.get(hostId);
    if (!record) return;
    if (token !== undefined && record.token !== token) return; // stale teardown
    record.view.destroy();
    editors.delete(hostId);
  },
};

// Guard against the bundle being injected twice (e.g. duplicate <script>
// tags after page navigation): keep the first instance and its live editors.
if (!window.AskkCM) {
  window.AskkCM = api;
}
