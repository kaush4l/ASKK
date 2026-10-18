// Tool: the one contract for anything an agent can call — a function, an MCP server's tool, another
// agent. `type` says which ("function" | "mcp" | "agent" | "artifact" | a desk's own); the agent sees
// them all in one TOOLS list and calls them the same way. `view` says how the live UI draws a call
// (quest | checklist | schedule | web | board | data | text …; null = the UI picks by type).

export class Tool {
  constructor({ name, description = "", input = {}, run, type = "function", view = null }) {
    if (!name) throw new Error("tool needs a name")
    this.name = name
    this.type = type
    this.view = view
    this.description = description
    this.input = input // {field: "what it means"}
    if (run) this._run = run
  }

  // What the live UI shows of it (the agent page's tool list).
  spec() {
    return { name: this.name, type: this.type, view: this.view, description: this.description, input: this.input }
  }

  // Its twin on the UI: the spec as an element of the kernel (Agent.twin lists its tools' twins).
  twin() {
    return { element: "tool", id: this.name, ...this.spec() }
  }

  async run(input, ctx) {
    if (!this._run) throw new Error(`${this.name}: no run()`)
    return this._run(input ?? {}, ctx)
  }

  describe() {
    const fields = Object.entries(this.input).map(([k, v]) => `${k}: ${v}`).join(", ")
    return `- ${this.name} {${fields}} — ${this.description}`
  }
}

// Another agent (or a team's lead) as a tool: the call hands it a quest; the result is its report.
// A quest is a brief, not a one-liner: the requirement (the situation and the limits the work must
// respect), the ask (the questions to answer) and the outcome (what the report must deliver to count
// as done). The sub-agent reads them as its request, in that order.
export const QUEST_INPUT = {
  requirement: "the situation and limits: what is known, the data and levels to use, what not to do",
  ask: "the questions whose answers change your decision, specific (names, numbers, sources, timeframes) — never \"do your part\"",
  outcome: "what the report must deliver to count as done: the decision it feeds and the numbers it must give",
}

export class AgentTool extends Tool {
  // after: the sibling agents whose reports this one works from, called and reported earlier in the
  // caller's run (2026-10-15: learn sent grader and critic together; the critic had no grades to read).
  constructor(agent, { name, description, after = [] } = {}) {
    super({
      name: name ?? agent.name,
      type: "agent",
      view: "quest",
      description: description ?? agent.config.description ?? agent.config.role,
      input: QUEST_INPUT,
    })
    this.agent = agent
    this.after = [].concat(after)
  }

  // The brief's fields are named here and explained once above the TOOLS list (Agent.render): repeating their
  // meaning on every agent line cost a lead ~300 chars per member (2026-10-15 prompt-size run).
  describe() {
    return `- ${this.name} {requirement, ask, outcome} — ${this.description}`
  }

  twin() {
    return { ...super.twin(), agent: this.agent.name }
  }

  async run(input, ctx = {}) {
    const waiting = this.after.filter((n) => ctx.agent?.reported && !ctx.agent.reported.has(n))
    if (waiting.length) throw new Error(`${this.name} works from ${waiting.join(" and ")}'s report: call ${waiting.join(", ")} first (alone), then ${this.name} with that report in the requirement`)
    return this.agent.ask(questText(input), { from: ctx.agent?.name, signal: ctx.signal })
  }
}

// The quest as the sub-agent's request text. Refused without an ask and an outcome: an agent handed a
// bare goal guesses what done means (a model sometimes nests the fields under `quest`).
export function questText(input) {
  const q = input?.quest && typeof input.quest === "object" ? input.quest : input ?? {}
  const field = (k) => (q[k] == null ? "" : lines(q[k]).trim())
  const missing = ["requirement", "ask", "outcome"].filter((k) => !field(k))
  if (missing.length) throw new Error(`a quest needs ${missing.join(", ")}: ${Object.entries(QUEST_INPUT).map(([k, v]) => `${k} (${v})`).join("; ")}`)
  return `REQUIREMENT: ${field("requirement")}\nASK: ${field("ask")}\nOUTCOME: ${field("outcome")}`
}

// A brief field the reply parser read as a list or an object (a <<< >>> block of "- " items or key: value
// lines) goes to the sub-agent as lines, never as JSON (2026-10-15 swing: a requirement arrived as {"Tickers":…}).
function lines(v) {
  if (typeof v === "string") return v
  if (Array.isArray(v)) return v.map((x) => `- ${x && typeof x === "object" ? inline(x) : x}`).join("\n")
  if (v && typeof v === "object") return Object.entries(v).map(([k, x]) => `${k}: ${x && typeof x === "object" ? (Array.isArray(x) ? x.map((y) => (y && typeof y === "object" ? inline(y) : y)).join(", ") : inline(x)) : x}`).join("\n")
  return String(v)
}
const inline = (o) => (Array.isArray(o) ? o.join(", ") : Object.entries(o).map(([k, x]) => `${k}: ${x && typeof x === "object" ? JSON.stringify(x) : x}`).join(", "))

// defineTool: the standard shape a desk's tools/<name>.js module default-exports, checked when the module loads so a
// bad tool fails at desk start, not at its first call.
//   export default defineTool({ name: "market.quote", description: "…", input: { symbol: "ticker" }, run: async (input, ctx) => … })
// name: lowercase words, dot-separated parts ("web.read", "desk.board-write"); input: {field: "what it means"}.
export const TOOL_NAME = /^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)*$/

export function defineTool({ name, description, input = {}, run, view = null, type = "function" } = {}) {
  if (!name) throw new Error("defineTool: name is required")
  if (typeof name !== "string" || !TOOL_NAME.test(name)) throw new Error(`defineTool: name "${name}" must match ${TOOL_NAME} (lowercase, dot-separated parts)`)
  if (typeof description !== "string" || !description.trim()) throw new Error(`defineTool ${name}: description is required (what the tool does, for the agent)`)
  if (typeof run !== "function") throw new Error(`defineTool ${name}: run must be a function (input, ctx) => result`)
  const plain = input !== null && typeof input === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(input))
  if (!plain) throw new Error(`defineTool ${name}: input must be a plain object {field: "what it means"}`)
  const bad = Object.entries(input).filter(([, v]) => typeof v !== "string").map(([k]) => k)
  if (bad.length) throw new Error(`defineTool ${name}: input ${bad.join(", ")} must be text (what the field means)`)
  return new Tool({ name, description, input, run, view, type })
}
