import { describe, expect, test } from "bun:test"

import { reportRows } from "./contract-line.jsx"

const ten = {
  VERDICT: "stands",
  EVIDENCE: "c109",
  CONFIDENCE: "0.8",
  FALSIFIER: "a failing check",
  GAPS: "none",
  SHIPPED: "18",
  TESTS: "pass",
  LOAD: "9 ms",
  LOOK: "8",
  EASE: "8",
}

describe("reportRows (report-rows-collapse)", () => {
  test("a 10-field report, closed: VERDICT, CONFIDENCE, GAPS in order and hidden 7", () => {
    const r = reportRows(ten, false)
    expect(r.rows.map(([f]) => f)).toEqual(["VERDICT", "CONFIDENCE", "GAPS"])
    expect(r.hidden).toBe(7)
  })

  test("a 10-field report, open: every row and hidden 0", () => {
    const r = reportRows(ten, true)
    expect(r.rows).toHaveLength(10)
    expect(r.hidden).toBe(0)
  })

  test("a 2-field report gives no toggle", () => {
    const r = reportRows({ VERDICT: "done", GAPS: "none" }, false)
    expect(r.rows.map(([f]) => f)).toEqual(["VERDICT", "GAPS"])
    expect(r.hidden).toBe(0)
  })

  test("no report gives no rows", () => {
    expect(reportRows(undefined, false)).toEqual({ rows: [], hidden: 0 })
  })
})
