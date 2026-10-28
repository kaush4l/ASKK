import { describe, expect, test } from "bun:test"
import { hm } from "../../backend/live/time.js"
import { importsLine, restartHealthLine, warmClasses, warmLine } from "./dev-warm.js"

const AT = "2026-10-26T06:35:00.000Z"

describe("warmLine (warm-line-twin)", () => {
  test("a 5-page report gives each path with its ms", () => {
    const pages = [["/", 483], ["/live", 40], ["/compose", 31], ["/agents", 130], ["/canvas", 29]].map(([path, ms]) => ({ path, status: 200, ms }))
    expect(warmLine({ at: AT, pages })).toBe(`warm at ${hm(AT)}: / 483 ms · /live 40 ms · /compose 31 ms · /agents 130 ms · /canvas 29 ms`)
  })

  test("a failed page shows its status, or its error when status is 0", () => {
    const pages = [{ path: "/", status: 500, ms: 80 }, { path: "/live", status: 0, ms: 5, error: "ECONNREFUSED" }]
    expect(warmLine({ at: AT, pages })).toBe(`warm at ${hm(AT)}: / 500 in 80 ms · /live ECONNREFUSED in 5 ms`)
  })

  test("its time is the views' local hm, like the Safety row's, not the ISO's UTC slice (warm-line-local-time)", () => {
    const at = Date.parse(AT)
    expect(warmLine({ at, pages: [{ path: "/", status: 200, ms: 1 }] })).toBe(`warm at ${hm(at)}: / 1 ms`)
  })

  test("no warm pass gives null", () => {
    expect(warmLine(null)).toBeNull()
    expect(warmLine(undefined)).toBeNull()
    expect(warmLine({ at: "x", pages: [] })).toBeNull()
  })
})

describe("warmClasses (dev-view-warm-shot)", () => {
  test("below sm the warm line takes its own wrapped row, from sm up it sits inline; it never breaks mid-number", () => {
    const c = warmClasses().split(" ")
    for (const k of ["basis-full", "sm:basis-auto", "min-w-0", "break-words"]) expect(c).toContain(k)
    expect(c).not.toContain("break-all")
  })
})

describe("importsLine (home-import-map)", () => {
  test("a report gives its 3 heaviest with KB", () => {
    const top = [["components/home/dashboard.jsx", 5120], ["components/home/talk-panel.jsx", 4096], ["lib/utils.js", 1024], ["lib/x.js", 10]].map(([path, bytes]) => ({ path, bytes, via: "app/page.jsx" }))
    expect(importsLine({ at: "2026-10-26T08:30:00.000Z", top })).toBe("heaviest on /: components/home/dashboard.jsx 5.0 KB · components/home/talk-panel.jsx 4.0 KB · lib/utils.js 1.0 KB")
  })

  test("no ranking gives null", () => {
    expect(importsLine(null)).toBeNull()
    expect(importsLine({ at: "x", top: [] })).toBeNull()
  })
})
describe("restartHealthLine (self-update)", () => {
  test("before and after with the after's ms", () => {
    expect(restartHealthLine({ before: { ok: true, ms: 31 }, after: { ok: true, ms: 1840 } })).toBe("health before ok → after ok · 1840 ms")
    expect(restartHealthLine({ before: { ok: true }, after: { ok: false, ms: null } })).toBe("health before ok → after failing")
  })

  test("a side not known reads ?, neither known gives null", () => {
    expect(restartHealthLine({ before: { ok: true, ms: 9 }, after: null })).toBe("health before ok → after ?")
    expect(restartHealthLine({ id: "r1" })).toBeNull()
    expect(restartHealthLine(null)).toBeNull()
  })
})
