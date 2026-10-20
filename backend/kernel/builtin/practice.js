import { Artifact } from "../artifact/artifact.js"
import { Tool } from "../tool/tool.js"

// Practice: an agent's standing orders that it keeps and improves itself (2026-10-20 owner: "the multi-agent setup now
// becomes a checklist … Give the agent the capability to self-reflect like the retro or the critic we have. Learning
// from the observations, it should be able to update instructions or the tools or any kind of quality guidelines it
// may have missed"). One file per agent — memory/<desk>/practice/<agent>.md: what the agent learned is memory; its
// agent.md (the config) stays as the owner wrote it — with six sections of "- " lines:
//
//   ## Checklist      what done means for every run: "id: text" ("!id" required: ticked, never skipped)
//   ## Quality        the bar each output is checked against before it is ticked
//   ## Instructions   how it works, learned: lines it added to its role
//   ## Lessons        what a run showed, with its evidence (newest last; the oldest drop past PRACTICE_MAX.lessons)
//   ## Tools          tools it lacks (for the owner, or a desk that writes tools): name, what, why
//   ## Changelog      every edit: when, who, what changed, why (written by the artifact, never edited)
//
// A run starts with the Checklist's items fresh and open, plus "!reflect" (unless reflect: false): the holder's answer
// waits while one is open (gate). Commands, id "<agent>.practice" (one per agent), view "practice", keep "file":
//   <id>.tick {id, evidence}    <id>.skip {id, reason}           this run's items
//   <id>.edit {section, old?, new?, why}                        old + new: replace that line; new: add; old: remove.
//                                                               Applies from the next run (this run's items stay).
//   <id>.reflect {worked, missed, changes}                      the retro: one entry in the retro log, ticks reflect;
//                                                               refused when it names a change and none was made
//                                                               ("none: <why>" says why nothing changes)
// store: {read() → text | null, write(text), seed?() → text | null, retro?(entry text), where?}: compose.js binds the
// node fs one (memory/<desk>/practice/<agent>.md; seed: practice.md in the agent's folder; retro:
// memory/<desk>/retros/<agent>.md). Without a store it lives in memory only (tests, a tab).
// Twin state: {file, revision, at, run: [{id, text, required, status: open | ticked | skipped, note}], sections:
// {checklist, quality, instructions, lessons, tools: [lines]}, changelog: [lines] ≤ 20, retros: [{at, by, worked,
// missed, changes}] ≤ 5, edits: n this run}.

export const PRACTICE_SECTIONS = ["checklist", "quality", "instructions", "lessons", "tools"]
const TITLES = { checklist: "Checklist", quality: "Quality", instructions: "Instructions", lessons: "Lessons", tools: "Tools", changelog: "Changelog" }
// Lines a section keeps (the oldest lessons and changelog lines drop first; a full section refuses an add).
export const PRACTICE_MAX = { checklist: 16, quality: 16, instructions: 24, lessons: 30, tools: 12, changelog: 80 }
const LINE_MAX = 400
const REFLECT = { id: "reflect", text: "practice.reflect: what held, what this run missed, and the edit that fixes it (or none: why)", required: true }

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim()
const emptySections = () => Object.fromEntries(Object.keys(TITLES).map((k) => [k, []]))
const sectionOf = (name) => {
  const key = clean(name).toLowerCase().replace(/^#+\s*/, "")
  const hit = Object.keys(TITLES).find((k) => k === key || (key.length > 2 && k.startsWith(key)))
  return hit === "changelog" ? null : (hit ?? null)
}

// The file's sections as {key: [lines]}: "## Title" headings, "- " lines (other non-empty lines count as lines too).
export function parsePractice(text) {
  const out = emptySections()
  let at = null
  for (const raw of String(text ?? "").split("\n")) {
    const head = raw.match(/^##\s+(.+?)\s*$/)
    if (head) {
      at = Object.keys(TITLES).find((k) => TITLES[k].toLowerCase() === head[1].toLowerCase()) ?? null
      continue
    }
    if (!at || /^#\s/.test(raw)) continue
    const line = raw.replace(/^\s*[-*]\s+/, "").trim()
    if (line) out[at].push(line)
  }
  return out
}

export function renderPractice(sections, name = "agent") {
  const parts = [`# ${name} practice`, "", "Standing orders this agent keeps and improves (practice.edit). Changelog lines are written by the artifact."]
  for (const k of Object.keys(TITLES)) parts.push("", `## ${TITLES[k]}`, ...(sections[k] ?? []).map((l) => `- ${l}`))
  return `${parts.join("\n")}\n`
}

// A checklist line → {id, text, required}: "!id: text", "id: text", or text alone (its slug as the id).
const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "item"
export function checklistItem(line) {
  const s = clean(line)
  const i = s.indexOf(":")
  const head = i > 0 ? s.slice(0, i).trim() : ""
  if (head && /^!?[\w.-]{1,40}$/.test(head)) return { id: head.replace(/^!/, ""), text: s.slice(i + 1).trim() || head.replace(/^!/, ""), required: head.startsWith("!") }
  return { id: slug(s), text: s, required: false }
}

export class Practice extends Artifact {
  // seed: {checklist?, quality?, instructions?} lines when the store has no file yet (and no seed of its own).
  constructor({ id, owner = null, store = null, seed = null, reflect = true, requiredWhen = null, clock = () => new Date() } = {}) {
    super({ name: id, title: `${owner ?? id} practice` })
    this.kind = "practice"
    this.view = "practice"
    this.keep = "file" // the file is the source: never saved or restored by the host
    this.owner = owner
    this.store = store
    this.seedLines = seed
    this.reflect = reflect !== false
    this.requiredWhen = requiredWhen
    this.clock = clock
    this.sections = emptySections()
    this.edits = 0
    this.state = { file: store?.where ?? null, revision: 0, at: null, run: [], sections: {}, changelog: [], retros: [], edits: 0 }
    this.load()
    this.reset()
  }

  // The file (or the seed) read again: the owner may edit it by hand between runs.
  load() {
    let text = null
    try {
      text = this.store?.read?.() ?? null
    } catch {}
    let fresh = false
    if (text == null) {
      try {
        text = this.store?.seed?.() ?? null
      } catch {}
      fresh = true
    }
    const parsed = text != null ? parsePractice(text) : emptySections()
    if (text == null && this.seedLines) for (const k of PRACTICE_SECTIONS) parsed[k] = [].concat(this.seedLines[k] ?? []).map(clean).filter(Boolean)
    this.sections = parsed
    this.unsaved = fresh
    this.#publish()
  }

  // true when written (or nowhere to write); false keeps `unsaved` and the reason in `saveError` (an edit says so).
  save() {
    if (!this.store?.write) return true
    try {
      this.store.write(renderPractice(this.sections, this.owner ?? this.name))
      this.unsaved = false
      this.saveError = null
      return true
    } catch (error) {
      this.unsaved = true
      this.saveError = error?.message ?? String(error)
      return false
    }
  }

  // This run's items: the Checklist section's, fresh (one per id), plus reflect last.
  reset() {
    const seen = new Set()
    const run = this.sections.checklist
      .map(checklistItem)
      .filter((i) => (seen.has(i.id) ? false : seen.add(i.id)))
      .filter((i) => !(this.reflect && i.id === REFLECT.id))
    if (this.reflect) run.push({ ...REFLECT })
    this.edits = 0
    this.state = { ...this.state, run: run.map((i) => ({ ...i, status: "open", note: null })), edits: 0 }
    this.changed()
  }

  attach(agent) {
    this.owner ??= agent?.name ?? null
  }

  onRunStart() {
    this.load()
    if (this.unsaved) this.save() // a seeded practice gets its file at the first run, so the owner can read it
    this.reset()
  }

  #publish() {
    this.state = { ...this.state, sections: Object.fromEntries(PRACTICE_SECTIONS.map((k) => [k, [...this.sections[k]]])), changelog: this.sections.changelog.slice(-20) }
  }

  open() {
    return this.state.run.filter((i) => i.status === "open")
  }

  gate() {
    const open = this.open()
    return open.length ? `practice checklist open: ${open.map((i) => i.id).join(", ")} — ${this.name}.tick each with evidence, ${this.name}.skip one that does not apply (a reason), and ${this.name}.reflect last` : null
  }

  render() {
    const s = this.sections
    const mark = { open: "[ ]", ticked: "[x]", skipped: "[-]" }
    const list = (k, n) => (s[k].length ? s[k].slice(-n).map((l) => `- ${l}`) : ["(none yet)"])
    return [
      `your standing orders, kept in ${this.state.file ?? "memory"} and improved by you: work the run checklist (${this.name}.tick {id, evidence} / .skip {id, reason}), meet the quality bar before you tick, follow the instructions. When a run shows a gap — a step that was missing, a bar too low, a tool you lacked — ${this.name}.edit {section, old?, new?, why} fixes it for every later run; ${this.name}.reflect {worked, missed, changes} closes the run. Your answer waits while an item is open.`,
      "RUN CHECKLIST",
      ...this.state.run.map((i) => `${mark[i.status]} ${i.required ? "!" : ""}${i.id}: ${i.text}${i.note ? ` ↳ ${i.note}` : ""}`),
      "QUALITY BAR",
      ...list("quality", PRACTICE_MAX.quality),
      "INSTRUCTIONS (learned)",
      ...list("instructions", PRACTICE_MAX.instructions),
      "LESSONS (newest last)",
      ...list("lessons", 12),
      ...(s.tools.length ? ["TOOLS WANTED", ...list("tools", PRACTICE_MAX.tools)] : []),
    ].join("\n")
  }

  brief() {
    const run = this.state.run
    return `${run.filter((i) => i.status !== "open").length}/${run.length} done · ${this.sections.lessons.length} lessons · rev ${this.state.revision}`
  }

  #close(id, status, note) {
    const key = String(id ?? "").replace(/^!/, "").trim()
    const item = this.state.run.find((i) => i.id === key)
    if (!item) throw new Error(`no item ${id}; this run: ${this.state.run.map((i) => i.id).join(", ")}`)
    if (key === REFLECT.id && this.reflect) throw new Error(`reflect closes with ${this.name}.reflect {worked, missed, changes}`)
    if (status === "skipped" && item.required && (this.requiredWhen?.(item.id) ?? true)) throw new Error(`${item.id} is required: it cannot be skipped (${item.text})`)
    if (!clean(note)) throw new Error(status === "ticked" ? "evidence is required: what shows it is done (a number, a tool result, an artifact)" : "reason is required: why it does not apply")
    this.state = { ...this.state, run: this.state.run.map((i) => (i === item ? { ...i, status, note: clean(note).slice(0, 300) } : i)) }
    this.changed()
    const left = this.open()
    return `${item.id} ${status}; ${left.length ? `${left.length} open: ${left.map((i) => i.id).join(", ")}` : "all done"}`
  }

  #log(by, what, why) {
    const at = this.clock().toISOString().slice(0, 16)
    this.sections.changelog.push(clean(`${at} ${by ?? this.owner ?? "?"}: ${what} — ${why}`).slice(0, LINE_MAX))
    if (this.sections.changelog.length > PRACTICE_MAX.changelog) this.sections.changelog.splice(0, this.sections.changelog.length - PRACTICE_MAX.changelog)
  }

  edit({ section, old, new: next, why } = {}, by = null) {
    const key = sectionOf(section)
    if (!key) throw new Error(`section ${JSON.stringify(section ?? null)}: one of ${PRACTICE_SECTIONS.join(", ")}`)
    const reason = clean(why)
    if (!reason) throw new Error("why is required: the run's evidence that calls for this change")
    const lines = this.sections[key]
    const was = clean(old)
    let line = clean(next).replace(/^[-*]\s+/, "").slice(0, LINE_MAX)
    if (key === "lessons" && line && !/^\d{4}-\d{2}-\d{2}/.test(line)) line = `${this.clock().toISOString().slice(0, 10)} ${line}`
    // old: the line itself, a checklist item's id, or a part of one line only
    const find = () => {
      const exact = lines.findIndex((l) => clean(l) === was || (key === "checklist" && checklistItem(l).id === was.replace(/^!/, "")))
      if (exact >= 0) return exact
      const part = lines.map((l, i) => (clean(l).includes(was) ? i : -1)).filter((i) => i >= 0)
      if (part.length > 1) throw new Error(`"${was.slice(0, 60)}" is in ${part.length} ${key} lines: quote the whole line`)
      return part[0] ?? -1
    }
    const at = was ? find() : -1
    if (was && at < 0) throw new Error(`no line ${JSON.stringify(was.slice(0, 80))} in ${key}; it has: ${lines.map((l) => l.slice(0, 60)).join(" | ") || "nothing"}`)
    if (key === "checklist" && line) {
      const id = checklistItem(line).id
      if (id === REFLECT.id && this.reflect) throw new Error("reflect is every run's last item already")
      const clash = lines.findIndex((l, i) => i !== at && checklistItem(l).id === id)
      if (clash >= 0) throw new Error(`checklist id ${id} exists ("${lines[clash].slice(0, 80)}"): replace it (old: ${id}) or pick another id`)
    }
    let what
    if (was) {
      if (line) {
        what = `${key} ~ "${lines[at].slice(0, 80)}" → "${line.slice(0, 120)}"`
        lines[at] = line
      } else {
        what = `${key} - "${lines[at].slice(0, 120)}"`
        lines.splice(at, 1)
      }
    } else {
      if (!line) throw new Error("new is required to add a line (old + new replaces, old alone removes)")
      if (lines.some((l) => clean(l) === line)) return `${key} has that line already`
      if (key === "lessons" && lines.length >= PRACTICE_MAX.lessons) lines.splice(0, lines.length - PRACTICE_MAX.lessons + 1)
      else if (lines.length >= PRACTICE_MAX[key]) throw new Error(`${key} is full (${PRACTICE_MAX[key]} lines): replace or remove one first`)
      lines.push(line)
      what = `${key} + "${line.slice(0, 120)}"`
    }
    this.#log(by, what, reason)
    this.edits += 1
    this.state = { ...this.state, revision: this.state.revision + 1, at: this.clock().toISOString(), edits: this.edits }
    this.#publish()
    const saved = this.save()
    this.changed()
    return `${this.name}: ${what}${key === "checklist" ? " (from the next run)" : ""}${saved ? "" : ` — NOT SAVED (${this.saveError}): it holds for this run only`}`
  }

  reflectOn({ worked, missed, changes } = {}, by = null) {
    const w = clean(worked)
    const m = clean(missed)
    const c = clean(changes)
    if (!w || !m || !c) throw new Error("worked, missed and changes are all required (missed: none, if the run lacked nothing — and why you are sure)")
    if (!this.edits && !/^none\s*:\s*\S/i.test(c)) throw new Error(`changes names edits but none were made this run: ${this.name}.edit the section that missed it first, or say "none: <why nothing changes>"`)
    const at = this.clock().toISOString()
    const n = `${this.edits} edit${this.edits === 1 ? "" : "s"}`
    const entry = { at, by: by ?? this.owner, worked: w.slice(0, 600), missed: m.slice(0, 600), changes: c.slice(0, 600) }
    try {
      this.store?.retro?.(`## ${at.slice(0, 16)} ${entry.by}\n- worked: ${entry.worked}\n- missed: ${entry.missed}\n- changes: ${entry.changes} (${n})\n`)
    } catch {}
    this.state = { ...this.state, run: this.state.run.map((i) => (i.id === REFLECT.id && this.reflect ? { ...i, status: "ticked", note: `${n}; missed: ${m.slice(0, 160)}` } : i)), retros: [...this.state.retros, entry].slice(-5) }
    this.changed()
    const left = this.open()
    return `reflected (${n} this run); ${left.length ? `${left.length} open: ${left.map((i) => i.id).join(", ")}` : "all done"}`
  }

  live() {
    return { view: "practice", data: this.state }
  }

  commands() {
    return [
      new Tool({ name: `${this.name}.tick`, description: "tick a run checklist item done", input: { id: "item id", evidence: "what shows it is done: a number, a tool result, an artifact" }, run: ({ id, evidence } = {}) => this.#close(id, "ticked", evidence) }),
      new Tool({ name: `${this.name}.skip`, description: "skip a run checklist item that does not apply now", input: { id: "item id", reason: "why it does not apply" }, run: ({ id, reason } = {}) => this.#close(id, "skipped", reason) }),
      new Tool({
        name: `${this.name}.edit`,
        description: "change your standing orders for every later run — a checklist item, a quality bar, an instruction, a lesson, a tool you lack; old + new replaces that line, new alone adds, old alone removes; why: the run's evidence",
        input: { section: PRACTICE_SECTIONS.join(" | "), old: "the line to replace or remove (a checklist item's id works); optional", new: 'the new line (checklist: "id: text", "!id" = required); optional', why: "the evidence from this run that calls for it" },
        run: (input = {}, { agent } = {}) => this.edit(input, agent?.name ?? null),
      }),
      new Tool({
        name: `${this.name}.reflect`,
        description: "the run's retro, your last item: what held, what this run missed (a gap in the checklist, the quality bar, an instruction, a tool), and the edits you made for it",
        input: { worked: "what held, with its evidence", missed: "what the run lacked, or none (and why you are sure)", changes: 'the practice edits made this run, or "none: <why>"' },
        run: (input = {}, { agent } = {}) => this.reflectOn(input, agent?.name ?? null),
      }),
    ]
  }
}
