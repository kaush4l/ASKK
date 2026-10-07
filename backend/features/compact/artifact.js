// The compact artifact (`compact`): size caps on the team's working files,
// kept by compaction — not summarization. agent.md lists the caps, one line each:
//
//   artifacts: [compact]
//   compact:
//     - shared/notes.md: 12000                          a file and its cap (characters)
//     - ledger.jsonl: 40000
//     - shared/<date>/ -> days/<date>/shared/: 2        dated folders: keep the newest 2,
//                                                       move older ones to the target
//
// Checked before a step (at most once a minute). A file over its cap is
// compacted to COMPACT_TO of it, in its own format:
//   .jsonl   rows sharing an "id" fold into one (later keys win, "fields" merged),
//            long text fields are cut, then the oldest rows go until it fits — deterministic, no model
//   other    one compactor pass (core/single-call.js createCompactor): repeats,
//            common knowledge and superseded lines dropped, useful items kept
// The file as it was is archived first in the engine's storage
// (compacted/<path>/<time>.txt, newest KEEP_ARCHIVES kept; the runtime folder
// in local mode), so nothing is lost before it is replaced. The write passes
// the revision it read: a file changed meanwhile is retried at the next check.
// `intel.compact {path, max_chars?}` compacts one file now.

import { Artifact } from "@/backend/core/artifact"
import { createCompactor } from "@/backend/core/single-call"
import { Tool } from "@/backend/core/tool"
import { listDir, removeEntry, writeFile } from "@/backend/platform/storage"
import { markSeen } from "@/backend/features/filesystem/tools"
import { normalizePath, workspace } from "@/backend/features/filesystem/workspace"

const CHECK_MS = 60 * 1000
export const COMPACT_TO = 0.6
const KEEP_ARCHIVES = 3
const MAX_FIELD = 240 // characters a .jsonl text field keeps when a file is over its cap
const DATE = /^\d{4}-\d{2}-\d{2}$/

const formatSize = (n) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}K`)
const parent = (path) => path.split("/").slice(0, -1).join("/")
const base = (path) => path.split("/").pop()

// agent.md `compact:` → [{ kind: "file", path, max } | { kind: "dated", from, to, keep }]
export function compactRules(agent) {
  return (agent?.compact ?? []).flatMap((line) => {
    const match = /^\s*(.+?)\s*:\s*(\d+)\s*$/.exec(String(line))
    if (!match) return []
    const [, key, number] = match
    const value = Number(number)
    const move = /^(.+?)\s*->\s*(.+)$/.exec(key)
    if (move) {
      const [from, to] = [move[1], move[2]].map((p) => p.trim().replace(/\/+$/, ""))
      if (!from.endsWith("/<date>") || !to.includes("<date>")) return []
      return [{ kind: "dated", from: normalizePath(from.slice(0, -"/<date>".length)), to, keep: Math.max(1, value) }]
    }
    return [{ kind: "file", path: normalizePath(key), max: Math.max(1000, value) }]
  })
}

// Rows sharing an id fold into the first one; then the oldest rows go until
// the text fits `target`. Lines that are not JSON stay as they are.
export function foldJsonl(text, target) {
  const rows = []
  const byId = new Map()
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    let row
    try {
      row = JSON.parse(line)
    } catch {
      rows.push(line)
      continue
    }
    const id = row && typeof row === "object" && row.id != null ? String(row.id) : null
    if (id === null) {
      rows.push(row)
      continue
    }
    const first = byId.get(id)
    if (!first) {
      const copy = { ...row }
      byId.set(id, copy)
      rows.push(copy)
      continue
    }
    const { id: _id, fields, ...rest } = row
    Object.assign(first, rest, fields && typeof fields === "object" ? fields : {})
  }
  const serialize = () => rows.map((row) => (typeof row === "string" ? row : JSON.stringify(row)))
  let lines = serialize()
  let size = lines.reduce((n, l) => n + l.length + 1, 0)
  // Then long prose fields are cut (the numbers live in the short ones).
  if (size > target) {
    for (const row of rows) {
      if (typeof row !== "object") continue
      for (const [key, value] of Object.entries(row)) {
        if (typeof value === "string" && value.length > MAX_FIELD) row[key] = `${value.slice(0, MAX_FIELD)}…`
      }
    }
    lines = serialize()
    size = lines.reduce((n, l) => n + l.length + 1, 0)
  }
  let dropped = 0
  while (lines.length > 1 && size > target) {
    size -= lines.shift().length + 1
    dropped++
  }
  return { text: lines.join("\n") + "\n", folded: byId.size, dropped }
}

export class CompactArtifact extends Artifact {
  static type = "compact"
  static title = "INTELLIGENCE CAPS"

  #checked = 0
  #busy = false

  initialState() {
    // files: path -> { size, max, at?, from?, to?, note?, error? }; moved: last folders moved
    return { files: {}, moved: [], at: null }
  }

  get rules() {
    return compactRules(this.engine?.agent)
  }

  async refresh() {
    if (this.#busy || Date.now() - this.#checked < CHECK_MS) return
    this.#checked = Date.now()
    this.#busy = true
    try {
      await this.check()
    } finally {
      this.#busy = false
    }
  }

  async check() {
    const ws = await workspace()
    if (!ws.writable) return
    const files = { ...this.state.files }
    let moved = this.state.moved
    for (const rule of this.rules) {
      try {
        if (rule.kind === "dated") {
          const done = await this.#moveDated(ws, rule)
          if (done.length) moved = [...done, ...moved].slice(0, 6)
          continue
        }
        const entry = (await ws.list(parent(rule.path)).catch(() => null))?.entries?.find((e) => e.name === base(rule.path))
        files[rule.path] = { ...(files[rule.path] ?? {}), size: entry?.size ?? 0, max: rule.max, error: null }
        if (entry && entry.size > rule.max) files[rule.path] = { ...files[rule.path], ...(await this.compactFile(rule.path, rule.max)) }
      } catch (error) {
        const key = rule.path ?? rule.from
        files[key] = { ...(files[key] ?? {}), error: error.message }
      }
    }
    this.setState({ files, moved, at: new Date().toISOString() })
  }

  // Compact one file to COMPACT_TO of `max`. Returns its new record.
  async compactFile(path, max) {
    const ws = await workspace()
    const file = await ws.read(path)
    if (file.binary) throw new Error(`${path} is binary.`)
    const original = file.text
    const target = Math.floor(max * COMPACT_TO)
    this.engine?.update?.({ activity: { phase: "compacting", name: path } })
    let text
    let note
    if (path.endsWith(".jsonl")) {
      const result = foldJsonl(original, target)
      text = result.text
      note = `${result.folded} ids folded, ${result.dropped} oldest rows archived`
    } else {
      text = await this.#llmCompact(path, original, target, max)
      note = "compacted"
    }
    if (text.length >= original.length) return { size: original.length, max, error: "compaction did not shrink it" }
    await this.#archive(path, original)
    const written = await ws.write(path, text, { revision: file.revision })
    markSeen(this.engine, written.path, written.revision)
    return { size: text.length, max, at: new Date().toISOString(), from: original.length, to: text.length, note, error: null }
  }

  async #llmCompact(path, original, target, max) {
    const model = this.engine?.model
    if (!model) throw new Error("No model to compact with.")
    const compactor = createCompactor()
    let text = original
    for (const goal of [target, Math.floor(target * 0.7)]) {
      const input = `File: ${path} — ${text.length} characters now; cap ${max}; write at most ${goal} characters.\n\n${text}`
      const { parsed } = await compactor.call(input, { model })
      const out = String(parsed.response ?? "").trim()
      // An empty or tiny answer is a failed call, never a compaction.
      if (out.length < Math.min(200, original.length * 0.05)) throw new Error("the compactor returned almost nothing")
      text = `${out}\n`
      if (text.length <= max) return text
    }
    // Still over: keep the head (frontmatter, headings) and the newest lines.
    const lines = text.split("\n")
    const head = lines.slice(0, 12).join("\n")
    const tail = []
    let size = head.length + 40
    for (let i = lines.length - 1; i >= 12 && size + lines[i].length + 1 <= target; i--) {
      tail.unshift(lines[i])
      size += lines[i].length + 1
    }
    return `${head}\n…(older lines cut to fit the cap)\n${tail.join("\n")}\n`
  }

  // The file as it was, in the engine's storage; the newest KEEP_ARCHIVES kept.
  async #archive(path, text) {
    const dir = `compacted/${path.replace(/\//g, "__")}`
    await writeFile(`${dir}/${new Date().toISOString().replace(/[:.]/g, "-")}.txt`, text)
    const entries = (await listDir(dir).catch(() => null)) ?? []
    const names = entries.filter((e) => e.type === "file").map((e) => e.name).sort()
    for (const name of names.slice(0, Math.max(0, names.length - KEEP_ARCHIVES))) await removeEntry(`${dir}/${name}`)
  }

  // Dated folders under rule.from beyond the newest `keep` move to rule.to.
  async #moveDated(ws, rule) {
    const listing = await ws.list(rule.from).catch(() => null)
    const dates = (listing?.entries ?? []).filter((e) => e.type === "dir" && DATE.test(e.name)).map((e) => e.name).sort().reverse()
    const moved = []
    for (const date of dates.slice(rule.keep)) {
      const from = `${rule.from}/${date}`
      const to = normalizePath(rule.to.replace("<date>", date))
      await this.#copyTree(ws, from, to)
      await ws.remove(from, { recursive: true })
      moved.push(`${from} → ${to}`)
    }
    return moved
  }

  async #copyTree(ws, from, to) {
    const listing = await ws.list(from)
    for (const entry of listing.entries ?? []) {
      if (entry.type === "dir") await this.#copyTree(ws, `${from}/${entry.name}`, `${to}/${entry.name}`)
      else if (entry.type === "file") {
        const file = await ws.read(`${from}/${entry.name}`)
        if (file.binary || file.truncated) throw new Error(`${from}/${entry.name} cannot be moved as text.`)
        const existing = await ws.read(`${to}/${entry.name}`).catch(() => null)
        await ws.write(`${to}/${entry.name}`, file.text, { revision: existing?.revision ?? null })
      }
    }
  }

  // Live follow: each capped file's last compaction and the folders moved.
  live() {
    const files = Object.entries(this.state.files ?? {}).map(([path, record]) => ({ path, ...record }))
    if (!files.length && !this.state.moved?.length) return null
    return { view: "list", data: { items: files.map((f) => ({ name: f.path, detail: f })), moved: this.state.moved ?? [], at: this.state.at ?? null } }
  }

  render() {
    const rules = this.rules
    if (!rules.length) return ""
    const lines = [
      `## ${CompactArtifact.title}`,
      "",
      `Files this team keeps small. Over its cap a file is compacted to ${COMPACT_TO * 100}% of it, keeping its format: ` +
        "repeats, common knowledge and superseded lines go; dated numbers, open items and evidenced lessons stay. " +
        "Write a new line only when it adds something the file does not already say.",
    ]
    for (const rule of rules) {
      if (rule.kind === "dated") {
        lines.push(`- ${rule.from}/<date>/: newest ${rule.keep} kept here; older ones move to ${rule.to}`)
        continue
      }
      const record = this.state.files[rule.path] ?? {}
      const last = record.at ? ` · compacted ${record.at.slice(0, 16).replace("T", " ")}Z ${formatSize(record.from)} → ${formatSize(record.to)}` : ""
      const error = record.error ? ` · last check failed: ${record.error}` : ""
      lines.push(`- ${rule.path}: ${record.size != null ? formatSize(record.size) : "?"} / ${formatSize(rule.max)}${last}${error}`)
    }
    if (this.state.moved.length) lines.push(`Moved: ${this.state.moved.slice(0, 3).join("; ")}`)
    return lines.join("\n")
  }

  commands() {
    return [
      new Tool({
        name: "intel.compact",
        view: "data",
        description:
          "Compact one workspace file now (not a summary: same format; repeats, common knowledge and superseded lines go). " +
          "Uses its cap from INTELLIGENCE CAPS; max_chars sets one for a file that has none.",
        inputs: {
          type: "object",
          properties: { path: { type: "string", minLength: 1 }, max_chars: { type: "integer", minimum: 1000 } },
          required: ["path"],
          additionalProperties: false,
        },
        run: async ({ path, max_chars }) => {
          const key = normalizePath(path)
          const max = max_chars ?? this.rules.find((r) => r.kind === "file" && r.path === key)?.max
          if (!max) throw new Error(`${key} has no cap; pass max_chars.`)
          const record = await this.compactFile(key, max)
          this.setState({ files: { ...this.state.files, [key]: record } })
          return record.error ? `${key} not compacted: ${record.error}.` : `${key}: ${record.from} → ${record.to} characters (${record.note}).`
        },
      }),
    ]
  }
}
