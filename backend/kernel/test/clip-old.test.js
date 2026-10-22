import { describe, expect, test } from "bun:test"
import { clipOld } from "../agent/agent.js"

// 2026-10-21: an old step's 10-name market read was clipped to its head and tail; the per-name lines it put first lost
// their middle. A leading `line` / `lines` summary now survives whole.
describe("clipOld", () => {
  const big = (extra) => JSON.stringify({ ...extra, ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`S${i}`, { pad: "x".repeat(200) }])) })
  test("lines kept whole above the clipped ends", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `S${i} line ${i} with the decision numbers`)
    const out = clipOld(big({ lines }), 700)
    for (const l of lines) expect(out).toContain(l)
    expect(out).toContain(" … ")
  })
  test("a single line kept; no summary → head and tail as before; short results untouched", () => {
    expect(clipOld(big({ line: "IWM short from 269.11: stock R 1" }), 700).startsWith("IWM short from 269.11: stock R 1\n")).toBe(true)
    const plain = big({})
    const out = clipOld(plain, 700)
    expect(out.length).toBeLessThan(720)
    expect(out.startsWith(plain.slice(0, 280))).toBe(true)
    expect(clipOld('{"a":1}', 700)).toBe('{"a":1}')
    expect(clipOld("not json " + "y".repeat(900), 700)).toContain(" … ")
  })
})
