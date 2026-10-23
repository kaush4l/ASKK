import { expect, test } from "bun:test"
import { Practice, parseRetros } from "../index.js"

// 2026-10-23 audit: a practice's retros are drawn from its state; they come back from the store at start, not only
// until a restart.
const RETROS = "## 2026-10-22T14:00 agent\n- worked: searched once\n- missed: none: the run lacked nothing\n- changes: none: nothing to change (0 edits)\n\n## 2026-10-23T09:10 agent\n- worked: two reads\n- missed: the date\n- changes: Lessons: name the date (1 edit)\n"

test("retros parse oldest first; a practice reads its newest back from its store", () => {
  expect(parseRetros(RETROS).map((r) => [r.at, r.by, r.missed])).toEqual([
    ["2026-10-22T14:00:00Z", "agent", "none: the run lacked nothing"],
    ["2026-10-23T09:10:00Z", "agent", "the date"],
  ])
  const p = new Practice({ id: "agent.practice", owner: "agent", store: { read: () => null, seed: () => null, write: () => {}, retro: () => {}, retros: () => RETROS } })
  expect(p.state.retros.map((r) => r.changes)).toEqual(["none: nothing to change (0 edits)", "Lessons: name the date (1 edit)"])
  expect(new Practice({ id: "x.practice", owner: "x", store: { read: () => null, seed: () => null } }).state.retros).toEqual([])
})

test("a pending line that does not parse is kept as written at the next save, and said", () => {
  let file = "# agent — practice\n\n## Checklist\n- route: pick how\n\n## Pending\n{ this is not json\n"
  const p = new Practice({ id: "agent.practice", owner: "agent", store: { read: () => file, seed: () => null, write: (t) => (file = t), retro: () => {} } })
  expect(p.state.readError).toContain("1 pending line in its file do not parse")
  p.save()
  expect(file).toContain("{ this is not json")
})
