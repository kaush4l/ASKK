import { expect, test } from "bun:test"

import { axisText, chartLayout, cleanPoints, downsample, nearestPoints, newestChart, numberText, SERIES_SLOTS, tickTexts } from "./chart.js"

const line = (points, name = "loss") => ({ name, points })

test("cleanPoints: numbers kept (numeric strings too), labels kept, anything else dropped", () => {
  expect(cleanPoints([[0, 1], ["2", "3.5"], [1, "nan"], [null, 2], "x", [4, 5, "run-a"], [5, 6, ""]])).toEqual([[0, 1], [2, 3.5], [4, 5, "run-a"], [5, 6]])
  expect(cleanPoints(null)).toEqual([])
})

test("downsample: at most max points, first and last kept, every spike and dip kept, order kept", () => {
  const points = Array.from({ length: 1000 }, (_, i) => [i, Math.sin(i / 10)])
  points[333][1] = 50 // a spike
  points[777][1] = -50 // a dip
  const out = downsample(points, 100)
  expect(out.length).toBeLessThanOrEqual(100)
  expect(out[0]).toBe(points[0])
  expect(out.at(-1)).toBe(points[999])
  expect(out).toContain(points[333])
  expect(out).toContain(points[777])
  expect(out.every((p, i) => i === 0 || p[0] > out[i - 1][0])).toBe(true)
  expect(downsample(points.slice(0, 10), 400)).toHaveLength(10) // under the cap: as it is
  expect(downsample(points, 3)).toEqual([points[0], points[999]])
  expect(downsample(points, 0)).toEqual([])
})

test("tickTexts: short, and as many digits as it takes to tell two values apart", () => {
  expect(tickTexts([0, 5000])).toEqual(["0", "5000"])
  expect(tickTexts([1234, 98765])).toEqual(["1234", "98.8K"])
  expect(tickTexts([2.3412, 2.3448])).toEqual(["2.341", "2.345"])
  expect(numberText(0.000012)).toBe("1.2e-5")
  expect(numberText(12.3456)).toBe("12.3")
  expect(numberText(-0.5)).toBe("-0.5")
  expect(numberText(NaN)).toBe("")
})

test("chartLayout line: y ticks at the data's min and max, x ticks at the range's ends, paths across the plot", () => {
  const l = chartLayout({ kind: "line", series: [line([[0, 3], [100, 2.5], [200, 2.1]]), line([[0, 3.1], [200, 2.4]], "val")] }, { width: 300, height: 120 })
  expect(l.empty).toBe(false)
  expect(l.yTicks.map((t) => t.text)).toEqual(["2.1", "3.1"])
  expect(l.yTicks[0].py).toBe(l.plot.bottom)
  expect(l.yTicks[1].py).toBe(l.plot.top)
  expect(l.xTicks.map((t) => [t.text, t.anchor])).toEqual([["0", "start"], ["200", "end"]])
  const [loss, val] = l.series
  expect(loss.d.startsWith(`M${l.plot.left} `)).toBe(true)
  expect(loss.d.endsWith(`${l.plot.right} ${l.plot.bottom}`)).toBe(true) // the last point is the min: bottom right
  expect(val.points[0].py).toBe(l.plot.top) // 3.1 is the max
  expect([loss.slot, val.slot]).toEqual([1, 2])
  expect(loss.last).toEqual([200, 2.1])
  expect(l.baseline).toBeNull() // 0 is outside the y range
  expect(l.plot.right).toBeLessThanOrEqual(300)
})

test("chartLayout line: drawn in x order; a long series is downsampled to the plot's width", () => {
  const l = chartLayout({ series: [line([[2, 1], [0, 3], [1, 2]])] }, { width: 300 })
  expect(l.kind).toBe("line")
  expect(l.series[0].points.map((p) => p.x)).toEqual([0, 1, 2])
  const long = chartLayout({ series: [line(Array.from({ length: 400 }, (_, i) => [i, i % 7]))] }, { width: 160 })
  expect(long.series[0].points.length).toBeLessThanOrEqual(Math.round(long.plot.right - long.plot.left))
  expect(long.series[0].n).toBe(400)
  expect(chartLayout({ series: [line(Array.from({ length: 50 }, (_, i) => [i, i]))] }, { width: 160, maxPoints: 10 }).series[0].points.length).toBeLessThanOrEqual(10)
})

test("chartLayout: a flat series or a single point still has a range (no NaN); no points is empty", () => {
  const flat = chartLayout({ series: [line([[0, 2], [1, 2]])] })
  expect(flat.series[0].d).not.toContain("NaN")
  expect(flat.yTicks[0].v).toBeLessThan(flat.yTicks[1].v)
  const one = chartLayout({ series: [line([[5, 0]])] })
  expect(one.series[0].d).not.toContain("NaN")
  expect(one.xTicks).toHaveLength(1)
  const none = chartLayout({ series: [line([])] })
  expect(none.empty).toBe(true)
  expect(none.xTicks).toEqual([])
  expect(chartLayout(null).empty).toBe(true)
})

test("chartLayout bar: from a zero baseline, one group per x, labels as x ticks, the newest groups past maxBars", () => {
  const b = chartLayout({ kind: "bar", series: [line([[0, 1.2, "r1"], [1, 1.1, "r2"], [2, -0.3, "r3"]], "bpb")] }, { width: 300, height: 120 })
  expect(b.baseline).toBeGreaterThan(b.plot.top)
  expect(b.baseline).toBeLessThan(b.plot.bottom)
  const [r1, , r3] = b.series[0].bars
  expect(r1.py + r1.h).toBeCloseTo(b.baseline, 0) // up from the baseline
  expect(r3.py).toBeCloseTo(b.baseline, 0) // a negative bar hangs down from it
  expect(b.xTicks.map((t) => t.text)).toEqual(["r1", "r2", "r3"])
  expect(b.yTicks[0].text).toBe("-0.3")
  const two = chartLayout({ kind: "bar", series: [line([[0, 1], [1, 2]], "a"), line([[0, 3], [1, 4]], "b")] }, { width: 300 })
  const [a0] = two.series[0].bars
  const [b0] = two.series[1].bars
  expect(b0.px).toBeGreaterThan(a0.px + a0.w - 0.01) // side by side, not on top of each other
  expect(two.yTicks[0].v).toBe(0) // bars start at zero
  const many = chartLayout({ kind: "bar", series: [line(Array.from({ length: 60 }, (_, i) => [i, i + 1]))] }, { maxBars: 20 })
  expect(many.clipped).toBe(40)
  expect(many.series[0].bars.map((b) => b.x)[0]).toBe(40)
})

test("chartLayout: labelled points (x was a run id) label the x axis, at most what fits", () => {
  const points = Array.from({ length: 30 }, (_, i) => [i, i, `run-${i}`])
  const l = chartLayout({ kind: "scatter", series: [line(points)] }, { width: 300 })
  expect(l.xTicks.length).toBeLessThanOrEqual(Math.floor((l.plot.right - l.plot.left) / 64))
  expect(l.xTicks[0]).toMatchObject({ text: "run-0", anchor: "start" })
  expect(l.xTicks.at(-1)).toMatchObject({ text: "run-29", anchor: "end" })
  expect(chartLayout({ series: [line([[0, 1, "a-very-long-run-identifier"]])] }).xTicks[0].text).toHaveLength(10)
})

test("chartLayout: series past the palette are drawn muted (slot 0), never a new hue", () => {
  const series = Array.from({ length: SERIES_SLOTS + 2 }, (_, i) => line([[0, i], [1, i + 1]], `s${i}`))
  const l = chartLayout({ series })
  expect(l.series.map((s) => s.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 0, 0])
})

test("nearestPoints: per series the point nearest the pointer's x", () => {
  const l = chartLayout({ series: [line([[0, 1], [10, 2], [20, 3]]), line([[0, 5], [20, 6]], "b")] }, { width: 300 })
  const mid = (l.plot.left + l.plot.right) / 2
  const near = nearestPoints(l, mid)
  expect(near.map((p) => [p.name, p.x])).toEqual([["loss", 10], ["b", 0]])
  const bars = chartLayout({ kind: "bar", series: [line([[0, 1], [1, 2]])] }, { width: 300 })
  expect(nearestPoints(bars, bars.plot.right - 1)[0].x).toBe(1)
})

test("newestChart and axisText", () => {
  const charts = [{ id: "a", updatedAt: "2026-10-17T10:00:00Z" }, { id: "b", updatedAt: "2026-10-17T11:00:00Z" }, { id: "c" }]
  expect(newestChart(charts).id).toBe("b")
  expect(newestChart([])).toBeNull()
  expect(axisText({ x: "step", y: ["loss", "val_bpb"] })).toBe("loss, val_bpb vs step")
  expect(axisText({ y: "loss" })).toBe("loss vs row")
  expect(axisText({})).toBe("")
})
