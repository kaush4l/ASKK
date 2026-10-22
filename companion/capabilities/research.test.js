import { expect, test } from "bun:test"
import { createResearch, researchArgv, researchEnv, researchEvents, researchRoute } from "./research.js"

const lines = (...events) => events.map((e) => JSON.stringify(e)).join("\n") + "\n"
const assistant = (...content) => ({ type: "assistant", message: { content } })
const RESULT = { type: "result", subtype: "success", is_error: false, num_turns: 2, duration_ms: 12207, total_cost_usd: 0.05, result: "ABC closed 769.05 (investing.com)" }

// A spawn that answers like the CLI: its stdout the given stream-json, its argv and stdin recorded.
function fakeSpawn(stdout, { code = 0, signalCode = null, seen = {} } = {}) {
  return (argv, opts) => {
    seen.argv = argv
    seen.opts = opts
    seen.stdin = ""
    return {
      stdin: { write: (s) => (seen.stdin += s), end() {} },
      stdout: new Response(stdout).body,
      stderr: new Response("").body,
      exited: Promise.resolve(code),
      signalCode,
    }
  }
}
const collect = async (iter) => {
  const out = []
  for await (const e of iter) out.push(e)
  return out
}

test("argv: only the two web tools, approved, no MCP, no settings, bounded turns", () => {
  const argv = researchArgv("/bin/claude", { model: "sonnet", maxTurns: 6 })
  const at = (flag) => argv[argv.indexOf(flag) + 1]
  expect(at("--tools")).toBe("WebSearch,WebFetch")
  expect(at("--allowedTools")).toBe("WebSearch,WebFetch")
  expect(at("--permission-mode")).toBe("dontAsk")
  expect(at("--max-turns")).toBe("6")
  expect(at("--setting-sources")).toBe("")
  expect(at("--model")).toBe("sonnet")
  expect(argv).toContain("--strict-mcp-config")
  expect(argv.join(" ")).not.toContain("bypass")
  expect(researchArgv("/bin/claude", {}).includes("--model")).toBe(false) // default: the CLI's own
})

test("env: no desk secrets reach the child", () => {
  const env = researchEnv({ HOME: "/Users/x", ASKK_ORDER_ACCOUNT: "123", TELEGRAM_BOT_TOKEN: "t", ANTHROPIC_API_KEY: "k", PATH: "/evil" }, "/Users/x/.local/bin/claude")
  expect(env.HOME).toBe("/Users/x")
  expect(env.ANTHROPIC_API_KEY).toBe("k")
  expect(env.ASKK_ORDER_ACCOUNT).toBeUndefined()
  expect(env.TELEGRAM_BOT_TOKEN).toBeUndefined()
  expect(env.PATH.startsWith("/Users/x/.local/bin:")).toBe(true)
})

test("events: tool uses and notes as they come, the result last with its sources", async () => {
  const seen = {}
  const out = fakeSpawn(lines({ type: "system", subtype: "init" }, assistant({ type: "thinking", thinking: "…" }, { type: "tool_use", name: "WebSearch", input: { query: "ABC close" } }), assistant({ type: "tool_use", name: "WebFetch", input: { url: "https://example.com/abc", prompt: "close" } }), assistant({ type: "text", text: "Found it." }), RESULT), { seen })
  const events = await collect(createResearch({ bin: "/bin/claude", spawn: out }).run({ prompt: "stage", max_turns: 99, seconds: 5 }))
  expect(events.map((e) => e.type)).toEqual(["start", "tool", "tool", "note", "result"])
  expect(events[0]).toMatchObject({ max_turns: 24, seconds: 30 }) // clamped
  expect(events[1]).toEqual({ type: "tool", name: "WebSearch", query: "ABC close" })
  expect(events.at(-1)).toMatchObject({ text: RESULT.result, turns: 2, ms: 12207, cost_usd: 0.05, sources: [{ name: "WebSearch", query: "ABC close" }, { name: "WebFetch", url: "https://example.com/abc" }] })
  expect(seen.stdin).toBe("stage")
  expect(seen.opts.timeout).toBe(30000)
})

test("out of turns, a CLI error, a timeout and a stop are errors, never an empty document", async () => {
  expect(researchEvents(JSON.stringify({ type: "result", subtype: "error_max_turns", num_turns: 8 }), { maxTurns: 8 })[0].message).toContain("ran out of turns (8)")
  expect(researchEvents(JSON.stringify({ type: "result", is_error: true, result: "You've hit your session limit" }))[0]).toMatchObject({ type: "error", message: "claude: You've hit your session limit" })
  const timedOut = await collect(createResearch({ bin: "b", spawn: fakeSpawn("", { signalCode: "SIGKILL" }) }).run({ prompt: "p" }))
  expect(timedOut.at(-1)).toMatchObject({ type: "error", message: "did not finish within 300 s" })
  const ac = new AbortController()
  ac.abort()
  const stopped = await collect(createResearch({ bin: "b", spawn: fakeSpawn(lines(RESULT)) }).run({ prompt: "p", signal: ac.signal }))
  expect(stopped.at(-1)).toMatchObject({ type: "error", message: "stopped" })
})

test("bad input is refused before anything runs", async () => {
  const r = createResearch({ bin: "b", spawn: () => { throw new Error("must not run") } })
  await expect(collect(r.run({ prompt: "" }))).rejects.toThrow("No prompt")
  await expect(collect(r.run({ prompt: "p", model: "x; rm -rf" }))).rejects.toThrow("Bad model id")
  expect(createResearch({ bin: null })).toBeNull()
})

test("route: NDJSON over a same-origin JSON POST; a bad body is a plain HTTP error", async () => {
  const route = researchRoute(createResearch({ bin: "b", spawn: fakeSpawn(lines(assistant({ type: "tool_use", name: "WebSearch", input: { query: "q" } }), RESULT)) }))
  const post = (body, headers = { "content-type": "application/json" }) => new Request("http://localhost:1/__askk/llm/research", { method: "POST", headers, body: JSON.stringify(body) })
  expect((await route(post({ prompt: "p" }), false)).status).toBe(403)
  expect((await route(post({ prompt: "p" }, { "content-type": "text/plain" }), true)).status).toBe(415)
  const res = await route(post({ prompt: "p" }), true)
  expect(res.headers.get("content-type")).toBe("application/x-ndjson")
  const events = (await res.text()).trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.type !== "ping")
  expect(events.map((e) => e.type)).toEqual(["start", "tool", "result"])
  await expect(route(post({ prompt: "" }), true)).rejects.toThrow("No prompt")
})

test("a caller that leaves mid-stream kills the CLI", async () => {
  let killed = null
  const spawn = () => ({
    stdin: { write() {}, end() {} },
    stdout: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(lines(assistant({ type: "tool_use", name: "WebSearch", input: { query: "q" } })))) } }), // never closes
    stderr: new Response("").body,
    exited: new Promise(() => {}),
    exitCode: null,
    signalCode: null,
    kill: (sig) => (killed = sig),
  })
  const it = createResearch({ bin: "b", spawn }).run({ prompt: "p" })
  expect((await it.next()).value.type).toBe("start")
  expect((await it.next()).value.type).toBe("tool")
  await it.return()
  expect(killed).toBe("SIGKILL")
})
