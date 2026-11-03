// Files — the filesystem tool group, a core tool.
//
// Load a folder into logical space: the tool is initialized by a
// location (a physical folder on disk), and everything inside it is
// addressed by workspace-relative paths — "src/core/tool.js", not
// "/Users/kaush/…/src/core/tool.js", and never ".." out of the root.
// A path that escapes the root, is absolute, or contains ".." is
// refused, not silently resolved.
//
// State (like the old files artifact, simplified):
//   { location, root, tree, open, focus, modified }
//   - location: the physical folder (server-side only, never sent
//     to the UI — the UI sees the logical root instead)
//   - root: the logical root currently shown ("" = the location,
//     or a focused folder, for every holder of this instance)
//   - tree: [{ path, size, dir }] under the root, refreshed on list
//   - open: [{ path, at, lines }] — files kept open; their text is
//     re-read on open, so an edit never works from a stale copy
//   - focus: { path, from, lines, by, at } | null — the focused
//     section (see files.focus) or folder
//   - modified: [{ path, op, at, why }] — latest change per path
//
// Two instances at the same location: per-location singleton by
// default (documented for Kaushal's correction). createFilesTool()
// with the same resolved location + id returns the cached instance,
// so two pointers at the same location SHARE state — a focus change
// by one holder changes the root for every holder, like the old
// perDesk files artifact. A different id gives a separate view
// over the same disk: independent open/focus state, but the same
// files underneath, so a write from one instance shows up in the
// other only on its next read (open re-reads, list re-walks).
// Whole-file writes are last-writer-wins; files.edit requires the
// exact old text to match once, so an edit on a changed file fails
// instead of silently overwriting it.
//
// Safety, carried from the old files tool: .env* files (except
// .env.example) and anything under a .git folder (config, hooks,
// or a .git file itself) are never read or written through these
// tools, whatever the path. .mcp.json is likewise refused.
//
// Gitignore (see gitignore.js and the README section "Gitignore:
// filtered views vs explicit reads"): tree/list/search views
// exclude paths matched by the root .gitignore (re-read on each
// list/tree/search); an explicit open/read/edit by a named path
// is not gitignore-filtered, only safety-refused.

import { existsSync, readFileSync } from "node:fs";
import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { emptyGitignore, isIgnored, parseGitignore } from "./gitignore.js";
import { Tool } from "./tool.js";

export const OPEN_MAX = 25;
const OPEN_FILE_CHARS = 12000;
const TREE_MAX = 800;
const TREE_DEPTH = 8;
const SEARCH_FILES = 300;
const SEARCH_BYTES = 512 * 1024;
const SEARCH_HITS = 60;
const LINE_CHARS = 200;
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".venv",
  "venv",
  "vendor",
  "__pycache__",
  ".cache",
  ".next",
  ".turbo",
  ".pytest_cache",
  ".mypy_cache",
]);

export function cleanPath(path) {
  const parts = String(path ?? "")
    .split(/[\\/]+/)
    .filter((part) => part && part !== ".");
  if (parts.includes("..")) {
    throw new Error(`${path}: ".." is not a workspace path`);
  }
  return parts.join("/");
}

function isSecretPath(logical) {
  const parts = logical.split("/").filter(Boolean);
  if (parts.includes(".git")) {
    return true;
  }
  const name = parts.at(-1) ?? "";
  if (name === ".mcp.json") {
    return true;
  }
  if (/^\.env(\..+)?$/.test(name) && name !== ".env.example") {
    return true;
  }
  return false;
}

function checkReadable(logical) {
  if (isSecretPath(logical)) {
    throw new Error(
      `${logical || "the workspace"}: refused — secrets and git code are never read or written through files tools`,
    );
  }
}

function splitPaths(input) {
  const raw = input?.paths ?? input?.path ?? "";
  if (Array.isArray(raw)) {
    return raw.map((entry) => String(entry).trim()).filter(Boolean);
  }
  return String(raw)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export class FilesGroup {
  constructor(location, id = "files") {
    if (typeof location !== "string" || location.trim() === "") {
      throw new Error("files tool needs a location folder");
    }
    this.id = id;
    this.location = resolve(/* turbopackIgnore: true */ location);
    // Logical state. root "" means the location itself.
    this.state = {
      location: this.location,
      root: "",
      tree: [],
      open: [],
      focus: null,
      modified: [],
    };
    this.gitignore = emptyGitignore();
    this.#loadGitignore();
    this.tools = this.#buildTools();
  }

  // (Re)read <root>/.gitignore, synchronously and best-effort.
  // Absent .gitignore = empty matcher, never an error. Re-read on
  // each list/tree/search so an edited .gitignore takes effect
  // without recreating the tool. Nested .gitignore files are NOT
  // parsed (root only, v1 — see gitignore.js).
  #loadGitignore() {
    try {
      const file = join(this.location, ".gitignore");
      if (existsSync(file)) {
        this.gitignore = parseGitignore(readFileSync(file, "utf8"));
        return;
      }
    } catch {
      // A broken .gitignore must not break the files tool.
    }
    this.gitignore = emptyGitignore();
  }

  // True if a tree/list/search view must hide this path. The root
  // .gitignore file itself is never filtered (it must stay visible).
  // Explicit open/read/edit by a named path do NOT use this — see
  // the README section "Gitignore: filtered views vs explicit reads".
  #isFiltered(logical, isDir) {
    if (logical === ".gitignore") {
      return false;
    }
    return isIgnored(this.gitignore, logical, isDir);
  }

  // The plain-data view for the UI: logical paths only, never the
  // physical location, and never file contents.
  stateForUI() {
    const state = this.state;
    return {
      root: state.root,
      treeCount: state.tree.length,
      gitignorePatterns: this.gitignore?.patterns?.length ?? 0,
      open: state.open.map((entry) => entry.path),
      focus: state.focus,
      modified: state.modified.map((entry) => ({
        path: entry.path,
        op: entry.op,
        at: entry.at,
      })),
    };
  }

  spec() {
    return {
      id: this.id,
      state: this.stateForUI(),
    };
  }

  #physical(logical) {
    const clean = cleanPath(logical);
    const physical = resolve(this.location, clean);
    if (
      physical !== this.location &&
      !physical.startsWith(this.location + sep)
    ) {
      throw new Error(`${logical}: outside the files root`);
    }
    return { clean, physical };
  }

  #recordModified(path, op, why) {
    const entry = {
      path,
      op,
      at: new Date().toISOString(),
      ...(why ? { why } : {}),
    };
    this.state.modified = [
      ...this.state.modified.filter((item) => item.path !== path),
      entry,
    ].slice(-30);
    return entry;
  }

  async #walk(dirLogical, depth, out) {
    if (depth > TREE_DEPTH || out.length >= TREE_MAX) {
      return;
    }
    const { physical } = this.#physical(dirLogical);
    let entries;
    try {
      entries = await readdir(physical, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= TREE_MAX) {
        return;
      }
      const logical = dirLogical ? `${dirLogical}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || this.#isFiltered(logical, true)) {
          continue;
        }
        out.push({ path: logical, size: 0, dir: true });
        await this.#walk(logical, depth + 1, out);
      } else if (entry.isFile()) {
        if (this.#isFiltered(logical, false)) {
          continue;
        }
        let size = 0;
        try {
          size = (await stat(join(physical, entry.name))).size;
        } catch {
          size = 0;
        }
        out.push({ path: logical, size, dir: false });
      }
    }
  }

  async #refreshTree() {
    this.#loadGitignore();
    const tree = [];
    await this.#walk(this.state.root, 0, tree);
    this.state.tree = tree;
    return tree;
  }

  async #readText(logical) {
    checkReadable(logical);
    const { physical } = this.#physical(logical);
    const text = await readFile(physical, "utf8");
    if (text.includes("\0")) {
      throw new Error(`${logical}: binary files are not read as text`);
    }
    return text;
  }

  async #list(input) {
    const path = cleanPath(input?.path ?? this.state.root);
    this.#loadGitignore();
    const { physical } = this.#physical(path);
    const entries = await readdir(physical, { withFileTypes: true });
    const out = [];
    for (const entry of entries) {
      const logical = path ? `${path}/${entry.name}` : entry.name;
      if (
        this.#isFiltered(logical, entry.isDirectory()) ||
        (entry.isDirectory() && SKIP_DIRS.has(entry.name))
      ) {
        continue;
      }
      let size = 0;
      if (entry.isFile()) {
        try {
          size = (await stat(join(physical, entry.name))).size;
        } catch {
          size = 0;
        }
      }
      out.push({
        name: entry.name,
        type: entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other",
        size,
      });
    }
    // Keep the tree fresh for the UI, but never fail a list on it.
    try {
      await this.#refreshTree();
    } catch {
      // Tree refresh is best-effort; the list itself already succeeded.
    }
    return { path, entries: out };
  }

  async #read(input) {
    const path = cleanPath(input?.path);
    if (!path) {
      throw new Error("files.read needs a path");
    }
    const text = await this.#readText(path);
    const lines = text.split(/\r?\n/);
    const from = Math.max(1, Number(input?.from ?? 1) || 1);
    const count =
      input?.lines === undefined || input?.lines === null
        ? lines.length
        : Math.max(0, Number(input.lines) || 0);
    const slice = lines.slice(from - 1, from - 1 + count);
    return {
      path,
      text: slice.join("\n"),
      from,
      lines: slice.length,
      totalLines: lines.length,
    };
  }

  async #write(input) {
    const path = cleanPath(input?.path);
    if (!path) {
      throw new Error("files.write needs a path");
    }
    checkReadable(path);
    const { physical } = this.#physical(path);
    const created = !existsSync(physical);
    await mkdir(dirname(physical), { recursive: true });
    await writeFile(physical, String(input?.content ?? ""), "utf8");
    this.#recordModified(path, created ? "create" : "write", input?.why);
    return { path, created };
  }

  async #edit(input) {
    const path = cleanPath(input?.path);
    if (!path) {
      throw new Error("files.edit needs a path");
    }
    if (typeof input?.old !== "string" || input.old === "") {
      throw new Error("files.edit needs an old passage to replace");
    }
    checkReadable(path);
    const text = await this.#readText(path);
    const matches = text.split(input.old).length - 1;
    if (matches === 0) {
      throw new Error(
        `files.edit: old text not found in ${path} — the file may have changed; re-read it and try again`,
      );
    }
    if (matches > 1 && input?.all !== true) {
      throw new Error(
        `files.edit: old text matches ${matches} times in ${path} — pass all: true to replace every match, or narrow the passage`,
      );
    }
    const next = input.all
      ? text.split(input.old).join(String(input?.new ?? ""))
      : text.replace(input.old, String(input?.new ?? ""));
    const { physical } = this.#physical(path);
    await writeFile(physical, next, "utf8");
    this.#recordModified(path, "edit", input?.why);
    return { path, replaced: input.all ? matches : 1 };
  }

  async #append(input) {
    const path = cleanPath(input?.path);
    if (!path) {
      throw new Error("files.append needs a path");
    }
    checkReadable(path);
    const { physical } = this.#physical(path);
    await mkdir(dirname(physical), { recursive: true });
    await appendFile(physical, String(input?.text ?? ""), "utf8");
    this.#recordModified(path, "append", input?.why);
    return { path };
  }

  async #search(input) {
    const text = String(input?.text ?? "");
    if (text === "") {
      throw new Error("files.search needs text to look for");
    }
    const root = cleanPath(input?.path ?? this.state.root);
    this.#loadGitignore();
    const needle = text.toLowerCase();
    const hits = [];
    const files = [];
    const collect = async (dirLogical) => {
      if (files.length >= SEARCH_FILES) {
        return;
      }
      const { physical } = this.#physical(dirLogical);
      let entries;
      try {
        entries = await readdir(physical, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (files.length >= SEARCH_FILES) {
          return;
        }
        const logical = dirLogical ? `${dirLogical}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name) && !this.#isFiltered(logical, true)) {
            await collect(logical);
          }
        } else if (entry.isFile()) {
          if (this.#isFiltered(logical, false)) {
            continue;
          }
          files.push(logical);
        }
      }
    };
    await collect(root);
    for (const file of files) {
      if (hits.length >= SEARCH_HITS) {
        break;
      }
      let content;
      try {
        content = await this.#readText(file);
      } catch {
        continue;
      }
      if (Buffer.byteLength(content) > SEARCH_BYTES) {
        continue;
      }
      const lines = content.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (hits.length >= SEARCH_HITS) {
          return;
        }
        if (line.toLowerCase().includes(needle)) {
          hits.push({
            path: file,
            line: index + 1,
            text: line.slice(0, LINE_CHARS),
          });
        }
      });
    }
    return { text, path: root, hits };
  }

  async #open(input) {
    const paths = splitPaths(input);
    if (paths.length === 0) {
      throw new Error("files.open needs paths");
    }
    for (const raw of paths) {
      const path = cleanPath(raw);
      const text = await this.#readText(path);
      const lines = text.split(/\r?\n/).length;
      this.state.open = this.state.open.filter((entry) => entry.path !== path);
      this.state.open.push({
        path,
        at: new Date().toISOString(),
        lines,
        text: text.slice(0, OPEN_FILE_CHARS),
      });
      if (this.state.open.length > OPEN_MAX) {
        this.state.open = this.state.open.slice(-OPEN_MAX);
      }
    }
    return {
      open: this.state.open.map((entry) => ({
        path: entry.path,
        lines: entry.lines,
      })),
    };
  }

  async #close(input) {
    const raw = splitPaths(input);
    if (raw.length === 1 && raw[0] === "all") {
      this.state.open = [];
    } else {
      const paths = new Set(raw.map((entry) => cleanPath(entry)));
      this.state.open = this.state.open.filter(
        (entry) => !paths.has(entry.path),
      );
    }
    return {
      open: this.state.open.map((entry) => entry.path),
    };
  }

  // Focus — the section tool for when a file is too big, and the
  // folder tool for when a tree is too big. Two forms, one command:
  //
  //   files.focus({ path: "src/core/files.js", from: 120, lines: 40 })
  //     -> only that slice of the file, and state.focus records
  //        { path, from, lines, by, at }. The agent reads a section,
  //        not the whole file, and the section stays recorded as
  //        the current focus.
  //   files.focus({ path: "src/core" })
  //     -> a folder: the tree's root becomes that folder, for every
  //        holder of this instance (state.root changes, and
  //        state.focus records the folder). "" resets to the location.
  async #focus(input, ctx) {
    const path = cleanPath(input?.path ?? "");
    const hasSlice = input?.from !== undefined || input?.lines !== undefined;
    if (hasSlice) {
      if (!path) {
        throw new Error("files.focus with from/lines needs a file path");
      }
      const read = await this.#read({
        path,
        from: input.from ?? 1,
        lines: input.lines,
      });
      this.state.focus = {
        path,
        from: read.from,
        lines: read.lines,
        by: ctx?.agent?.name ?? null,
        at: new Date().toISOString(),
      };
      return { ...read, focus: this.state.focus };
    }
    // Folder focus (or reset to the location with "").
    if (path !== "") {
      const { physical } = this.#physical(path);
      let info;
      try {
        info = await stat(physical);
      } catch {
        throw new Error(`files.focus: ${path} does not exist`);
      }
      if (!info.isDirectory()) {
        // A file without a slice is just read whole, without
        // changing the root — but record it as the focus.
        const read = await this.#read({ path });
        this.state.focus = {
          path,
          from: 1,
          lines: read.lines,
          by: ctx?.agent?.name ?? null,
          at: new Date().toISOString(),
        };
        return { ...read, focus: this.state.focus };
      }
    }
    this.state.root = path;
    this.state.focus = {
      path,
      by: ctx?.agent?.name ?? null,
      at: new Date().toISOString(),
    };
    await this.#refreshTree();
    return {
      root: this.state.root,
      focus: this.state.focus,
      treeCount: this.state.tree.length,
    };
  }

  #buildTools() {
    const make = (name, description, input, expectation, run) =>
      new Tool({ name, description, input, expectation, run });
    return [
      make(
        "files.list",
        "list a folder: names, type, sizes",
        { path: "a folder (default: the tree's root, optional)" },
        "immediate",
        (input) => this.#list(input),
      ),
      make(
        "files.read",
        "read a file once with line numbers (a one-off look; open keeps it in view); from/lines for a slice of a big one",
        {
          path: "the file",
          from: "first line (default 1, optional)",
          lines: "how many (default all, optional)",
        },
        "immediate",
        (input) => this.#read(input),
      ),
      make(
        "files.write",
        "write a whole file (folders are created); only inside the files root",
        {
          path: "the file",
          content: "its full text",
          why: "the change's note (optional)",
        },
        "immediate",
        (input) => this.#write(input),
      ),
      make(
        "files.edit",
        "replace one exact passage of a file (old must match once, whitespace included; all: true replaces each) — fails if the file changed underneath, never silently overwrites it",
        {
          path: "the file",
          old: "the exact text now",
          new: "its replacement",
          all: "true: every match (optional)",
          why: "the change's note (optional)",
        },
        "immediate",
        (input) => this.#edit(input),
      ),
      make(
        "files.append",
        "add text at the end of a file (created if missing)",
        {
          path: "the file",
          text: "the lines to add",
          why: "the change's note (optional)",
        },
        "immediate",
        (input) => this.#append(input),
      ),
      make(
        "files.search",
        "find the lines that hold a text (case-insensitive) in the files under a folder, or in one file",
        {
          text: "what to look for",
          path: "a folder, or one file (default: the tree's root, optional)",
        },
        "immediate",
        (input) => this.#search(input),
      ),
      make(
        "files.open",
        "keep files open: each one's current text is re-read on open and stays in view until you close it — at most 25; close what you are done with to keep the view small",
        { paths: "the files, comma-separated (or one path)" },
        "live-state",
        (input) => this.#open(input),
      ),
      make(
        "files.close",
        "close open files (their text leaves the view)",
        { paths: 'the files, comma-separated, or "all"' },
        "live-state",
        (input) => this.#close(input),
      ),
      make(
        "files.focus",
        'focus a section of a big file — files.focus({ path, from, lines }) returns only that slice and records it as the focus — or focus a folder as the tree\'s root (for every holder of this instance); "" resets to the location',
        {
          path: 'the file section or folder ("" = the location)',
          from: "first line of a file section (optional)",
          lines: "how many lines of a file section (optional)",
        },
        "live-state",
        (input, ctx) => this.#focus(input, ctx),
      ),
    ];
  }
}

// Per-location singleton cache: key = resolved location + id.
const filesCache = new Map();

export function createFilesTool(location, id = "files") {
  const resolved = resolve(/* turbopackIgnore: true */ location ?? "");
  const key = `${resolved}\0${id}`;
  if (!filesCache.has(key)) {
    filesCache.set(key, new FilesGroup(location, id));
  }
  return filesCache.get(key);
}

// Test helper: drop the cache so tests (and a fresh desk) start clean.
export function clearFilesToolCache() {
  filesCache.clear();
}
