import { describe, expect, test } from "bun:test"
import { Agent } from "../index.js"
import { nextStats } from "../../live/team-rows.js"

// The context meter: each prompt element's chars, the newest render's only.
describe("prompt parts", () => {
  const agent = () => new Agent({ name: "b", soul: "Be plain.", role: "builds one thing", report: false }, { infer: async () => "" })

  test("the parts' chars sum to the prompt's length, each element named", () => {
    const a = agent()
    const prompt = a.render({ text: "go", from: "lead" }, [])
    expect(a.promptParts.reduce((n, p) => n + p.chars, 0)).toBe(prompt.length)
    expect(a.promptParts.map((p) => p.label)).toEqual(["soul", "you", "request", "response"])
  })

  test("a second render replaces agent.promptParts", () => {
    const a = agent()
    a.render({ text: "go", from: "lead" }, [])
    const first = a.promptParts
    const prompt = a.render({ text: "a much longer request than the first one", from: "lead" }, [])
    expect(a.promptParts).not.toBe(first)
    expect(a.promptParts.length).toBe(first.length)
    expect(a.promptParts.reduce((n, p) => n + p.chars, 0)).toBe(prompt.length)
  })

  test("nextStats keeps only the newest promptParts", () => {
    const one = [{ label: "you", chars: 10 }]
    const two = [{ label: "you", chars: 20 }]
    const s1 = nextStats(null, null, { ms: 5, prompt_chars: 10, reply_chars: 1, promptParts: one })
    const s2 = nextStats(s1, null, { ms: 5, prompt_chars: 20, reply_chars: 1, promptParts: two })
    expect(s2.promptParts).toEqual(two)
    // a chat event without a measure keeps the last one
    expect(nextStats(s2, null, { ms: 5, prompt_chars: 3, reply_chars: 1 }).promptParts).toEqual(two)
  })

  test("artifacts whose ids share a prefix (dev, dev.board) are two distinct parts", () => {
    const art = (id, title, text) => ({ id, title, render: () => text, commands: () => [] })
    const a = new Agent({ name: "b", soul: "Be plain.", role: "builds one thing", report: false }, { infer: async () => "", artifacts: [art("dev", "the project", "x"), art("dev.board", "the board", "y")] })
    const prompt = a.render({ text: "go", from: "lead" }, [])
    expect(a.promptParts.map((p) => p.label)).toEqual(["soul", "you", "dev", "dev.board", "request", "response"])
    expect(a.promptParts.reduce((n, p) => n + p.chars, 0)).toBe(prompt.length)
  })
})
