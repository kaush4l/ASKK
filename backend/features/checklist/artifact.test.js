// The checklist artifact over a fake workspace: the first run of a run day writes the template, ticks and adds keep
// the template's guidance, a new day archives the old file.
// Run: bun test ./backend/features/checklist

import { afterAll, beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test"

const FILES = {}
let rev = 0
const ws = {
  kind: "host",
  label: "test",
  writable: true,
  read: async (path) => {
    if (!(path in FILES)) throw new Error(`Not found: ${path}`)
    return { path, text: FILES[path].text, revision: FILES[path].revision }
  },
  write: async (path, text) => {
    FILES[path] = { text, revision: `r${++rev}` }
    return { path, revision: FILES[path].revision }
  },
}

const real = await import("@/backend/features/filesystem/workspace")
mock.module("@/backend/features/filesystem/workspace", () => ({ ...real, workspace: async () => ws }))
const { ChecklistArtifact } = await import("./artifact")

const TEMPLATE = `---
days: [mon, tue, wed, thu, fri]
vars: {drafts: 2}
---
# Checklist {{date}}

Rank the drafts by clarity.

- [ ] draft-{{1..drafts}}: 09:40 draft #{{1..drafts}}
- [ ] review: 09:45 lead picks
`

const engine = {
  name: "lead",
  agent: { name: "lead", checklist_file: "checklist.md", checklist_template_text: TEMPLATE, checklist_vars: { drafts: 3 } },
  getSnapshot: () => ({ working: { origin: "o1", kind: "request" } }),
}

const tool = (artifact, name) => artifact.commands().find((t) => t.name === name)

describe("checklist artifact with a template", () => {
  beforeEach(() => {
    for (const key of Object.keys(FILES)) delete FILES[key]
  })
  afterAll(() => setSystemTime())

  test("first run of a run day writes the template; ticks keep its guidance", async () => {
    setSystemTime(new Date("2026-10-13T13:00:00Z")) // Tue 09:00 ET
    const a = new ChecklistArtifact({ engine })
    await a.refresh()
    expect(FILES["checklist.md"].text).toContain("# Checklist 2026-10-13")
    expect(a.fileItems.map((i) => i.id)).toEqual(["draft-1", "draft-2", "draft-3", "review"])
    expect(a.pending()).toHaveLength(0) // nothing due before 09:40
    expect(a.render()).toContain("Rank the drafts by clarity.")

    await tool(a, "checklist.tick").run({ id: "draft-1", evidence: "report sent · 2 files" })
    await tool(a, "checklist.add").run({ text: "12:00 re-read drafts", id: "redraft" })
    const text = FILES["checklist.md"].text
    expect(text).toContain("Rank the drafts by clarity.")
    expect(text).toMatch(/- \[x\] draft-1: 09:40 draft #1\n {2}↳ 09:00 ET: report sent · 2 files/)
    expect(text).toContain("- [ ] redraft: 12:00 re-read drafts")

    setSystemTime(new Date("2026-10-13T13:50:00Z")) // 09:50 ET: draft-2, draft-3, review due
    expect(a.pending().map((i) => i.id)).toEqual(["draft-2", "draft-3", "review"])
    expect(a.render()).toContain("draft-2: 09:40 draft #2 (due)")
  })

  test("a new day archives yesterday's file; a weekend is a rest day", async () => {
    setSystemTime(new Date("2026-10-16T13:00:00Z")) // Fri
    const a = new ChecklistArtifact({ engine })
    await a.refresh()
    setSystemTime(new Date("2026-10-17T13:00:00Z")) // Sat
    await a.refresh()
    expect(FILES["days/2026-10-16/checklist.md"].text).toContain("# Checklist 2026-10-16")
    expect(FILES["checklist.md"].text).toContain("Rest day (sat)")
    expect(a.pending()).toHaveLength(0)
  })
})
