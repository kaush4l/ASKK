import { describe, expect, test } from "bun:test"
import { FRAMES_TAIL, goalSplit, skippedOf, tailArtifact, tailArtifacts, TAIL } from "./artifact-tail"

const change = (n) => ({ path: `a${n}.js`, by: "coder", at: `2026-10-26T09:${String(n).padStart(2, "0")}:00Z`, op: "edit", added: 1, removed: 0, diff: `+ line ${n}`, why: `w${n}` })
const files = () => ({ id: "files", kind: "files", view: "files", holders: ["coder"], state: { root: "projects", tree: [{ path: "a.js", size: 1 }], open: [], modified: [change(3), change(1), change(2)] } })
const goal = (n) => ({
  id: "goal",
  kind: "goal",
  view: "goal",
  holders: ["dev"],
  state: { goal: { text: "g" }, entries: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, kind: "progress" })), ledger: Array.from({ length: n }, (_, i) => ({ id: `l${i}`, kind: "fact", text: `t${i}` })), milestones: [] },
})

describe("snapshot-artifact-views", () => {
  test("files keeps every change, only the newest change's diff, and the tree as its count", () => {
    const t = tailArtifact("files", files())
    expect(t.diffsSkipped).toBe(2)
    expect(t.state.tree).toEqual([])
    expect(t.treeSkipped).toBe(1)
    expect(t.state.modified).toHaveLength(3)
    expect(t.state.modified.filter((m) => m.diff != null).map((m) => m.path)).toEqual(["a3.js"])
    expect(t.state.modified[1]).toEqual({ path: "a1.js", by: "coder", at: change(1).at, op: "edit", added: 1, removed: 0, why: "w1" })
    expect(skippedOf(t)).toBe(3)
  })

  test("snapshot-files-lean: an 800-row tree rides as a count, under a quarter of the size, and the original stays whole", () => {
    const tree = Array.from({ length: 800 }, (_, i) => ({ path: `src/dir${i % 40}/file-${i}.js`, size: 1000 + i, mtime: 1761469200000 + i, dir: false }))
    const big = { ...files(), state: { ...files().state, tree } }
    const t = tailArtifact("files", big)
    expect(t.state.tree).toEqual([])
    expect(t.treeSkipped).toBe(800)
    expect(big.state.tree).toHaveLength(800)
    expect(JSON.stringify(t).length).toBeLessThan(JSON.stringify(big).length / 4)
  })

  test("goal keeps its newest 15 entries and ledger notes", () => {
    const t = tailArtifact("goal", goal(60))
    expect(TAIL).toBe(15)
    expect(t.state.entries).toHaveLength(TAIL)
    expect(t.state.ledger).toHaveLength(TAIL)
    expect(t.state.ledger[0].id).toBe("l45")
    expect(t.state.ledger.at(-1).id).toBe("l59")
    expect(t.entriesSkipped).toBe(90)
    expect(tailArtifact("goal", goal(10))).toEqual(goal(10))
  })

  test("goal-lean-ledger: 30 entries of 1.5 KB, 30 notes of 400 chars and 25 done milestones ride under 30 KB", () => {
    const kb = "x".repeat(1024)
    const done = (i) => ({ id: `d${i}`, text: `done ${i} `.padEnd(300, "t"), check: kb, status: "done", claim: null, evidence: kb, by: "coder", at: "2026-10-26T10:00:00Z" })
    const entries = Array.from({ length: 30 }, (_, i) => ({ id: `e${i}`, kind: "progress", text: "e".repeat(1536) }))
    const ledger = Array.from({ length: 30 }, (_, i) => ({ id: `l${i}`, kind: "decision", text: "n".repeat(400) }))
    const big = { ...goal(0), state: { goal: { text: "g" }, entries, ledger, milestones: Array.from({ length: 25 }, (_, i) => done(i)) } }
    const t = tailArtifact("goal", big)
    expect(t.state.entries.map((e) => e.id)).toEqual(entries.slice(-15).map((e) => e.id))
    expect(t.state.ledger[0].id).toBe("l15")
    expect(t.entriesSkipped).toBe(30)
    expect(t.entriesCut).toBe(15)
    for (const e of t.state.entries) {
      expect(e.entryCut).toBe(true)
      expect(e.text.length).toBeLessThanOrEqual(301)
    }
    expect(big.state.entries[29].text).toHaveLength(1536)
    expect(t.notesCut).toBe(15)
    expect(skippedOf(t)).toBe(30 + 15 + 15 + 25)
    expect(JSON.stringify(big).length).toBeGreaterThan(30 * 1024)
    expect(JSON.stringify(t).length).toBeLessThan(30 * 1024)
  })

  test("snapshot-goal-lean: done milestones ride as one line, open ones with their long check cut, the original untouched", () => {
    const kb = "x".repeat(1024)
    const done = (i) => ({ id: `d${i}`, text: `done ${i} `.padEnd(300, "t"), check: kb, status: "done", claim: null, evidence: kb, by: "coder", at: "2026-10-26T10:00:00Z" })
    const open = (i) => ({ id: `o${i}`, text: `open ${i}`, check: kb, status: "open", claim: i ? null : { by: "coder", at: "2026-10-26T10:30:00Z" } })
    const big = () => ({ ...goal(5), state: { ...goal(5).state, milestones: [...Array.from({ length: 25 }, (_, i) => done(i)), ...Array.from({ length: 3 }, (_, i) => open(i))] } })
    const g = big()
    const t = tailArtifact("goal", g)
    const rows = t.state.milestones
    expect(rows).toHaveLength(28)
    for (const m of rows.filter((m) => m.status === "done")) {
      expect(m.check).toBeUndefined()
      expect(m.evidence).toBeUndefined()
      expect(m.done).toBe(true)
      expect(m.doneCut).toBe(true)
      expect(m.text.length).toBeLessThanOrEqual(121)
    }
    for (const [m, o] of rows.slice(25).map((m, i) => [m, big().state.milestones[25 + i]])) {
      expect(m).toEqual({ ...o, check: `${o.check.slice(0, 300)}…`, cut: true })
    }
    expect(g).toEqual(big())
    expect(t.milestonesCut).toBe(28)
    expect(skippedOf(t)).toBe(28)
    expect(JSON.stringify(t).length).toBeLessThan(30 * 1024)
  })

  test("goal-under-30: a realistic goal rides under 30 KB, notes and open checks cut, short fields whole, the original untouched", () => {
    const k = (c, n) => c.repeat(n)
    const make = () => ({
      ...goal(0),
      state: {
        goal: { text: "g" },
        entries: Array.from({ length: 15 }, (_, i) => ({ id: `e${i}`, kind: "progress", did: k("d", 200), result: k("r", 200), next: k("n", 200), toward: k("t", 200) })),
        ledger: Array.from({ length: 15 }, (_, i) => ({ id: `l${i}`, kind: "fact", text: k("n", 1536), evidence: k("v", 1536), by: "critic" })),
        milestones: [
          ...Array.from({ length: 30 }, (_, i) => ({ id: `d${i}`, text: `done ${i}`, check: k("c", 2048), status: "done", evidence: k("v", 2048), by: "coder", at: "2026-10-26T10:00:00Z" })),
          ...Array.from({ length: 3 }, (_, i) => ({ id: `o${i}`, text: `open ${i}`, check: k("c", 2048), status: "open", claim: null })),
        ],
      },
    })
    const g = make()
    const t = tailArtifact("goal", g)
    expect(JSON.stringify(g).length).toBeGreaterThan(30 * 1024)
    expect(JSON.stringify(t).length).toBeLessThan(30 * 1024)
    expect(t.state.entries).toEqual(g.state.entries)
    expect(t.notesCut).toBe(15)
    for (const n of t.state.ledger) {
      expect(n.cut).toBe(true)
      expect(n.text).toHaveLength(301)
      expect(n.evidence).toHaveLength(301)
      expect(n.by).toBe("critic")
    }
    for (const m of t.state.milestones.slice(30)) {
      expect(m.cut).toBe(true)
      expect(m.check).toHaveLength(301)
      expect(m.text).toMatch(/^open \d$/)
    }
    expect(t.milestonesCut).toBe(33)
    expect(skippedOf(t)).toBe(15 + 33)
    expect(g).toEqual(make())
  })

  test("goal-30-diagnose: a live-shaped goal with 12 frames rides under 30 KB with the newest 3 frames, the original untouched", () => {
    const k = (c, n) => c.repeat(n)
    const make = () => ({
      ...goal(0),
      state: {
        goal: { text: k("g", 900) },
        status: "active",
        next: k("x", 260),
        entries: Array.from({ length: 15 }, (_, i) => ({ id: `e${i}`, kind: "progress", did: k("d", 100), result: k("r", 100), next: k("n", 100), toward: k("t", 100), value: k("v", 60) })),
        ledger: Array.from({ length: 15 }, (_, i) => ({ id: `l${i}`, kind: "fact", text: k("n", 300), evidence: k("v", 120), by: "critic" })),
        milestones: [
          ...Array.from({ length: 30 }, (_, i) => ({ id: `d${i}`, text: k("t", 100), check: k("c", 500), status: "done", evidence: k("v", 500), by: "coder", at: "2026-10-26T10:00:00Z" })),
          ...Array.from({ length: 3 }, (_, i) => ({ id: `o${i}`, text: `open ${i}`, check: k("c", 300), status: "open", claim: null })),
        ],
        frames: Array.from({ length: 12 }, (_, i) => ({ id: `f${i}`, agent: "coder", request: k("q", 300), intent: k("i", 100), done: k("o", 100), route: k("r", 50), why: k("w", 200), at: "2026-10-26T11:00:00Z", status: "answered" })),
      },
    })
    const g = make()
    const t = tailArtifact("goal", g)
    const s = goalSplit(t)
    expect(Object.keys(s)).toEqual([...Object.keys(g.state), "rest"])
    expect(goalSplit(g).frames).toBeGreaterThan(Math.max(s.entries, s.ledger, s.milestones))
    expect(FRAMES_TAIL).toBe(3)
    expect(t.state.frames.map((f) => f.id)).toEqual(["f9", "f10", "f11"])
    expect(t.state.frames.at(-1)).toEqual(g.state.frames.at(-1))
    expect(t.framesSkipped).toBe(9)
    expect(skippedOf(t)).toBe(30 + 9)
    expect(JSON.stringify(t).length).toBeLessThan(30 * 1024)
    expect(g).toEqual(make())
    expect(g.state.frames).toHaveLength(12)
  })

  test("an unknown artifact passes through unchanged", () => {
    const board = { id: "board", view: "board", state: { cards: [1, 2] } }
    expect(tailArtifact("board", board)).toBe(board)
    expect(tailArtifact("x", null)).toBe(null)
    expect(skippedOf(board)).toBe(0)
  })

  test("the trim leaves the full view whole, so the card's fetch equals the original", () => {
    const all = { files: files(), goal: goal(45) }
    const tailed = tailArtifacts(all)
    expect(skippedOf(tailed.files) + skippedOf(tailed.goal)).toBe(3 + 60)
    expect(all).toEqual({ files: files(), goal: goal(45) })
    expect(JSON.stringify(tailed).length).toBeLessThan(JSON.stringify(all).length)
  })
})
