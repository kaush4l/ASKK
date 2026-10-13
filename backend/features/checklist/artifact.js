// The checklist artifact: what a run must have done before it ends, ticked
// item by item with evidence, one live view per engine.
//
// Two lists from agent.md, one "id: what done means" per line:
//
//   artifacts: [checklist]
//   checklist:            THIS RUN: fresh for every run; blocks the answer
//     - sources: five sources read and ranked
//     - wake: next run booked with what it should look at
//   daily:                TODAY: fresh every day (America/New_York), kept
//     - start: 08:30 first run done          across the day's runs; the
//     - close: 16:15 day reviewed            script the day follows
//
// A run is one origin (the owner's request or a scheduled wake, with every
// report that continues it). Both lists are rendered every step; the engine
// refuses a final answer while RUN items are open (BaseEngine.pendingChecks),
// so each ends ticked or skipped with its reason. Day items are ticked by the
// run that does them; the next run sees where the day stands.
//
//   checklist.tick({"id": "sources", "evidence": "shared/2026-10-05/sources.md: 5 sources"})
//   checklist.skip({"id": "group", "reason": "nothing to send today"})
//
// agent.md `checklist_file: checklist.md` keeps TODAY in that workspace file
// instead (the owner reads and edits it; re-read before every step). The first
// run of a new day archives yesterday's file to days/<date>/checklist.md and
// writes a clean one from the day's template: agent.md `checklist_template`
// (a Markdown file in the agent's folder with run days, vars and repeated
// slots — template.js), else the `daily:` lines. The template's headings and
// guidance stay in the file and in the prompt. checklist.add puts more items on it while
// the day runs. An open item whose time has come (a leading "HH:MM" ET, or no
// time) also blocks the answer, so the lead works the list down until the day
// is done.
//
//   # Checklist 2026-10-07
//   - [x] plan: 08:30 plan.md written from the inbox
//     ↳ 08:52 ET: shared/2026-10-07/plan.md, 4 tasks
//   - [ ] close: 16:15 reviewer reviewed the day
//   - [-] weekly: 15:30 Fridays only — weekly summary
//     ↳ 15:31 ET: skipped: not Friday

import { Artifact } from "@/backend/core/artifact"
import { Tool } from "@/backend/core/tool"
import { markSeen } from "@/backend/features/filesystem/tools"
import { ConflictError, normalizePath, workspace } from "@/backend/features/filesystem/workspace"
import {
  addItem,
  isDue,
  itemLines,
  markItem,
  ownerDay,
  ownerTime,
  parseChecklist,
  parseTemplate,
  renderTemplate,
  templateFromDaily,
} from "@/backend/features/checklist/template"

const BOXES = { open: "[ ]", ticked: "[x]", skipped: "[-]" }

// The items as state keeps them (no line positions).
const plainItems = (items) => items.map(({ id, text, status, note }) => ({ id, text, status, note }))

export class ChecklistArtifact extends Artifact {
  static type = "checklist"
  static title = "RUN CHECKLIST"

  initialState() {
    // done / today: id -> { status: "ticked" | "skipped", note, at }
    // file: the checklist file's day and items, when agent.md names one
    return { origin: null, done: {}, day: null, today: {}, file: null }
  }

  get items() {
    return itemLines(this.engine?.agent?.checklist)
  }

  get dailyItems() {
    return itemLines(this.engine?.agent?.daily)
  }

  get filePath() {
    const path = this.engine?.agent?.checklist_file
    return typeof path === "string" && path.trim() ? normalizePath(path) : null
  }

  // The day's template: agent.md `checklist_template` (its text, read at load), else the `daily:` lines.
  get template() {
    const agent = this.engine?.agent
    const text = agent?.checklist_template_text ?? templateFromDaily(agent?.daily)
    const key = `${text}\u0000${JSON.stringify(agent?.checklist_vars ?? {})}`
    if (this._template?.key !== key) this._template = { key, value: parseTemplate(text, agent?.checklist_vars) }
    return this._template.value
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

  // The template filled in for today, with the ticks of a day the state list already started.
  #fresh(day) {
    let text = renderTemplate(this.template, day, { agent: this.engine?.agent?.name ?? "" })
    if (this.state.day === day) {
      for (const [id, done] of Object.entries(this.state.today ?? {})) {
        text = markItem(text, id, done.status, `${ownerTime(new Date(done.at))} ET: ${done.note.replace(/\s+/g, " ")}`) ?? text
      }
    }
    return text
  }

  // Read the checklist file; the first run of a new day archives it and writes the template for today.
  async #syncFile(day) {
    const ws = await workspace()
    let file = null
    try {
      file = await ws.read(this.filePath)
    } catch {}
    const parsed = parseChecklist(file?.text ?? "")
    if (!file || parsed.day !== day) {
      if (file && parsed.day) await ws.write(`days/${parsed.day}/checklist.md`, file.text).catch(() => {})
      const text = file ? renderTemplate(this.template, day, { agent: this.engine?.agent?.name ?? "" }) : this.#fresh(day)
      file = await ws.write(this.filePath, text, { revision: file?.revision ?? null })
      markSeen(this.engine, file.path, file.revision)
      this.#remember(day, parseChecklist(text).items, text)
      return
    }
    markSeen(this.engine, file.path, file.revision)
    this.#remember(day, parsed.items, file.text)
  }

  #remember(day, items, text) {
    const next = { path: this.filePath, day, items: plainItems(items), text: text ?? null }
    if (JSON.stringify(next) !== JSON.stringify(this.state.file)) this.setState({ day, file: next })
  }

  // Change the file (read fresh, so the owner's edits are kept): change(text) → { text, result }; text null = no change.
  async #editFile(change) {
    const ws = await workspace()
    for (let attempt = 0; ; attempt++) {
      const file = await ws.read(this.filePath).catch(() => null)
      const day = ownerDay()
      const current = parseChecklist(file?.text ?? "").day === day ? file.text : this.#fresh(day)
      const { text, result } = change(current)
      if (text == null) return result
      try {
        const saved = await ws.write(this.filePath, text, { revision: file?.revision ?? null })
        markSeen(this.engine, saved.path, saved.revision)
        this.#remember(day, parseChecklist(text).items, text)
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
        `TODAY ${this.state.file?.day ?? ownerDay()} — ${this.filePath}, written from the template by the first run of each run day. More work for the day: ` +
          'checklist.add({"text": "<HH:MM when due, optional> <what done means>"}). An open item whose time has come ' +
          "(no time = now) blocks your final answer; the day is complete when no line is open."
      )
      const text = this.state.file?.day === ownerDay() ? this.state.file.text : null
      if (text) {
        // The file as written (the template's guidance stays beside its items), open items due now marked.
        const due = new Set(today.filter((item) => item.status === "open" && isDue(item, now)).map((item) => item.id))
        const body = parseChecklist(text)
        const marked = [...body.lines]
        for (const item of body.items) if (due.has(item.id)) marked[item.at] = `${marked[item.at]} (due)`
        lines.push("", ...marked.filter((line, i) => i > 0 || !/^#\s*Checklist/.test(line)).join("\n").trim().split("\n"))
      } else if (!today.length) lines.push("(empty)")
      else {
        for (const item of today) {
          const due = item.status === "open" && isDue(item, now) ? " (due)" : ""
          lines.push(`- ${mark(item.status)} ${item.id}: ${item.text}${due}${item.note ? ` — ${item.note}` : ""}`)
        }
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
      const line = `${ownerTime()} ET: ${status === "skipped" ? "skipped: " : ""}${entry.note.replace(/\s+/g, " ")}`
      const found = await this.#editFile((current) => {
        const text = markItem(current, key, status, line)
        return { text, result: text != null }
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
    const added = await this.#editFile((current) => {
      const items = parseChecklist(current).items
      let key = base
      for (let n = 2; items.some((i) => i.id === key) || this.items.some((i) => i.id === key); n++) key = `${base}-${n}`
      return { text: addItem(current, key, what), result: key }
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
