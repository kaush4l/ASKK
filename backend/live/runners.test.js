import { expect, test } from "bun:test"
import { parsePlot, runnerCall, runnerCharts, runnerRows, runnerStatus, startRunner } from "./runners.js"

test("the chart: price-scale plots over the price, the others in the lower panel, fire marks placed", () => {
  const chart = { t: ["10:30", "10:35", "10:40", "10:45"], c: [100, 101, 102, 101.5], plots: { ema: [null, 100.5, 101.2, 101.4], rsi: [50, 60, 72, 65] }, marks: [2] }
  const g = runnerCharts(chart, { width: 100, height: 50, pad: 0 })
  expect(g.over.map((s) => s.name)).toEqual(["ema"])
  expect(g.lower.series.map((s) => s.name)).toEqual(["rsi"])
  expect(g.price.d.startsWith("M0.0,50.0")).toBe(true) // the low at the bottom left
  expect(g.over[0].d.startsWith("M33.3")).toBe(true) // its warm-up skipped
  expect(g.marks).toEqual([{ x: (2 / 3) * 100, at: "10:40" }])
  expect([g.first, g.last, g.price.last.v]).toEqual(["10:30", "10:45", 101.5])
  expect(runnerCharts({ c: [] })).toBeNull()
})

test("each runner's state in a word, the holding and near ones first", () => {
  const base = { status: "running", warn: 2 }
  expect(runnerStatus({ ...base, last: { cond: true } })).toMatchObject({ word: "holds", tone: "holds" })
  expect(runnerStatus({ ...base, last: { cond: false, prox: { gap: 0.4, pace: -0.2, eta: 2 } } })).toMatchObject({ word: "near", detail: "0.4 to go · ≈2 bars" })
  expect(runnerStatus({ ...base, last: { cond: false, prox: { gap: 3, pace: 0.1, eta: null } } })).toMatchObject({ tone: "running", detail: "3 to go · moving away" })
  expect(runnerStatus({ ...base, last: { warming: "4/22 bars" } })).toMatchObject({ word: "warming", detail: "4/22 bars" })
  expect(runnerStatus({ status: "fired", fires: [{ kind: "fire", at: "2026-10-20T14:35:00Z" }] })).toMatchObject({ word: "fired", detail: "at 10:35 ET" })
  const rows = runnerRows({ runners: [{ id: "a", status: "paused" }, { id: "b", ...base, last: { cond: true } }, { id: "c", ...base, last: { cond: false } }] })
  expect(rows.map((x) => x.r.id)).toEqual(["b", "c", "a"])
  expect(parsePlot("ema9=ema(close, 9); hi: highest(high, 20)\nbad")).toEqual({ ema9: "ema(close, 9)", hi: "highest(high, 20)" })
})

test("the owner's calls go to the artifact", async () => {
  const realFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return new Response(JSON.stringify({ ok: true, value: { runner: "x" } }), { headers: { "content-type": "application/json" } })
  }
  try {
    await runnerCall("lab.runners", "pause", "orb-up")
    await startRunner("lab.runners", { id: "x", symbol: "ABC", when: "close > 1" })
    expect(calls.map((c) => c.body)).toEqual([
      { target: "artifact", method: "pause", args: [{ id: "lab.runners", runner: "orb-up" }] },
      { target: "artifact", method: "start", args: [{ id: "lab.runners", spec: { id: "x", symbol: "ABC", when: "close > 1" } }] },
    ])
  } finally {
    globalThis.fetch = realFetch
  }
})
