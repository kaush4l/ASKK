// The day's checklist template (template.js): run days, vars, repeated slots, edits that keep the owner's lines.
// Run: bun test ./backend/features/checklist

import { describe, expect, test } from "bun:test"
import {
  addItem,
  isDue,
  isRunDay,
  markItem,
  parseChecklist,
  parseTemplate,
  renderTemplate,
  templateFromDaily,
  weekdayOf,
} from "./template"

const TEMPLATE = `---
days: [mon, tue, wed, thu, fri]
skip: ["2026-11-26"]
vars:
  drafts: 3
  goal: "inbox zero"
---
# Checklist {{date}}

Goal {{goal}} on {{weekday}}.

## Drafts
- [ ] draft-{{1..drafts}}: 09:40 draft #{{1..drafts}} of {{drafts}}
- [ ] review: 09:45 rank by clarity
`

describe("checklist template", () => {
  test("weekday of a date", () => {
    expect(weekdayOf("2026-10-13")).toBe("tue")
    expect(weekdayOf("2026-10-11")).toBe("sun")
  })

  test("run days and skipped dates", () => {
    const t = parseTemplate(TEMPLATE)
    expect(isRunDay(t, "2026-10-13")).toBe(true)
    expect(isRunDay(t, "2026-10-11")).toBe(false)
    expect(isRunDay(t, "2026-11-26")).toBe(false)
  })

  test("renders vars and repeats range lines", () => {
    const text = renderTemplate(parseTemplate(TEMPLATE), "2026-10-13")
    expect(text).toContain("# Checklist 2026-10-13")
    expect(text).toContain("Goal inbox zero on tue.")
    const doc = parseChecklist(text)
    expect(doc.day).toBe("2026-10-13")
    expect(doc.items.map((i) => i.id)).toEqual(["draft-1", "draft-2", "draft-3", "review"])
    expect(doc.items[1].text).toBe("09:40 draft #2 of 3")
  })

  test("agent.md vars override the template's", () => {
    const doc = parseChecklist(renderTemplate(parseTemplate(TEMPLATE, { drafts: 5 }), "2026-10-13"))
    expect(doc.items.filter((i) => i.id.startsWith("draft-"))).toHaveLength(5)
  })

  test("a rest day has no items", () => {
    const text = renderTemplate(parseTemplate(TEMPLATE), "2026-10-11")
    expect(parseChecklist(text).day).toBe("2026-10-11")
    expect(parseChecklist(text).items).toHaveLength(0)
  })

  test("unknown day names and duplicate ids are errors", () => {
    expect(() => parseTemplate("---\ndays: [mon, funday]\n---\n# x")).toThrow(/unknown day/)
    expect(() => renderTemplate(parseTemplate("- [ ] a: x\n- [ ] a: y"), "2026-10-13")).toThrow(/twice/)
  })

  test("the daily: form still works and every day is a run day", () => {
    const t = parseTemplate(templateFromDaily(["start: 08:55 plan written", "close: 16:25 reviewed"]))
    const doc = parseChecklist(renderTemplate(t, "2026-10-11"))
    expect(doc.items.map((i) => i.id)).toEqual(["start", "close"])
  })

  test("tick, re-tick and add keep every other line", () => {
    let text = renderTemplate(parseTemplate(TEMPLATE), "2026-10-13")
    text = markItem(text, "draft-2", "ticked", "09:41 ET: report sent · 2 files")
    expect(text).toContain("- [x] draft-2: 09:40 draft #2 of 3\n  ↳ 09:41 ET: report sent · 2 files")
    text = markItem(text, "draft-2", "skipped", "09:50 ET: skipped: dropped")
    expect(text.match(/↳/g)).toHaveLength(1)
    expect(parseChecklist(text).items[1]).toMatchObject({ status: "skipped", note: "09:50 ET: skipped: dropped" })
    text = addItem(text, "redraft", "12:00 re-read the drafts")
    expect(text).toContain("Goal inbox zero on tue.")
    expect(text).toContain("## Drafts")
    expect(parseChecklist(text).items.at(-1)).toMatchObject({ id: "redraft", status: "open" })
    expect(markItem(text, "nope", "ticked", "x")).toBeNull()
  })

  test("a timed item is due once its time has come", () => {
    expect(isDue({ text: "09:40 draft" }, "09:39")).toBe(false)
    expect(isDue({ text: "09:40 draft" }, "09:40")).toBe(true)
    expect(isDue({ text: "no time" }, "00:00")).toBe(true)
  })
})
