import { expect, test } from "bun:test"
import { pipelineView, sourceChips, took } from "./pipeline.js"

test("view: progress, live elapsed for a running stage, chips newest first, the result and what waits", () => {
  const now = Date.parse("2026-10-21T12:20:00Z")
  const v = pipelineView(
    {
      status: "running",
      run: { id: "r1", by: "desk: schedule 08:15", started: "2026-10-21T12:15:00Z" },
      stages: [
        { id: "evidence", n: 1, status: "done", ms: 95000, tools: 3, sources: [{ name: "WebSearch", query: "ABC news" }, { name: "WebFetch", url: "https://news.example.org/x" }] },
        { id: "pattern", n: 2, status: "running", started: "2026-10-21T12:19:30Z", sources: [] },
      ],
      card: { decision: "GO", text: "DECISION: GO", problems: [], levels: [] },
      learnings: { pending: [{ id: "L1", text: "t" }], accepted: 2 },
      watch: { hits: [{ symbol: "ABC", kind: "entry", price: 772.5, side: "above", px: 772.6, hm: "10:02" }] },
    },
    { now },
  )
  expect(v.progress).toBe("1/2")
  expect(v.run.elapsed).toBe("5m00s")
  expect(v.stages[0]).toMatchObject({ elapsed: "1m35s", tools: 3 })
  expect(v.stages[0].chips.map((c) => c.label)).toEqual(["news.example.org", "ABC news"])
  expect(v.stages[1].elapsed).toBe("30s")
  expect(v.result.decision).toBe("GO")
  expect(v.pending).toHaveLength(1)
  expect(v.events[0]).toContain("ABC entry 772.5 crossed (above) at 772.6")
})

test("chips: capped with a count; a page link only for http(s)", () => {
  const { chips, more } = sourceChips([...Array(9)].map((_, i) => ({ url: i ? `https://s${i}.com` : "javascript:x" })), 6)
  expect(chips).toHaveLength(6)
  expect(more).toBe(3)
  expect(sourceChips([{ url: "javascript:x" }]).chips[0].href).toBeNull()
  expect(took(61000)).toBe("1m01s")
  expect(pipelineView(null).status).toBe("idle")
})
