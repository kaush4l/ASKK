import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHistory, parseHistory } from "./kernel-history.js"
import { createTranscripts } from "./kernel-transcripts.js"

test("a history.md beside the agent's .md: runs recorded with their steps, the newest restored, rotated into history/", () => {
  const folder = mkdtempSync(join(tmpdir(), "agent-"))
  const agent = { name: "tape", config: { folder, historyKeep: 2 } }
  const t = createHistory({ maxBytes: 1200, keep: 1 })
  for (let i = 1; i <= 3; i++)
    t.record(agent, { at: Date.UTC(2026, 9, 15, 14, i), request: { from: "market", text: `REQUIREMENT: r\nASK: run ${i}\nOUTCOME: o` }, answer: `VERDICT: ${i}`, steps: [{ thought: "look", calls: [{ tool: "market.intraday", input: { symbols: ["ACME"] } }], results: [{ tool: "market.intraday", ok: true, output: "x".repeat(50) }] }] })
  const rows = t.restore(agent)
  expect(rows.length).toBeLessThanOrEqual(2)
  expect(rows.at(-1)?.answer).toBe("VERDICT: 3") // the newest, from history.md or the archive rotation just made
  const archives = readdirSync(join(folder, "history"))
  expect(archives.length).toBe(1) // rotated, the newest archive kept
  expect(archives[0]).toMatch(/^history-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.md$/)
  expect(parseHistory(readFileSync(join(folder, "history", archives[0]), "utf8")).every((r) => r.from === "market")).toBe(true)
  t.record(agent, { at: Date.now(), error: "stopped" }, { from: "owner", text: "go" })
  expect(readFileSync(join(folder, "history.md"), "utf8")).toContain("· owner · error")
  expect(t.restore(agent).some((r) => r.error)).toBe(false) // a failed run is kept on file, not restored as an answer
  expect(t.record({ name: "x", config: {} }, { answer: "a" })).toBeUndefined() // no folder: nothing written
  expect(existsSync(join(folder, "transcript.jsonl"))).toBe(false) // never written again
  expect(createTranscripts).toBe(createHistory) // the old name, for callers
})
