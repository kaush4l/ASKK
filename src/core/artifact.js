// Live artifact — a filesystem instance, kept beside the conversation.
//
// Borrowed shape, from the old project (backend/kernel/artifact/
// artifact.js and the files artifact), simplified for this skeleton:
//
//   - An artifact is state an agent keeps beside its conversation,
//     rendered as its latest state only. Several agents may hold the
//     same artifact: each sees the others' writes at its next step.
//   - Its commands are the tools that change it (here: the files
//     tools, delegated, not re-implemented).
//   - It stays in sync with the instance it depends on: the old
//     host-backed artifacts were refreshed before each step's
//     render (refresh(agent)), reading their state from the host
//     (a terminal's tail, a file tree) so render() stayed
//     synchronous, and only reported a change when the twin state
//     differed. Here, expand() / openPreviews() re-read the open
//     files from disk, so state() after an external file change
//     reflects the new on-disk text on re-read — the artifact is
//     live-state expectation, not an immediate snapshot.
//
// NOT borrowed (yet): the old gate() / minCalls. In the old system
// gate(agent, answer) could refuse a final answer, and minCalls was
// the minimum number of artifact commands before a final answer was
// allowed. This skeleton has no loop and no final-answer gate, so
// there is nothing to gate yet — gate/minCalls are documented here
// as a later step, not implemented, and no code pretends otherwise.
//
// A live artifact IS a filesystem instance: it wraps the files tool
// instance for a location (the per-location singleton from
// src/core/files.js — it does NOT create a second independent files
// state for the same location). Its live state is the files state:
//   { id, root, tree, open, focus, modified }
// Open files are re-read before each step / after each change by the
// files tool itself; expand() re-reads them again, so an external
// edit shows up on the next expand.
//
// Persistence — agent state in personal/memory/agent/:
//   <personalBase>/memory/agent/<id>/state.md
//   <personalBase>/memory/agent/<id>/history.md
// Plain markdown only, NO state.json in this feature, so tools can
// read the state back with the files tools themselves. Nothing is
// ever written to public/defaults/. History and state carry logical
// workspace-relative paths only — never an absolute filesystem path,
// never an API key, never .env content.
//
//   state.md — current live state, rewritten on every state-changing
//     call: title, root, focus line, "## Open files", "## Modified
//     files", and "## Open file previews" (bounded previews).
//   history.md — append-only, one STANDARD ENTRY per agent action:
//     ## <ISO timestamp> · <action>
//     - agent: <name>
//     - path: <logical path>        (when applicable)
//     - detail: <free text, one line>
//     Plain reads/lists are NOT recorded (noise). History actions:
//     artifact.create, artifact.expand, files.open, files.close,
//     files.focus, files.write, files.edit, files.append.
//
//   const artifact = createLiveArtifact({ id, location, personalBase });
//   await artifact.open("src/core/tool.js");
//   const view = await artifact.expand(); // agent's expand call
//   artifact.twin(); // plain data for the UI, no functions, no keys
//   loadLiveArtifact({ id, location, personalBase }); // restore, or
//     start empty without writing until the first state-changing call
//
// The single-turn chat does NOT invoke tools or artifacts yet (no
// loop) — the artifact is loaded, listed, and shown in the UI, and
// expand() is a method call for later loop work.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { createFilesTool } from "./files.js";

export const PREVIEW_LINES = 120;
export const PREVIEW_CHARS = 8000;
export const STATE_PREVIEW_LINES = 40;
export const STATE_PREVIEW_CHARS = 2000;

const ARTIFACT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function checkId(id) {
  if (typeof id !== "string" || !ARTIFACT_ID.test(id)) {
    throw new Error(
      `live artifact id must be letters, digits, "-" or "_", got ${JSON.stringify(id)}`,
    );
  }
  return id;
}

function isSecretPath(logical) {
  const parts = String(logical).split("/").filter(Boolean);
  if (parts.includes(".git")) {
    return true;
  }
  const name = parts.at(-1) ?? "";
  if (name === ".mcp.json") {
    return true;
  }
  return /^\.env(\..+)?$/.test(name) && name !== ".env.example";
}

function cleanLogical(path) {
  return String(path ?? "")
    .split(/[\\/]+/)
    .filter((part) => part && part !== ".")
    .join("/");
}

function rootLabel(root) {
  return root === "" ? "workspace" : root;
}

function focusLabel(focus) {
  if (!focus || !focus.path) {
    return "none";
  }
  if (focus.from !== undefined && focus.from !== null) {
    const last = focus.from + (focus.lines ?? 1) - 1;
    return `${focus.path} (lines ${focus.from}–${last})`;
  }
  return focus.path;
}

function boundPreview(text, maxLines, maxChars) {
  const lines = String(text ?? "").split(/\r?\n/);
  const sliced = lines.slice(0, maxLines);
  let preview = sliced.join("\n");
  let truncated = lines.length > maxLines;
  if (preview.length > maxChars) {
    preview = preview.slice(0, maxChars);
    truncated = true;
  }
  return { preview, truncated, totalLines: lines.length };
}

// --- state.md ------------------------------------------------------------

// state: the artifact's state() shape (id, root, tree, open, focus,
// modified) plus, optionally, previews: { path: text } for open files.
// Previews are bounded (STATE_PREVIEW_LINES / STATE_PREVIEW_CHARS);
// the full text lives on disk in the original files, not here.
export function stateToMarkdown(state, previews = {}) {
  const open = state.open ?? [];
  const modified = state.modified ?? [];
  const lines = [];
  lines.push(`# Live artifact: ${state.id}`);
  lines.push("");
  lines.push(`- id: ${state.id}`);
  lines.push(`- root: ${rootLabel(state.root ?? "")}`);
  lines.push(`- focus: ${focusLabel(state.focus)}`);
  lines.push("");
  lines.push("## Open files");
  lines.push("");
  if (open.length === 0) {
    lines.push("- none");
  } else {
    for (const entry of open) {
      lines.push(`- ${entry.path} (${entry.lines ?? 0} lines)`);
    }
  }
  lines.push("");
  lines.push("## Modified files");
  lines.push("");
  if (modified.length === 0) {
    lines.push("- none");
  } else {
    for (const entry of modified) {
      lines.push(`- ${entry.path} (${entry.op})`);
    }
  }
  lines.push("");
  lines.push("## Open file previews");
  lines.push("");
  if (open.length === 0) {
    lines.push("- none");
  } else {
    for (const entry of open) {
      const text = previews[entry.path] ?? "";
      const { preview, truncated, totalLines } = boundPreview(
        text,
        STATE_PREVIEW_LINES,
        STATE_PREVIEW_CHARS,
      );
      lines.push(`### ${entry.path}`);
      lines.push("");
      lines.push("```");
      lines.push(preview);
      if (truncated) {
        lines.push(`… (truncated, ${totalLines} lines total)`);
      }
      lines.push("```");
      lines.push("");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

// Parse state.md back into objects. Previews are NOT parsed back:
// file contents live on disk and are re-read on load, so a parsed
// state carries paths, line counts, focus and modified ops only.
export function parseStateMarkdown(text) {
  const state = {
    id: null,
    root: "",
    open: [],
    focus: null,
    modified: [],
  };
  let section = null;
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    const title = line.match(/^# Live artifact: (.+)$/);
    if (title) {
      state.id = title[1].trim();
      continue;
    }
    const heading = line.match(/^## (.+)$/);
    if (heading) {
      section = heading[1].trim().toLowerCase();
      continue;
    }
    if (line.startsWith("### ")) {
      section = "preview";
      continue;
    }
    if (section === null) {
      const root = line.match(/^- root: (.+)$/);
      if (root) {
        const value = root[1].trim();
        state.root = value === "workspace" ? "" : value;
        continue;
      }
      const focus = line.match(/^- focus: (.+)$/);
      if (focus) {
        const value = focus[1].trim();
        if (value !== "none") {
          const sliced = value.match(/^(.+?) \(lines (\d+)–(\d+)\)$/);
          if (sliced) {
            const from = Number(sliced[2]);
            const last = Number(sliced[3]);
            state.focus = { path: sliced[1], from, lines: last - from + 1 };
          } else {
            state.focus = { path: value };
          }
        }
        continue;
      }
      const idLine = line.match(/^- id: (.+)$/);
      if (idLine && !state.id) {
        state.id = idLine[1].trim();
      }
      continue;
    }
    if (section === "open files") {
      const entry = line.match(/^- (.+?) \((\d+) lines\)$/);
      if (entry) {
        state.open.push({ path: entry[1], lines: Number(entry[2]) });
      }
    } else if (section === "modified files") {
      const entry = line.match(/^- (.+?) \((.+)\)$/);
      if (entry) {
        state.modified.push({ path: entry[1], op: entry[2] });
      }
    }
  }
  return state;
}

// --- history.md ----------------------------------------------------------

// One standard entry. Heading: "## <ISO timestamp> · <action>",
// then bullet fields. path is omitted when not applicable; detail
// is free text but must stay on one line (newlines are flattened).
export function historyEntryToMarkdown(entry) {
  const timestamp = entry.timestamp ?? entry.at ?? new Date().toISOString();
  const detail = String(entry.detail ?? "").replace(/\s*\r?\n\s*/g, " ");
  const lines = [`## ${timestamp} · ${entry.action}`];
  lines.push(`- agent: ${entry.agent ?? "default"}`);
  if (entry.path) {
    lines.push(`- path: ${cleanLogical(entry.path)}`);
  }
  lines.push(`- detail: ${detail}`);
  return `${lines.join("\n")}\n`;
}

// Append one entry to history.md. First argument is either a
// directory path (the <id> folder) or a live artifact object (it
// carries .dir). Creates the folder if needed. Never rewrites
// existing entries.
export function appendHistoryEntry(target, entry) {
  const dir =
    typeof target === "string"
      ? target
      : (target?.dir ?? target?.historyDir ?? null);
  if (!dir) {
    throw new Error("appendHistoryEntry needs a directory or an artifact");
  }
  if (!entry?.action) {
    throw new Error("appendHistoryEntry needs an action");
  }
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "history.md");
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  const separator = existing === "" || existing.endsWith("\n\n") ? "" : "\n";
  appendFileSync(file, `${separator}${historyEntryToMarkdown(entry)}\n`);
  return file;
}

export function readHistoryEntries(target) {
  const file =
    typeof target === "string" && target.endsWith(".md")
      ? target
      : join(
          typeof target === "string"
            ? target
            : (target?.dir ?? target?.historyDir ?? ""),
          "history.md",
        );
  if (!file || !existsSync(file)) {
    return [];
  }
  return parseHistoryEntries(readFileSync(file, "utf8"));
}

// Parse history.md back into entries, in file order. Unknown or
// malformed blocks are skipped, never thrown on — a tool reading
// history must not fail the whole read on one bad entry.
export function parseHistoryEntries(text) {
  const entries = [];
  let current = null;
  const flush = () => {
    if (current?.action) {
      entries.push(current);
    }
    current = null;
  };
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    const heading = line.match(/^## (.+?) · (.+)$/);
    if (heading) {
      flush();
      current = {
        timestamp: heading[1].trim(),
        action: heading[2].trim(),
        agent: "default",
        path: null,
        detail: "",
      };
      continue;
    }
    if (!current) {
      continue;
    }
    const field = line.match(/^- (agent|path|detail): (.*)$/);
    if (field) {
      current[field[1]] = field[2].trim();
    }
  }
  flush();
  return entries.map((entry) => ({
    timestamp: entry.timestamp,
    action: entry.action,
    agent: entry.agent,
    ...(entry.path ? { path: entry.path } : {}),
    detail: entry.detail,
  }));
}

// --- the live artifact ---------------------------------------------------

export class LiveArtifact {
  constructor({
    id = "default",
    location,
    filesTool,
    personalBase = null,
    agent = "default",
  } = {}) {
    this.id = checkId(id);
    this.agent = agent;
    this.files =
      filesTool ?? createFilesTool(location ?? process.cwd(), "files");
    this._filesLocation = this.files.location;
    // Server-side only: the personal folder this artifact persists
    // under, or null for an in-memory artifact. Never in twin().
    this.personalBase = personalBase
      ? isAbsolute(personalBase)
        ? personalBase
        : join(/* turbopackIgnore: true */ process.cwd(), personalBase)
      : null;
    this.dir = this.personalBase
      ? join(this.personalBase, "memory", "agent", this.id)
      : null;
    this._persist = Boolean(this.dir);
  }

  get statePath() {
    return this.dir ? join(this.dir, "state.md") : null;
  }

  get historyPath() {
    return this.dir ? join(this.dir, "history.md") : null;
  }

  // Current live state, plain data: logical paths only, no physical
  // location, no file contents, no keys. tree is whatever the files
  // tool last walked (refresh it with list() / expand()).
  state() {
    const files = this.files.state;
    return {
      id: this.id,
      root: files.root,
      tree: files.tree.map((entry) => ({ ...entry })),
      open: files.open.map((entry) => ({
        path: entry.path,
        at: entry.at,
        lines: entry.lines,
      })),
      focus: files.focus ? { ...files.focus } : null,
      modified: files.modified.map((entry) => ({
        path: entry.path,
        op: entry.op,
        at: entry.at,
      })),
    };
  }

  // Plain data for the UI. No functions, no physical paths, no keys.
  twin() {
    const state = this.state();
    return {
      element: "artifact",
      kind: "live-artifact",
      expectation: "live-state",
      id: state.id,
      root: state.root,
      treeCount: state.tree.length,
      open: state.open.map((entry) => entry.path),
      focus: state.focus,
      modified: state.modified,
    };
  }

  history() {
    return this.dir ? readHistoryEntries(this.dir) : [];
  }

  // Restore saved state into this artifact's files state. Open
  // files are re-read from disk (bounded, like files.open); secret
  // paths saved by mistake are skipped, never restored.
  _restore(parsed) {
    const files = this.files;
    if (parsed.root !== undefined) {
      files.state.root = parsed.root;
    }
    if (parsed.focus) {
      files.state.focus = { ...parsed.focus, by: null, at: null };
    }
    files.state.modified = (parsed.modified ?? []).map((entry) => ({
      path: entry.path,
      op: entry.op,
      at: null,
    }));
    const open = [];
    for (const entry of parsed.open ?? []) {
      if (isSecretPath(entry.path)) {
        continue;
      }
      try {
        const physical = resolve(this._filesLocation, entry.path);
        if (
          physical !== this._filesLocation &&
          !physical.startsWith(`${this._filesLocation}/`)
        ) {
          continue;
        }
        const text = readFileSync(physical, "utf8");
        if (text.includes("\0")) {
          continue;
        }
        open.push({
          path: entry.path,
          at: null,
          lines: text.split(/\r?\n/).length,
          text: text.slice(0, 12000),
        });
      } catch {
        // A saved open file that no longer exists is dropped on
        // load, not an error — the disk is the source of truth.
      }
    }
    files.state.open = open;
    return this;
  }

  _previewsForState() {
    const previews = {};
    for (const entry of this.files.state.open) {
      previews[entry.path] = entry.text ?? "";
    }
    return previews;
  }

  _saveState() {
    if (!this._persist) {
      return;
    }
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(
      this.statePath,
      stateToMarkdown(this.state(), this._previewsForState()),
      "utf8",
    );
  }

  _record(action, path, detail) {
    if (!this._persist) {
      return;
    }
    appendHistoryEntry(this.dir, {
      action,
      agent: this.agent,
      ...(path ? { path } : {}),
      detail,
    });
  }

  #tool(name) {
    const tool = this.files.tools.find((entry) => entry.name === name);
    if (!tool) {
      throw new Error(`files tool has no ${name}`);
    }
    return tool;
  }

  async #delegate(name, input, history) {
    const result = await this.#tool(name).run(input, {
      agent: { name: this.agent },
    });
    if (history) {
      this._record(history.action, history.path, history.detail(result));
    }
    this._saveState();
    return result;
  }

  // Delegated files calls. list/read are plain reads: no history,
  // no state rewrite (reads do not change the artifact's state).
  async list(path) {
    return this.#tool("files.list").run(path === undefined ? {} : { path }, {
      agent: { name: this.agent },
    });
  }

  async read(path, from, lines) {
    return this.#tool("files.read").run(
      {
        path,
        ...(from !== undefined ? { from } : {}),
        ...(lines !== undefined ? { lines } : {}),
      },
      { agent: { name: this.agent } },
    );
  }

  async open(path) {
    return this.#delegate(
      "files.open",
      { path },
      {
        action: "files.open",
        path: cleanLogical(path),
        detail: (result) => {
          const entry = (result.open ?? []).find(
            (item) => item.path === cleanLogical(path),
          );
          return `opened, ${entry?.lines ?? "?"} lines`;
        },
      },
    );
  }

  async close(path) {
    return this.#delegate(
      "files.close",
      { paths: path },
      {
        action: "files.close",
        path: path === "all" ? null : cleanLogical(path),
        detail: () => (path === "all" ? "closed all" : "closed"),
      },
    );
  }

  async focus(path, from, lines) {
    const input = { path };
    if (from !== undefined) {
      input.from = from;
    }
    if (lines !== undefined) {
      input.lines = lines;
    }
    return this.#delegate("files.focus", input, {
      action: "files.focus",
      path: cleanLogical(path),
      detail: (result) =>
        from !== undefined || lines !== undefined
          ? `focused section, ${result.lines ?? "?"} lines`
          : "focused",
    });
  }

  async write(path, content, why) {
    return this.#delegate(
      "files.write",
      { path, content, ...(why ? { why } : {}) },
      {
        action: "files.write",
        path: cleanLogical(path),
        detail: (result) => (result.created ? "created" : "wrote"),
      },
    );
  }

  async edit(path, oldText, newText, why) {
    return this.#delegate(
      "files.edit",
      { path, old: oldText, new: newText, ...(why ? { why } : {}) },
      {
        action: "files.edit",
        path: cleanLogical(path),
        detail: (result) => `edited, replaced ${result.replaced ?? 1}`,
      },
    );
  }

  async append(path, text, why) {
    return this.#delegate(
      "files.append",
      { path, text, ...(why ? { why } : {}) },
      {
        action: "files.append",
        path: cleanLogical(path),
        detail: () => "appended",
      },
    );
  }

  // The call the agent makes to get the expanded view. Re-reads
  // every open file from disk (so an external change shows up),
  // refreshes the tree, records artifact.expand, and saves state.
  async expand() {
    const read = this.#tool("files.read");
    const open = [];
    for (const entry of [...this.files.state.open]) {
      try {
        const result = await read.run(
          { path: entry.path },
          { agent: { name: this.agent } },
        );
        const { preview, truncated, totalLines } = boundPreview(
          result.text,
          PREVIEW_LINES,
          PREVIEW_CHARS,
        );
        open.push({
          path: entry.path,
          lines: totalLines,
          preview,
          truncated,
          totalLines,
        });
        // Keep the files state live: its stored text/lines now
        // match disk, so the next state.md preview is fresh too.
        const stored = this.files.state.open.find(
          (item) => item.path === entry.path,
        );
        if (stored) {
          stored.lines = totalLines;
          stored.text = result.text.slice(0, 12000);
        }
      } catch {
        // A file deleted externally drops out of the expanded view
        // but does not fail the whole expand.
      }
    }
    try {
      await this.#tool("files.list").run(
        { path: this.files.state.root },
        { agent: { name: this.agent } },
      );
    } catch {
      // Tree refresh is best-effort.
    }
    const view = {
      id: this.id,
      location: rootLabel(this.files.state.root),
      root: this.files.state.root,
      tree: this.files.state.tree.map((entry) => ({ ...entry })),
      openFiles: open,
      focus: this.files.state.focus ? { ...this.files.state.focus } : null,
      modified: this.state().modified,
    };
    this._record(
      "artifact.expand",
      null,
      `expanded, ${open.length} open files`,
    );
    this._saveState();
    return view;
  }

  // Read-only previews for the UI route: re-reads open files with a
  // bound, but records NO history and writes NO state — so GET
  // /api/artifact can show previews without side effects.
  async openPreviews() {
    const read = this.#tool("files.read");
    const out = [];
    for (const entry of this.files.state.open) {
      try {
        const result = await read.run(
          { path: entry.path },
          { agent: { name: this.agent } },
        );
        const { preview, truncated, totalLines } = boundPreview(
          result.text,
          PREVIEW_LINES,
          PREVIEW_CHARS,
        );
        out.push({
          path: entry.path,
          lines: totalLines,
          preview,
          truncated,
        });
      } catch {
        // Deleted externally: shown as gone, not an error.
        out.push({
          path: entry.path,
          lines: 0,
          preview: "",
          truncated: false,
          gone: true,
        });
      }
    }
    return out;
  }
}

// Create a live artifact. If saved state/history already exist under
// <personalBase>/memory/agent/<id>/, they are restored and NO new
// artifact.create entry is written. If they do not exist, the
// initial state.md is written and artifact.create is recorded —
// this is the first creation, and it is the only place that writes
// a create entry, so repeated loads do not flood history.
export function createLiveArtifact(options = {}) {
  const artifact = new LiveArtifact(options);
  if (!artifact._persist) {
    return artifact;
  }
  const hasState = existsSync(artifact.statePath);
  const hasHistory = existsSync(artifact.historyPath);
  if (hasState || hasHistory) {
    if (hasState) {
      artifact._restore(
        parseStateMarkdown(readFileSync(artifact.statePath, "utf8")),
      );
    }
    return artifact;
  }
  artifact._saveState();
  artifact._record(
    "artifact.create",
    null,
    `created, root: ${rootLabel(artifact.files.state.root)}`,
  );
  return artifact;
}

// Load a saved artifact, or start empty. Unlike createLiveArtifact,
// this NEVER writes on load: if no saved state exists, it returns an
// empty artifact and creates the folder only on the first
// state-changing call (open/close/focus/write/edit/append/expand).
// This is what the desk uses, so every API request that builds a
// desk does not create files or history entries.
export function loadLiveArtifact(options = {}) {
  const artifact = new LiveArtifact(options);
  if (!artifact._persist) {
    return artifact;
  }
  if (existsSync(artifact.statePath)) {
    artifact._restore(
      parseStateMarkdown(readFileSync(artifact.statePath, "utf8")),
    );
  }
  return artifact;
}
