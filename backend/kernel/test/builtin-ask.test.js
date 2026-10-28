// Ask (2026-10-27 goal: "Context-aware questions are answered from the code, the live state and what the owner sees
// (file:line and UI element) without a run"): ask.what answers "what is this?" now — the pointed artifact's class
// file:line, its state now and the code lines the question names; one answer, the next replaces it.

import { describe, expect, test } from "bun:test"
import { BUILTIN, Talk } from "../index.js"
import { Ask, grep, keyTerms } from "../builtin/ask.js"

const clock = () => new Date("2026-10-27T02:10:00Z")
const FILES = {
  "backend/kernel/builtin/talk.js": "import { Artifact } from \"../artifact/artifact.js\"\n\n// Talk: the desk's side\nexport class Talk extends Artifact {\n  say() {}\n}",
  "backend/kernel/README.md": "| `backend/kernel/builtin/talk.js` | Talk: say and ask the owner |\n| `backend/kernel/builtin/goal.js` | Goal |",
}
const registry = (id) => (id === "talk" ? { name: "Talk", file: "backend/kernel/builtin/talk.js", about: "the desk's side of the conversation", brief: "nothing said yet" } : null)
const read = async (file) => {
  if (!(file in FILES)) throw new Error(`404 ${file}`)
  return FILES[file]
}
const what = (ask, input, ctx = {}) => ask.commands().find((t) => t.name === "ask.what").run(input, ctx)

describe("ask: what is this, answered now (no run)", () => {
  test("a question + an element: the answer cites its class's file:line and its state now", async () => {
    const ask = new Ask({ clock, registry, read })
    const out = await what(ask, { question: "what is this?", element: { artifact: "talk", view: "talk" } })
    expect(out).toContain("backend/kernel/builtin/talk.js:4")
    expect(ask.state.answer).toStartWith("Talk (talk, view talk): the desk's side of the conversation. Now: nothing said yet. Its class: backend/kernel/builtin/talk.js:4.")
    expect(ask.state.cites[0]).toEqual({ file: "backend/kernel/builtin/talk.js", line: 4, text: "export class Talk extends Artifact {" })
    expect(ask.state.cites.length).toBeLessThanOrEqual(5)
    expect(ask.state.cites.some((c) => c.file === "backend/kernel/README.md" && c.line === 1)).toBe(true)
    expect(ask.state).toMatchObject({ question: "what is this?", element: { artifact: "talk", view: "talk" }, at: "2026-10-27T02:10:00.000Z" })
  })

  test("a second ask replaces the first: the state holds one answer", async () => {
    const ask = new Ask({ clock, registry, read })
    await what(ask, { question: "what is this?", element: "talk" })
    await what(ask, { question: "where is the goal described?" })
    expect(ask.state.question).toBe("where is the goal described?")
    expect(ask.state.element).toBeNull()
    expect(ask.state.answer).toBe("The code on goal, described: backend/kernel/README.md:2.")
    expect(Object.keys(ask.snapshot()).sort()).toEqual(["answer", "at", "cites", "element", "question", "revision"])
    expect(ask.brief()).toStartWith("where is the goal described? →")
  })

  test("refused: an unknown element, a bad id, no question", async () => {
    const ask = new Ask({ clock, registry, read })
    await expect(what(ask, { question: "what is this?", element: "nope" })).rejects.toThrow('element: no artifact "nope" on this desk')
    await expect(what(ask, { question: "what?", element: "../x" })).rejects.toThrow("element.artifact")
    await expect(what(ask, { question: " " })).rejects.toThrow("question: what you ask")
    expect(ask.state.answer).toBeNull()
  })

  test("the owner asks through ownerCall; the default registry finds a holder's artifact and its class in kernelClasses()", async () => {
    const ask = new Ask({ clock, read })
    const talk = new Talk({ clock })
    ask.attach({ name: "lead", artifacts: [talk, ask] })
    await ask.ownerCall("what", [{ question: "what is this?", element: { artifact: "talk" } }])
    expect(ask.state.cites[0]).toMatchObject({ file: "backend/kernel/builtin/talk.js", line: 4 })
    expect(ask.state.answer).toContain("Now: nothing said yet.")
  })

  test("2026-10-27 a read that fails is said in the answer, not swallowed", async () => {
    const failing = async (file) => {
      if (file.endsWith("talk.js")) throw new Error("404 not found")
      return FILES[file]
    }
    const ask = new Ask({ clock, registry, read: failing })
    await what(ask, { question: "what is this?", element: "talk" })
    expect(ask.state.answer).toContain("could not read backend/kernel/builtin/talk.js: 404 not found.")
    expect(ask.state.cites[0]).toEqual({ file: "backend/kernel/builtin/talk.js", line: null, text: "class Talk" })
    const lonely = new Ask({ clock, registry })
    await what(lonely, { question: "what is this?", element: "talk" })
    expect(lonely.state.answer).toContain("could not read backend/kernel/builtin/talk.js: no host to read through.")
  })

  test("2026-10-27 bound to a root, the default read goes through ctx.host's fs/read under it", async () => {
    const paths = []
    const host = { get: async (p) => {
      const path = decodeURIComponent(p.split("path=")[1])
      paths.push(path)
      const file = path.slice("projects/powerhouse/".length)
      if (!(file in FILES)) throw new Error(`404 ${path}`)
      return { path, text: FILES[file] }
    } }
    const ask = BUILTIN.artifacts.ask({ clock, ask: { root: "projects/powerhouse" } })({ name: "lead" }, { type: "ask" })
    expect(ask.root).toBe("projects/powerhouse")
    ask.registry = registry
    await what(ask, { question: "what is this?", element: "talk" }, { host })
    expect(paths).toEqual(["projects/powerhouse/backend/kernel/builtin/talk.js", "projects/powerhouse/backend/kernel/README.md"])
    expect(ask.state.cites[0]).toMatchObject({ file: "backend/kernel/builtin/talk.js", line: 4 })
    expect(ask.state.answer).not.toContain("could not read")
  })

  test("keyTerms and grep", () => {
    expect(keyTerms("What is this speech.say button?", ["Talk"])).toEqual(["talk", "speech.say", "button"])
    expect(grep([["a.js", "x\nspeech.say here"]], ["speech.say"])).toEqual([{ file: "a.js", line: 2, text: "speech.say here" }])
  })

  test("in the kit: one instance per desk, its command, its twin", () => {
    const make = BUILTIN.artifacts.ask({ clock })
    const one = make({ name: "lead" }, { type: "ask" })
    expect(make({ name: "coder" }, { type: "ask" })).toBe(one)
    expect(one.commands().map((t) => t.name)).toEqual(["ask.what"])
    expect(one.twin()).toMatchObject({ kind: "ask", view: "ask", keep: "day", brief: "nothing asked yet" })
  })
})
