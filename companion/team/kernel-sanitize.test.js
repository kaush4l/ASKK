import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildDesk } from "../../backend/kernel/index.js"
import { createKernelTeam } from "./kernel-team.js"
import { createHistory } from "./kernel-history.js"

// 2026-10-24 owner: "The first user input can always go through sanitize … the input and the voice transcribe can both
// be sent through this step": the owner's new work is rewritten by the host's sanitizer before the run; the run's
// request row and its prompt keep the owner's words beside it; schedule, wakes and plain sends are left as they are.
async function deskWith(sanitize) {
  const prompts = []
  const infer = async (prompt) => (prompts.push(prompt), JSON.stringify({ thought: "done", calls: [], answer: "ok" }))
  const state = mkdtempSync(join(tmpdir(), "ks-"))
  const desk = { state, workspace: "/tmp", start: async () => ({ desk: buildDesk({ name: "lead", report: false, folder: join(state, "lead") }, { infer }) }) }
  const team = await createKernelTeam({ desk, port: 0, live: false })
  const calls = []
  team.useSanitizer(sanitize ? { sanitize: async (text, o) => (calls.push([text, o.via]), sanitize(text, o)) } : null)
  const rows = []
  const res = team.stream({ signal: new AbortController().signal })
  const reader = res.body.getReader()
  ;(async () => {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      for (const line of new TextDecoder().decode(value).split("\n\n")) if (line.startsWith("data: ")) rows.push(...(JSON.parse(line.slice(6)).patch?.messages?.items ?? []))
    }
  })()
  return { team, prompts, calls, rows, state }
}
const until = async (fn) => {
  for (let i = 0; i < 200 && !fn(); i++) await Bun.sleep(5)
}

test("the owner's typed work is rewritten; the row and the prompt keep the owner's words", async () => {
  const { team, prompts, calls, rows } = await deskWith(async (text, { via }) => ({ text: "Write a Python script that plots ~/data.csv.", original: text, changed: true, via, model: "apple", ms: 640 }))
  expect((await team.call({ target: "lead", method: "send", args: ["write me a pyhton script that plots ~/data.csv", { via: "typed" }] })).ok).toBe(true)
  await until(() => prompts.length && team.work().length === 0)
  expect(calls).toEqual([["write me a pyhton script that plots ~/data.csv", "typed"]])
  expect(prompts[0]).toContain("# REQUEST (from owner)\nWrite a Python script that plots ~/data.csv.\n(Rewritten from the owner's own words: \"write me a pyhton script that plots ~/data.csv\"")
  await until(() => rows.some((m) => m.kind === "request"))
  expect(rows.find((m) => m.kind === "request")).toMatchObject({ content: "Write a Python script that plots ~/data.csv.", original: "write me a pyhton script that plots ~/data.csv", rewrite: { via: "typed", model: "apple", ms: 640 } })
})

test("voice: rewritten, its read-aloud note after the rewrite; voice guidance and chat corrected only", async () => {
  const { team, prompts, calls } = await deskWith(async (text, { via }) => ({ text: via === "guidance" ? "Fixed question?" : "A ten-minute story about Vikram and the Vetal.", original: text, changed: true, via, model: "apple", ms: 900 }))
  team.call({ target: "lead", method: "send", args: ["a ten minute story of vikram veetal", { via: "voice", suffix: "\n\n(read aloud)" }] })
  await until(() => prompts.length)
  expect(prompts[0]).toContain("A ten-minute story about Vikram and the Vetal.\n\n(read aloud)\n(Rewritten from the owner's own words, spoken and transcribed")
  await until(() => team.work().length === 0)
  await team.call({ target: "lead", method: "chat", args: ["wat is bilt", { via: "voice" }] })
  expect(calls.at(-1)).toEqual(["wat is bilt", "guidance"])
  expect(prompts.at(-1)).toContain("Fixed question?")
})

test("no via, a schedule, Telegram's own rewrite, no sanitizer: as they are", async () => {
  const { team, prompts, calls } = await deskWith(async (text) => ({ text: "REWRITTEN", original: text, changed: true }))
  team.send({ text: "a script's work, sent as it is" })
  await until(() => prompts.length === 1)
  expect(prompts[0]).toContain("# REQUEST (from owner)\na script's work, sent as it is\n")
  await until(() => team.work().length === 0)
  // the Telegram bridge rewrote it already: passed on, never rewritten twice
  team.send({ text: "[Telegram context]\nResearch Nvidia's earnings date.", from: "telegram:me", original: "research nvdia earnigs date", rewrite: { via: "telegram", model: "apple", ms: 500 } })
  await until(() => prompts.length === 2)
  expect(prompts[1]).toContain("Research Nvidia's earnings date.\n(Rewritten from the owner's own words: \"research nvdia earnigs date\"")
  expect(calls).toEqual([])
  const none = await deskWith(null)
  none.team.call({ target: "lead", method: "send", args: ["leave my words as they are", { via: "typed" }] })
  await until(() => none.prompts.length)
  expect(none.prompts[0]).toContain("leave my words as they are\n")
  expect(none.prompts[0]).not.toContain("Rewritten from")
})

test("a sanitizer that fails leaves the words; history.md keeps the owner's words", async () => {
  const bad = await deskWith(async () => {
    throw new Error("model down")
  })
  bad.team.call({ target: "lead", method: "send", args: ["keep going with the plan", { via: "typed" }] })
  await until(() => bad.prompts.length)
  expect(bad.prompts[0]).toContain("keep going with the plan\n")
  const folder = mkdtempSync(join(tmpdir(), "ksh-"))
  const agent = { name: "lead", config: { folder, historyKeep: 2 } }
  const h = createHistory({})
  h.record(agent, { at: Date.now(), request: { from: "owner", text: "Make the samples at 0.9 speed.", original: "samples slower 0.9 speed", rewrite: { via: "typed", model: "apple", ms: 700 } }, answer: "ok", steps: [] })
  const md = readFileSync(join(folder, "history.md"), "utf8")
  expect(md).toContain("**In the owner's words** (rewritten on-device):")
  expect(md).toContain("> samples slower 0.9 speed")
  expect(h.restore(agent).at(-1)).toMatchObject({ request: "Make the samples at 0.9 speed.", original: "samples slower 0.9 speed", rewrite: { via: "typed" } })
})
