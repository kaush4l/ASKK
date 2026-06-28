// ASKK TypeScript/JavaScript language-service Web Worker.
//
// Compiled to a single classic-worker IIFE asset (`assets/lsp_ts_worker.js`)
// with `bun run build`. The TypeScript compiler and the default lib `.d.ts`
// files are embedded (see gen-libs.mjs), so the worker works fully offline.
//
// postMessage JSON protocol (offsets are UTF-16 code-unit offsets into the
// current document text; this is also TypeScript's native position unit):
//
//   in:  { method: "initialize", files: [{ path, text }] }
//        { method: "didOpen" | "didChange", path, text }
//        { method: "didClose", path }
//        { id, method: "completion", path, offset }
//        { id, method: "hover", path, offset }
//
//   out: { id, result: { items: [{ label, detail?, insertText?, kind? }] } }
//        { id, result: { contents } }                       // hover, plain string
//        { method: "publishDiagnostics", path, diagnostics: // unsolicited, debounced,
//          [{ from, to, severity: "error"|"warning"|"info", message }] }
//
// Requests always get a reply (empty result on failure) so the client never
// hangs. didClose keeps the file in the project so cross-file imports from
// still-open docs keep resolving; it only stops diagnostics for that path.

import ts from "typescript";
import {
  createSystem,
  createVirtualTypeScriptEnvironment,
} from "@typescript/vfs";
import { libFiles } from "./libs.generated.js";

const COMPILER_OPTIONS = {
  allowJs: true,
  checkJs: false, // plain .js is not type-checked unless it opts in via // @ts-check
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  jsx: ts.JsxEmit.Preserve,
  esModuleInterop: true,
  allowSyntheticDefaultImports: true,
  resolveJsonModule: true,
  skipLibCheck: true,
  strict: false,
  noEmit: true,
};

const DIAGNOSTICS_DEBOUNCE_MS = 150;

/** Lazily-created @typescript/vfs environment (built on first message). */
let env = null;
/** vfs path -> pending debounced diagnostics timer id. */
const pendingDiagnostics = new Map();

/** The vfs roots every doc path at "/". */
function vfsPath(path) {
  const p = String(path || "");
  return p.startsWith("/") ? p : `/${p}`;
}

/**
 * @typescript/vfs quirk: its getScriptSnapshot treats empty-string file
 * contents as "no file", so an empty doc would vanish from the project.
 * Store a lone newline instead — there are no meaningful offsets or
 * diagnostics in an empty doc, so positions are unaffected.
 */
function normalizeText(text) {
  const t = typeof text === "string" ? text : "";
  return t.length === 0 ? "\n" : t;
}

function ensureEnv(initialFiles) {
  if (env !== null) {
    for (const f of initialFiles) upsertFile(f.path, f.text);
    return;
  }
  const fsMap = new Map(libFiles);
  const roots = [];
  for (const f of initialFiles) {
    if (!f || typeof f.path !== "string") continue;
    const file = vfsPath(f.path);
    fsMap.set(file, normalizeText(f.text));
    roots.push(file);
  }
  env = createVirtualTypeScriptEnvironment(
    createSystem(fsMap),
    roots,
    ts,
    COMPILER_OPTIONS,
  );
}

function upsertFile(path, text) {
  const file = vfsPath(path);
  const content = normalizeText(text);
  if (env.getSourceFile(file) !== undefined) {
    env.updateFile(file, content);
  } else {
    env.createFile(file, content);
  }
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

const SEVERITY = {
  [ts.DiagnosticCategory.Error]: "error",
  [ts.DiagnosticCategory.Warning]: "warning",
  [ts.DiagnosticCategory.Suggestion]: "info",
  [ts.DiagnosticCategory.Message]: "info",
};

function scheduleDiagnostics(path) {
  const file = vfsPath(path);
  clearTimeout(pendingDiagnostics.get(file));
  pendingDiagnostics.set(
    file,
    setTimeout(() => {
      pendingDiagnostics.delete(file);
      publishDiagnostics(path);
    }, DIAGNOSTICS_DEBOUNCE_MS),
  );
}

function publishDiagnostics(path) {
  const file = vfsPath(path);
  if (env === null || env.getSourceFile(file) === undefined) return;
  let raw = [];
  try {
    raw = [
      ...env.languageService.getSyntacticDiagnostics(file),
      ...env.languageService.getSemanticDiagnostics(file),
    ];
  } catch (_err) {
    raw = [];
  }
  const docLength = (env.sys.readFile(file) ?? "").length;
  const diagnostics = raw.map((d) => {
    const start = typeof d.start === "number" ? d.start : 0;
    const length = typeof d.length === "number" ? d.length : 0;
    const from = Math.max(0, Math.min(start, docLength));
    const to = Math.max(from, Math.min(start + length, docLength));
    return {
      from,
      to,
      severity: SEVERITY[d.category] ?? "info",
      message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
    };
  });
  self.postMessage({ method: "publishDiagnostics", path, diagnostics });
}

// ---------------------------------------------------------------------------
// Completion / hover
// ---------------------------------------------------------------------------

/** Coarse completion kinds (aligned with CM6 autocomplete `type` names). */
function coarseKind(kind) {
  switch (kind) {
    case "var":
    case "let":
    case "const":
    case "local var":
    case "parameter":
    case "alias":
      return "variable";
    case "function":
    case "local function":
      return "function";
    case "method":
    case "construct":
    case "call":
    case "index":
      return "method";
    case "property":
    case "getter":
    case "setter":
    case "accessor":
      return "property";
    case "class":
      return "class";
    case "interface":
      return "interface";
    case "type":
    case "type parameter":
    case "primitive type":
      return "type";
    case "enum":
      return "enum";
    case "enum member":
      return "constant";
    case "module":
    case "external module name":
      return "namespace";
    case "keyword":
      return "keyword";
    default:
      return "text";
  }
}

function completion(msg) {
  let items = [];
  const file = vfsPath(msg.path);
  if (env !== null && env.getSourceFile(file) !== undefined) {
    const info = env.languageService.getCompletionsAtPosition(
      file,
      msg.offset,
      {},
    );
    if (info) {
      items = info.entries.map((entry) => {
        const item = { label: entry.name, kind: coarseKind(entry.kind) };
        const detail = [entry.kindModifiers, entry.kind]
          .filter((part) => typeof part === "string" && part.length > 0)
          .join(" ");
        if (detail.length > 0) item.detail = detail;
        if (entry.insertText) item.insertText = entry.insertText;
        return item;
      });
    }
  }
  self.postMessage({ id: msg.id, result: { items } });
}

function hover(msg) {
  let contents = "";
  const file = vfsPath(msg.path);
  if (env !== null && env.getSourceFile(file) !== undefined) {
    const info = env.languageService.getQuickInfoAtPosition(file, msg.offset);
    if (info) {
      contents = ts.displayPartsToString(info.displayParts);
      const docs = ts.displayPartsToString(info.documentation);
      if (docs.length > 0) contents += `\n\n${docs}`;
    }
  }
  self.postMessage({ id: msg.id, result: { contents } });
}

// ---------------------------------------------------------------------------
// Protocol dispatch
// ---------------------------------------------------------------------------

function handle(msg) {
  switch (msg.method) {
    case "initialize": {
      const files = Array.isArray(msg.files) ? msg.files : [];
      ensureEnv(files);
      // Seed diagnostics so the client gets squiggles without an extra edit.
      for (const f of files) {
        if (f && typeof f.path === "string") scheduleDiagnostics(f.path);
      }
      break;
    }
    case "didOpen":
    case "didChange": {
      if (typeof msg.path !== "string") break;
      ensureEnv([]);
      upsertFile(msg.path, msg.text);
      scheduleDiagnostics(msg.path);
      break;
    }
    case "didClose": {
      // Keep the file in the project (other open docs may import it); just
      // drop any pending diagnostics publish for it.
      const file = vfsPath(msg.path);
      clearTimeout(pendingDiagnostics.get(file));
      pendingDiagnostics.delete(file);
      break;
    }
    case "completion":
      completion(msg);
      break;
    case "hover":
      hover(msg);
      break;
    default:
      // Unknown request -> empty reply so the client never hangs.
      if (msg.id !== undefined) {
        self.postMessage({ id: msg.id, result: { items: [] } });
      }
      break;
  }
}

self.onmessage = (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object") return;
  try {
    handle(msg);
  } catch (err) {
    // A request must always get a reply; shape it for the method that asked.
    if (msg.id !== undefined) {
      const result =
        msg.method === "hover" ? { contents: "" } : { items: [] };
      self.postMessage({ id: msg.id, result });
    }
    // Surface the failure in the page console for debugging.
    console.error("lsp_ts_worker:", err);
  }
};
