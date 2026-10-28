import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildDesk, Goal } from "../../backend/kernel/index.js"
import { createKernelTeam } from "./kernel-team.js"

// 2026-10-24 owner: "the desk will set a goal and will keep working towards the goal": the host resumes the standing
// goal's keeper on its own when it is due and the keeper idle; the owner's feedback goes to the keeper as a run.
const until = async (fn) => {
  for (let i = 0; i < 400 && !fn(); i++) await Bun.sleep(5)
}

test("an active goal resumes its keeper when due; the owner's feedback reaches it; paused, nothing starts", async () => {
  const prompts = []
  const goal = new Goal()
  const infer = async (prompt) => {
    prompts.push(prompt)
    // every run records its progress, then answers
    return prompt.includes("goal.progress recorded") || prompt.includes("progress e")
      ? JSON.stringify({ thought: "done", calls: [], answer: "step done" })
      : JSON.stringify({ thought: "progress", calls: [{ tool: "goal.progress", input: { did: "a step", result: "value 3", value: 3, toward: "closer", next: "the next step" } }] })
  }
  const desk = { state: mkdtempSync(join(tmpdir(), "kg-")), workspace: "/tmp", start: async () => ({ desk: buildDesk({ name: "lead", report: false, artifacts: [goal] }, { infer }) }) }
  const team = await createKernelTeam({ desk, port: 0, live: false, goalTickMs: 20 })
  try {
    expect((await team.call({ target: "artifact", method: "set", args: [{ id: "goal", text: "Write 10 chapters", measure: "chapters done", target: "10" }] })).ok).toBe(true)
    await Bun.sleep(80)
    expect(prompts.length).toBe(0) // not due for an hour
    expect((await team.call({ target: "artifact", method: "now", args: [{ id: "goal" }] })).ok).toBe(true)
    await until(() => prompts.length >= 2 && team.work().length === 0)
    expect(prompts[0]).toContain("# REQUEST (from goal)\nKeep working toward the desk's standing goal: Write 10 chapters")
    expect(prompts[0]).toContain("STANDING GOAL (active; set by owner")
    expect(goal.state.entries.at(-1)).toMatchObject({ kind: "progress", value: 3, by: "lead" })
    expect(goal.state.next_at).not.toBeNull() // the next run booked by the progress, an hour on
    const runs = prompts.length
    await Bun.sleep(80)
    expect(prompts.length).toBe(runs) // once per due time
    // the owner's feedback: a run for the keeper (idle)
    const fb = await team.call({ target: "artifact", method: "feedback", args: [{ id: "goal", text: "shorter chapters" }] })
    expect(fb.value).toMatchObject({ keeper: "lead", delivered: "run" })
    await until(() => prompts.length > runs && team.work().length === 0)
    expect(prompts[runs]).toContain('The owner\'s feedback on the standing goal ("Write 10 chapters"): "shorter chapters"')
    // paused: due or not, nothing starts
    await team.call({ target: "artifact", method: "pause", args: [{ id: "goal" }] })
    goal.state.next_at = new Date(0).toISOString()
    const before = prompts.length
    await Bun.sleep(80)
    expect(prompts.length).toBe(before)
  } finally {
    team.terminate()
  }
})

// 2026-10-24 owner ("I want to create configurable workflows"): a goal with a workflow resumes through it — the host
// runs the flow with the goal's vars, never the keeper's own run, and the flow's last report becomes the progress.
test("a goal with a workflow resumes through it; its last step's report is the run's progress", async () => {
  const { Artifact } = await import("../../backend/kernel/index.js")
  class Flow extends Artifact {
    constructor() {
      super({ name: "goal-cycle", title: "goal-cycle" })
      this.kind = "workflow"
      this.view = "pipeline"
      this.active = null
      this.calls = []
      this.state = { status: "idle", stages: [] }
    }
    async run(opts, ctx) {
      this.calls.push(ctx)
      this.active = { id: "r1" }
      await Bun.sleep(10)
      this.active = null
      this.state = { status: "done", stages: [{ id: "plan" }, { id: "judge" }] }
      return "done"
    }
    stageDetail(id) {
      return id === "judge" ? { report: { toward: "closer", value: "4", did: "chapter 4", result: "4 of 10", next: "chapter 5" } } : null
    }
    render() {
      return "flow"
    }
  }
  const goal = new Goal()
  const flow = new Flow()
  const prompts = []
  const infer = async (prompt) => (prompts.push(prompt), JSON.stringify({ thought: "", calls: [], answer: "x" }))
  const desk = { state: mkdtempSync(join(tmpdir(), "kgw-")), workspace: "/tmp", start: async () => ({ desk: buildDesk({ name: "lead", report: false, artifacts: [goal, flow] }, { infer }) }) }
  const team = await createKernelTeam({ desk, port: 0, live: false, goalTickMs: 20 })
  try {
    await team.call({ target: "artifact", method: "set", args: [{ id: "goal", text: "Write 10 chapters", measure: "chapters done", workflow: "goal-cycle" }] })
    await team.call({ target: "artifact", method: "now", args: [{ id: "goal" }] })
    await until(() => goal.state.entries.some((e) => e.kind === "progress"))
    expect(flow.calls.length).toBe(1)
    expect(flow.calls[0]).toMatchObject({ owner: true, vars: { goal: "Write 10 chapters", measure: "chapters done" } })
    expect(flow.calls[0].request).toContain("Keep working toward the desk's standing goal: Write 10 chapters")
    expect(prompts.length).toBe(0) // the keeper never ran on its own
    expect(goal.state.entries.at(-1)).toMatchObject({ kind: "progress", by: "goal-cycle", value: 4, toward: "closer", next: "chapter 5" })
    expect(goal.state.flow_run).toBeNull()
    expect(goal.state.next_at).not.toBeNull()
  } finally {
    team.terminate()
  }
})
