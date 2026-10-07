// An engine's memory: its message list as a readable Markdown file in browser
// storage (see platform/storage.js), saved before every prompt render and restored
// when the engine starts.
//
// agents/<engine>/memory.md:
//
//   # Memory · lead
//
//   ## user · 2026-10-03 07:24
//   <!-- {"role":"user","at":"2026-10-03T07:24:31.000Z"} -->
//
//   What is an OLED display?
//
//   ## tool · planner · succeeded
//   <!-- {"role":"tool","name":"planner","kind":"agent","ok":true,"at":"..."} -->
//
//   1. Float 2. Kick 3. Breathe
//
// Each entry is a heading, a one-line JSON metadata comment, then the text.
// The comment marks entry boundaries, so text may itself contain headings.
//
// Summarizing moves the log into a new agents/<engine>/history-<time>.md (same
// format) and leaves only the summary in memory.md. Startup loads memory.md only.
// History is capped: only the newest HISTORY_KEEP files per engine are kept
// (ASKK_HISTORY_KEEP in .env, via the runtime; default 6), so the runtime
// folder stays bounded however many runs an engine works.

import { listDir, readFile, removeEntry, writeFile } from "@/backend/platform/storage"

// Fields kept besides the text. Prompts, raw output and reasoning are not
// part of memory — only the conversation.
const META_FIELDS = ["role", "from", "name", "kind", "ok", "stage", "parallel", "skipped", "action", "stopped", "error", "count", "archive", "at", "quest", "reports", "waiting", "status", "guidance"]

const ENTRY = /^## [^\n]*\n<!-- (\{.*\}) -->\n\n?/gm

export const HISTORY_KEEP = 6

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-")

function heading(message) {
  const time = message.at ? ` · ${message.at.slice(0, 16).replace("T", " ")}` : ""
  if (message.role === "tool") {
    return `## tool · ${message.name ?? "unparsed call"} · ${message.ok ? "succeeded" : "failed"}${time}`
  }
  const extra = message.action === "tool" ? " · tool call" : message.from ? ` · from ${message.from}` : ""
  return `## ${message.role}${extra}${time}`
}

// Tool messages store their output; the history line is rebuilt on load.
const textOf = (m) => (m.role === "tool" ? (m.output ?? "") : (m.content ?? ""))

export function serializeMemory(title, messages, kind = "Memory") {
  const entries = messages
    .filter((m) => textOf(m) || m.error)
    .map((m) => {
      const meta = Object.fromEntries(META_FIELDS.filter((f) => m[f] != null).map((f) => [f, m[f]]))
      return `${heading(m)}\n<!-- ${JSON.stringify(meta)} -->\n\n${textOf(m)}`
    })
  return [`# ${kind} · ${title}`, ...entries].join("\n\n") + "\n"
}

export function parseMemory(text) {
  const matches = [...text.matchAll(ENTRY)]
  return matches.map((match, i) => {
    const meta = JSON.parse(match[1])
    const start = match.index + match[0].length
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length
    const body = text.slice(start, end).trim()
    if (meta.role === "tool") {
      return { ...meta, output: body, content: `Result: ${meta.name}: ${body}` }
    }
    return { ...meta, content: body }
  })
}

export class Memory {
  constructor(name) {
    this.title = name
    this.dir = `agents/${slug(name)}`
    this.path = `${this.dir}/memory.md`
  }

  // Messages saved by a previous session ([] when none).
  async load() {
    const text = await readFile(this.path)
    return text ? parseMemory(text) : []
  }

  save(messages) {
    return writeFile(this.path, serializeMemory(this.title, messages))
  }

  // Write `messages` to a new history file beside memory.md; returns its path.
  async archive(messages) {
    const at = new Date().toISOString()
    const base = `${this.dir}/history-${at.replace(/[:.]/g, "-")}`
    let path = `${base}.md`
    for (let n = 2; (await readFile(path)) !== null; n++) path = `${base}-${n}.md` // never overwrite
    await writeFile(path, serializeMemory(`${this.title} · ${at}`, messages, "History"))
    await this.prune().catch(() => {}) // a cap that cannot be applied never fails the archive
    return path
  }

  // Delete the oldest history files beyond `keep` (names sort by time).
  async prune(keep = Number(globalThis.askkHistoryKeep) || HISTORY_KEEP) {
    const entries = await listDir(this.dir).catch(() => null)
    const history = (entries ?? []).filter((e) => e.type === "file" && /^history-.*\.md$/.test(e.name)).map((e) => e.name).sort()
    const old = history.slice(0, Math.max(0, history.length - keep))
    for (const name of old) await removeEntry(`${this.dir}/${name}`)
    return old.length
  }
}
