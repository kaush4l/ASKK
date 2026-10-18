import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createTranscripts } from "./kernel-transcripts.js"

test("a transcript beside agent.md: runs recorded with their steps, the newest restored, compacted into history/", () => {
  const folder = mkdtempSync(join(tmpdir(), "agent-"))
  const agent = { name: "tape", config: { folder, historyKeep: 2 } }
  const t = createTranscripts({ maxBytes: 600, keep: 1 })
  for (let i = 1; i <= 3; i++)
    t.record(agent, { at: Date.UTC(2026, 9, 15, 14, i), request: { from: "market", text: `REQUIREMENT: r\nASK: run ${i}\nOUTCOME: o` }, answer: `VERDICT: ${i}`, steps: [{ thought: "look", calls: [{ tool: "market.intraday", input: { symbols: ["ACME"] } }], results: [{ tool: "market.intraday", ok: true, output: "x".repeat(50) }] }] })
  const rows = t.restore(agent)
  expect(rows.map((r) => r.answer).length).toBeLessThanOrEqual(2)
  expect(rows.at(-1)?.answer ?? null).toBe(existsSync(join(folder, "transcript.jsonl")) ? "VERDICT: 3" : null)
  expect(readdirSync(join(folder, "history")).length).toBe(1) // compacted, the newest archive kept
  t.record(agent, { at: Date.now(), error: "stopped" }, { from: "owner", text: "go" })
  expect(t.restore(agent).some((r) => r.error)).toBe(false) // a failed run is kept on file, not restored as an answer
  expect(t.record({ name: "x", config: {} }, { answer: "a" })).toBeUndefined() // no folder: nothing written
})
