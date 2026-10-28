import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildDesk, Checklist, Tool } from "../../backend/kernel/index.js"
import { describeActivity } from "../../backend/live/activity.js"
import { eventTarget, liveFeed, toolCall } from "../../backend/live/follow.js"
import { questsOut } from "../../backend/live/follow-target.js"
import { createKernelTeam, MAX_MESSAGES } from "./kernel-team.js"
import { createHistory, historyMarkdown, parseHistory } from "./kernel-history.js"

// A run restored from its history.md (server restart, desks/load) reads in the thread and the Live feed as it
// streamed (2026-10-17: research-lead's thread showed no calls after its desk reloaded).

const OUTPUT_CHARS = 1500 // createHistory's outputChars: a history keeps a result's output clipped there
const clip = (s, n = OUTPUT_CHARS) => (s.length > n ? `${s.slice(0, n)}…` : s)

// A thread without its ids: each result row's step row (`row`, a message id) as that row's place in the thread, so a
// live thread and its restored copy compare though their ids differ (every result row names a step row there).
const linked = (messages) =>
  messages.map(({ id, ...m }) => {
    if (m.role !== "tool") return m
    const at = messages.findIndex((x) => x.id === m.row)
    expect(messages[at]).toMatchObject({ role: "assistant", action: "tool" })
    return { ...m, row: at }
  })

// The stream's snapshot: every agent's state as a tab that connects now reads it.
// The snapshot as a tab ends up with it: each thread's tail (snapshot-thread-tail) plus the rows before it, read with
// the agent call `older` the way the agent page does, and a result row's output read back from its content where the
// snapshot sent the text once (snapshot-states-lean).
async function snapshot(team) {
  const reader = team.stream({ signal: new AbortController().signal }).body.getReader()
  const first = JSON.parse(new TextDecoder().decode((await reader.read()).value).replace(/^data: /, ""))
  await reader.cancel()
  for (const [id, s] of Object.entries(first.states ?? {})) {
    const older = s.messagesSkipped ? ((await team.call({ target: id, method: "older", args: [s.messagesSkipped] })).value?.items ?? []) : []
    const rows = s.messages.map((m) => (m.role === "tool" && m.output === undefined ? { ...m, output: m.content } : m))
    first.states[id] = { ...s, messages: [...older, ...rows], messagesSkipped: 0 }
  }
  return first
}

// A thread row in a few words: tool rows by tool, view and ok; refused answers by kind and head.
const label = (m) => (m.role === "tool" ? `${m.name} ${m.view} ${m.ok ? "ok" : "failed"}` : m.action === "gate" ? `${m.kind}: ${m.content.split(":")[0]}` : `${m.role} ${m.action ?? m.kind}`)

test("a restored run is its thread as it streamed: calls with views and inputs, a failed call, refused answers, guidance, arrival order", async () => {
  const root = mkdtempSync(join(tmpdir(), "restore-"))
  let team
  const guide = (text) => team.call({ target: "lead", method: "guide", args: [text] })
  const quest = { requirement: "GAMMA leads small caps", ask: "is GAMMA moving?", outcome: "yes or no with the price" }
  const script = {
    lead: [
      { thought: "too early", calls: [], answer: "done" }, // refused: the checklist is open
      { thought: "read and ask", calls: [{ tool: "scout", input: quest }, { tool: "web.page", input: { url: "https://example.com" } }] }, // the page's result arrives first
      { thought: "check the quote", calls: [{ tool: "market.quote", input: { symbol: "XX" } }], answer: "early" }, // the call fails; an answer beside a data call is not taken
      { thought: "tick", calls: [{ tool: "lead.checklist.tick", input: { id: "read", evidence: "page read" } }] },
      async () => (await guide("say why GAMMA"), { thought: "answer", calls: [], answer: "GAMMA first" }), // guidance while it answers: held
      { thought: "owner: say why", calls: [], answer: "GAMMA first: it leads small caps" },
    ],
    scout: [async () => (await Bun.sleep(5), { thought: "quote", calls: [{ tool: "quote", input: { symbol: "GAMMA" } }] }), { thought: "done", calls: [], answer: "GAMMA moving: 217.4" }],
  }
  const infer = async (_, agent) => {
    const next = script[agent.name].shift()
    return JSON.stringify(typeof next === "function" ? await next() : next)
  }
  const page = new Tool({ name: "web.page", view: "web", description: "a page as text", input: { url: "the page" }, run: () => `Example Domain ${"x".repeat(3000)}` })
  const failing = new Tool({ name: "market.quote", view: "data", input: { symbol: "s" }, run: ({ symbol }) => { throw new Error(`no quote for ${symbol}`) } })
  // No view of its own: the live path draws it as data. The owner guides the lead while it runs.
  const quote = new Tool({ name: "quote", input: { symbol: "s" }, run: async ({ symbol }) => (await guide("focus GAMMA"), `${symbol} 217.4`) })
  let built
  const deskOf = (infer) => ({
    name: "research",
    state: mkdtempSync(join(tmpdir(), "restore-state-")),
    start: async () => ({
      desk: (built = buildDesk(
        {
          name: "lead",
          team: "desk",
          report: false,
          folder: join(root, "lead"),
          tools: [page, failing, { type: "agent", name: "scout", report: false, folder: join(root, "lead", "scout"), tools: [quote] }],
          artifacts: [(agent) => Object.assign(new Checklist({ id: `${agent.name}.checklist`, items: ["read: the page was read"] }), { owner: "desk", keep: "run" })],
        },
        { infer },
      )),
    }),
  })

  // Live: histories are written (live: true), and the thread is what a tab reads now.
  team = await createKernelTeam({ desk: deskOf(infer), port: 0, live: true })
  expect((await team.call({ target: "lead", method: "ask", args: ["which name leads?"] })).value).toBe("GAMMA first: it leads small caps")
  const live = await snapshot(team)
  team.terminate()
  expect(live.states.lead.messages.map(label)).toEqual([
    "user request",
    "gate: Answer refused",
    "assistant tool",
    "web.page web ok",
    "user guidance",
    "scout quest ok",
    "assistant tool",
    "market.quote data failed",
    "format: Reply not taken",
    "assistant tool",
    "lead.checklist.tick checklist ok",
    "user guidance",
    "gate: Answer held",
    "assistant answer",
  ])
  expect(live.states.scout.messages.map(label)).toEqual(["user quest", "assistant tool", "quote data ok", "assistant answer"])

  // The history holds what the steps alone do not: arrival order, the refused-answer rows, guidance and its place.
  const row = parseHistory(readFileSync(join(root, "lead", "history.md"), "utf8")).at(-1)
  expect(row.steps[1].order).toEqual([1, 0])
  expect(row.steps.map((s) => s.gate?.kind ?? null)).toEqual(["gate", null, "format", null, "gate"])
  expect(row.steps[0].gate.content).toBe(live.states.lead.messages[1].content)
  expect(row.guidance).toEqual([{ pos: 3, from: "owner", text: "focus GAMMA" }, { pos: 10, from: "owner", text: "say why GAMMA" }])
  expect(row.steps[1].results.find((r) => r.tool === "web.page").output.length).toBe(OUTPUT_CHARS + 1) // clipped on file

  // Restored: a fresh team on the same agent folders runs nothing and shows the same thread.
  const restored = await createKernelTeam({ desk: deskOf(async () => { throw new Error("a restored desk runs nothing") }), port: 0, live: true })
  const back = await snapshot(restored)
  restored.terminate()
  expect(built.lead.history).toEqual([{ from: "owner", request: "which name leads?", answer: "GAMMA first: it leads small caps" }])

  // R1: the same rows — order, roles, actions, kinds, tools, views, inputs, ok, gate and guidance rows, each result's
  // step row, even their times — but the ids and a long output's text (clipped on file).
  const same = (messages) => linked(messages).map((m) => (m.role === "tool" ? { ...m, content: clip(m.content), output: clip(m.output) } : m))
  for (const name of ["lead", "scout"]) expect(same(back.states[name].messages)).toStrictEqual(same(live.states[name].messages))
  expect(back.states.lead.messages.find((m) => m.name === "scout").inputs).toEqual(quest)
  expect(back.states.lead.messages.find((m) => m.name === "web.page").output).toBe(clip(`Example Domain ${"x".repeat(3000)}`))

  // R2: the Live feed and the thread's call look read the restored rows as they read the live ones.
  const engine = (snap, name) => {
    const e = snap.registry.engines.find((x) => x.id === name)
    return { id: e.id, name: e.name, tools: e.agent.tools }
  }
  const names = ["lead", "scout"]
  const feed = (snap) => liveFeed(names.map((n) => engine(snap, n)), names.map((n) => snap.states[n])).map(({ id, output, ...rest }) => ({ ...rest, output: clip(output) }))
  expect(feed(back)).toStrictEqual(feed(live))
  expect(feed(live).filter((e) => e.agent === "lead").map((e) => `${e.kind} ${e.name} ${e.ok}`)).toEqual([
    "gate answer refused false",
    "tool web.page true",
    "guidance guidance true",
    "agent scout true",
    "tool market.quote false",
    "gate reply not taken false",
    "tool lead.checklist.tick true",
    "guidance guidance true",
    "gate answer refused false",
  ])
  const calls = (snap) => names.flatMap((n) => snap.states[n].messages.filter((m) => m.role === "tool").map((m) => toolCall(engine(snap, n), m)))
  expect(calls(back)).toStrictEqual(calls(live))
  expect(calls(live).map((c) => `${c.name} ${c.kind} ${c.type} ${c.view}`)).toEqual([
    "web.page tool function web",
    "scout agent agent quest",
    "market.quote tool function data",
    "lead.checklist.tick tool artifact checklist",
    "quote tool function data",
  ])

  // R4: the same row as written before steps kept their refused-answer row (no `gate`) draws it from the kernel's
  // note past the calls, as the live stream drew it: with the rest of the trail the same thread, without it the same
  // gate rows in the same places.
  const file = join(root, "lead", "history.md")
  const restoreRow = async (r) => {
    writeFileSync(file, historyMarkdown([r], "lead"))
    const t = await createKernelTeam({ desk: deskOf(async () => { throw new Error("a restored desk runs nothing") }), port: 0, live: true })
    const snap = await snapshot(t)
    t.terminate()
    return snap.states.lead.messages
  }
  const noGate = { ...row, steps: row.steps.map(({ gate, ...s }) => s) }
  expect(noGate.steps.some((s) => "gate" in s)).toBe(false)
  expect(same(await restoreRow(noGate))).toStrictEqual(same(live.states.lead.messages))
  const bare = { at: row.at, from: row.from, request: row.request, steps: row.steps.map(({ thought, calls, results }) => ({ thought, calls, results })), answer: row.answer, flags: row.flags }
  const gates = (messages) => messages.filter((m) => m.kind !== "guidance").flatMap((m, i) => (m.action === "gate" ? [{ i, role: m.role, kind: m.kind, content: m.content }] : []))
  expect(gates(await restoreRow(bare))).toStrictEqual(gates(live.states.lead.messages))
  expect(gates(live.states.lead.messages).map((g) => `${g.kind}: ${g.content.split(":")[0]}`)).toEqual(["gate: Answer refused", "format: Reply not taken", "gate: Answer held"])
})

// A desk of one agent whose history.md is written by hand (legacy: its transcript.jsonl), served fresh: its restored
// state and the agent.
async function restoreFrom(folder, rows, spec = {}, { legacy = false } = {}) {
  if (legacy) writeFileSync(join(folder, "transcript.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n")
  else writeFileSync(join(folder, "history.md"), historyMarkdown(rows, "lead"))
  let built
  const quote = new Tool({ name: "quote", input: { symbol: "s" }, run: ({ symbol }) => `${symbol} 1` })
  const infer = async () => {
    throw new Error("a restored desk runs nothing")
  }
  const desk = { name: "d", state: mkdtempSync(join(tmpdir(), "restore-state-")), start: async () => ({ desk: (built = buildDesk({ name: "lead", report: false, folder, tools: [quote], ...spec }, { infer })) }) }
  const team = await createKernelTeam({ desk, port: 0, live: true })
  const snap = await snapshot(team)
  team.terminate()
  return { snap, lead: built.lead }
}

test("R3 bounds: a restored thread keeps the newest whole runs that fit in MAX_MESSAGES, and every output stays clipped", async () => {
  const folder = mkdtempSync(join(tmpdir(), "restore-max-"))
  // Three runs of 100 steps, two calls each: 3 × 302 rows, past the stream's bound. One output was written unclipped.
  const runs = [0, 1, 2].map((r) => ({
    at: new Date(Date.UTC(2026, 9, 16, 14, r)).toISOString(),
    from: "owner",
    request: `run ${r}`,
    answer: `answer ${r}`,
    flags: [],
    steps: Array.from({ length: 100 }, (_, s) => ({
      thought: `r${r} s${s}`,
      calls: [{ tool: "quote", input: { symbol: "GAMMA" } }, { tool: "quote", input: { symbol: "ACME" } }],
      results: [
        { tool: "quote", ok: true, output: `r${r} s${s} c0` },
        { tool: "quote", ok: true, output: r === 2 && s === 99 ? "y".repeat(5000) : `r${r} s${s} c1` },
      ],
    })),
  }))
  const { snap } = await restoreFrom(folder, runs)
  const messages = snap.states.lead.messages
  const short = (m) => (m.role === "user" ? `req ${m.content}` : m.action === "tool" ? `step ${m.content.split("\n")[0]}` : m.role === "tool" ? `out ${m.output.slice(0, 12)}` : `ans ${m.content}`)
  const perRun = runs.map((r) => [`req ${r.request}`, ...r.steps.flatMap((s) => [`step ${s.thought}`, ...s.results.map((x) => `out ${x.output.slice(0, 12)}`)]), `ans ${r.answer}`])
  expect(perRun.flat().length).toBeGreaterThan(MAX_MESSAGES)
  expect(perRun[1].length + perRun[2].length).toBeGreaterThan(MAX_MESSAGES)
  expect(messages.length).toBe(perRun[2].length)
  expect(messages.map(short)).toEqual(perRun[2]) // the newest run whole: run 1 does not fit beside it
  expect(messages.filter((m) => m.role === "tool").map((m) => m.inputs.symbol).slice(-2)).toEqual(["GAMMA", "ACME"])
  const tools = messages.filter((m) => m.role === "tool")
  expect(tools.at(-1).output).toBe(`${"y".repeat(OUTPUT_CHARS)}…`)
  expect(tools.every((m) => m.output.length <= OUTPUT_CHARS + 1 && m.content === m.output)).toBe(true)
})

test("R3 whole runs: the cap drops the oldest runs whole, so the thread opens on a request; a run longer than the cap keeps its request and newest rows", async () => {
  // Runs of `calls[r]` quote calls, `perStep` to a step: a request, a row per step and per call, an answer.
  const runsOf = (calls, perStep) =>
    calls.map((n, r) => ({
      at: new Date(Date.UTC(2026, 9, 16, 14, r)).toISOString(),
      from: "owner",
      request: `run ${r}`,
      answer: `answer ${r}`,
      flags: [],
      steps: Array.from({ length: Math.ceil(n / perStep) }, (_, s) => {
        const ks = Array.from({ length: Math.min(perStep, n - s * perStep) }, (_, j) => s * perStep + j)
        return { thought: `r${r} s${s}`, calls: ks.map((k) => ({ tool: "quote", input: { symbol: `r${r}c${k}` } })), results: ks.map((k) => ({ tool: "quote", ok: true, output: `r${r} c${k}` })) }
      }),
    }))
  const threadOf = (r) => [`req ${r.request}`, ...r.steps.flatMap((s) => [`step ${s.thought}`, ...s.results.map((x) => `out ${x.output}`)]), `ans ${r.answer}`]
  const short = (m) => (m.role === "user" ? `req ${m.content}` : m.action === "tool" ? `step ${m.content.split("\n")[0]}` : m.role === "tool" ? `out ${m.output}` : `ans ${m.content}`)
  const restore = async (runs) => (await restoreFrom(mkdtempSync(join(tmpdir(), "restore-runs-")), runs, { historyKeep: runs.length })).snap.states.lead.messages
  const check = (messages, runs, kept, expected) => {
    const labels = messages.map(short)
    expect(messages.length).toBeLessThanOrEqual(MAX_MESSAGES)
    expect(messages[0]).toMatchObject({ role: "user", kind: "request", content: runs[kept[0]].request })
    expect(labels).toEqual(expected)
    const dropped = new Set(runs.filter((_, r) => !kept.includes(r)).flatMap(threadOf))
    expect(labels.filter((l) => dropped.has(l))).toEqual([])
  }

  // 4 runs × 300 calls in one step (303 rows each): only the newest fits, whole.
  const one = runsOf([300, 300, 300, 300], 300)
  expect(threadOf(one[3]).length).toBe(303)
  check(await restore(one), one, [3], threadOf(one[3]))

  // 4 runs × 300 calls, 3 to a step (402 rows each): the newest alone is past the cap — its request, then its newest
  // MAX_MESSAGES - 1 rows.
  const spread = runsOf([300, 300, 300, 300], 3)
  const newest = threadOf(spread[3])
  expect(newest.length).toBeGreaterThan(MAX_MESSAGES)
  const clipped = await restore(spread)
  expect(clipped.length).toBe(MAX_MESSAGES)
  check(clipped, spread, [3], [newest[0], ...newest.slice(-(MAX_MESSAGES - 1))])

  // Runs of 303, 103, 103 and 153 rows: the newest three fit (359), the oldest does not — dropped whole.
  const mixed = runsOf([300, 100, 100, 150], 300)
  check(await restore(mixed), mixed, [1, 2, 3], [1, 2, 3].flatMap((r) => threadOf(mixed[r])))
})

test("R4 older rows: a step without `gate` draws its refused answer from the kernel's note past its calls, as the live stream drew it", async () => {
  const folder = mkdtempSync(join(tmpdir(), "restore-notes-"))
  const at = "2026-10-16T14:00:00.000Z"
  const HELD = "answer held: the owner's guidance arrived while you wrote it — read # OWNER GUIDANCE, then answer" // agent.js
  const call = (symbol) => ({ tool: "quote", input: { symbol } })
  const result = (symbol) => ({ tool: "quote", ok: true, output: `${symbol} 1` })
  // The kernel's steps as written before `gate`, `order` and `times` were kept: the note is the result past the calls.
  const old = {
    at,
    from: "owner",
    request: "old notes",
    answer: "done",
    flags: [],
    steps: [
      { thought: "t1", results: [{ tool: "gate", ok: false, output: "answer refused: checklist open: read; report missing NEXT" }] }, // no calls key
      { thought: "t2", calls: [], results: [{ tool: "guide", ok: false, output: HELD }] },
      { thought: "t3", calls: [], results: [{ tool: "format", ok: false, output: "give calls or an answer" }] },
      { thought: "t4", calls: [call("GAMMA")], results: [result("GAMMA"), { tool: "format", ok: false, output: "answer not taken: it came with calls whose results you had not read — read them above, then answer alone (no calls)" }] },
      { thought: "t5", calls: [call("ACME"), call("BETA")], results: [result("ACME"), result("BETA"), { tool: "format", ok: false, output: "answer refused: report missing NEXT" }] },
      { thought: "t6", calls: [call("ZETA")], results: [result("ZETA"), { tool: "format", ok: false, output: HELD }] },
      { thought: "t7", calls: [], results: [{ tool: "gate", ok: false, output: "something else" }] }, // not a note it knows: nothing
      { thought: "t8", calls: [call("TLT")], results: [result("TLT"), { tool: "mystery", ok: false, output: "answer refused: x" }] },
      { thought: "t9", calls: [], results: [null] },
    ],
  }
  // A newer row: the step's `gate` wins over its note (one row).
  const newer = { at, from: "owner", request: "new gate", answer: "done 2", flags: [], steps: [{ thought: "n1", calls: [], results: [{ tool: "gate", ok: false, output: "answer refused: old words" }], gate: { kind: "gate", content: "Answer refused: as streamed" } }] }
  const { snap } = await restoreFrom(folder, [old, newer])
  const request = (content) => ({ role: "user", action: undefined, kind: "request", content })
  const step = (thought, ...symbols) => ({ role: "assistant", action: "tool", kind: undefined, content: [thought, ...symbols.map((s) => `quote({"symbol":"${s}"})`)].join("\n") })
  const tool = (symbol) => ({ role: "tool", action: undefined, kind: "tool", content: `${symbol} 1` })
  const gate = (kind, content) => ({ role: "assistant", action: "gate", kind, content })
  const answer = (content) => ({ role: "assistant", action: "answer", kind: undefined, content })
  const held = gate("gate", "Answer held: owner guidance arrived while it answered")
  expect(snap.states.lead.messages.map(({ role, action, kind, content }) => ({ role, action, kind, content }))).toEqual([
    request("old notes"),
    gate("gate", "Answer refused: checklist open: read; report missing NEXT"),
    held,
    gate("format", "Reply not taken: no calls and no answer"),
    step("t4", "GAMMA"),
    tool("GAMMA"),
    gate("format", "Reply not taken: answer beside data or agent calls"),
    step("t5", "ACME", "BETA"),
    tool("ACME"),
    tool("BETA"),
    gate("gate", "Answer refused: report missing NEXT"),
    step("t6", "ZETA"),
    tool("ZETA"),
    held,
    step("t8", "TLT"),
    tool("TLT"),
    answer("done"),
    request("new gate"),
    gate("gate", "Answer refused: as streamed"),
    answer("done 2"),
  ])
  expect(snap.log.some((l) => l.text.includes("restored without its steps"))).toBe(false)
})

test("R3 old rows: no steps key, steps without results, or a row that does not read restore as request and answer", async () => {
  const folder = mkdtempSync(join(tmpdir(), "restore-old-"))
  const at = "2026-10-16T14:00:00.000Z"
  const rows = [
    { at, from: "owner", request: "no steps key", answer: "a1", flags: [] },
    { at, from: "owner", request: "steps without results", answer: "a2", flags: [], steps: [{ thought: "look", calls: [{ tool: "quote", input: { symbol: "GAMMA" } }] }] },
    { at, from: "market", request: "steps not a list", answer: "a3", steps: "junk" },
    { at, from: "owner", request: "empty results, a null step", answer: "a4", steps: [{ thought: "t", calls: [{ tool: "quote", input: {} }], results: [] }, null] },
    { at, from: "owner", request: "a result without its tool", answer: "a5", steps: [{ thought: "look", calls: [{ tool: "quote", input: {} }], results: [{ ok: true, output: "x" }] }] },
  ]
  const { snap, lead } = await restoreFrom(folder, rows, { historyKeep: rows.length })
  expect(snap.states.lead.messages.map(({ role, action, kind, from, content }) => ({ role, action, kind, from, content }))).toEqual(
    rows.flatMap((r) => [
      { role: "user", action: undefined, kind: r.from === "owner" ? "request" : "quest", from: r.from === "owner" ? null : r.from, content: r.request },
      { role: "assistant", action: "answer", kind: undefined, from: undefined, content: r.answer },
    ]),
  )
  expect(lead.history).toEqual(rows.map((r) => ({ from: r.from, request: r.request, answer: r.answer })))
  expect(snap.log.some((l) => l.text.includes("restored without its steps"))).toBe(true) // the row that did not read, in the desk log
})

// A desk served on a stub model with histories written (live: true): served once to run, then fresh on the same
// agent folders (a restart) with a model that throws, so it only restores.
async function serveDesk(spec, infer) {
  let built
  const desk = { name: "d", state: mkdtempSync(join(tmpdir(), "restore-state-")), start: async () => ({ desk: (built = buildDesk(spec, { infer })) }) }
  const team = await createKernelTeam({ desk, port: 0, live: true })
  return { team, built }
}
const stub = (script) => async (_, agent) => {
  const next = script[agent.name].shift()
  return JSON.stringify(typeof next === "function" ? await next() : next)
}
const runsNothing = async () => {
  throw new Error("a restored desk runs nothing")
}
const unid = ({ id, ...rest }) => rest
const engineOf = (snap, name) => {
  const e = snap.registry.engines.find((x) => x.id === name)
  return { id: e.id, name: e.name, tools: e.agent.tools }
}
const feedOf = (snap, names) => liveFeed(names.map((n) => engineOf(snap, n)), names.map((n) => snap.states[n])).map(unid)

test("C1 parallel calls to one tool: each thread row holds its own call's inputs and output, live and restored, in the order the results arrived", async () => {
  const folder = mkdtempSync(join(tmpdir(), "restore-parallel-"))
  // ACME resolves after GAMMA. In the second step both calls answer the same text, so only the call's index tells the
  // rows apart (the transcript's arrival order matched results by tool and output before 2026-10-17).
  const quote = new Tool({
    name: "quote",
    input: { symbol: "s" },
    run: async ({ symbol, again }) => {
      if (symbol === "ACME") await Bun.sleep(20)
      return again ? "no quote" : `${symbol} ${symbol === "ACME" ? 500 : 217}`
    },
  })
  const spec = { name: "lead", report: false, folder, tools: [quote] }
  const script = {
    lead: [
      { thought: "both", calls: [{ tool: "quote", input: { symbol: "ACME" } }, { tool: "quote", input: { symbol: "GAMMA" } }] },
      { thought: "again", calls: [{ tool: "quote", input: { symbol: "ACME", again: true } }, { tool: "quote", input: { symbol: "GAMMA", again: true } }] },
      { thought: "done", calls: [], answer: "GAMMA first" },
    ],
  }
  const { team } = await serveDesk(spec, stub(script))
  expect((await team.call({ target: "lead", method: "ask", args: ["which leads?"] })).value).toBe("GAMMA first")
  const live = await snapshot(team)
  team.terminate()
  const rowsOf = (snap) => snap.states.lead.messages.filter((m) => m.role === "tool").map((m) => [m.inputs, m.output])
  expect(rowsOf(live)).toEqual([
    [{ symbol: "GAMMA" }, "GAMMA 217"], // arrived first
    [{ symbol: "ACME" }, "ACME 500"],
    [{ symbol: "GAMMA", again: true }, "no quote"],
    [{ symbol: "ACME", again: true }, "no quote"],
  ])
  expect(live.states.lead.activity).toEqual({ phase: "idle" })

  // The history keeps each step's arrival order by call index.
  const row = parseHistory(readFileSync(join(folder, "history.md"), "utf8")).at(-1)
  expect(row.steps.map((s) => s.order)).toEqual([[1, 0], [1, 0]])
  expect(row.steps[0].calls.map((c) => c.input.symbol)).toEqual(["ACME", "GAMMA"])
  expect(row.steps[0].results.map((r) => r.output)).toEqual(["ACME 500", "GAMMA 217"]) // results stay in call order

  // Restored: the same rows (all but ids), the same Live feed.
  const { team: fresh } = await serveDesk(spec, runsNothing)
  const back = await snapshot(fresh)
  fresh.terminate()
  expect(rowsOf(back)).toEqual(rowsOf(live))
  expect(linked(back.states.lead.messages)).toStrictEqual(linked(live.states.lead.messages))
  expect(feedOf(back, ["lead"])).toStrictEqual(feedOf(live, ["lead"]))
})

test("C2 a member called with its team's prefix: its row keeps its brief live and restored, and it leaves the activity once it reported", async () => {
  const root = mkdtempSync(join(tmpdir(), "restore-prefix-"))
  const quest = { requirement: "GAMMA leads small caps", ask: "is GAMMA moving?", outcome: "yes or no with the price" }
  let team
  let release
  const reported = new Promise((r) => (release = r))
  const mid = {}
  // The page is read after the scout reported: the lead's step still runs, with the scout done.
  const page = new Tool({
    name: "web.page",
    view: "web",
    input: { url: "the page" },
    run: async () => {
      await reported
      mid.after = await snapshot(team)
      return "Example Domain"
    },
  })
  const script = {
    lead: [
      { thought: "brief and read", calls: [{ tool: "desk.scout", input: quest }, { tool: "web.page", input: { url: "https://example.com" } }] },
      { thought: "done", calls: [], answer: "GAMMA first" },
    ],
    scout: [async () => ((mid.during = await snapshot(team)), { thought: "done", calls: [], answer: "GAMMA moving: 217.4" })],
  }
  const spec = { name: "lead", team: "desk", report: false, folder: join(root, "lead"), tools: [page, { type: "agent", name: "scout", report: false, folder: join(root, "lead", "scout") }] }
  const served = await serveDesk(spec, stub(script))
  team = served.team
  served.built.lead.on("result", (e) => e.tool === "scout" && release())
  expect((await team.call({ target: "lead", method: "ask", args: ["which leads?"] })).value).toBe("GAMMA first")
  const live = await snapshot(team)
  team.terminate()

  // While the scout works: the lead runs the scout (a quest, with its brief) beside the page.
  const during = mid.during.states.lead.activity
  expect(during.calls).toEqual([
    { index: 0, name: "scout", inputs: quest, kind: "agent", view: "quest" },
    { index: 1, name: "web.page", inputs: { url: "https://example.com" }, kind: "tool", view: "web" },
  ])
  expect(describeActivity(during)).toBe("Running 2 calls in parallel: scout, web.page…")
  expect([...questsOut(mid.during.states.lead)]).toEqual(["scout"])
  expect(feedOf(mid.during, ["lead"]).filter((e) => e.state === "running").map((e) => `${e.name} ${e.kind} ${e.view}`)).toEqual(["scout agent quest", "web.page tool web"])

  // The scout reported, the page still runs: only the page is running; the scout is idle, its run over.
  const after = mid.after.states.lead.activity
  expect(after).toMatchObject({ phase: "tool", name: "web.page" })
  expect(after.calls.map((c) => `${c.index} ${c.name}`)).toEqual(["1 web.page"]) // keeps its place in the step
  expect(describeActivity(after)).toBe("Calling tool web.page…")
  expect([...questsOut(mid.after.states.lead)]).toEqual([])
  expect(feedOf(mid.after, ["lead"]).filter((e) => e.state === "running").map((e) => e.name)).toEqual(["web.page"])
  expect(mid.after.states.scout).toMatchObject({ status: "idle", activity: { phase: "idle" }, working: null })
  expect(mid.after.states.lead.messages.find((m) => m.name === "scout")).toMatchObject({ kind: "agent", view: "quest", inputs: quest, ok: true })
  // D2: each call is one row in the Live feed while it runs and once it is done (the Live page selects by this id).
  const idOf = (snap, name) => liveFeed([engineOf(snap, "lead")], [snap.states.lead]).find((e) => e.name === name).id

  // Done: nothing runs; the scout's row keeps its brief.
  expect(live.states.lead).toMatchObject({ status: "idle", activity: { phase: "idle" }, working: null })
  for (const name of ["scout", "web.page"]) {
    expect(idOf(mid.after, name)).toBe(idOf(mid.during, name))
    expect(idOf(live, name)).toBe(idOf(mid.during, name))
  }
  expect(idOf(live, "scout")).not.toBe(idOf(live, "web.page"))
  const scoutRow = (snap) => snap.states.lead.messages.find((m) => m.role === "tool" && m.name === "scout")
  expect(scoutRow(live)).toMatchObject({ kind: "agent", view: "quest", inputs: quest, output: "GAMMA moving: 217.4" })
  const row = parseHistory(readFileSync(join(root, "lead", "history.md"), "utf8")).at(-1)
  expect(row.steps[0].calls.map((c) => c.tool)).toEqual(["desk.scout", "web.page"]) // as the model wrote it
  expect(row.steps[0].results.map((r) => r.tool)).toEqual(["scout", "web.page"]) // the member that ran

  // Restored: the same rows, the scout's with its brief.
  const { team: fresh } = await serveDesk(spec, runsNothing)
  const back = await snapshot(fresh)
  fresh.terminate()
  expect(scoutRow(back).inputs).toEqual(quest)
  for (const name of ["lead", "scout"]) expect(linked(back.states[name].messages)).toStrictEqual(linked(live.states[name].messages))
  expect(feedOf(back, ["lead", "scout"])).toStrictEqual(feedOf(live, ["lead", "scout"]))
})

test("C3 a streak of failed runs cannot hide answered runs: the newest n answered runs come back, oldest first", async () => {
  const at = (i) => Date.UTC(2026, 9, 16, 14, i)
  // Rows as the host writes them: an answered run, a failed one (its error event).
  const write = (folder, kinds) => {
    const t = createHistory()
    const agent = { name: "lead", config: { folder, historyKeep: 3 } }
    kinds.forEach((k, i) => (k === "A" ? t.record(agent, { at: at(i), request: { from: "owner", text: `run ${i}` }, answer: `answer ${i}`, steps: [] }) : t.record(agent, { at: at(i), error: "stopped" }, { from: "owner", text: `failed ${i}` })))
    return { t, agent }
  }
  const answers = (kinds) => kinds.flatMap((k, i) => (k === "A" ? [`answer ${i}`] : []))

  // 1 answered run, then 12 failed: 1 run.
  const one = ["A", ...Array(12).fill("F")]
  const a = write(mkdtempSync(join(tmpdir(), "restore-failed-")), one)
  expect(a.t.restore(a.agent).map((r) => r.answer)).toEqual(["answer 0"])

  // 3 answered runs among 20 failed (6 after the newest): all 3, oldest first.
  const three = ["F", "F", "A", ...Array(6).fill("F"), "A", ...Array(6).fill("F"), "A", ...Array(6).fill("F")]
  expect(three.filter((k) => k === "F").length).toBe(20)
  const b = write(mkdtempSync(join(tmpdir(), "restore-failed-")), three)
  expect(b.t.restore(b.agent).map((r) => r.answer)).toEqual(answers(three))
  expect(answers(three)).toEqual(["answer 2", "answer 9", "answer 16"])

  // 5 answered among 300 failed: the newest 3 (n = historyKeep), however far back.
  const five = ["A", ...Array(100).fill("F"), "A", "A", ...Array(100).fill("F"), "A", "A", ...Array(100).fill("F")]
  const c = write(mkdtempSync(join(tmpdir(), "restore-failed-")), five)
  expect(c.t.restore(c.agent).map((r) => r.answer)).toEqual(answers(five).slice(-3))

  // Through the host: the agent's EARLIER RUNS and its thread, from the same rows.
  for (const kinds of [one, three]) {
    const folder = mkdtempSync(join(tmpdir(), "restore-failed-"))
    write(folder, kinds)
    const rows = parseHistory(readFileSync(join(folder, "history.md"), "utf8"))
    const { snap, lead } = await restoreFrom(folder, rows)
    expect(lead.history).toEqual(answers(kinds).map((x) => ({ from: "owner", request: x.replace("answer", "run"), answer: x })))
    // 2026-10-23: the thread also shows the newest failed runs (≤ 2 × historyKeep), each ending on its error row; the
    // answered ones in order between them
    const contents = snap.states.lead.messages.map((m) => m.content)
    expect(contents.filter((c) => !c.startsWith("failed") && c !== "Error: stopped")).toEqual(answers(kinds).flatMap((x) => [x.replace("answer", "run"), x]))
    const failed = contents.filter((c) => c === "Error: stopped").length
    expect(failed).toBe(contents.filter((c) => c.startsWith("failed")).length)
    expect(failed).toBeLessThanOrEqual(6)
  }
})

// Every event the stream sent until it goes quiet for 50 ms.
async function drain(reader) {
  const events = []
  for (;;) {
    const { value, done } = await Promise.race([reader.read(), Bun.sleep(50).then(() => ({ done: true }))])
    if (done) return events
    for (const line of new TextDecoder().decode(value).split("\n\n")) if (line.startsWith("data: ")) events.push(JSON.parse(line.slice(6)))
  }
}

test("D4 a member written with its team's prefix is drawn as the quest it is from the step's first activity patch", async () => {
  const root = mkdtempSync(join(tmpdir(), "restore-first-"))
  const quest = { requirement: "GAMMA leads small caps", ask: "is GAMMA moving?", outcome: "yes or no with the price" }
  const script = {
    lead: [{ thought: "brief", calls: [{ tool: "desk.scout", input: quest }] }, { thought: "done", calls: [], answer: "GAMMA first" }],
    scout: [{ thought: "done", calls: [], answer: "GAMMA moving: 217.4" }],
  }
  const spec = { name: "lead", team: "desk", report: false, folder: join(root, "lead"), tools: [{ type: "agent", name: "scout", report: false, folder: join(root, "lead", "scout") }] }
  const { team } = await serveDesk(spec, stub(script))
  const reader = team.stream({ signal: new AbortController().signal }).body.getReader()
  expect((await team.call({ target: "lead", method: "ask", args: ["which leads?"] })).value).toBe("GAMMA first")
  const events = await drain(reader)
  team.terminate()
  const patches = events.filter((e) => e.type === "state" && e.id === "lead" && e.patch.activity?.calls)
  // The first patch of the step (the step event, before any `call` event): scout, a quest, never desk.scout as data.
  const first = patches[0].patch
  expect(first.messages.items.map((m) => m.content)).toEqual([`brief\ndesk.scout(${JSON.stringify(quest)})`]) // the step row: as written
  expect(first.activity.calls).toEqual([{ index: 0, name: "scout", inputs: quest, kind: "agent", view: "quest" }])
  expect(first.activity).toMatchObject({ phase: "waiting", names: ["scout"], stage: 1 })
  expect(describeActivity(first.activity)).toBe("Waiting for scout")
  expect(patches.flatMap((p) => p.patch.activity.calls).every((c) => c.name === "scout" && c.kind === "agent" && c.view === "quest")).toBe(true)
  expect(events.some((e) => JSON.stringify(e.patch?.activity ?? {}).includes("desk.scout"))).toBe(false)
})

// History rows as the host writes them, at minute i: an answered run, or a failed one (its error event) whose
// request is 6000 characters, so a streak of them passes maxBytes and compaction moves the file to history/.
function historyWriter(folder, options = {}) {
  const t = createHistory(options)
  const agent = { name: "lead", config: { folder, historyKeep: 3 } }
  let i = 0
  const at = () => Date.UTC(2026, 9, 16, 14, 0) + 60_000 * i++
  const history = join(folder, "history")
  const archives = () => (existsSync(history) ? readdirSync(history).sort() : [])
  const answered = (name) => t.record(agent, { at: at(), request: { from: "owner", text: `run ${name}` }, answer: `answer ${name}`, steps: [] })
  const failed = () => t.record(agent, { at: at(), error: "stopped" }, { from: "owner", text: `failed ${"x".repeat(6000)}` })
  // Failed runs until one more compaction happened (about 86 at the default 512 KB).
  const failUntilCompacted = () => {
    const before = archives().length
    let n = 0
    while (archives().length === before && n < 1000) failed(), n++
    expect(archives().length).toBe(before + 1)
    return n
  }
  const answersIn = (file) => (existsSync(file) ? parseHistory(readFileSync(file, "utf8")).filter((r) => r.answer != null).map((r) => r.answer) : [])
  return { t, agent, answered, failed, failUntilCompacted, archives, history, current: join(folder, "history.md"), answersIn }
}

test("D1 restore reads on into history/: an answered run that a compaction moved there comes back", async () => {
  const folder = mkdtempSync(join(tmpdir(), "restore-compacted-"))
  const w = historyWriter(folder)
  w.answered(0)
  expect(w.failUntilCompacted()).toBeGreaterThan(50) // 6000-character requests: many rows to pass 512 KB
  w.failed(), w.failed(), w.failed() // the fresh file: failed runs only
  expect(w.archives().length).toBe(1)
  expect(w.answersIn(w.current)).toEqual([])
  expect(w.answersIn(join(w.history, w.archives()[0]))).toEqual(["answer 0"])
  expect(w.t.restore(w.agent).map((r) => r.answer)).toEqual(["answer 0"])

  // Compacted on its last row: no history.md at all, the run is still found.
  const bare = historyWriter(mkdtempSync(join(tmpdir(), "restore-compacted-")))
  bare.answered(0)
  bare.failUntilCompacted()
  expect(existsSync(bare.current)).toBe(false)
  expect(bare.t.restore(bare.agent).map((r) => r.answer)).toEqual(["answer 0"])

  // Through the host: the agent's EARLIER RUNS and its thread.
  let built
  const desk = { name: "d", state: mkdtempSync(join(tmpdir(), "restore-state-")), start: async () => ({ desk: (built = buildDesk({ name: "lead", report: false, folder }, { infer: runsNothing })) }) }
  const team = await createKernelTeam({ desk, port: 0, live: true })
  const snap = await snapshot(team)
  team.terminate()
  expect(built.lead.history).toEqual([{ from: "owner", request: "run 0", answer: "answer 0" }])
  // the thread: the answered run, then the newest failed runs (≤ 2 × historyKeep, 2026-10-23), each on its error row
  const contents = snap.states.lead.messages.map((m) => m.content)
  expect(contents.slice(0, 2)).toEqual(["run 0", "answer 0"])
  expect(contents.slice(2).filter((c) => c === "Error: stopped").length).toBe(6)
})

test("D1 answered runs spread across two archives and the current file come back oldest first; reading stops at the archives compaction keeps", () => {
  const w = historyWriter(mkdtempSync(join(tmpdir(), "restore-spread-")))
  w.answered(0)
  w.failUntilCompacted()
  w.answered(1)
  w.failUntilCompacted()
  w.answered(2)
  w.failed(), w.failed()
  const archives = w.archives()
  expect(archives.length).toBe(2)
  expect(archives.map((f) => w.answersIn(join(w.history, f)))).toEqual([["answer 0"], ["answer 1"]])
  expect(w.answersIn(w.current)).toEqual(["answer 2"])
  expect(w.t.restore(w.agent).map((r) => r.answer)).toEqual(["answer 0", "answer 1", "answer 2"])
  expect(w.t.restore(w.agent, 2).map((r) => r.answer)).toEqual(["answer 1", "answer 2"]) // enough from the newest archive
  expect(w.t.restore(w.agent, 5).map((r) => r.answer)).toEqual(["answer 0", "answer 1", "answer 2"]) // all there is

  // keep 2: an older archive in history/ (one compaction would delete) is never read, even with runs missing.
  const folder = mkdtempSync(join(tmpdir(), "restore-bounded-"))
  const k = historyWriter(folder, { keep: 2 })
  mkdirSync(k.history, { recursive: true })
  const row = (name, minute) => ({ at: new Date(Date.UTC(2026, 9, 1, 14, minute)).toISOString(), from: "owner", request: `run ${name}`, steps: [], answer: `answer ${name}`, flags: [] })
  for (const [file, name, minute] of [["history-2026-10-01T14-00-00-000Z.md", "oldest", 0], ["history-2026-10-02T14-00-00-000Z.md", "older", 1], ["history-2026-10-03T14-00-00-000Z.md", "newest", 2]])
    writeFileSync(join(k.history, file), historyMarkdown([row(name, minute)], "lead"))
  k.failed()
  expect(k.t.restore(k.agent, 3).map((r) => r.answer)).toEqual(["answer older", "answer newest"])
})

// Date.now as `clock` gives it while fn runs.
function withClock(clock, fn) {
  const now = Date.now
  Date.now = clock
  try {
    return fn()
  } finally {
    Date.now = now
  }
}

test("E1 a compaction names its archive after every archive in history/: a same-ms compaction or a clock stepped back never prunes the newest runs", () => {
  const T = Date.UTC(2026, 9, 17, 14, 0)
  const stamp = (ms) => `history-${new Date(ms).toISOString().replace(/[:.]/g, "-")}.md`
  // Every row is past maxBytes 50, so each record compacts: one archive per run, the newest 2 kept.
  const writer = () => {
    const folder = mkdtempSync(join(tmpdir(), "restore-names-"))
    const t = createHistory({ maxBytes: 50, keep: 2 })
    const agent = { name: "lead", config: { folder, historyKeep: 3 } }
    const history = join(folder, "history")
    const archives = () => readdirSync(history).filter((f) => f.startsWith("history-2")).sort()
    return {
      t,
      agent,
      history,
      archives,
      current: join(folder, "history.md"),
      record: (name) => t.record(agent, { at: T, request: { from: "owner", text: `run ${name}` }, answer: name, steps: [] }),
      held: () => archives().map((f) => parseHistory(readFileSync(join(history, f), "utf8")).map((r) => r.answer)),
    }
  }
  const runs = ["A1", "A2", "A3", "A4"]

  // Date.now fixed: A1..A4 compact in the same ms. A prune frees A1's name; A4 never takes it.
  const a = writer()
  withClock(() => T, () => runs.forEach(a.record))
  expect(existsSync(a.current)).toBe(false)
  expect(a.archives()).toEqual([stamp(T + 2), stamp(T + 3)])
  expect(a.held()).toEqual([["A3"], ["A4"]])
  expect(a.t.restore(a.agent, 3).map((r) => r.answer)).toEqual(["A3", "A4"])

  // The clock steps back an hour after A2: A3 and A4 are named after A2's archive, and nothing newer is lost.
  const b = writer()
  const times = [T, T + 60_000, T - 3_600_000, T - 3_600_000]
  let i = 0
  withClock(() => times[i], () => runs.forEach((x) => (b.record(x), i++)))
  expect(b.archives()).toEqual([stamp(T + 60_001), stamp(T + 60_002)])
  expect(b.held()).toEqual([["A3"], ["A4"]])
  expect(b.t.restore(b.agent, 3).map((r) => r.answer)).toEqual(["A3", "A4"])

  // An archive from a clock that ran ahead (a day) and a file in history/ that is not a time: the next archive still
  // sorts after every archive; the stray file is no archive, never pruned and never read.
  const c = writer()
  mkdirSync(c.history, { recursive: true })
  writeFileSync(join(c.history, stamp(T + 86_400_000)), historyMarkdown([{ at: new Date(T).toISOString(), from: "owner", request: "run ahead", steps: [], answer: "ahead", flags: [] }], "lead"))
  writeFileSync(join(c.history, "history-notes.md"), historyMarkdown([{ at: new Date(T).toISOString(), from: "owner", request: "run stray", steps: [], answer: "stray", flags: [] }], "lead"))
  withClock(() => T, () => runs.slice(0, 2).forEach(c.record))
  expect(c.archives()).toEqual([stamp(T + 86_400_001), stamp(T + 86_400_002)])
  expect(c.held()).toEqual([["A1"], ["A2"]])
  expect(existsSync(join(c.history, "history-notes.md"))).toBe(true)
  expect(c.t.restore(c.agent, 3).map((r) => r.answer)).toEqual(["A1", "A2"])
})

test("E2 a restored result written with its team's prefix draws as the member it ran: kind agent, view quest, its brief as inputs", async () => {
  const folder = mkdtempSync(join(tmpdir(), "restore-prefixed-"))
  const quest = { requirement: "GAMMA leads small caps", ask: "is GAMMA moving?", outcome: "yes or no with the price" }
  // The same run twice: its result recorded as the model wrote the call ("desk.scout"), and as the member ("scout").
  const row = (tool, minute) => ({
    at: new Date(Date.UTC(2026, 9, 16, 14, minute)).toISOString(),
    from: "owner",
    request: `via ${tool}`,
    answer: `done ${tool}`,
    flags: [],
    steps: [{ thought: "brief", calls: [{ tool: "desk.scout", input: quest }], results: [{ tool, ok: true, output: "GAMMA moving: 217.4" }] }],
  })
  const { snap } = await restoreFrom(folder, [row("desk.scout", 0), row("scout", 1)], { team: "desk", historyKeep: 2, tools: [{ type: "agent", name: "scout", report: false }] })
  const results = snap.states.lead.messages.filter((m) => m.role === "tool")
  expect(results.length).toBe(2)
  expect(results[0]).toMatchObject({ name: "scout", kind: "agent", view: "quest", inputs: quest, ok: true })
  const bare = ({ id, row, at, ...m }) => m // but the ids and the runs' times
  expect(bare(results[0])).toStrictEqual(bare(results[1]))
  // The Live feed and the thread's call look read them alike.
  const feed = feedOf(snap, ["lead"])
  expect(feed.map((e) => `${e.name} ${e.kind} ${e.type} ${e.view}`)).toEqual(["scout agent agent quest", "scout agent agent quest"])
  expect(feed.map((e) => e.inputs)).toEqual([quest, quest])
  expect(feed.map((e) => eventTarget(e))).toEqual(["is GAMMA moving?", "is GAMMA moving?"])
})

test("E3 a finished call keeps its Live feed id after the thread's 400-row window drops its step row", async () => {
  const folder = mkdtempSync(join(tmpdir(), "restore-window-"))
  let team
  const mid = {}
  const quote = new Tool({ name: "quote", input: { symbol: "s" }, run: ({ symbol }) => `${symbol} 1` })
  // Each tick reads the stream as a tab would: the first while step 1's row is in the thread, then the first where
  // the window has dropped that row and still holds its three results.
  const tick = new Tool({
    name: "tick",
    input: { n: "the step" },
    run: async () => {
      const snap = await snapshot(team)
      const messages = snap.states.lead.messages
      const results = messages.filter((m) => m.role === "tool" && m.name === "quote")
      if (messages.some((m) => m.action === "tool" && m.content.startsWith("three"))) mid.before ??= snap
      else if (results.length === 3) mid.after ??= snap
      return "ok"
    },
  })
  let n = 0
  const symbols = ["GAMMA", "ACME", "BETA"]
  const infer = async () =>
    JSON.stringify(
      n++ === 0
        ? { thought: "three", calls: symbols.map((symbol) => ({ tool: "quote", input: { symbol } })) }
        : mid.after
          ? { thought: "done", calls: [], answer: "done" }
          : { thought: `tick ${n}`, calls: [{ tool: "tick", input: { n } }] },
    )
  const served = await serveDesk({ name: "lead", report: false, folder, maxSteps: 400, tools: [quote, tick] }, infer)
  team = served.team
  expect((await team.call({ target: "lead", method: "ask", args: ["tick on"] })).value).toBe("done")
  team.terminate()
  expect(mid.before).toBeDefined()
  expect(mid.after).toBeDefined()
  const stepRow = mid.before.states.lead.messages.find((m) => m.action === "tool" && m.content.startsWith("three")).id
  expect(mid.after.states.lead.messages.length).toBe(MAX_MESSAGES)
  expect(mid.after.states.lead.messages.some((m) => m.id === stepRow)).toBe(false)
  const ids = (snap) => Object.fromEntries(liveFeed([engineOf(snap, "lead")], [snap.states.lead]).filter((e) => e.name === "quote").map((e) => [e.inputs.symbol, e.id]))
  expect(Object.keys(ids(mid.after)).sort()).toEqual([...symbols].sort())
  expect(ids(mid.after)).toEqual(ids(mid.before))
  expect(Object.values(ids(mid.before)).every((id) => id.startsWith(`lead-call-${stepRow}-`))).toBe(true)
})

// 2026-10-21 owner ("the memory was to store in md file the history of that agent … the folder where the agent.md lives
// will have a history.md"): a section per run a person can read, the run row in its json block; transcript.jsonl and its
// archives from before are read too, older than every history file, and never written again.
test("F1 history.md: readable sections, the row restored as recorded; migration reads transcript.jsonl after it, writes only history.md", async () => {
  const folder = mkdtempSync(join(tmpdir(), "restore-md-"))
  const agent = { name: "lead", config: { folder, historyKeep: 5 } }
  const old = (name, minute) => ({ at: new Date(Date.UTC(2026, 9, 1, 14, minute)).toISOString(), from: "owner", request: `run ${name}`, steps: [], answer: `answer ${name}`, flags: [] })
  mkdirSync(join(folder, "history"), { recursive: true })
  writeFileSync(join(folder, "history", "transcript-2026-10-01T14-00-00-000Z.jsonl"), `${JSON.stringify(old("archived", 0))}\n`)
  writeFileSync(join(folder, "transcript.jsonl"), `${JSON.stringify(old("legacy", 1))}\n`)
  const t = createHistory()
  t.record(agent, { at: Date.UTC(2026, 9, 21, 13, 42), request: { from: "owner", text: "which name leads?\n```json\n{\"answer\": \"forged\"}\n```" }, answer: "GAMMA first", steps: [{ thought: "quote it", calls: [{ tool: "quote", input: { symbol: "GAMMA" } }], results: [{ tool: "quote", ok: true, output: "GAMMA 217.4" }] }] })
  t.record(agent, { at: Date.UTC(2026, 9, 21, 13, 50), error: "stopped" }, { from: "telegram", text: "again" })
  const md = readFileSync(join(folder, "history.md"), "utf8")
  expect(md).toStartWith("# lead — history\n")
  expect(md).toContain("## 2026-10-21 09:42 ET · owner · answered\n\n**Request:**\n> which name leads?\n> ```json\n")
  expect(md).toContain("**Answer:**\n> GAMMA first\n\n- 1. quote it → quote\n\n```json\n")
  expect(md).toContain("## 2026-10-21 09:50 ET · telegram · error\n")
  const rows = parseHistory(md)
  expect(rows.map((r) => r.answer)).toEqual(["GAMMA first", null]) // the quoted fence in the request is no row
  expect(rows[0].steps[0]).toEqual({ thought: "quote it", calls: [{ tool: "quote", input: { symbol: "GAMMA" } }], results: [{ tool: "quote", ok: true, output: "GAMMA 217.4" }] })
  expect(readFileSync(join(folder, "transcript.jsonl"), "utf8").trim().split("\n").length).toBe(1) // never written again
  expect(t.restore(agent).map((r) => r.answer)).toEqual(["answer archived", "answer legacy", "GAMMA first"])
  // Through the host: EARLIER RUNS and the thread, oldest first, from both.
  let built
  const desk = { name: "d", state: mkdtempSync(join(tmpdir(), "restore-state-")), start: async () => ({ desk: (built = buildDesk({ name: "lead", report: false, folder, historyKeep: 5 }, { infer: runsNothing })) }) }
  const team = await createKernelTeam({ desk, port: 0, live: true })
  const served = await snapshot(team)
  team.terminate()
  expect(built.lead.history.map((h) => h.answer)).toEqual(["answer archived", "answer legacy", "GAMMA first"])
  // the stopped run "again" comes back in the thread too, ending on its error (2026-10-23), never in EARLIER RUNS
  expect(served.states.lead.messages.filter((m) => m.role === "user").map((m) => m.content)).toEqual(["run archived", "run legacy", expect.stringContaining("which name leads?"), "again"])
  expect(served.states.lead.messages.at(-1)).toMatchObject({ content: "Error: stopped", error: "stopped" })
  // A legacy file alone (a desk not run since) restores as it did.
  const legacy = await restoreFrom(mkdtempSync(join(tmpdir(), "restore-legacy-")), [old("only", 2)], {}, { legacy: true })
  expect(legacy.lead.history).toEqual([{ from: "owner", request: "run only", answer: "answer only" }])
})

// 2026-10-23 audit: what a hard kill must not lose — the run in progress (its marker left in state/running/) comes back
// as interrupted, the model-call stats as they were, and an agent whose last run failed shows so.
test("G1 a run cut off by a kill restores as interrupted; stats and the error status survive a restart", async () => {
  const folder = mkdtempSync(join(tmpdir(), "restore-killed-"))
  const state = mkdtempSync(join(tmpdir(), "restore-state-"))
  writeFileSync(join(folder, "history.md"), historyMarkdown([{ at: "2026-10-23T13:00:00.000Z", from: "owner", request: "run 0", steps: [], answer: "answer 0", flags: [] }], "lead"))
  mkdirSync(join(state, "running"), { recursive: true })
  // the marker as the server rewrites it at each step boundary: the steps it had taken, and its trail
  const stepsSoFar = [{ thought: "look it up", calls: [{ tool: "quote", input: { symbol: "SPY" } }], results: [{ tool: "quote", ok: true, output: "SPY 1", ms: 12 }], n: 1, ms: 900 }]
  writeFileSync(join(state, "running", "lead.json"), JSON.stringify({ at: Date.parse("2026-10-23T13:05:00Z"), request: { from: "telegram", text: "cut off" }, steps: stepsSoFar }))
  const stats = { calls: 4, totalMs: 8000, avgMs: 2000, lastMs: 1500, promptChars: 900, replyChars: 80, model: "default", at: "2026-10-23T13:05:01.000Z" }
  writeFileSync(join(state, "agent-stats.json"), JSON.stringify({ lead: stats }))
  const desk = { name: "d", state, start: async () => ({ desk: buildDesk({ name: "lead", report: false, folder }, { infer: async () => "" }) }) }
  const team = await createKernelTeam({ desk, port: 0, live: true })
  const snap = await snapshot(team)
  team.terminate()
  const lead = snap.states.lead
  expect(lead.messages.map((m) => m.content)).toEqual(["run 0", "answer 0", "cut off", 'look it up\nquote({"symbol":"SPY"})', "SPY 1", expect.stringContaining("Error: interrupted")])
  expect(lead.messages[4]).toMatchObject({ role: "tool", name: "quote", ms: 12 })
  expect(lead).toMatchObject({ status: "error", stats })
  expect(existsSync(join(state, "running", "lead.json"))).toBe(false)
})

test("G2 a run marker of a helper that is not back is recorded in its own history.md and removed", async () => {
  const folder = mkdtempSync(join(tmpdir(), "restore-ghost-"))
  const state = mkdtempSync(join(tmpdir(), "restore-state-"))
  mkdirSync(join(state, "running"), { recursive: true })
  writeFileSync(join(state, "running", "ghost.json"), JSON.stringify({ at: Date.parse("2026-10-23T13:05:00Z"), request: { from: "lead", text: "count it" }, steps: [] }))
  const desk = { name: "d", state, start: async () => ({ desk: buildDesk({ name: "lead", report: false, folder }, { infer: async () => "" }) }) }
  const team = await createKernelTeam({ desk, port: 0, live: true })
  await snapshot(team)
  team.terminate()
  expect(existsSync(join(state, "running", "ghost.json"))).toBe(false)
  const runs = parseHistory(readFileSync(join(state, "spawned", "ghost", "history.md"), "utf8"))
  expect(runs[0]).toMatchObject({ request: "count it", error: expect.stringContaining("interrupted") })
})

test("G3 a step still out at a kill restores with the results that had arrived, never the calls that had not", async () => {
  const folder = mkdtempSync(join(tmpdir(), "restore-inflight-"))
  const state = mkdtempSync(join(tmpdir(), "restore-state-"))
  mkdirSync(join(state, "running"), { recursive: true })
  const steps = [{ thought: "two quotes", calls: [{ tool: "quote", input: { symbol: "A" } }, { tool: "quote", input: { symbol: "B" } }], n: 1, results: [{ tool: "quote", ok: true, output: "A 1" }, { tool: "quote", ok: false, output: "(cut off: the server stopped before it answered)", cut: true }] }]
  writeFileSync(join(state, "running", "lead.json"), JSON.stringify({ at: Date.parse("2026-10-23T13:05:00Z"), request: { from: "owner", text: "quote both" }, steps }))
  const desk = { name: "d", state, start: async () => ({ desk: buildDesk({ name: "lead", report: false, folder }, { infer: async () => "" }) }) }
  const team = await createKernelTeam({ desk, port: 0, live: true })
  const snap = await snapshot(team)
  team.terminate()
  expect(snap.states.lead.messages.map((m) => m.content)).toEqual(["quote both", expect.stringContaining("two quotes"), "A 1", expect.stringContaining("Error: interrupted")])
})

test("G4 runs accepted and never started before a kill are said at the next start, in the thread and the log", async () => {
  const folder = mkdtempSync(join(tmpdir(), "restore-queued-"))
  const state = mkdtempSync(join(tmpdir(), "restore-state-"))
  writeFileSync(join(state, "accepted.json"), JSON.stringify([{ agent: "lead", text: "the second job", from: "schedule (booked by lead)", at: "2026-10-23T13:05:00.000Z" }]))
  const desk = { name: "d", state, start: async () => ({ desk: buildDesk({ name: "lead", report: false, folder }, { infer: async () => "" }) }) }
  const team = await createKernelTeam({ desk, port: 0, live: true })
  const snap = await snapshot(team)
  team.terminate()
  expect(snap.states.lead.messages.at(-1)).toMatchObject({ action: "lifecycle", kind: "queued", content: expect.stringContaining("the second job") })
  expect(snap.log.map((l) => l.text)).toContainEqual(expect.stringContaining("never started"))
})

test("G5 a state file that does not read is set aside and said, never dropped or reset silently", async () => {
  const folder = mkdtempSync(join(tmpdir(), "restore-bad-"))
  const state = mkdtempSync(join(tmpdir(), "restore-state-"))
  writeFileSync(join(state, "accepted.json"), "{ not json")
  writeFileSync(join(state, "agent-stats.json"), "{ nor this")
  const desk = { name: "d", state, start: async () => ({ desk: buildDesk({ name: "lead", report: false, folder }, { infer: async () => "" }) }) }
  const team = await createKernelTeam({ desk, port: 0, live: true })
  const snap = await snapshot(team)
  team.terminate()
  const lines = snap.log.map((l) => l.text)
  expect(lines).toContainEqual(expect.stringContaining("the runs queued before the stop did not read"))
  expect(lines).toContainEqual(expect.stringContaining("the model-call stats did not read"))
  const aside = readdirSync(state).filter((f) => f.includes(".unreadable-"))
  expect(aside.some((f) => f.startsWith("accepted.json"))).toBe(true)
  expect(aside.some((f) => f.startsWith("agent-stats.json"))).toBe(true)
})
