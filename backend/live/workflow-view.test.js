import { describe, expect, test } from "bun:test"

import { compareFields, errorLine, flowLayout, nowLine, phaseCards, phaseOffset, progressOf } from "./workflow-view"

const config = {
  settings: { board: false },
  steps: [
    { id: "research", n: 1, kind: "phase", agent: "scout", after: [], uses: ["request"], report: ["sources", "findings"], rev: "a1" },
    { id: "outline", n: 2, kind: "agent", own: true, step_agent: "brief-outline", after: ["research"], uses: ["research.findings"], report: ["outline"], rev: "b1" },
    { id: "check", n: 3, kind: "phase", agent: "scout", after: ["research"], uses: [], report: ["verdict"], board: true, rev: "c1" },
    { id: "write", n: 4, kind: "phase", agent: "writer", after: ["outline", "check"], uses: ["outline.outline", "research.sources", "audience"], report: ["file"], rev: "d1" },
  ],
}

describe("the workflow viewer's model", () => {
  test("each phase as input → work → output: what it reads and from where, how it runs, what it hands on", () => {
    const cards = phaseCards(config, [])
    expect(cards.map((c) => [c.id, c.status, c.how.label, c.how.detail])).toEqual([
      ["research", "waiting", "agent", "scout"],
      ["outline", "waiting", "own agent", "brief-outline"],
      ["check", "waiting", "agent", "scout"],
      ["write", "waiting", "agent", "writer"],
    ])
    expect(cards[3].reads.vars).toEqual([
      { name: "outline.outline", from: "outline", kind: "field" },
      { name: "research.sources", from: "research", kind: "field" },
      { name: "audience", from: "run", kind: "run" },
    ])
    expect(cards[3].reads.board).toBe(false) // the workflow turned the board off
    expect(cards[2].reads.board).toBe(true) // the phase turned it back on
    expect(cards[0].hands.map((h) => h.name)).toEqual(["research.sources", "research.findings"])
  })

  test("the flow's shape: phases that wait on the same one share a depth; data edges where a phase reads past its after", () => {
    const { groups, edges } = flowLayout(config.steps)
    expect(groups).toEqual([["research"], ["outline", "check"], ["write"]])
    expect(edges.filter((e) => e.kind === "data")).toEqual([{ from: "research", to: "write", kind: "data", vars: ["research.sources"] }])
    expect(edges.find((e) => e.to === "outline")).toEqual({ from: "research", to: "outline", kind: "after", vars: ["research.findings"] })
  })

  test("live: progress by phase, the line of what runs now, a phase edited since its output", () => {
    const stages = [
      { id: "research", status: "done", rev: "a0", elapsed: "1m37s", last: { run: "r1", rev: "a0" } },
      { id: "outline", status: "running", rev: "b1", elapsed: "0m42s", turns: 3, tools: 2, agent: "brief-outline" },
      { id: "check", status: "running", rev: "c1", elapsed: "0m10s", turns: 1, tools: 0 },
    ]
    const cards = phaseCards(config, stages)
    expect(progressOf(cards)).toMatchObject({ total: 4, settled: 1, share: 0.25 })
    expect(nowLine(cards)).toEqual([
      { id: "outline", title: "outline", text: "0m42s · 3 turns · 2 calls", agent: "brief-outline" },
      { id: "check", title: "check", text: "0m10s · 1 turn", agent: null },
    ])
    expect(cards[0]).toMatchObject({ edited: true, lastEdited: true })
    expect(cards[1].edited).toBe(false)
    expect(nowLine(phaseCards(config, []), { status: "running" })).toEqual([{ id: "research", title: "research", text: "starting", agent: null }])
  })

  test("the editor: an error's line, a phase's place in the file, a report compared with the run before", () => {
    const text = "---\ntitle: x\n---\n## research\nagent: a\n\ngo\n\n## outline\nagent: a\n\nuse {{research.nope}}"
    expect(errorLine("workflow.md ## outline: {{research.nope}} — research reports a", text)).toBe(9)
    expect(errorLine("no phases", text)).toBe(null)
    expect(text.slice(phaseOffset(text, "outline")).startsWith("## outline")).toBe(true)
    expect(compareFields(["a", "b"], { a: "1", b: "2" }, { a: "1", b: "3" })).toEqual([
      { field: "a", now: "1", before: "1", same: true },
      { field: "b", now: "2", before: "3", same: false },
    ])
  })
})
