// The restart supervisor's logic, with a fake launchd, server and tree: healthy → ok; broken → evidence, rollback to the
// good checkpoint, kickstart again → rolled_back (or failed). checkHealth over a fake fetch.
import { describe, expect, test } from "bun:test"
import { mkdtempSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkHealth, projectSafetyRoutes, restartBook, sanitizeHealth, superviseRestart } from "./restart.js"

const sleep = async () => {}
const fast = { waitMs: 50, everyMs: 1 }
function fakes(states) {
  const saves = []
  const kicks = []
  let healthCalls = 0
  return {
    saves,
    kicks,
    deps: {
      kickstart: async () => (kicks.push(1), { ok: true }),
      health: async () => states[Math.min(healthCalls++, states.length - 1)](kicks.length),
      rollback: async (id) => ({ id, before: "c9", restored: ["backend/kernel/agent/agent.js"], reverted: [], removed: [] }),
      save: (r) => (saves.push(structuredClone(r)), r),
      logTail: () => "SyntaxError: Unexpected token",
      sleep,
      wait: fast,
    },
  }
}
const record = { id: "r1", desk: "dev", project: "powerhouse", pre: "c4", good: "c3", status: "pending" }

describe("superviseRestart", () => {
  test("healthy after the kickstart → ok", async () => {
    const f = fakes([() => ({ ok: true, problems: [] })])
    const r = await superviseRestart(record, f.deps)
    expect(r).toMatchObject({ status: "ok", health: { ok: true }, after: { ok: true } })
    expect(f.kicks).toHaveLength(1)
    expect(f.saves.map((s) => s.status)).toEqual(["restarting", "ok"])
  })

  test("broken → evidence kept, the good checkpoint restored, kickstarted again → rolled_back", async () => {
    const f = fakes([(k) => (k === 1 ? { ok: false, problems: ["GET /: 500 — Module parse failed"], pages: [{ path: "/", status: 500 }] } : { ok: true, problems: [] })])
    const r = await superviseRestart(record, f.deps)
    expect(r.status).toBe("rolled_back")
    expect(r.evidence).toEqual({ problems: ["GET /: 500 — Module parse failed"], pages: [{ path: "/", status: 500 }], log: "SyntaxError: Unexpected token" })
    expect(r.rollback).toMatchObject({ id: "c3", before: "c9" })
    expect(r.after).toMatchObject({ ok: true })
    expect(f.kicks).toHaveLength(2)
    expect(f.saves.map((s) => s.status)).toEqual(["restarting", "rolling_back", "rolling_back", "rolled_back"])
  })

  test("still broken after the rollback → failed; no good checkpoint → failed without a rollback", async () => {
    expect((await superviseRestart(record, fakes([() => ({ ok: false, problems: ["down"] })]).deps)).status).toBe("failed")
    const f = fakes([() => ({ ok: false, problems: ["down"] })])
    const r = await superviseRestart({ ...record, good: null }, f.deps)
    expect(r).toMatchObject({ status: "failed", note: "no good checkpoint to roll back to" })
    expect(f.kicks).toHaveLength(1)
  })
})

test("checkHealth: the desks listed without errors, the asking desk among them, every page 200", async () => {
  const pages = { "/__askk/desks": [200, { desks: [{ name: "agent" }, { name: "dev" }] }], "/": [200, "<html>"], "/live": [500, "<html><body>Module not found: ./x</body></html>"], "/compose": [200, "<html>"] }
  const fetch = async (url) => {
    const [status, body] = pages[new URL(url).pathname]
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": typeof body === "string" ? "text/html" : "application/json" } })
  }
  const h = await checkHealth({ port: 1, desk: "dev", fetch })
  expect(h.ok).toBe(false)
  expect(h.problems).toEqual(["GET /live: 500 — Module not found: ./x"])
  expect(h.desks).toEqual(["agent", "dev"])
  expect((await checkHealth({ port: 1, desk: "studio", fetch, pages: [] })).problems).toEqual(["desk studio is not hosted"])
  expect((await checkHealth({ port: 1, fetch: async () => { throw new Error("ECONNREFUSED") } })).problems).toEqual(["GET /__askk/desks: ECONNREFUSED"])
})

test("restartBook: r1, r2 … newest first", () => {
  const book = restartBook(join(realpathSync(mkdtempSync(join(tmpdir(), "restarts-"))), "restarts"))
  expect(book.next()).toBe("r1")
  book.save({ id: "r1", status: "ok" })
  book.save({ id: book.next(), status: "pending" })
  expect(book.list().map((r) => r.id)).toEqual(["r2", "r1"])
  expect(book.get("r1").status).toBe("ok")
  expect(book.get("../x")).toBeNull()
})
test("projects/restart stores the health before, sanitized (self-update)", () => {
  const memory = realpathSync(mkdtempSync(join(tmpdir(), "restart-route-")))
  const routes = projectSafetyRoutes({ projects: { list: () => [{ name: "app", path: "/code/askk", self: true }] }, desk: { name: "dev", memory }, port: 1, env: { XPC_SERVICE_NAME: "com.askk.server" }, spawn: () => {}, appRoot: memory, createCheckpoints: () => ({ create: () => ({ id: "c2" }), list: () => [], get: (id) => ({ id }) }) })
  const before = { ok: true, ms: 31, at: "2026-10-27T03:20:00.000Z", problems: [], pages: [{ path: "/" }], extra: "x" }
  expect(routes.POST["projects/restart"]({ name: "app", why: "kernel change", by: "coder", before }).restart.before).toEqual({ ok: true, ms: 31, at: "2026-10-27T03:20:00.000Z", problems: [] })
  expect(routes.POST["projects/restart"]({ name: "app", why: "again", before: "not a health" }).restart.before).toBeNull()
  expect(sanitizeHealth({ ok: false, problems: Array.from({ length: 9 }, (_, i) => `p${i}`) }).problems).toHaveLength(6)
})
