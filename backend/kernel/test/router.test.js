import { expect, test } from "bun:test"
import { Agent, scriptRouter, withShadowFill } from "../index.js"
import { Tool } from "../tool/tool.js"

const rows = [1, 2, 3, 4].map(() => ({ prev: ["<start>", "<start>"], action: "files.list", template: 'files.list {}', input: {}, ok: true }))

function agent(router, replies = [JSON.stringify({ thought: "look", calls: [{ tool: "files.list", input: {} }] }), JSON.stringify({ thought: "d", calls: [], answer: "done" })]) {
  const prompts = []
  const tool = new Tool({ name: "files.list", type: "data", description: "list", input: {}, run: () => "a.md" })
  const a = new Agent({ name: "a", role: "r", report: false, router }, { infer: async (p) => (prompts.push(p), replies.shift()), tools: [tool] })
  const steps = []
  a.on("step", (e) => steps.push(e))
  return { a, prompts, steps }
}

test("shadow router records its prediction and the model still answers every step", async () => {
  const { a, prompts, steps } = agent(scriptRouter(rows))
  await a.ask("list")
  expect(prompts.length).toBe(2)
  expect(steps[0].route).toMatchObject({ mode: "script", acted: false, predicted: ["files.list"], agree: true })
  expect(steps[1].route.mode).toBe("big")
})

test("acting router replaces the model call for a script step", async () => {
  const { a, prompts, steps } = agent(scriptRouter(rows, { act: true }), [JSON.stringify({ thought: "d", calls: [], answer: "done" })])
  await a.ask("list")
  expect(steps[0].route).toMatchObject({ mode: "script", acted: true })
  expect(steps[0].thought).toContain("script route")
  expect(prompts.length).toBe(1) // only the answer step asked the model
})

test("slotted call shapes never route", () => {
  const r = scriptRouter(rows.map((x) => ({ ...x, template: 'web.search {"q":"<TEXT>"}' })))
  expect(r.decide({ steps: [] }).mode).toBe("big")
})

test("calls outside the read-only list never route", () => {
  const r = scriptRouter(rows.map((x) => ({ ...x, action: "files.write", template: "files.write {}" })))
  expect(r.decide({ steps: [] }).mode).toBe("big")
})

test("shadow fill compares the small model's input with the big model's and never runs it", async () => {
  const logged = []
  const router = withShadowFill(scriptRouter([]), { fill: async () => ({}), log: (r) => logged.push(r) })
  const { a } = agent(router)
  await a.ask("list")
  await Bun.sleep(5)
  expect(router.tally).toMatchObject({ n: 1, json: 1, keys: 1, exact: 1 })
  expect(logged[0].tool).toBe("files.list")
})
