import { Checklist } from "../artifact/checklist.js"

// Plan: the desk's checklist, written at run time (2026-10-17 owner: the planner writes the desk's checklist — no
// hard-coded checklist in any agent.md). One instance per desk (id "plan"), held by every agent that lists it; kept
// always (a restart keeps it) and never reset when a run starts — it outlives runs, the desk works it down.
//
// plan.write {goal, items}: items are "id: text" lines (a "!" before the id: required) or {id, text, required}; it replaces
// the open items, keeps a ticked or skipped item whose id is still listed, bumps the revision, records who wrote it.
// plan.tick / plan.skip (a required item cannot be skipped).
//
// gate(): refuses an answer only for a holder attached with {gate: true} (agent.addArtifact(plan, {gate: true}),
// an agent.md artifact {type: plan, gate: true}) while an item is open, or while there is no plan yet.
// Twin state: {goal, revision, by, at, items: [{id, text, required, status: open | ticked | skipped, note, by, at}]}
// (the checklist view, with the goal and revision as its header).
const NOTE_MAX = 300
const TEXT_MAX = 400

// An item id from text that came without one ("tests pass" → "tests-pass").
const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "item"

// The items a write lists, from what a model sends: an array of lines or objects, or one text of "- id: text" lines.
function parseItems(items) {
  const raw = typeof items === "string" ? items.split("\n") : Array.isArray(items) ? items : items && typeof items === "object" ? Object.entries(items).map(([id, text]) => `${id}: ${text}`) : []
  return raw
    .map((x) => {
      if (x && typeof x === "object") {
        const id = String(x.id ?? "").trim()
        const required = !!x.required || id.startsWith("!")
        const text = String(x.text ?? x.id ?? "").trim()
        return text ? { id: id.replace(/^!/, "") || slug(text), text, required } : null
      }
      const line = String(x ?? "").replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim()
      if (!line) return null
      const i = line.indexOf(":")
      const head = i > 0 ? line.slice(0, i).trim() : ""
      // "id: text" only when the head reads as an id (one word); else the whole line is the text.
      if (head && /^!?[\w.-]{1,40}$/.test(head)) return { id: head.replace(/^!/, ""), text: line.slice(i + 1).trim() || head.replace(/^!/, ""), required: head.startsWith("!") }
      return { id: slug(line), text: line, required: false }
    })
    .filter(Boolean)
    .map((x) => ({ ...x, text: x.text.slice(0, TEXT_MAX) }))
}

export class Plan extends Checklist {
  static about = "the desk's plan written at run time: a goal and items ticked with evidence; gates the holders attached with gate"
  static commands = {
    write: {
      description: "write the desk's plan: the goal and the items that mean it is done, each observable; replaces the open items (closed ones still listed stay closed)",
      input: { goal: "the goal the plan serves", items: `"id: text" lines, one per item ("!id: …" = required, cannot be skipped)` },
      run(input, { agent } = {}) {
        return this.write(input ?? {}, agent?.name ?? null)
      },
    },
    tick: { description: "tick a plan item done", input: { id: "item id", evidence: "what shows it is done" }, run({ id, evidence } = {}, { agent } = {}) { return this.#close(id, "ticked", evidence, agent?.name ?? null) } },
    skip: { description: "skip a plan item that cannot be done", input: { id: "item id", reason: "why" }, run({ id, reason } = {}, { agent } = {}) { return this.#close(id, "skipped", reason, agent?.name ?? null) } },
  }

  constructor({ id = "plan", title = "plan — the desk's checklist", owner = null, requiredWhen = null, clock = () => new Date() } = {}) {
    super({ id, title, items: [], owner, requiredWhen })
    Object.assign(this, { kind: "plan", view: "checklist", keep: "always" })
    this.clock = clock
    this.gated = new Set() // the holders whose answer waits on the plan (attached with gate: true)
  }

  // An empty plan (the Checklist constructor calls it once); a run start never does.
  reset() {
    this.state = { goal: "", revision: 0, by: null, at: null, items: [] }
    this.changed()
  }

  onRunStart() {}

  attach(agent, { gate = false } = {}) {
    if (gate) this.gated.add(agent.name)
  }

  detach(agent) {
    this.gated.delete(agent.name)
  }

  restore(data) {
    if (!data || typeof data !== "object" || !Array.isArray(data.items)) return
    const status = (s) => (["open", "ticked", "skipped"].includes(s) ? s : "open")
    this.state = {
      goal: String(data.goal ?? ""),
      revision: Number.isFinite(data.revision) ? data.revision : 0,
      by: data.by ?? null,
      at: data.at ?? null,
      items: data.items.filter((i) => i?.id).map((i) => ({ id: String(i.id), text: String(i.text ?? i.id), required: !!i.required, status: status(i.status), note: i.note ?? null, by: i.by ?? null, at: i.at ?? null })),
    }
  }

  open() {
    return this.state.items.filter((i) => i.status === "open")
  }

  // The plan as the holder reads it: what it can do with it (its own commands only), the goal, every item.
  render(agent) {
    const s = this.state
    const has = (c) => !agent || agent.tools?.has(`${this.name}.${c}`)
    const can = [has("write") && `${this.name}.write {goal, items} replaces it`, has("tick") && `${this.name}.tick {id, evidence} closes an item`, has("skip") && `${this.name}.skip {id, reason} skips one that cannot be done`].filter(Boolean)
    const waits = agent && this.gated.has(agent.name) ? "; your answer waits while an item is open" : ""
    const head = `the desk's plan, shared by the agents that hold it${can.length ? `: ${can.join(", ")}` : ""}${waits}`
    if (!s.items.length) return [head, has("write") ? `(no plan yet: write it with ${this.name}.write)` : "(no plan yet — the planner writes it)"].join("\n")
    const mark = { open: "[ ]", ticked: "[x]", skipped: "[-]" }
    return [
      head,
      `GOAL: ${s.goal || "(none given)"}`,
      `revision ${s.revision}${s.by ? ` by ${s.by}` : ""}${s.at ? ` at ${s.at}` : ""}`,
      ...s.items.map((i) => `${mark[i.status]} ${i.required ? "!" : ""}${i.id}: ${i.text}${i.note ? ` ↳ ${i.note}${i.by ? ` (${i.by})` : ""}` : ""}`),
    ].join("\n")
  }

  brief() {
    const items = this.state.items
    if (!items.length) return "no plan yet"
    return `${items.filter((i) => i.status !== "open").length}/${items.length} done · rev ${this.state.revision}`
  }

  live() {
    const { goal, revision, by, at, items } = this.state
    return { view: "checklist", data: { goal, revision, by, at, run: items } }
  }

  gate(agent) {
    if (!agent || !this.gated.has(agent.name)) return null
    if (!this.state.items.length) return `no plan yet — ask the planner to write ${this.name} (${this.name}.write), then work it`
    const open = this.open()
    return open.length ? `plan open: ${open.map((i) => i.id).join(", ")} — ${this.name}.tick each with evidence, or ${this.name}.skip with a reason` : null
  }

  // A new revision: the listed items in their order; one already ticked or skipped keeps its status and note.
  write({ goal, items }, by = null) {
    const listed = parseItems(items)
    if (!listed.length) throw new Error(`${this.name}.write needs items: "id: text" lines, each one observable (what shows it is done)`)
    const ids = listed.map((i) => i.id)
    const twice = ids.filter((id, k) => ids.indexOf(id) !== k)
    if (twice.length) throw new Error(`item ids must be unique: ${[...new Set(twice)].join(", ")} twice`)
    const before = new Map(this.state.items.map((i) => [i.id, i]))
    const at = this.clock().toISOString()
    const next = listed.map((i) => {
      const old = before.get(i.id)
      return old && old.status !== "open" ? { ...old, text: i.text, required: i.required } : { id: i.id, text: i.text, required: i.required, status: "open", note: null, by: null, at: null }
    })
    const kept = next.filter((i) => i.status !== "open").length
    this.state = { goal: goal == null ? this.state.goal : String(goal).trim(), revision: this.state.revision + 1, by, at, items: next }
    this.changed()
    return `${this.name} revision ${this.state.revision}: ${next.length} items${kept ? ` (${kept} already closed kept)` : ""}; ${this.open().length} open`
  }

  #close(id, status, note, by) {
    const item = this.state.items.find((i) => i.id === String(id ?? "").replace(/^!/, ""))
    if (!item) throw new Error(this.state.items.length ? `no item ${id}; items: ${this.state.items.map((i) => i.id).join(", ")}` : `no plan yet: ${this.name}.write writes it`)
    if (status === "skipped" && item.required && (this.requiredWhen?.(item.id) ?? true)) throw new Error(`${item.id} is required: it cannot be skipped (${item.text})`)
    if (!String(note ?? "").trim()) throw new Error(status === "ticked" ? "evidence is required: what shows it is done" : "reason is required: why it cannot be done")
    const at = this.clock().toISOString()
    this.state = { ...this.state, items: this.state.items.map((i) => (i === item ? { ...i, status, note: String(note).trim().slice(0, NOTE_MAX), by, at } : i)) }
    this.changed()
    const left = this.open().length
    return `${item.id} ${status}; ${left ? `${left} open` : "all done"}`
  }
}
