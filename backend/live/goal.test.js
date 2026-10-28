import { expect, test } from "bun:test"
import { goalLedger, goalLine, goalPlan, goalPreview, goalSeries, goalWorkflows, standingGoal } from "./goal.js"

const state = {
  goal: { text: "Grow to 1300", measure: "$" },
  status: "active",
  next_at: "2026-10-24T14:47:00Z",
  entries: [
    { id: "e1", kind: "event", text: "goal set" },
    { id: "e2", kind: "progress", at: "2026-10-24T14:00:00Z", value: 1000, toward: "same" },
    { id: "e3", kind: "progress", at: "2026-10-24T14:16:00Z", value: "n/a", toward: "closer" },
    { id: "e4", kind: "progress", at: "2026-10-24T14:30:00Z", value: 1060, toward: "closer" },
  ],
}

test("the standing goal, its series and its line", () => {
  expect(standingGoal({ a: { view: "talk", state: {} }, goal: { id: "goal", view: "goal", state } })?.id).toBe("goal")
  expect(standingGoal({ goal: { view: "goal", state: { goal: null } } })).toBeNull()
  expect(goalSeries(state)).toEqual([{ at: "2026-10-24T14:00:00Z", value: 1000 }, { at: "2026-10-24T14:30:00Z", value: 1060 }])
  expect(goalLine(state, new Date("2026-10-24T14:35:00Z").getTime())).toMatch(/^active · closer 1060 · next .+ \(in 12 min\)$/)
  expect(goalLine({ ...state, status: "paused", reason: "3 runs in a row ended in an error", next_at: null })).toBe("paused · closer 1060 · 3 runs in a row ended in an error")
  expect(goalLine(null)).toBe("no standing goal")
})

test("the plan, the ledger by kind, the desk's workflows, a stalled or flowing line", () => {
  const s = { ...state, stall: 3, next_at: null, flow_run: { flow: "goal-cycle", at: "x" }, milestones: [{ id: "a", status: "done" }, { id: "b", status: "open", claim: { by: "w" } }, { id: "c", status: "dropped" }], ledger: [{ id: "l1", kind: "guess", text: "g" }, { id: "l2", kind: "decision", text: "d" }] }
  expect(goalPlan(s)).toMatchObject({ done: 1, total: 2, claimed: 1 })
  expect(goalLedger(s).map((g) => g.kind)).toEqual(["decision", "guess"])
  expect(goalWorkflows({ x: { id: "saga", kind: "workflow" }, y: { id: "goal", kind: "goal" }, z: { id: "brief", kind: "workflow" } })).toEqual(["brief", "saga"])
  expect(goalLine(s)).toBe("active (stalled: replans next) · 1/2 milestones · closer 1060 · goal-cycle running")
})

test("goalPreview: the desk's preview (id preview first), else none", () => {
  expect(goalPreview({ a: { id: "b.preview", kind: "preview" }, b: { id: "preview", kind: "preview" } })?.id).toBe("preview")
  expect(goalPreview({ a: { id: "z", kind: "preview" }, b: { id: "y", kind: "preview" } })?.id).toBe("y")
  expect(goalPreview({ a: { id: "goal", kind: "goal" } })).toBeNull()
})
