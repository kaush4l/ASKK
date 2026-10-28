import { describe, expect, test } from "bun:test"
import { checkRewrite, createSanitizer, skipReason } from "./sanitize.js"

// A local-models stand-in: provider apple answers with `reply` (a function of the prompt), or throws, or hangs.
const fakeLocal = (reply, { providers = ["apple"] } = {}) => ({
  providers,
  prompts: [],
  complete(provider, { prompt, signal }) {
    this.prompts.push(prompt)
    const self = this
    return (async function* () {
      if (reply === "hang") await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))))
      if (reply instanceof Error) throw reply
      yield typeof reply === "function" ? reply(prompt, self) : reply
    })()
  },
})

describe("skipReason", () => {
  test("short, command, code and long messages are left alone", () => {
    expect(skipReason("yes")).toBe("short")
    expect(skipReason("go on now")).toBe("short") // under 12 chars
    expect(skipReason("/status please now")).toBe("command")
    expect(skipReason("fix this ```js\nx()\n``` for me")).toBe("code")
    expect(skipReason('{"a": 1, "b": "a long json body"}')).toBe("code")
    expect(skipReason("x ".repeat(2500))).toBe("long")
    expect(skipReason("make a story for my kid please")).toBe(null)
  })
})

describe("checkRewrite", () => {
  test("keeps a faithful rewrite, strips a label and quotes", () => {
    expect(checkRewrite("make a 10 min story", 'Rewritten request: "Make a 10-minute story."').text).toBe("Make a 10-minute story.")
  })
  test("refuses an answer, an echo, a dropped number or link, a long reply", () => {
    expect(checkRewrite("tell me a story about a king", "I'm sorry, I can't help").problem).toMatch(/answered/)
    expect(checkRewrite("make it shorter like five minutes", "The message was spoken by the owner").problem).toMatch(/echo/)
    expect(checkRewrite("buy 3 at 412.50", "Buy three at the price").problem).toMatch(/412.50|"3"/)
    expect(checkRewrite("read https://example.com/a and sum up", "Read the page and summarise it").problem).toMatch(/dropped/)
    expect(checkRewrite("hi there all", "x".repeat(600)).problem).toBe("too long")
    expect(checkRewrite("anything at all", "  ").problem).toBe("empty")
  })
})

describe("createSanitizer", () => {
  test("rewrites with the on-device model and says how", async () => {
    const local = fakeLocal("Create a ten-minute story about Vikram and the Vetal for my child.")
    const s = createSanitizer({ local })
    expect(s.available).toBe(true)
    const r = await s.sanitize("make a story of vikram veetal for my kid about ten minutes", { via: "voice" })
    expect(r).toMatchObject({ changed: true, via: "voice", model: "apple", original: "make a story of vikram veetal for my kid about ten minutes" })
    expect(r.text).toMatch(/^Create a ten-minute story/)
    expect(local.prompts[0]).toMatch(/speech recognition/)
    expect(local.prompts[0]).toMatch(/<message>\nmake a story/)
  })
  test("voice guidance is corrected only", async () => {
    const local = fakeLocal("Actually, make it shorter, like five minutes.")
    await createSanitizer({ local }).sanitize("actually make it shorter like five minutes", { via: "guidance" })
    expect(local.prompts[0]).toMatch(/^Correct the owner's short note/)
    expect(local.prompts[0]).not.toMatch(/Make the request explicit/)
  })
  test("never in the way: no model, an error, a bad reply, a timeout → the words as they were", async () => {
    const words = "research the nvdia earnigs date please"
    expect(await createSanitizer({ local: null }).sanitize(words)).toMatchObject({ text: words, changed: false, skipped: "no on-device model" })
    expect(await createSanitizer({ local: fakeLocal("x", { providers: ["claude-cli"] }) }).sanitize(words)).toMatchObject({ skipped: "no on-device model" })
    expect(await createSanitizer({ local: fakeLocal(new Error("busy")) }).sanitize(words)).toMatchObject({ text: words, skipped: expect.stringMatching(/model error/) })
    expect(await createSanitizer({ local: fakeLocal("I'm sorry, I cannot do that") }).sanitize(words)).toMatchObject({ text: words, skipped: expect.stringMatching(/answered/) })
    const stop = new AbortController()
    const pending = createSanitizer({ local: fakeLocal("hang") }).sanitize(words, { signal: stop.signal })
    stop.abort()
    expect(await pending).toMatchObject({ text: words, skipped: "stopped" })
  })
  test("unchanged when the model gives the words back", async () => {
    const r = await createSanitizer({ local: fakeLocal("Write a Python script.") }).sanitize("Write a Python script.")
    expect(r).toMatchObject({ changed: false, text: "Write a Python script." })
  })
})
