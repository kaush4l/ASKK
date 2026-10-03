// The filesystem artifact: the workspace as one live view per engine.
//
// Rendered every step: the whole tree, names only down to the leaves (heavy
// folders such as node_modules listed but not expanded), and the files this
// engine has open, with their current content. Files are shared (the
// workspace); only the list of open files is this engine's state.
//
//   fs.open({"path": "src/app.js"})    add a file to the open files
//   fs.close({"path": "src/app.js"})   drop it once it no longer helps
//
// Open files are re-read before every step, so they always show the latest
// content (also after fs.write / fs.edit), and each read counts as "seen" for
// the write tools' revision check.

import { Artifact } from "@/backend/core/artifact"
import { Tool } from "@/backend/core/tool"
import { markSeen } from "@/backend/features/filesystem/tools"
import { normalizePath, workspace } from "@/backend/features/filesystem/workspace"

const MAX_OPEN = 12 // files open at once
const MAX_FILE_CHARS = 40000 // characters of one file shown
const MAX_TOTAL_CHARS = 120000 // characters of all open files shown

const formatSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`)
const notFound = (error) => /^Not found/.test(error?.message ?? "")

// A code fence longer than any backtick run inside the text.
const fence = (text) => "`".repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)))

export class FilesystemArtifact extends Artifact {
  static type = "filesystem"
  static title = "FILESYSTEM"

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
    try {
      this.tree = (await ws.tree("")).entries
      this.treeError = null
    } catch (error) {
      this.treeError = error.message
    }

    const files = new Map()
    const gone = []
    await Promise.all(
      this.state.open.map(async (path) => {
        try {
          const file = await ws.read(path)
          files.set(path, file)
          if (!file.binary) markSeen(this.engine, file.path, file.revision)
        } catch (error) {
          if (notFound(error)) gone.push(path)
          else files.set(path, { error: error.message })
        }
      })
    )
    this.files = files
    this.notes = gone.map((path) => `${path} was closed: it no longer exists.`)
    if (gone.length) this.setState({ open: this.state.open.filter((p) => !gone.includes(p)) })
  }

  // ── rendering ──────────────────────────────────────────────────────────

  // Tree lines, two spaces per level; folders end with "/".
  #treeLines(entries, parent, lines) {
    const indent = "  ".repeat(parent ? parent.split("/").length : 0)
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
    if (!file) return { lines: [`#### ${path}`, "(not loaded yet)"], used: 0 }
    if (file.error) return { lines: [`#### ${path}`, `(cannot read: ${file.error})`], used: 0 }
    if (file.binary) return { lines: [`#### ${path} · ${formatSize(file.size)}`, "(binary file; not shown)"], used: 0 }
    let text = file.text
    const cut = []
    if (file.truncated) cut.push(`only the first ${formatSize(text.length)} of ${formatSize(file.size)} could be read`)
    const limit = Math.min(MAX_FILE_CHARS, Math.max(0, budget))
    if (text.length > limit) {
      text = text.slice(0, limit)
      cut.push(`shown up to ${limit} characters`)
    }
    const marker = fence(text)
    const title = `#### ${path} · ${formatSize(file.size)}${cut.length ? ` — ${cut.join("; ")}` : ""}`
    return { lines: [title, marker, text, marker], used: text.length }
  }

  render() {
    const lines = [
      `### ${this.constructor.title}`,
      "",
      `Workspace: ${this.label}. Kept current: the tree and your open files are re-read before every step.`,
      'Open a file to see its content: fs.open({"path": "folder/file.ext"}). Close files that no longer help: ' +
        'fs.close({"path": "folder/file.ext"}). A folder marked … is not expanded.',
      "",
    ]
    for (const note of this.notes) lines.push(`Note: ${note}`)
    if (this.notes.length) lines.push("")

    lines.push("Tree:")
    if (this.treeError) lines.push(`(unavailable: ${this.treeError})`)
    else if (!this.tree?.length) lines.push("(empty)")
    else this.#treeLines(this.tree, "", lines)
    lines.push("")

    const open = this.state.open
    lines.push(`Open files (${open.length} of ${MAX_OPEN}):${open.length ? "" : " none"}`)
    let budget = MAX_TOTAL_CHARS
    for (const path of open) {
      const { lines: block, used } = this.#fileLines(path, budget)
      budget -= used
      lines.push("", ...block)
    }
    return lines.join("\n")
  }

  // ── commands ───────────────────────────────────────────────────────────

  async #open({ path }) {
    if (typeof path !== "string" || !path.trim()) throw new Error('Expected {"path": "folder/file.ext"}.')
    const key = normalizePath(path)
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
    return `Opened ${file.path} (${formatSize(file.size)}). Its content is under Open files in the FILESYSTEM artifact.`
  }

  async #close({ path }) {
    if (typeof path !== "string" || !path.trim()) throw new Error('Expected {"path": "folder/file.ext"}.')
    const key = normalizePath(path)
    if (!this.state.open.includes(key)) throw new Error(`${key} is not open.`)
    this.files.delete(key)
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
        description:
          "Open a workspace file: its content appears under Open files in the FILESYSTEM artifact and stays " +
          "current until you close it.",
        inputs: pathInput,
        run: (inputs) => this.#open(inputs),
      }),
      new Tool({
        name: "fs.close",
        description: "Close an open file you no longer need, to keep the context small.",
        inputs: pathInput,
        run: (inputs) => this.#close(inputs),
      }),
    ]
  }
}
