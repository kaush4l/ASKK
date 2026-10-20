import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildDesk, Preview, Talk } from "../../backend/kernel/index.js"
import { createKernelTeam } from "./kernel-team.js"

// 2026-10-17: the owner acts on an artifact through its twin (team/call target "artifact"): an ask in the preview (the
// one pane — 2026-10-17 the stage folded into it) is recorded there with what was in the pane and handed to its keeper —
// a new run when it is idle, guidance while it runs.
function previewDesk(script) {
  const preview = new Preview({ clock: () => new Date("2026-10-17T23:30:00Z") })
  const infer = async () => JSON.stringify(script.shift() ?? { thought: "done", calls: [], answer: "ok" })
  const spec = { name: "lead", report: false, artifacts: [preview] }
  return { preview, desk: { state: mkdtempSync(join(tmpdir(), "kt-art-")), workspace: "/tmp", start: async () => ({ desk: buildDesk(spec, { infer }) }) } }
}
const heads = { kind: "steps", steps: ["embed", "attend to t-1"] }

test("an owner's ask in the preview: recorded with the item in the pane, run by its keeper, answered in the preview", async () => {
  const { preview, desk } = previewDesk([
    { thought: "redraw, then answer", calls: [{ tool: "preview.show", input: { id: "why", title: "Why t-1", says: "82% of head 2.1's weight", visual: heads } }] },
    { thought: "answer in the preview", calls: [{ tool: "preview.answer", input: { ask: "q1", text: "a previous-token head", show: "heads" } }] },
    { thought: "done", calls: [], answer: "answered in the preview" },
  ])
  const team = await createKernelTeam({ desk, port: 0, live: false })
  await preview.commands().find((t) => t.name === "preview.show").run({ id: "heads", title: "Heads", says: "head 2.1 looks back", visual: heads })
  const r = await team.call({ target: "artifact", method: "ask", args: [{ id: "preview", text: "why does it look back?", context: { head: "2.1" } }] })
  expect(r.ok).toBe(true)
  expect(r.value).toMatchObject({ keeper: "lead", delivered: "run", ask: { id: "q1", on: { kind: "visual", id: "heads" }, context: { head: "2.1" } } })
  expect(r.value.deliver).toBeUndefined()
  for (let i = 0; i < 100 && !preview.state.asks[0].answer; i++) await Bun.sleep(10)
  expect(preview.state.asks[0].answer).toMatchObject({ text: "a previous-token head", on: { kind: "visual", id: "heads" }, by: "lead" })
  expect(preview.state.visuals.map((v) => v.id)).toEqual(["heads", "why"])
  expect(preview.state.current).toEqual({ kind: "visual", id: "heads" })
})

test("owner calls on an artifact: unknown ids and methods are refused", async () => {
  const { desk } = previewDesk([])
  const team = await createKernelTeam({ desk, port: 0, live: false })
  expect(await team.call({ target: "artifact", method: "ask", args: [{ id: "nope", text: "x" }] })).toEqual({ ok: false, error: { message: 'no artifact "nope" takes the owner\'s calls' } })
  expect((await team.call({ target: "artifact", method: "focus", args: [{ id: "preview" }] })).error.message).toBe("preview: the owner can ask, open, back, rerun (not focus)")
  expect((await team.call({ target: "artifact", method: "ask", args: [{ id: "preview", text: " " }] })).error.message).toBe("text: the question")
})

test("2026-10-17: the owner's open and back are awaited (they read files first) and start no run; an error comes back as one", async () => {
  const { preview, desk } = previewDesk([])
  const team = await createKernelTeam({ desk, port: 0, live: false })
  const show = preview.commands().find((t) => t.name === "preview.show")
  await show.run({ id: "heads", title: "Heads", visual: heads })
  await show.run({ id: "flow", title: "Flow", visual: { kind: "flow", nodes: [{ id: "h", open: "heads" }] } })
  const r = await team.call({ target: "artifact", method: "open", args: [{ id: "preview", visual: "heads" }] })
  expect(r).toEqual({ ok: true, value: { current: { kind: "visual", id: "heads" }, trail: [{ kind: "visual", id: "flow" }] } })
  expect((await team.call({ target: "artifact", method: "back", args: [{ id: "preview" }] })).value.current).toEqual({ kind: "visual", id: "flow" })
  expect(await team.call({ target: "artifact", method: "back", args: [{ id: "preview" }] })).toEqual({ ok: false, error: { message: "nothing to go back to" } })
  expect((await team.call({ target: "artifact", method: "rerun", args: [{ id: "preview", visual: "heads" }] })).error.message).toBe("heads has no bound script (preview.show … bind) — nothing to run")
  expect(desk.state).toBeTruthy()
  expect(preview.state.asks).toEqual([])
})


// 2026-10-18 owner: "The desk should be able to talk with me too. The work and build can run in the background." The
// desk asks (talk.ask) and its run goes on to its answer; the owner's reply comes back to the agent that asked — a new
// run when it is idle — and the agent tells the owner what it will do (talk.say).
test("talk: the lead asks, ends its run; the owner's reply starts a run of the asker, which answers in the talk", async () => {
  const talk = new Talk({ clock: () => new Date("2026-10-18T18:00:00Z") })
  const prompts = []
  const script = [
    { thought: "ask, keep going", calls: [{ tool: "talk.ask", input: { question: "TCR on FLORES-200 first?", options: "yes | no" } }] },
    { thought: "done for now", calls: [], answer: "asked q1; scans running" },
    { thought: "the owner said yes", calls: [{ tool: "talk.say", input: { text: "FLORES-200 TCR next: eng vs san_Deva at 32k vocab" } }] },
    { thought: "done", calls: [], answer: "queued the TCR study" },
  ]
  const infer = async (prompt) => (prompts.push(prompt), JSON.stringify(script.shift() ?? { thought: "done", calls: [], answer: "ok" }))
  const desk = { state: mkdtempSync(join(tmpdir(), "kt-talk-")), workspace: "/tmp", start: async () => ({ desk: buildDesk({ name: "lead", report: false, artifacts: [talk] }, { infer }) }) }
  const team = await createKernelTeam({ desk, port: 0, live: false })
  expect((await team.call({ target: "lead", method: "ask", args: ["plan the study"] })).value).toBe("asked q1; scans running")
  expect(talk.open().map((q) => q.id)).toEqual(["q1"])
  const r = await team.call({ target: "artifact", method: "reply", args: [{ id: "talk", ask: "q1", text: "yes" }] })
  expect(r).toMatchObject({ ok: true, value: { keeper: "lead", delivered: "run", reply: { id: "r2", re: "q1" } } })
  for (let i = 0; i < 100 && talk.state.messages.length < 3; i++) await Bun.sleep(10)
  expect(prompts[2]).toContain('The owner replies to your question q1 ("TCR on FLORES-200 first?"): "yes"')
  expect(talk.state.messages.map((m) => [m.id, m.kind, m.status ?? null])).toEqual([["q1", "ask", "answered"], ["r2", "reply", null], ["m3", "say", null]])
})
