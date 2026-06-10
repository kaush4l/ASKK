// ASKK Python language-service worker: diagnostics-only, powered by Ruff WASM.
//
// Compiled to a single worker asset (`assets/lsp_py_worker.js`) with
// `bun run build`, which also copies the Ruff engine to
// `assets/lsp_py_ruff.wasm`. The worker speaks the ASKK language-service
// postMessage protocol:
//
//   in:  { method: "initialize", files: [{ path, text }] }
//        { method: "didOpen" | "didChange", path, text }
//        { method: "didClose", path }
//        { id, method: "completion", path, offset }
//        { id, method: "hover", path, offset }
//   out: { id, result: { items: [] } }      // completion (graceful empty)
//        { id, result: { contents: "" } }   // hover (graceful empty)
//        { method: "publishDiagnostics", path,
//          diagnostics: [{ from, to, severity, message }] }
//
// The build defines `import.meta.url` as `self.location.href` so the bundle
// stays valid as a *classic* worker script (wasm-bindgen's glue mentions
// `import.meta` in a dead branch we never take — we always pass the URL).
//
// `from`/`to` are UTF-16 code-unit offsets into the current document text;
// `severity` is "error" | "warning" | "info". Diagnostics are published after
// every didOpen/didChange of a `.py` document (an empty array clears stale
// squiggles). Ruff runs with its default rule set (the pycodestyle E4/E7/E9
// subset + pyflakes F), and syntax errors are always reported.

import init, { Workspace, PositionEncoding } from "@astral-sh/ruff-wasm-web";

// ---------------------------------------------------------------------------
// Ruff bootstrap (once per worker)
// ---------------------------------------------------------------------------

function wasmUrl() {
  // Preferred: an explicit `?wasm=` override on the worker script URL — the
  // app passes the content-hashed asset URL this way, because Dioxus renames
  // both files at build time. Fallback: the canonical sibling next to this
  // script, which is how the test harness and plain static hosting lay the
  // files out.
  const override = new URL(self.location.href).searchParams.get("wasm");
  if (override) return override;
  return new URL("lsp_py_ruff.wasm", self.location.href).toString();
}

const ruffReady = (async () => {
  await init({ module_or_path: wasmUrl() });
  // UTF-16 so Ruff's columns count the same code units as JS string indices.
  return new Workspace(Workspace.defaultSettings(), PositionEncoding.Utf16);
})();
ruffReady.catch((err) => {
  console.error("[lsp-python] Ruff failed to initialize:", err);
});

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

// path -> current full text, kept for every pushed document; only `.py`
// documents are linted.
const docs = new Map();

function isPython(path) {
  return typeof path === "string" && path.toLowerCase().endsWith(".py");
}

// ---------------------------------------------------------------------------
// Position conversion
// ---------------------------------------------------------------------------

// UTF-16 offset of the first code unit of each line. `\n` ends a line (which
// also covers `\r\n`); a lone `\r` ends one too, matching Ruff's line index.
function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit === 10 /* \n */ || (unit === 13 /* \r */ && text.charCodeAt(i + 1) !== 10)) {
      starts.push(i + 1);
    }
  }
  return starts;
}

// Ruff reports one-indexed { row, column }; with PositionEncoding.Utf16 the
// column is in UTF-16 code units, so the document offset is simply
// lineStart + (column - 1), clamped into the document.
function toOffset(starts, length, location) {
  if (!location || typeof location.row !== "number" || typeof location.column !== "number") {
    return 0;
  }
  const row = Math.min(Math.max(location.row, 1), starts.length);
  const offset = starts[row - 1] + Math.max(location.column - 1, 0);
  return Math.min(Math.max(offset, 0), length);
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

// Ruff surfaces syntax errors as diagnostics whose id is "invalid-syntax"
// (older engines used E999 or a null code) rather than a rule code.
function isSyntaxError(code) {
  return !code || code === "invalid-syntax" || code === "E999";
}

function severityFor(code) {
  if (isSyntaxError(code)) return "error";
  if (/^F\d/.test(code)) return "error";
  if (/^[EW]\d/.test(code)) return "warning";
  return "info";
}

function toDiagnostics(text, ruffDiagnostics) {
  const starts = lineStarts(text);
  const out = [];
  for (const item of ruffDiagnostics || []) {
    const code = item.code || null;
    let from = toOffset(starts, text.length, item.start_location);
    let to = toOffset(starts, text.length, item.end_location);
    if (to < from) [from, to] = [to, from];
    out.push({
      from,
      to,
      severity: severityFor(code),
      message: isSyntaxError(code) ? `SyntaxError: ${item.message}` : `${code} ${item.message}`,
    });
  }
  return out;
}

async function publish(path) {
  const text = docs.get(path);
  if (text === undefined || !isPython(path)) return;
  let diagnostics = [];
  try {
    const workspace = await ruffReady;
    diagnostics = toDiagnostics(text, workspace.check(text));
  } catch (err) {
    // Engine failure must not strand stale squiggles: publish a clean slate.
    console.error(`[lsp-python] lint failed for ${path}:`, err);
  }
  self.postMessage({ method: "publishDiagnostics", path, diagnostics });
}

// ---------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------

async function handle(msg) {
  switch (msg.method) {
    case "initialize":
      for (const file of msg.files || []) {
        if (file && typeof file.path === "string") {
          docs.set(file.path, typeof file.text === "string" ? file.text : "");
        }
      }
      // Not required by the protocol, but seeding diagnostics for the initial
      // set costs nothing and lets the client paint without a didOpen.
      for (const path of [...docs.keys()]) await publish(path);
      break;
    case "didOpen":
    case "didChange":
      if (typeof msg.path === "string") {
        docs.set(msg.path, typeof msg.text === "string" ? msg.text : "");
        await publish(msg.path);
      }
      break;
    case "didClose":
      if (typeof msg.path === "string" && docs.delete(msg.path) && isPython(msg.path)) {
        // Clear any stale squiggles for the closed document.
        self.postMessage({ method: "publishDiagnostics", path: msg.path, diagnostics: [] });
      }
      break;
    case "completion":
      // Diagnostics-only service: reply with a graceful empty result.
      if (msg.id !== undefined) self.postMessage({ id: msg.id, result: { items: [] } });
      break;
    case "hover":
      if (msg.id !== undefined) self.postMessage({ id: msg.id, result: { contents: "" } });
      break;
    default:
      // Unknown request: answer (empty) so the client never hangs on the id.
      if (msg.id !== undefined) self.postMessage({ id: msg.id, result: null });
  }
}

// Serialize message handling so diagnostics are always published in arrival
// order, even though the Ruff bootstrap is asynchronous.
let queue = Promise.resolve();

self.onmessage = (event) => {
  const msg = event.data;
  if (!msg || typeof msg.method !== "string") return;
  queue = queue
    .then(() => handle(msg))
    .catch((err) => console.error("[lsp-python] failed to handle message:", err));
};
