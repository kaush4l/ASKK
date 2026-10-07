// The filesystem artifacts: the workspace as one live view per engine.
//
// FILESYSTEM (`filesystem`): the whole tree, names only down to the leaves
// (heavy folders such as node_modules listed but not expanded), plus the
// files this engine opened. The agent manages its own context:
//
//   fs.open({"path": "src/app.js"})    expand a file: its content is shown from now on
//   fs.close({"path": "src/app.js"})   collapse it again
//
// SHARED (`shared`, SharedArtifact): the team's shared space, the workspace's
// shared/ folder. Every file in it is always expanded; nothing to open. An
// agent shares a finding by writing there (fs.write / fs.append with a
// shared/… path), and every agent sees it at its next step, also agents
// working in parallel. FILESYSTEM leaves shared/ to it.
//
// Files are re-read before every step, so they always show the latest content
// (also after another agent's write), and each read counts as "seen" for the
// write tools' revision check. Expanded files in order: pinned, then paths in
// reverse order (days/2026-10-03 before days/2026-10-02). Logs (.jsonl, .log)
// show their tail, the newest rows.

import { Artifact } from "@/backend/core/artifact"
import { Tool } from "@/backend/core/tool"
import { markSeen } from "@/backend/features/filesystem/tools"
import { normalizePath, workspace } from "@/backend/features/filesystem/workspace"

const MAX_OPEN = 12 // files pinned at once
const MAX_FILES = 200 // files read per step
const MAX_FILE_CHARS = 40000 // characters of one file shown
const MAX_TOTAL_CHARS = 120000 // characters of all open files shown

const formatSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`)
const isLog = (path) => /\.(jsonl|log)$/.test(path)
const hidden = (name) => /^\.env/.test(name) && name !== ".env.example"

// Every file path in the tree, skipping folders that are not expanded.
const filePaths = (entries, parent = "", out = []) => {
  for (const entry of entries ?? []) {
    const path = parent ? `${parent}/${entry.name}` : entry.name
    if (entry.type === "dir") filePaths(entry.children, path, out)
    else if (entry.type === "file" && !hidden(entry.name)) out.push(path)
  }
  return out
}

const notFound = (error) => /^Not found/.test(error?.message ?? "")

// A code fence longer than any backtick run inside the text.
const fence = (text) => "`".repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)))

export const SHARED_FOLDER = "shared"

export class FilesystemArtifact extends Artifact {
  static type = "filesystem"
  static title = "FILESYSTEM"
  static folder = "" // the part of the workspace shown ("" = all of it)
  static expandAll = false // every file expanded, or only the opened ones
  static exclude = [SHARED_FOLDER] // top-level folders another artifact shows

  tree = null // workspace tree entries (latest refresh)
  treeError = null
  files = new Map() // open path -> { text, size, binary, truncated } | { error }
  notes = [] // what changed on its own since the last step (e.g. a file deleted)
  label = "the workspace"

  initialState() {
    return { open: [] } // paths this engine has open, in the order opened
  }

  async refresh() {
    const ws = await workspace()
    this.label =
      ws.kind === "host"
        ? `${ws.label} (a folder on the owner's computer, ${ws.writable ? "read + write" : "read-only"})`
        : "a workspace stored in this browser (read + write)"
    const { folder, expandAll, exclude } = this.constructor
    try {
      this.tree = (await ws.tree(folder)).entries.filter((entry) => !(entry.type === "dir" && exclude.includes(entry.name)))
      this.treeError = null
    } catch (error) {
      if (folder && notFound(error)) {
        this.tree = [] // the shared space starts empty
        this.treeError = null
      } else this.treeError = error.message
    }

    const pinned = this.state.open
    const rest = expandAll
      ? filePaths(this.tree, folder).filter((p) => !pinned.includes(p)).sort().reverse()
      : []
    this.order = [...pinned, ...rest].slice(0, MAX_FILES)
    this.unread = Math.max(0, pinned.length + rest.length - MAX_FILES)

    const files = new Map()
    const gone = []
    await Promise.all(
      this.order.map(async (path) => {
        try {
          const file = await ws.read(path)
          files.set(path, file)
          if (!file.binary) markSeen(this.engine, file.path, file.revision)
        } catch (error) {
          if (notFound(error)) {
            if (pinned.includes(path)) gone.push(path)
          }
          else files.set(path, { error: error.message })
        }
      })
    )
    this.files = files
    this.notes = gone.map((path) => `${path} was unpinned: it no longer exists.`)
    if (gone.length) this.setState({ open: this.state.open.filter((p) => !gone.includes(p)) })
  }

  // Live follow: the tree and the files this engine sees (path, size,
  // revision), published by the engine whenever they change.
  live() {
    if (!this.tree && !this.treeError) return null
    return {
      view: "filesystem",
      data: {
        label: this.label,
        folder: this.constructor.folder,
        error: this.treeError,
        tree: this.tree ?? [],
        open: this.state.open,
        files: (this.order ?? []).map((path) => {
          const file = this.files.get(path)
          return file?.error ? { path, error: file.error } : { path, size: file?.size ?? null, revision: file?.revision ?? null }
        }),
      },
    }
  }

  // ── rendering ──────────────────────────────────────────────────────────

  // Tree lines, two spaces per level; folders end with "/".
  #treeLines(entries, parent, lines) {
    const depth = (path) => (path ? path.split("/").length : 0)
    const indent = "  ".repeat(depth(parent) - depth(this.constructor.folder))
    for (const entry of entries) {
      const path = parent ? `${parent}/${entry.name}` : entry.name
      if (entry.type === "omitted") lines.push(`${indent}… ${entry.omitted} more not listed`)
      else if (entry.type === "dir") {
        lines.push(`${indent}${entry.name}/${entry.skipped ? " …" : ""}`)
        if (entry.children) this.#treeLines(entry.children, path, lines)
      } else {
        const link = entry.type === "link" ? " (link)" : ""
        lines.push(`${indent}${entry.name}${link}${this.state.open.includes(path) ? "  [open]" : ""}`)
      }
    }
    return lines
  }

  #fileLines(path, budget) {
    const file = this.files.get(path)
    if (!file) return { lines: [], used: 0 } // gone since the tree was read
    if (file.error) return { lines: [`#### ${path}`, `(cannot read: ${file.error})`], used: 0 }
    if (file.binary) return { lines: [`#### ${path} · ${formatSize(file.size)}`, "(binary file; not shown)"], used: 0 }
    let text = file.text
    const cut = []
    if (file.truncated) cut.push(`only the first ${formatSize(text.length)} of ${formatSize(file.size)} could be read`)
    const limit = Math.min(MAX_FILE_CHARS, Math.max(0, budget))
    if (text.length > limit) {
      if (isLog(path)) {
        text = text.slice(text.length - limit)
        text = text.slice(text.indexOf("\n") + 1) // whole rows only
        cut.push(`last ${text.length} of ${text.length + (file.text.length - text.length)} characters`)
      } else {
        text = text.slice(0, limit)
        cut.push(`shown up to ${limit} characters`)
      }
    }
    const marker = fence(text)
    const title = `#### ${path} · ${formatSize(file.size)}${cut.length ? ` — ${cut.join("; ")}` : ""}`
    return { lines: [title, marker, text, marker], used: text.length }
  }

  intro() {
    return [
      `Workspace: ${this.label}. The tree lists every file; only files you opened are shown, re-read before ` +
        'every step. fs.open({"path": "folder/file.ext"}) expands one, fs.close({"path": …}) collapses it ' +
        "again: keep open only what the work needs. A folder marked … is not expanded." +
        (this.constructor.exclude.includes(SHARED_FOLDER) ? ` ${SHARED_FOLDER}/ is shown in SHARED.` : ""),
    ]
  }

  render() {
    const lines = [`### ${this.constructor.title}`, "", ...this.intro(), ""]
    for (const note of this.notes) lines.push(`Note: ${note}`)
    if (this.notes.length) lines.push("")

    lines.push("Tree:")
    if (this.treeError) lines.push(`(unavailable: ${this.treeError})`)
    else if (!this.tree?.length) lines.push("(empty)")
    else this.#treeLines(this.tree, this.constructor.folder, lines)
    lines.push("")

    const order = this.order ?? this.state.open
    lines.push(`Files (${order.length}):${order.length ? "" : " none"}`)
    let budget = MAX_TOTAL_CHARS
    const skipped = []
    for (const path of order) {
      if (budget <= 0 && !this.files.get(path)?.error) {
        skipped.push(path)
        continue
      }
      const { lines: block, used } = this.#fileLines(path, budget)
      budget -= used
      if (block.length) lines.push("", ...block)
    }
    if (skipped.length) lines.push("", `Not shown (over budget): ${skipped.join(", ")}`)
    if (this.unread) lines.push("", `${this.unread} more files not read (over ${MAX_FILES}).`)
    return lines.join("\n")
  }

  // ── commands ───────────────────────────────────────────────────────────

  async #open({ path }) {
    if (typeof path !== "string" || !path.trim()) throw new Error('Expected {"path": "folder/file.ext"}.')
    const key = normalizePath(path)
    if (key === SHARED_FOLDER || key.startsWith(`${SHARED_FOLDER}/`)) {
      return `${key} is in the shared space: every file there is already shown in SHARED.`
    }
    if (this.state.open.includes(key)) return `${key} is already open.`
    if (this.state.open.length >= MAX_OPEN) {
      throw new Error(`${MAX_OPEN} files are open already. Close one that no longer helps first.`)
    }
    const ws = await workspace()
    const file = await ws.read(key)
    if (file.binary) throw new Error(`${file.path} is a binary file (${formatSize(file.size)}); it cannot be shown as text.`)
    this.files.set(file.path, file)
    markSeen(this.engine, file.path, file.revision)
    this.setState({ open: [...this.state.open, file.path] })
    const part = file.truncated || file.text.length > MAX_FILE_CHARS
      ? ` Only ${isLog(file.path) ? "its last" : "its first"} ${MAX_FILE_CHARS} characters are shown.`
      : ""
    return `Opened ${file.path} (${formatSize(file.size)}): it is shown under Files in the FILESYSTEM artifact.${part}`
  }

  async #close({ path }) {
    if (typeof path !== "string" || !path.trim()) throw new Error('Expected {"path": "folder/file.ext"}.')
    const key = normalizePath(path)
    if (!this.state.open.includes(key)) throw new Error(`${key} is not open.`)
    this.setState({ open: this.state.open.filter((p) => p !== key) })
    return `Closed ${key}.`
  }

  commands() {
    const pathInput = {
      type: "object",
      properties: { path: { type: "string", minLength: 1, maxLength: 1024 } },
      required: ["path"],
      additionalProperties: false,
    }
    return [
      new Tool({
        name: "fs.open",
        view: "file",
        description: "Expand a workspace file: its current content is shown in the FILESYSTEM artifact until closed.",
        inputs: pathInput,
        run: (inputs) => this.#open(inputs),
      }),
      new Tool({
        name: "fs.close",
        description: "Collapse a file opened with fs.open.",
        inputs: pathInput,
        run: (inputs) => this.#close(inputs),
      }),
    ]
  }
}

// The team's shared space: every file of the workspace's shared/ folder,
// always expanded, re-read before every step. No commands: agents write it
// with fs.write / fs.append.
export class SharedArtifact extends FilesystemArtifact {
  static type = "shared"
  static title = "SHARED"
  static folder = SHARED_FOLDER
  static expandAll = true
  static exclude = []

  intro() {
    return [
      `The team's shared space: ${SHARED_FOLDER}/ in ${this.label}. Every file in it is shown below with its ` +
        "current content, re-read before every step, so what another agent wrote (also one working in parallel) " +
        `is here at your next step. Share a finding others need by writing it here (fs.append to a ` +
        `${SHARED_FOLDER}/… file, one dated line).`,
    ]
  }

  // fs.read of a shared/ file (agents without FILESYSTEM keep fs.read): the
  // file is shown here already, so the result is a status line, not the
  // content a second time. Null when it is not shown whole.
  async show(path) {
    const key = normalizePath(path)
    if (!key.startsWith(`${SHARED_FOLDER}/`)) return null
    const file = await (await workspace()).read(key)
    if (file.binary || file.truncated || file.text.length > MAX_FILE_CHARS) return null
    const others = [...this.files].filter(([p, f]) => p !== file.path && f.text).reduce((n, [, f]) => n + Math.min(f.text.length, MAX_FILE_CHARS), 0)
    if (others + file.text.length > MAX_TOTAL_CHARS) return null
    markSeen(this.engine, file.path, file.revision)
    return `${file.path} (${formatSize(file.size)}) is shown with its current content in SHARED (re-read before every step); read it there.`
  }

  commands() {
    return []
  }
}
