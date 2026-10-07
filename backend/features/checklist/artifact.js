// The checklist artifact: what a run must have done before it ends, ticked
// item by item with evidence, one live view per engine.
//
// Two lists from agent.md, one "id: what done means" per line:
//
//   artifacts: [checklist]
//   checklist:            THIS RUN: fresh for every run; blocks the answer
//     - picks: top five trades read and ranked
//     - wake: next run booked with what it should look at
//   daily:                TODAY: fresh every day (America/New_York), kept
//     - morning: 08:30 morning run done      across the day's runs; the
//     - close: 16:15 close graded            script the day follows
//
// A run is one origin (the owner's request or a scheduled wake, with every
// report that continues it). Both lists are rendered every step; the engine
// refuses a final answer while RUN items are open (BaseEngine.pendingChecks),
// so each ends ticked or skipped with its reason. Day items are ticked by the
// run that does them; the next run sees where the day stands.
//
//   checklist.tick({"id": "picks", "evidence": "shared/2026-10-05/momentum.md: 2 picks"})
//   checklist.skip({"id": "group", "reason": "nothing to send today"})
//
// agent.md `checklist_file: checklist.md` keeps TODAY in that workspace file
// instead (the owner reads and edits it; re-read before every step). The first
// run of a new day archives yesterday's file to days/<date>/checklist.md and
// writes a clean one from `daily:`. checklist.add puts more items on it while
// the day runs. An open item whose time has come (a leading "HH:MM" ET, or no
// time) also blocks the answer, so the lead works the list down until the day
// is done.
//
//   # Checklist 2026-10-07
//   - [x] plan: 08:30 plan.md written from book.read
//     ↳ 08:52 ET: shared/2026-10-07/plan.md, equity $971.83
//   - [ ] close: 16:15 grader graded the day
//   - [-] weekend: 15:30 Fridays only — weekend spread
//     ↳ 15:31 ET: skipped: not Friday

import { Artifact } from "@/backend/core/artifact"
import { Tool } from "@/backend/core/tool"
import { markSeen } from "@/backend/features/filesystem/tools"
import { ConflictError, normalizePath, workspace } from "@/backend/features/filesystem/workspace"

const ZONE = "America/New_York" // the owner's day

export function ownerDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
}

function ownerTime(now = new Date()) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(now)
}

// "id: text" lines from agent.md (`checklist`, or `daily`) → [{ id, text }]
export function checklistItems(agent, field = "checklist") {
  return (agent?.[field] ?? []).flatMap((line) => {
    const match = /^\s*([a-z0-9_-]+)\s*:\s*(.+)$/i.exec(String(line))
    return match ? [{ id: match[1].toLowerCase(), text: match[2].trim() }] : []
  })
}

const MARKS = { " ": "open", x: "ticked", X: "ticked", "-": "skipped" }
const BOXES = { open: "[ ]", ticked: "[x]", skipped: "[-]" }

// checklist.md → { day, items: [{ id, text, status, note }] }. Lines that are
// not items (the owner's own notes) are ignored.
export function parseChecklist(text = "") {
  const day = /^#\s*Checklist\s+(\d{4}-\d{2}-\d{2})/m.exec(text)?.[1] ?? null
  const items = []
  for (const line of text.split("\n")) {
    const item = /^\s*[-*]\s*\[([ xX-])\]\s*([a-z0-9_-]+)\s*:\s*(.+?)\s*$/i.exec(line)
    if (item) {
      items.push({ id: item[2].toLowerCase(), text: item[3], status: MARKS[item[1]], note: null })
      continue
    }
    const note = /^\s+↳\s*(.+?)\s*$/.exec(line)
    if (note && items.length) items[items.length - 1].note = note[1]
  }
  return { day, items }
}

export function formatChecklist(day, items) {
  const lines = [`# Checklist ${day}`, "", "Wiped every morning. The day is done when no line is open.", ""]
  for (const item of items) {
    lines.push(`- ${BOXES[item.status] ?? "[ ]"} ${item.id}: ${item.text}`)
    if (item.note) lines.push(`  ↳ ${item.note}`)
  }
  return `${lines.join("\n")}\n`
}

// A leading "HH:MM" is when the item comes due (ET); none = due now.
function isDue(item, now = ownerTime()) {
  const at = /^(\d{1,2}):(\d{2})\b/.exec(item.text)
  return !at || `${at[1].padStart(2, "0")}:${at[2]}` <= now
}

export class ChecklistArtifact extends Artifact {
  static type = "checklist"
  static title = "RUN CHECKLIST"

  initialState() {
    // done / today: id -> { status: "ticked" | "skipped", note, at }
    // file: the checklist file's day and items, when agent.md names one
    return { origin: null, done: {}, day: null, today: {}, file: null }
  }

  get items() {
    return checklistItems(this.engine?.agent)
  }

  get dailyItems() {
    return checklistItems(this.engine?.agent, "daily")
  }

  get filePath() {
    const path = this.engine?.agent?.checklist_file
    return typeof path === "string" && path.trim() ? normalizePath(path) : null
  }

  // A new day starts the day list over; a new run (origin) the run list. A
  // side turn (a status check on a quest) is not a run.
  async refresh() {
    const day = ownerDay()
    if (this.filePath) await this.#syncFile(day)
    else if (this.dailyItems.length && day !== this.state.day) this.setState({ day, today: {} })
    const working = this.engine?.getSnapshot?.().working
    if (!working?.origin || working.kind === "status" || working.origin === this.state.origin) return
    this.setState({ origin: working.origin, done: {} })
  }

  // Read the checklist file; on a new day archive it and write a clean one.
  async #syncFile(day) {
    const ws = await workspace()
    let file = null
    try {
      file = await ws.read(this.filePath)
    } catch {}
    const parsed = parseChecklist(file?.text ?? "")
    if (!file || parsed.day !== day) {
      if (file && parsed.day) await ws.write(`days/${parsed.day}/checklist.md`, file.text).catch(() => {})
      // The first file of a day the state list already started keeps its ticks.
      const carried = !file && this.state.day === day ? this.state.today : {}
      const fresh = this.dailyItems.map((item) => {
        const done = carried[item.id]
        return { ...item, status: done?.status ?? "open", note: done ? `${ownerTime(new Date(done.at))} ET: ${done.note.replace(/\s+/g, " ")}` : null }
      })
      file = await ws.write(this.filePath, formatChecklist(day, fresh), { revision: file?.revision ?? null })
      markSeen(this.engine, file.path, file.revision)
      this.#remember(day, fresh)
      return
    }
    markSeen(this.engine, file.path, file.revision)
    this.#remember(day, parsed.items)
  }

  #remember(day, items) {
    const next = { path: this.filePath, day, items }
    if (JSON.stringify(next) !== JSON.stringify(this.state.file)) this.setState({ day, file: next })
  }

  // Change the file's items (read fresh, so the owner's edits are kept).
  async #editFile(change) {
    const ws = await workspace()
    for (let attempt = 0; ; attempt++) {
      const file = await ws.read(this.filePath).catch(() => null)
      const day = ownerDay()
      const parsed = parseChecklist(file?.text ?? "")
      const items = parsed.day === day ? parsed.items : []
      const result = change(items)
      try {
        const saved = await ws.write(this.filePath, formatChecklist(day, items), { revision: file?.revision ?? null })
        markSeen(this.engine, saved.path, saved.revision)
        this.#remember(day, items)
        return result
      } catch (error) {
        if (!(error instanceof ConflictError) || attempt >= 2) throw error
      }
    }
  }

  get fileItems() {
    return this.state.file?.day === ownerDay() ? this.state.file.items : []
  }

  // Open items, for the engine's final-answer check.
  pending() {
    const working = this.engine?.getSnapshot?.().working
    if (!working || working.kind === "status") return []
    const now = ownerTime()
    const due = this.fileItems.filter((item) => item.status === "open" && isDue(item, now))
    return [...this.items.filter((item) => !this.state.done[item.id]), ...due.map(({ id, text }) => ({ id, text }))]
  }

  // The day's rows: from the file, or from state.
  #todayRows() {
    if (this.filePath) return this.fileItems.map((item) => ({ id: item.id, text: item.text, status: item.status, note: item.note, at: null }))
    return this.dailyItems.map((item) => {
      const done = this.state.today[item.id]
      return { id: item.id, text: item.text, status: done?.status ?? "open", note: done?.note ?? null, at: done?.at ?? null }
    })
  }

  // Live follow: the run's and the day's items with their ticks.
  live() {
    const run = this.items
    const today = this.#todayRows()
    if (!run.length && !today.length && !this.filePath) return null
    const row = (item, done) => ({ id: item.id, text: item.text, status: done?.status ?? "open", note: done?.note ?? null, at: done?.at ?? null })
    return {
      view: "checklist",
      data: { run: run.map((item) => row(item, this.state.done[item.id])), today, day: this.state.day },
    }
  }

  render() {
    const run = this.items
    const today = this.#todayRows()
    if (!run.length && !today.length && !this.filePath) return ""
    const mark = (status) => BOXES[status] ?? "[ ]"
    const lines = [
      `### ${this.constructor.title}`,
      "",
      'Tick an item when it is done, with its evidence: checklist.tick({"id": "<id>", "evidence": "<file, tool ' +
        'result or fact>"}). One that does not apply: checklist.skip({"id": "<id>", "reason": "<why>"}).',
    ]
    if (this.filePath) {
      const now = ownerTime()
      lines.push(
        "",
        `TODAY ${this.state.file?.day ?? ownerDay()} — ${this.filePath}, wiped every morning. More work for the day: ` +
          'checklist.add({"text": "<HH:MM when due, optional> <what done means>"}). An open item whose time has come ' +
          "(no time = now) blocks your final answer; the day is complete when no line is open."
      )
      if (!today.length) lines.push("(empty)")
      for (const item of today) {
        const due = item.status === "open" && isDue(item, now) ? " (due)" : ""
        lines.push(`- ${mark(item.status)} ${item.id}: ${item.text}${due}${item.note ? ` — ${item.note}` : ""}`)
      }
    } else if (today.length) {
      lines.push("", `TODAY ${this.state.day ?? ownerDay()} — the day's script, kept across runs. Do the next open item whose time has come; tick it in the run that does it.`)
      for (const item of today) lines.push(`- ${mark(item.status)} ${item.id}: ${item.text}${item.note ? ` — ${item.note}` : ""}`)
    }
    if (run.length) {
      lines.push("", "THIS RUN — your final answer is refused while any of these is open.")
      for (const item of run) {
        const done = this.state.done[item.id]
        lines.push(`- ${mark(done?.status)} ${item.id}: ${item.text}${done ? ` — ${done.note}` : ""}`)
      }
    }
    return lines.join("\n")
  }

  #openSummary() {
    const run = this.items.filter((i) => !this.state.done[i.id]).map((i) => i.id)
    const now = ownerTime()
    const day = this.fileItems.filter((i) => i.status === "open")
    const parts = [run.length ? `Open this run: ${run.join(", ")}.` : "Every run item is done."]
    if (this.filePath) {
      parts.push(
        day.length
          ? `Open today: ${day.map((i) => `${i.id}${isDue(i, now) ? "" : " (later)"}`).join(", ")}.`
          : "Every item on the day's checklist is done: the day is complete."
      )
    }
    return parts.join(" ")
  }

  async #mark(status, id, note) {
    const key = String(id ?? "").trim().toLowerCase()
    if (typeof note !== "string" || !note.trim()) {
      throw new Error(status === "ticked" ? "Give the evidence it is done." : "Give the reason it does not apply.")
    }
    const entry = { status, note: note.trim(), at: new Date().toISOString() }
    const runItem = this.items.find((i) => i.id === key)
    if (runItem) {
      this.setState({ done: { ...this.state.done, [runItem.id]: entry } })
      return `${runItem.id} ${status}. ${this.#openSummary()}`
    }
    if (this.filePath) {
      const found = await this.#editFile((items) => {
        const item = items.find((i) => i.id === key)
        if (!item) return false
        item.status = status
        item.note = `${ownerTime()} ET: ${status === "skipped" ? "skipped: " : ""}${entry.note.replace(/\s+/g, " ")}`
        return true
      })
      if (found) return `${key} (today) ${status} in ${this.filePath}. ${this.#openSummary()}`
    } else {
      const dayItem = this.dailyItems.find((i) => i.id === key)
      if (dayItem) {
        this.setState({ day: this.state.day ?? ownerDay(), today: { ...this.state.today, [dayItem.id]: entry } })
        return `${dayItem.id} (today) ${status}. ${this.#openSummary()}`
      }
    }
    const ids = [...this.items, ...(this.filePath ? this.fileItems : this.dailyItems)].map((i) => i.id)
    throw new Error(`No checklist item "${id}". Items: ${ids.join(", ")}.`)
  }

  async #add(text, id) {
    if (!this.filePath) throw new Error("This agent keeps no checklist file (agent.md checklist_file).")
    const what = String(text ?? "").replace(/\s+/g, " ").trim()
    if (!what) throw new Error('Give the item: {"text": "<HH:MM when due, optional> <what done means>"}.')
    const slug = (value) =>
      String(value ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    const base =
      slug(id) ||
      slug(what.replace(/^\d{1,2}:\d{2}\s*/, ""))
        .split("-")
        .slice(0, 3)
        .join("-") ||
      "item"
    const added = await this.#editFile((items) => {
      let key = base
      for (let n = 2; items.some((i) => i.id === key) || this.items.some((i) => i.id === key); n++) key = `${base}-${n}`
      items.push({ id: key, text: what, status: "open", note: null })
      return key
    })
    return `Added ${added} to ${this.filePath}. ${this.#openSummary()}`
  }

  commands() {
    const tools = [
      new Tool({
        name: "checklist.tick",
        view: "checklist",
        description: 'Tick a checklist item (this run or today) as done, with its evidence. {"id": "<item id>", "evidence": "<proof>"}',
        inputs: {
          type: "object",
          properties: { id: { type: "string" }, evidence: { type: "string" } },
          required: ["id", "evidence"],
        },
        run: ({ id, evidence }) => this.#mark("ticked", id, evidence),
      }),
      new Tool({
        name: "checklist.skip",
        view: "checklist",
        description: 'Mark a checklist item as not applying, with the reason. {"id": "<item id>", "reason": "<why>"}',
        inputs: {
          type: "object",
          properties: { id: { type: "string" }, reason: { type: "string" } },
          required: ["id", "reason"],
        },
        run: ({ id, reason }) => this.#mark("skipped", id, reason),
      }),
    ]
    if (this.filePath) {
      tools.push(
        new Tool({
          name: "checklist.add",
          view: "checklist",
          description:
            'Add an item to today\'s checklist file. {"text": "<HH:MM ET when due, optional> <what done means>", "id": "<short id, optional>"}',
          inputs: {
            type: "object",
            properties: { text: { type: "string" }, id: { type: "string" } },
            required: ["text"],
          },
          run: ({ text, id }) => this.#add(text, id),
        })
      )
    }
    return tools
  }
}
