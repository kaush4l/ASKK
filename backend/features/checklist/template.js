// The day's checklist as a template: one Markdown file per team (or agent) that the first run of every run day
// turns into that day's checklist file. The owner configures the day here, not in code.
//
// agent.md:
//   checklist_file: checklist.md              the day's checklist (workspace path; the owner reads and edits it)
//   checklist_template: checklist.template.md the template, in the agent's folder (read once at load, like skills)
//   checklist_vars: {drafts: 5}               overrides the template's vars (a team tunes its numbers here)
//   daily: ["id: text", …]                    the older form: a template with only these items
//
// Template = optional frontmatter + Markdown:
//   ---
//   days: [mon, tue, wed, thu, fri]   run days (America/New_York); any other day gets a "rest day" file with no items
//   skip: ["2026-11-26"]              dates that are not run days (holidays)
//   vars: {drafts: 5, goal: "inbox zero"}
//   ---
//   # Checklist {{date}}
//   - [ ] draft-{{1..drafts}}: 09:40 draft #{{1..drafts}} sent for review
//
// {{date}}, {{weekday}}, {{agent}} and every var are filled in. A line holding {{a..b}} (numbers or var names) is
// written once per number from a to b, every {{a..b}} in it replaced by that number. Lines that are not items
// (headings, the owner's guidance) are kept as written and survive every tick, skip and add.
//
// Item lines: `- [ ] id: text` (open), `[x]` ticked, `[-]` skipped; the line after an item starting `↳` is its note.

import { splitFrontmatter } from "@/backend/agents/frontmatter"

export const ZONE = "America/New_York" // the owner's day

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]
const MARKS = { " ": "open", x: "ticked", X: "ticked", "-": "skipped" }
const BOXES = { open: "[ ]", ticked: "[x]", skipped: "[-]" }
const ITEM = /^(\s*[-*]\s*\[)([ xX-])(\]\s*)([a-z0-9_-]+)(\s*:\s*)(.+?)\s*$/i
const NOTE = /^\s+↳\s*(.+?)\s*$/

export function ownerDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
}

export function ownerTime(now = new Date()) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(now)
}

// "2026-10-13" → "tue" (the date itself, no time zone involved).
export function weekdayOf(day) {
  const [y, m, d] = day.split("-").map(Number)
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

// "id: text" lines (agent.md `checklist` / `daily`) → [{ id, text }]
export function itemLines(lines) {
  return (lines ?? []).flatMap((line) => {
    const match = /^\s*([a-z0-9_-]+)\s*:\s*(.+)$/i.exec(String(line))
    return match ? [{ id: match[1].toLowerCase(), text: match[2].trim() }] : []
  })
}

// The older `daily:` form as a template: every day a run day, the items as given.
export function templateFromDaily(daily) {
  const items = itemLines(daily).map((item) => `- [ ] ${item.id}: ${item.text}`)
  return ["# Checklist {{date}}", "", "Wiped every morning. The day is done when no line is open.", "", ...items, ""].join("\n")
}

// Template text → { days, skip, vars, body }. Unknown day names are an error, so a typo never silently
// turns every day into a rest day.
export function parseTemplate(text, overrides = {}) {
  const { data, body } = splitFrontmatter(String(text ?? ""))
  const days = data.days == null ? WEEKDAYS : [].concat(data.days).map((d) => String(d).slice(0, 3).toLowerCase())
  const unknown = days.filter((d) => !WEEKDAYS.includes(d))
  if (unknown.length) throw new Error(`checklist template: unknown day ${unknown.join(", ")} (use ${WEEKDAYS.join(", ")}).`)
  const skip = [].concat(data.skip ?? []).map(String)
  const vars = { ...(data.vars && typeof data.vars === "object" ? data.vars : {}), ...(overrides ?? {}) }
  return { days, skip, vars, body }
}

export function isRunDay(template, day) {
  return template.days.includes(weekdayOf(day)) && !template.skip.includes(day)
}

// The template filled in for one day → the checklist file's text.
export function renderTemplate(template, day, { agent = "" } = {}) {
  const heading = `# Checklist ${day}`
  if (!isRunDay(template, day)) {
    return `${heading}\n\nRest day (${weekdayOf(day)}): not a run day, nothing is due. Add work with checklist.add.\n`
  }
  const values = { ...template.vars, date: day, weekday: weekdayOf(day), agent }
  const number = (token) => {
    const value = /^\d+$/.test(token) ? Number(token) : Number(values[token])
    if (!Number.isInteger(value)) throw new Error(`checklist template: {{${token}}} is not a whole number.`)
    return value
  }
  const out = []
  for (const line of template.body.split("\n")) {
    const range = /\{\{\s*([a-z0-9_]+)\s*\.\.\s*([a-z0-9_]+)\s*\}\}/i.exec(line)
    const copies = []
    if (range) {
      const from = number(range[1])
      const to = number(range[2])
      for (let n = from; n <= to; n++) copies.push(line.replace(/\{\{\s*[a-z0-9_]+\s*\.\.\s*[a-z0-9_]+\s*\}\}/gi, String(n)))
    } else copies.push(line)
    for (const copy of copies) {
      out.push(copy.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (whole, key) => (key in values ? String(values[key]) : whole)))
    }
  }
  let text = out.join("\n").trim()
  if (!/^#\s*Checklist\s+\d{4}-\d{2}-\d{2}/m.test(text)) text = `${heading}\n\n${text}`
  const ids = parseChecklist(text).items.map((item) => item.id)
  const twice = ids.filter((id, i) => ids.indexOf(id) !== i)
  if (twice.length) throw new Error(`checklist template: item id used twice: ${[...new Set(twice)].join(", ")}.`)
  return `${text}\n`
}

// checklist.md → { day, lines, items: [{ id, text, status, note, at, noteAt }] }. `at` is the item's line index,
// `noteAt` its note line's (or null). Everything else in the file is the owner's and is kept.
export function parseChecklist(text = "") {
  const day = /^#\s*Checklist\s+(\d{4}-\d{2}-\d{2})/m.exec(text)?.[1] ?? null
  const lines = String(text).split("\n")
  const items = []
  lines.forEach((line, at) => {
    const item = ITEM.exec(line)
    if (item) {
      items.push({ id: item[4].toLowerCase(), text: item[6], status: MARKS[item[2]], note: null, at, noteAt: null })
      return
    }
    const note = NOTE.exec(line)
    const last = items[items.length - 1]
    if (note && last && last.noteAt == null && at === last.at + 1) Object.assign(last, { note: note[1], noteAt: at })
  })
  return { day, lines, items }
}

// Tick / skip an item in place: its box and its note line change, nothing else in the file does.
export function markItem(text, id, status, note) {
  const doc = parseChecklist(text)
  const item = doc.items.find((i) => i.id === id)
  if (!item) return null
  const lines = [...doc.lines]
  lines[item.at] = lines[item.at].replace(ITEM, (_, a, _box, b, key, c, rest) => `${a}${BOXES[status][1]}${b}${key}${c}${rest}`)
  const indent = /^(\s*)/.exec(lines[item.at])[1]
  const noteLine = `${indent}  ↳ ${note}`
  if (item.noteAt != null) lines[item.noteAt] = noteLine
  else lines.splice(item.at + 1, 0, noteLine)
  return lines.join("\n")
}

// Add an open item at the end of the file.
export function addItem(text, id, what) {
  const body = String(text).replace(/\s+$/, "")
  return `${body}\n- [ ] ${id}: ${what}\n`
}

// A leading "HH:MM" is when the item comes due (ET); none = due now.
export function isDue(item, now = ownerTime()) {
  const at = /^(\d{1,2}):(\d{2})\b/.exec(item.text)
  return !at || `${at[1].padStart(2, "0")}:${at[2]}` <= now
}
