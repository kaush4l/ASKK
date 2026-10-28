import { describe, expect, test } from "bun:test"

import { Ask } from "../kernel/builtin/ask.js"
import { createChannel, createTeamCore } from "./team-core.js"

const FILES = { "backend/kernel/builtin/talk.js": "// Talk\nexport class Talk {\n}" }
const registry = (id) => (id === "talk" ? { name: "Talk", file: "backend/kernel/builtin/talk.js", about: "the desk's side", brief: "nothing said yet" } : null)

const coreWith = (ask) => {
  const team = { lead: { name: "lead" }, list: [], artifacts: () => new Map([["ask", { artifact: ask, holders: ["lead"] }]]), tree: () => ({}), agents: () => new Map() }
  return createTeamCore({ team, channel: createChannel({ logKeep: 10 }), maxMessages: 10, idOf: (n) => `t${n}`, stats: () => ({}), persist: { restore() {}, save() {} } })
}
const askWhat = (core) => core.ownerArtifact("what", [{ id: "ask", question: "what is this?", element: { artifact: "talk" } }], async () => {})

describe("ask-answer: the owner's 'what' through ownerArtifact", () => {
  test("an answer comes back whole, with its file:line cite", async () => {
    const read = async (file) => {
      if (!(file in FILES)) throw new Error(`404 ${file}`)
      return FILES[file]
    }
    const out = await askWhat(coreWith(new Ask({ registry, read })))
    expect(out.ok).toBe(true)
    expect(typeof out.value).toBe("string")
    expect(out.value).toContain("backend/kernel/builtin/talk.js:2")
  })

  test("a throw that is not an Error fails with its text", async () => {
    const ask = new Ask({ registry, read: async () => "" })
    ask.what = async () => {
      throw "the host has no fs/read"
    }
    const out = await askWhat(coreWith(ask))
    expect(out).toEqual({ ok: false, error: { message: "the host has no fs/read" } })
  })

  test("an Error's message reaches the fail", async () => {
    const out = await coreWith(new Ask({ registry, read: async () => "" })).ownerArtifact("what", [{ id: "ask", question: "" }], async () => {})
    expect(out.ok).toBe(false)
    expect(out.error.message).toContain("question")
  })
})
