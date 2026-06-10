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
//   window.AskkCM.setDiagnostics(hostId, path, diagnostics) -> boolean
//       // diagnostics: [{from, to, severity: "error"|"warning"|"info", message}]
//       // (UTF-16 code-unit offsets into the current doc). Applied only when
//       // `path` matches the host's open doc; stale paths are dropped.
//   window.AskkCM.attachLanguageService(hostId, { workerUrl, languages })
//       -> id (0 on failure)
//       // Spawns a Worker speaking the language-service protocol below and
//       // wires it into completion, hover and diagnostics for docs whose
//       // language (by extension) is listed in `languages`. Re-attaching the
//       // same workerUrl replaces (respawns) the previous worker. Multiple
//       // services per host coexist; requests are routed by language.
//
// Language-service worker protocol (JSON via postMessage):
//   to worker:   {method:"initialize", files:[{path,text}]}
//                {method:"didOpen"|"didChange", path, text}   (didChange ~300ms debounced)
//                {method:"didClose", path}
//                {id, method:"completion", path, offset}
//                {id, method:"hover", path, offset}
//   from worker: {id, result:{items:[{label, detail?, insertText?, kind?}]}}
//                {id, result:{contents}}
//                {method:"publishDiagnostics", path, diagnostics:[...]}
//
// `onChange` fires only for user edits (never for programmatic `open`), and
// `onSave` fires on Mod-S inside the editor. Both report the path that was
// active when the edit happened so late events can't be misattributed after
// a tab switch.

import { basicSetup } from "codemirror";
import { EditorView, keymap, hoverTooltip } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { indentWithTab } from "@codemirror/commands";
import { autocompletion } from "@codemirror/autocomplete";
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { java } from "@codemirror/lang-java";

function extOf(path) {
  const name = (path || "").toLowerCase();
  return name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
}

function languageFor(path) {
  switch (extOf(path)) {
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
    case "java":
      return java();
    default:
      return [];
  }
}

// Language id used to route language-service requests. Must stay consistent
// with the extension mapping in `languageFor` above.
function languageIdFor(path) {
  switch (extOf(path)) {
    case "js":
    case "mjs":
    case "cjs":
    case "jsx":
      return "javascript";
    case "ts":
    case "tsx":
      return "typescript";
    case "json":
      return "json";
    case "html":
    case "htm":
      return "html";
    case "css":
      return "css";
    case "md":
    case "markdown":
      return "markdown";
    case "py":
      return "python";
    case "rs":
      return "rust";
    case "java":
      return "java";
    default:
      return "";
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
    // Descendant selector: the hover dom may sit inside either a lone
    // .cm-tooltip or a combined .cm-tooltip-section wrapper.
    ".askk-cm-hover": {
      maxWidth: "480px",
      padding: "4px 8px",
      whiteSpace: "pre-wrap",
    },
  },
  { dark: true },
);

// hostId -> editor record (see mount() for the full shape).
const editors = new Map();

// Monotonic mount token. A remount (page navigation) can leave the previous
// mount's teardown running *after* the new mount; tokens let stale teardowns
// no-op instead of destroying the editor that just replaced them.
let mountCounter = 0;

// Monotonic language-service id, shared across hosts.
let serviceCounter = 0;

const DID_CHANGE_DEBOUNCE_MS = 300;
const REQUEST_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Language-service plumbing
// ---------------------------------------------------------------------------

// Services attached to `record` whose `languages` cover the open doc.
function activeServices(record) {
  const lang = languageIdFor(record.path);
  if (!lang) return [];
  const out = [];
  for (const service of record.services.values()) {
    if (service.languages.has(lang)) out.push(service);
  }
  return out;
}

// Post a request to one service worker; resolves with `result` (or null on
// timeout / teardown — never rejects, so callers can Promise.all freely).
function serviceRequest(service, method, params) {
  return new Promise((resolve) => {
    const id = ++service.nextRequestId;
    const timer = setTimeout(() => {
      service.pending.delete(id);
      resolve(null);
    }, REQUEST_TIMEOUT_MS);
    service.pending.set(id, { resolve, timer });
    service.worker.postMessage({ id, method, ...params });
  });
}

// Resolve every in-flight request with null (used on detach so completion /
// hover callers are not left hanging on a terminated worker).
function flushPending(service) {
  for (const entry of service.pending.values()) {
    clearTimeout(entry.timer);
    entry.resolve(null);
  }
  service.pending.clear();
}

function detachService(record, service) {
  if (service.changeTimer !== null) clearTimeout(service.changeTimer);
  service.changeTimer = null;
  flushPending(service);
  service.worker.terminate();
  record.services.delete(service.workerUrl);
}

function detachAllServices(record) {
  for (const service of Array.from(record.services.values())) {
    detachService(record, service);
  }
}

// Tell each attached service about a document switch: close the old path
// (tracked per service as `openPath`), open the new one when the service
// handles its language. Pending requests keep running; responses for the old
// doc are dropped by the path guards in the completion / hover sources.
function notifyServicesOpen(record) {
  const newLang = languageIdFor(record.path);
  for (const service of record.services.values()) {
    if (service.changeTimer !== null) {
      clearTimeout(service.changeTimer);
      service.changeTimer = null;
    }
    if (service.openPath && service.openPath !== record.path) {
      service.worker.postMessage({ method: "didClose", path: service.openPath });
      service.openPath = null;
    }
    if (record.path && newLang && service.languages.has(newLang)) {
      service.openPath = record.path;
      service.worker.postMessage({
        method: "didOpen",
        path: record.path,
        text: record.view.state.doc.toString(),
      });
    }
  }
}

// Debounced didChange fan-out, called from the editor's update listener on
// user edits only.
function scheduleDidChange(record) {
  for (const service of activeServices(record)) {
    if (service.openPath !== record.path) continue;
    if (service.changeTimer !== null) clearTimeout(service.changeTimer);
    const path = record.path;
    service.changeTimer = setTimeout(() => {
      service.changeTimer = null;
      // The doc may have switched while the timer was pending; skip if stale.
      if (record.path !== path || !editors.has(record.hostId)) return;
      service.worker.postMessage({
        method: "didChange",
        path,
        text: record.view.state.doc.toString(),
      });
    }, DID_CHANGE_DEBOUNCE_MS);
  }
}

// Clamp incoming offsets into the doc and normalize severity so a sloppy
// worker can never make CM6 throw on an out-of-range diagnostic.
function toLintDiagnostics(state, list) {
  const len = state.doc.length;
  const out = [];
  for (const d of Array.isArray(list) ? list : []) {
    if (!d || typeof d.message !== "string") continue;
    const rawFrom = Number(d.from);
    const rawTo = Number(d.to);
    const from = Math.min(Math.max(Number.isFinite(rawFrom) ? rawFrom : 0, 0), len);
    const to = Math.min(Math.max(Number.isFinite(rawTo) ? rawTo : from, from), len);
    const severity =
      d.severity === "error" || d.severity === "warning" || d.severity === "info"
        ? d.severity
        : "info";
    out.push({ from, to, severity, message: d.message });
  }
  return out;
}

function applyDiagnostics(record, path, diagnostics) {
  if ((path || "") !== record.path) return false; // stale path: drop silently
  const diags = toLintDiagnostics(record.view.state, diagnostics);
  record.view.dispatch(setDiagnostics(record.view.state, diags));
  return true;
}

// CM6 completion source backed by the attached language services. Routes by
// the open doc's language and merges items across services.
function serviceCompletionSource(record) {
  return async (context) => {
    const services = activeServices(record);
    if (!services.length) return null;
    const word = context.matchBefore(/[\w$]+/);
    if (!word && !context.explicit) return null;
    const path = record.path;
    const results = await Promise.all(
      services.map((s) => serviceRequest(s, "completion", { path, offset: context.pos })),
    );
    if (record.path !== path) return null; // doc switched mid-flight
    const items = [];
    for (const result of results) {
      if (result && Array.isArray(result.items)) items.push(...result.items);
    }
    if (!items.length) return null;
    return {
      from: word ? word.from : context.pos,
      options: items
        .filter((item) => item && typeof item.label === "string")
        .map((item) => ({
          label: item.label,
          detail: typeof item.detail === "string" ? item.detail : undefined,
          type: typeof item.kind === "string" ? item.kind : undefined,
          apply: typeof item.insertText === "string" ? item.insertText : item.label,
        })),
      validFor: /^[\w$]*$/,
    };
  };
}

// Hover tooltip backed by the attached language services. All matching
// services are queried in parallel (so one slow worker cannot stall the
// rest); the first non-empty `contents` in service order wins. Rendered as
// plain text (worker output is untrusted).
function serviceHoverSource(record) {
  return async (view, pos) => {
    const services = activeServices(record);
    if (!services.length) return null;
    const path = record.path;
    const results = await Promise.all(
      services.map((s) => serviceRequest(s, "hover", { path, offset: pos })),
    );
    if (record.path !== path) return null; // doc switched mid-flight
    for (const result of results) {
      if (result && result.contents) {
        const text = String(result.contents);
        return {
          pos,
          create() {
            const dom = document.createElement("div");
            dom.className = "askk-cm-hover";
            dom.textContent = text;
            return { dom };
          },
        };
      }
    }
    return null;
  };
}

// Completion compartment content: route through the services when at least
// one covers the open doc's language, otherwise leave `basicSetup`'s default
// autocompletion in charge (word / language completions).
function completionExtFor(record) {
  return activeServices(record).length
    ? autocompletion({ override: [serviceCompletionSource(record)] })
    : [];
}

function reconfigureCompletion(record) {
  record.view.dispatch({
    effects: record.completion.reconfigure(completionExtFor(record)),
  });
}

// ---------------------------------------------------------------------------
// Editor assembly
// ---------------------------------------------------------------------------

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
    record.completion.of(completionExtFor(record)),
    lintGutter(),
    hoverTooltip(serviceHoverSource(record)),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged || record.silent) return;
      const cb = record.callbacks.onChange;
      if (cb) cb(record.path, update.state.doc.toString());
      scheduleDidChange(record);
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
      hostId,
      view: null,
      language: new Compartment(),
      completion: new Compartment(),
      path: "",
      silent: false,
      callbacks: callbacks || {},
      token: ++mountCounter,
      // workerUrl -> attached language service (worker + routing state).
      services: new Map(),
    };
    record.view = new EditorView({
      state: EditorState.create({ doc: "", extensions: extensionsFor(record, "") }),
      parent: host,
    });
    editors.set(hostId, record);
    return record.token;
  },

  // Replace the document (fresh EditorState so undo history does not leak
  // across files) and switch the language by extension. Diagnostics reset
  // with the state; attached services get didClose / didOpen notifications.
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
    notifyServicesOpen(record);
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
    detachAllServices(record);
    record.view.destroy();
    editors.delete(hostId);
  },

  // Set lint diagnostics for the doc at `path`. Returns true when applied,
  // false when the host is missing or `path` is not the open doc (stale
  // updates are dropped silently by design).
  setDiagnostics(hostId, path, diagnostics) {
    const record = editors.get(hostId);
    if (!record) return false;
    return applyDiagnostics(record, path, diagnostics);
  },

  // Spawn a language-service worker and wire it to this host. Returns a
  // service id (> 0) or 0 when the host is missing / options are invalid.
  // Re-attaching the same workerUrl replaces (respawns) the previous worker.
  attachLanguageService(hostId, options) {
    const record = editors.get(hostId);
    if (!record || !options || typeof options.workerUrl !== "string") return 0;
    const languages = Array.isArray(options.languages)
      ? options.languages.filter((l) => typeof l === "string" && l.length > 0)
      : [];
    if (!languages.length) return 0;

    const previous = record.services.get(options.workerUrl);
    if (previous) detachService(record, previous);

    let worker;
    try {
      worker = new Worker(options.workerUrl);
    } catch (err) {
      console.warn("AskkCM: failed to spawn language service worker", options.workerUrl, err);
      // The same-URL predecessor (if any) was already detached above; make
      // sure the completion compartment reflects the remaining services.
      reconfigureCompletion(record);
      return 0;
    }

    const service = {
      id: ++serviceCounter,
      workerUrl: options.workerUrl,
      worker,
      languages: new Set(languages),
      pending: new Map(), // request id -> { resolve, timer }
      nextRequestId: 0,
      changeTimer: null,
      openPath: null,
    };

    worker.onmessage = (event) => {
      const msg = event.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.method === "publishDiagnostics") {
        const live = editors.get(hostId);
        if (live && live.services.get(service.workerUrl) === service) {
          applyDiagnostics(live, msg.path, msg.diagnostics);
        }
        return;
      }
      if (msg.id !== undefined && service.pending.has(msg.id)) {
        const entry = service.pending.get(msg.id);
        service.pending.delete(msg.id);
        clearTimeout(entry.timer);
        entry.resolve(msg.result || null);
      }
    };
    worker.onerror = () => {
      // A broken worker should not wedge completion/hover callers.
      flushPending(service);
    };

    record.services.set(service.workerUrl, service);

    const lang = languageIdFor(record.path);
    const matchesOpenDoc = Boolean(record.path) && service.languages.has(lang);
    const text = record.view.state.doc.toString();
    worker.postMessage({
      method: "initialize",
      files: matchesOpenDoc ? [{ path: record.path, text }] : [],
    });
    if (matchesOpenDoc) {
      service.openPath = record.path;
      worker.postMessage({ method: "didOpen", path: record.path, text });
    }
    reconfigureCompletion(record);
    return service.id;
  },
};

// Guard against the bundle being injected twice (e.g. duplicate <script>
// tags after page navigation): keep the first instance and its live editors.
if (!window.AskkCM) {
  window.AskkCM = api;
}
