import { describe, expect, test } from "bun:test"
import { meterOf } from "./prompt-meter.js"

describe("meterOf", () => {
  test("segments share the whole bar and the legend holds the three largest, largest first", () => {
    const m = meterOf([{ label: "soul", chars: 10 }, { label: "tools", chars: 50 }, { label: "files", chars: 30 }, { label: "request", chars: 10 }, { label: "guidance", chars: 0 }])
    expect(m.total).toBe(100)
    expect(m.segments.map((s) => s.label)).toEqual(["soul", "tools", "files", "request"])
    expect(m.segments.reduce((n, s) => n + s.pct, 0)).toBeCloseTo(100)
    expect(m.legend.map((s) => s.label)).toEqual(["tools", "files", "soul"])
  })

  test("no measure gives null", () => {
    expect(meterOf(undefined)).toBeNull()
    expect(meterOf([])).toBeNull()
  })
})
