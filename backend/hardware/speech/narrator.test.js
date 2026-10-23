import { expect, test } from "bun:test"

import { narrate } from "./narrator.js"

const idle = { status: "idle", activity: { phase: "idle" }, messages: [], error: null }

test("the first snapshot is the baseline: restored history is never spoken again", () => {
  const empty = { status: "created", activity: { phase: "idle" }, messages: [], error: null }
  const restored = { ...idle, messages: [{ id: "k1", role: "assistant", action: "answer", content: "old answer" }], error: "old error" }
  expect(narrate(empty, restored)).toEqual([])
  const next = { ...restored, messages: [...restored.messages, { id: "k2", role: "assistant", action: "answer", content: "new answer" }] }
  expect(narrate(restored, next)).toEqual([{ kind: "answer", level: 1, text: "new answer", id: "k2" }])
})

test("a quest's result row is its member's report; a failed one says so", () => {
  const report = { id: "k3", role: "tool", kind: "agent", name: "coder", ok: true, output: "done" }
  expect(narrate(idle, { ...idle, messages: [report] })).toEqual([{ kind: "report", level: 2, text: "coder reported back", from: "coder" }])
  expect(narrate(idle, { ...idle, messages: [{ ...report, ok: false }] })).toEqual([{ kind: "failed", level: 2, text: "coder could not finish", from: "coder" }])
  const tool = { id: "k4", role: "tool", kind: "tool", name: "terminal.run", ok: false }
  expect(narrate(idle, { ...idle, messages: [tool] })[0].text).toBe("That step failed: Running a command")
})

test("steps are said in the kernel's tool names; bookkeeping calls stay quiet", () => {
  const at = (activity) => narrate(idle, { ...idle, activity })
  expect(at({ phase: "tool", name: "files.edit" })[0].text).toBe("Editing a file")
  expect(at({ phase: "tool", name: "lead.practice.reflect" })[0].text).toBe("Looking back on the run")
  expect(at({ phase: "tool", name: "plan.tick" })).toEqual([])
  expect(at({ phase: "tool", name: "github.search_issues" })[0].text).toBe("Checking github: search issues")
  expect(at({ phase: "tools", names: ["web.search", "browse.open"] })[0].text).toBe("2 things at once: searching the web and opening a web page")
})

test("a failed run is said once: its error answer row and the state's error are one line (2026-10-23)", () => {
  const running = { ...idle, status: "running" }
  const failed = { ...idle, status: "error", error: "model timed out", messages: [{ id: "k5", role: "assistant", action: "answer", content: "Error: model timed out", error: "model timed out" }] }
  expect(narrate(running, failed)).toEqual([{ kind: "error", level: 1, text: "Something went wrong: model timed out", id: "k5" }])
  // a state error with no answer row is still said
  expect(narrate(running, { ...running, status: "error", error: "lost" })).toEqual([{ kind: "error", level: 1, text: "Something went wrong: lost" }])
})
