import { Artifact } from "./artifact.js"

// Checklist: what done means for one agent's run, ticked with evidence. Fresh every run; the
// agent's final answer is refused while an item is open (the agent's gate, a few times at most).
// An id starting with "!" is required: it can be ticked, never skipped — unless requiredWhen(id) says it
// does not apply now (e.g. a trading item after the close).
//   new Checklist({ id: "lead.checklist", items: ["teams: every team reported", "!post: posted", …], requiredWhen })
export class Checklist extends Artifact {
  static about = "items ticked with evidence; open required items refuse the answer"
  static commandType = "artifact"
  static commands = {
    tick: { description: "tick an item done", input: { id: "item id", evidence: "what proves it" }, run({ id, evidence }) { return this.#set(id, "done", evidence) } },
    skip: { description: "skip an item that cannot be done", input: { id: "item id", reason: "why" }, run({ id, reason }) { return this.#set(id, "skipped", reason) } },
  }

  constructor({ id, title, items = [], owner = null, requiredWhen = null }) {
    super({ name: id, title: title ?? id })
    this.kind = "checklist"
    this.view = "checklist"
    this.owner = owner
    this.requiredWhen = requiredWhen // (id) → is a required item required now
    this.template = items.map((line) => {
      const i = String(line).indexOf(":")
      const raw = i > 0 ? line.slice(0, i).trim() : String(line)
      const required = raw.startsWith("!")
      const id = required ? raw.slice(1) : raw
      return { id, text: i > 0 ? line.slice(i + 1).trim() : id, ...(required ? { required } : {}) }
    })
    this.reset()
  }

  reset() {
    this.state = { items: this.template.map((t) => ({ ...t, status: "open", note: null })) }
    this.changed()
  }

  onRunStart() {
    this.reset()
  }

  render() {
    const mark = { open: "[ ]", done: "[x]", skipped: "[-]" }
    const head = `what done means this run: ${this.name}.tick each item with its evidence, or ${this.name}.skip one that cannot be done (a reason); your answer waits while one is open`
    return [head, ...this.state.items.map((i) => `${mark[i.status]} ${i.id}: ${i.text}${i.note ? ` ↳ ${i.note}` : ""}`)].join("\n")
  }

  brief() {
    const items = this.state.items
    return `${items.filter((i) => i.status !== "open").length}/${items.length} done`
  }

  live() {
    const status = { open: "open", done: "ticked", skipped: "skipped" }
    return { view: "checklist", data: { run: this.state.items.map((i) => ({ ...i, status: status[i.status] })) } }
  }

  open() {
    return this.state.items.filter((i) => i.status === "open")
  }

  gate() {
    const open = this.open()
    return open.length ? `checklist open: ${open.map((i) => i.id).join(", ")} — ${this.name}.tick each with evidence, or ${this.name}.skip with a reason` : null
  }

  #set(id, status, note) {
    const item = this.state.items.find((i) => i.id === id)
    if (!item) throw new Error(`no item ${id}; items: ${this.state.items.map((i) => i.id).join(", ")}`)
    if (status === "skipped" && item.required && (this.requiredWhen?.(id) ?? true)) throw new Error(`${id} cannot be skipped: ${item.text}`)
    if (!String(note ?? "").trim()) throw new Error(status === "done" ? "evidence is required" : "reason is required")
    this.state = { items: this.state.items.map((i) => (i.id === id ? { ...i, status, note: String(note).slice(0, 200) } : i)) }
    this.changed()
    const left = this.open().length
    return `${id} ${status}; ${left ? `${left} open` : "all done"}`
  }
}
