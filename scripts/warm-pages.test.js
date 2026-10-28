import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { warmPages, warmReport, writeWarm } from "./warm-pages.js"

const clock = (...times) => () => times.shift()

test("warmPages: each page asked once, in order, on the origin, with its status and ms", async () => {
  const asked = []
  const fetchFn = async (url) => (asked.push(url), { status: url.endsWith("/live") ? 404 : 200, arrayBuffer: async () => new ArrayBuffer(0) })
  const results = await warmPages("http://127.0.0.1:4000", ["/", "/live", "/compose"], fetchFn, clock(0, 1200, 1200, 1500, 1500, 1600))
  expect(asked).toEqual(["http://127.0.0.1:4000/", "http://127.0.0.1:4000/live", "http://127.0.0.1:4000/compose"])
  expect(results).toEqual([
    { path: "/", status: 200, ms: 1200 },
    { path: "/live", status: 404, ms: 300 },
    { path: "/compose", status: 200, ms: 100 },
  ])
})

test("warmPages: a page that fails is status 0 with its error, and the rest are still warmed", async () => {
  const fetchFn = async (url) => {
    if (url.endsWith("/")) throw new Error("connection refused")
    return { status: 200 }
  }
  const results = await warmPages("http://x", ["/", "/live"], fetchFn, clock(0, 5, 5, 9))
  expect(results).toEqual([
    { path: "/", status: 0, ms: 5, error: "connection refused" },
    { path: "/live", status: 200, ms: 4 },
  ])
})

test("warmPages: no paths, no requests", async () => {
  expect(await warmPages("http://x", [], () => { throw new Error("asked") })).toEqual([])
})
test("writeWarm: logs/warm.json parses as JSON with every path, status and ms, and keeps a status-0 failure", () => {
  const file = join(mkdtempSync(join(tmpdir(), "warm-")), "logs", "warm.json")
  const results = [
    { path: "/", status: 200, ms: 1200 },
    { path: "/live", status: 0, ms: 5, error: "connection refused" },
    { path: "/compose", status: 200, ms: 90 },
    { path: "/agents", status: 200, ms: 300 },
    { path: "/canvas", status: 200, ms: 250 },
  ]
  const report = writeWarm(file, results, "2026-10-26T06:40:00.000Z")
  const read = JSON.parse(readFileSync(file, "utf8"))
  expect(read).toEqual(report)
  expect(read.at).toBe("2026-10-26T06:40:00.000Z")
  expect(read.pages.map((p) => p.path)).toEqual(["/", "/live", "/compose", "/agents", "/canvas"])
  expect(read.pages[1]).toEqual({ path: "/live", status: 0, ms: 5, error: "connection refused" })
  expect(read.pages[0]).toEqual({ path: "/", status: 200, ms: 1200 })
})

test("warmReport: only path, status and ms (and an error when there is one)", () => {
  expect(warmReport([{ path: "/", status: 200, ms: 4, extra: 1 }], "t")).toEqual({ at: "t", pages: [{ path: "/", status: 200, ms: 4 }] })
})
