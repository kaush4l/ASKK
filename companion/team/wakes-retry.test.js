// The wake book: a wake the team cannot take (no such agent, team not ready) books one retry instead of vanishing.
import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startWakes } from "./wakes.js"

let root
afterEach(() => rmSync(root, { recursive: true, force: true }))

test("a failed delivery books a retry row", async () => {
  root = mkdtempSync(join(tmpdir(), "wake-"))
  mkdirSync(join(root, "state"))
  const due = new Date(Date.now() - 1000).toISOString()
  writeFileSync(join(root, "state", "wakes.jsonl"), `${JSON.stringify({ id: "mon-x", at: due, booked_at: due, agent: "ghost", reason: "MONITOR x", message: "MONITOR x fired" })}\n`)
  const logs = []
  const stop = startWakes({ root, deliver: () => ({ ok: false, error: { message: 'No agent "ghost" in this team.' } }), log: (l) => logs.push(l) })
  await Bun.sleep(31000)
  stop()
  const rows = readFileSync(join(root, "state", "wakes.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
  expect(rows.some((r) => r.id === "mon-x-retry" && r.agent === "ghost")).toBe(true)
  expect(logs.join(" ")).toMatch(/not delivered: No agent "ghost".*retry mon-x-retry/)
}, 40000)
