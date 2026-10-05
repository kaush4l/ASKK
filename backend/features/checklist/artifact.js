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

import { Artifact } from "@/backend/core/artifact"
import { Tool } from "@/backend/core/tool"

const ZONE = "America/New_York" // the owner's day

export function ownerDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
}

// "id: text" lines from agent.md (`checklist`, or `daily`) → [{ id, text }]
export function checklistItems(agent, field = "checklist") {
  return (agent?.[field] ?? []).flatMap((line) => {
    const match = /^\s*([a-z0-9_-]+)\s*:\s*(.+)$/i.exec(String(line))
    return match ? [{ id: match[1].toLowerCase(), text: match[2].trim() }] : []
  })
}

export class ChecklistArtifact extends Artifact {
  static type = "checklist"
  static title = "RUN CHECKLIST"

  initialState() {
    // done / today: id -> { status: "ticked" | "skipped", note, at }
    return { origin: null, done: {}, day: null, today: {} }
  }

  get items() {
    return checklistItems(this.engine?.agent)
  }

  get dailyItems() {
    return checklistItems(this.engine?.agent, "daily")
  }

  // A new day starts the day list over; a new run (origin) the run list. A
  // side turn (a status check on a quest) is not a run.
  async refresh() {
    const day = ownerDay()
    if (this.dailyItems.length && day !== this.state.day) this.setState({ day, today: {} })
    const working = this.engine?.getSnapshot?.().working
    if (!working?.origin || working.kind === "status" || working.origin === this.state.origin) return
    this.setState({ origin: working.origin, done: {} })
  }

  // Open items, for the engine's final-answer check.
  pending() {
    const working = this.engine?.getSnapshot?.().working
    if (!working || working.kind === "status") return []
    return this.items.filter((item) => !this.state.done[item.id])
  }

  render() {
    const run = this.items
    const daily = this.dailyItems
    if (!run.length && !daily.length) return ""
    const mark = (done) => (done?.status === "ticked" ? "[x]" : done?.status === "skipped" ? "[-]" : "[ ]")
    const line = (item, done) => `- ${mark(done)} ${item.id}: ${item.text}${done ? ` — ${done.note}` : ""}`
    const lines = [
      `### ${this.constructor.title}`,
      "",
      'Tick an item when it is done, with its evidence: checklist.tick({"id": "<id>", "evidence": "<file, tool ' +
        'result or fact>"}). One that does not apply: checklist.skip({"id": "<id>", "reason": "<why>"}).',
    ]
    if (daily.length) {
      lines.push("", `TODAY ${this.state.day ?? ownerDay()} — the day's script, kept across runs. Do the next open item whose time has come; tick it in the run that does it.`)
      for (const item of daily) lines.push(line(item, this.state.today[item.id]))
    }
    if (run.length) {
      lines.push("", "THIS RUN — your final answer is refused while any of these is open.")
      for (const item of run) lines.push(line(item, this.state.done[item.id]))
    }
    return lines.join("\n")
  }

  #mark(status, id, note) {
    const key = String(id ?? "").trim().toLowerCase()
    const runItem = this.items.find((i) => i.id === key)
    const dayItem = runItem ? null : this.dailyItems.find((i) => i.id === key)
    const item = runItem ?? dayItem
    if (!item) throw new Error(`No checklist item "${id}". Items: ${[...this.items, ...this.dailyItems].map((i) => i.id).join(", ")}.`)
    if (typeof note !== "string" || !note.trim()) {
      throw new Error(status === "ticked" ? "Give the evidence it is done." : "Give the reason it does not apply.")
    }
    const entry = { status, note: note.trim(), at: new Date().toISOString() }
    if (runItem) this.setState({ done: { ...this.state.done, [item.id]: entry } })
    else this.setState({ day: this.state.day ?? ownerDay(), today: { ...this.state.today, [item.id]: entry } })
    const open = this.items.filter((i) => !this.state.done[i.id]).map((i) => i.id)
    const where = runItem ? "" : " (today)"
    return `${item.id}${where} ${status}. ${open.length ? `Open this run: ${open.join(", ")}.` : "Every run item is done."}`
  }

  commands() {
    return [
      new Tool({
        name: "checklist.tick",
        description: 'Tick a RUN CHECKLIST item as done, with its evidence. {"id": "<item id>", "evidence": "<proof>"}',
        inputs: {
          type: "object",
          properties: { id: { type: "string" }, evidence: { type: "string" } },
          required: ["id", "evidence"],
        },
        run: ({ id, evidence }) => this.#mark("ticked", id, evidence),
      }),
      new Tool({
        name: "checklist.skip",
        description: 'Mark a RUN CHECKLIST item as not applying to this run, with the reason. {"id": "<item id>", "reason": "<why>"}',
        inputs: {
          type: "object",
          properties: { id: { type: "string" }, reason: { type: "string" } },
          required: ["id", "reason"],
        },
        run: ({ id, reason }) => this.#mark("skipped", id, reason),
      }),
    ]
  }
}
