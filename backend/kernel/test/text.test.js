// narrowText: passages around `find` terms, capped, so a page never lands in an agent's context whole.

import { describe, expect, test } from "bun:test"
import { FIND_AROUND, FIND_CHARS, READ_CHARS, narrowText } from "../util/text.js"

const filler = (n) => "lorem ipsum dolor ".repeat(Math.ceil(n / 18)).slice(0, n)

describe("narrowText", () => {
  test("keeps only the passages around each term, merged and in page order", () => {
    const page = `${filler(5000)} CPI 08:30 ET ${filler(5000)} Retail Sales 08:30 ET ${filler(200)} FOMC 14:00 ${filler(5000)}`
    const r = narrowText(page, { find: ["fomc", "cpi", "retail sales"] })
    expect(r.text.startsWith("[2 passage(s) matching fomc, cpi, retail sales]")).toBe(true) // retail + FOMC overlap: one passage
    expect(r.text.indexOf("CPI 08:30")).toBeLessThan(r.text.indexOf("FOMC 14:00"))
    expect(r.text).toContain("Retail Sales 08:30 ET")
    expect(r.text.length).toBeLessThan(2 * (2 * FIND_AROUND + 300) + 100)
    expect(r.truncated).toBe(false)
  })
  test("no match says so; max caps the text; find defaults to FIND_CHARS", () => {
    expect(narrowText(filler(3000), { find: ["nfp"] }).text).toBe("[no passage matches nfp]")
    const capped = narrowText(filler(30000), { max: 1000 })
    expect(capped.text.length).toBe(1000)
    expect(capped.truncated).toBe(true)
    const many = Array.from({ length: 40 }, (_, i) => `${filler(2000)} event${i} `).join("")
    const r = narrowText(many, { find: ["event"] })
    expect(r.truncated).toBe(true)
    expect(r.text.length).toBeLessThanOrEqual(FIND_CHARS + 60)
  })
  test("max never exceeds READ_CHARS; no options returns the text unchanged", () => {
    expect(narrowText(filler(50000), { max: 99999 }).text.length).toBe(READ_CHARS)
    expect(narrowText("abc").text).toBe("abc")
  })
})
