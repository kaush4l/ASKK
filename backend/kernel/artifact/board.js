import { Tool } from "../tool/tool.js"
import { Artifact } from "./artifact.js"

// A board entry as text: a list one item per line, an object as key: value lines (2026-10-15: the grader's
// list arrived as "a,b" and an object as "[object Object]").
const asText = (v) =>
  Array.isArray(v) ? v.map(asText).join("\n") : v && typeof v === "object" ? Object.entries(v).map(([k, x]) => `${k}: ${typeof x === "object" ? JSON.stringify(x) : x}`).join("\n") : String(v ?? "")

// SharedBoard: a team's shared space, keyed entries {author, text, at}. Nested: a board has a
// parent (the enclosing team's board). Members write their own board and read every ancestor's,
// so the goal flows down and findings stay where the team works.
const ENTRY_MAX = 1200 // a board entry's text in a prompt (2026-10-15 prompt-size run: a scorecard ran 3.7K)

export class SharedBoard extends Artifact {
  constructor({ name, title, parent = null, goal = "", maxEntries = 40, clock = () => new Date() } = {}) {
    super({ name: `${name}.board`, title })
    this.team = name
    this.kind = "board"
    this.view = "board"
    this.owner = name
    this.parent = parent
    this.children = []
    if (parent) parent.children.push(this)
    this.clock = clock
    this.maxEntries = maxEntries
    this.state = { goal, entries: {} }
  }

  write(key, text, author) {
    delete this.state.entries[key] // re-insert so the newest is last
    this.state.entries[key] = { author, text: asText(text), at: this.clock().toISOString() }
    const keys = Object.keys(this.state.entries)
    if (keys.length > this.maxEntries) delete this.state.entries[keys[0]]
    this.changed()
  }

  setGoal(goal) {
    this.state.goal = String(goal)
    this.changed()
  }

  brief() {
    const verdict = this.state.entries.verdict?.text
    return verdict ? verdict.split("\n")[0].slice(0, 120) : `${Object.keys(this.state.entries).length} entries`
  }

  path() {
    return this.parent ? [...this.parent.path(), this.team] : [this.team]
  }

  // 2026-10-17: a spawned team leaves (Desk.dismiss) — its board leaves the parent's children, so the parent's
  // snapshot no longer lists it. Also the Artifact hook detach(agent) a dismissed holder calls: only the team's own
  // lead (agent.board === this) or no agent unlinks it; a member that goes leaves the board where it is.
  detach(agent = null) {
    if (agent && agent.board !== this) return
    const at = this.parent?.children.indexOf(this) ?? -1
    if (at >= 0) this.parent.children.splice(at, 1)
  }

  renderOwn() {
    const lines = [`## ${this.title} (${this.path().join(" / ")})`]
    if (this.state.goal) lines.push(`GOAL: ${this.state.goal}`)
    const entries = Object.entries(this.state.entries)
    if (!entries.length) lines.push("(empty)")
    // an entry is a finding, not a dump: past ENTRY_MAX chars it is cut in the prompt (whole in the UI's snapshot)
    for (const [key, e] of entries) lines.push(`- [${key}] ${e.author}: ${e.text.length > ENTRY_MAX ? `${e.text.slice(0, ENTRY_MAX)}… (cut at ${ENTRY_MAX} of ${e.text.length} chars)` : e.text}`)
    return lines.join("\n")
  }

  // Saved entries come back; the goal stays the one the desk was built with.
  restore(data) {
    if (data?.entries && typeof data.entries === "object") this.state = { ...this.state, entries: data.entries }
  }

  // The boards above carry only their goal (the direction); this board in full (the work).
  renderGoals() {
    const up = this.parent ? this.parent.renderGoals() : []
    return this.state.goal ? [...up, `${this.path().join(" / ")} GOAL: ${this.state.goal}`] : up
  }

  render() {
    const above = this.parent ? this.parent.renderGoals() : []
    return [...above, this.renderOwn()].join("\n")
  }

  // Whole tree as plain data (for snapshots, dry-run files, UI).
  snapshot() {
    return { name: this.team, id: this.name, ...structuredClone(this.state), children: this.children.map((c) => c.snapshot()) }
  }

  twinState() {
    return { goal: this.state.goal, entries: this.state.entries }
  }

  commands() {
    return [
      new Tool({
        name: `${this.name}.write`, // <team>.board.write
        description: `write an entry on the ${this.title} board (same key replaces)`,
        input: { key: "short id", text: "the finding, with numbers" },
        run: ({ key, text, ...rest }, { agent }) => {
          const k = key || agent.name
          // Report lines written outside <<< >>> arrive as their own fields (EVIDENCE: …, GAPS: …; 2026-10-15
          // lead sim): they belong to the text, in order, not dropped.
          const more = Object.entries(rest).map(([f, v]) => `${f}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
          if (more.length) text = [text == null ? "" : typeof text === "string" ? text : asText(text), ...more].filter(Boolean).join("\n")
          // The team's verdict is its lead's to write (2026-10-15: a member overwrote it).
          if (k === "verdict" && agent.board !== this) throw new Error(`"verdict" is the ${this.team} lead's; write yours under key "${agent.name}"`)
          this.write(k, text, agent.name)
          return `written ${this.path().join("/")}/${k}`
        },
      }),
    ]
  }
}
