import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Artifact, buildAgent, buildDesk, Checklist, dismissTool, Plan, Preview, Schedule, spawnTool, Tool, updateTool } from "../../backend/kernel/index.js"
import { fakeHost } from "../../backend/kernel/test/fake-host.js"
import { mirrorTeam } from "./kernel-live.js"
import { createKernelTeam } from "./kernel-team.js"
import { parseHistory } from "./kernel-history.js"

// A small code desk (no model, no network) through the team surface the app mirrors.
function fixtureDesk() {
  const script = {
    lead: [{ thought: "ask", calls: [{ tool: "scout", input: { requirement: "r", ask: "names", outcome: "o" } }] }, { thought: "tick", calls: [{ tool: "lead.checklist.tick", input: { id: "names", evidence: "scout reported" } }] }, { thought: "done", calls: [], answer: "GAMMA first" }],
    scout: [{ thought: "quote", calls: [{ tool: "quote", input: { symbol: "GAMMA" } }] }, { thought: "done", calls: [], answer: "GAMMA moving" }],
  }
  const infer = async (_, agent) => JSON.stringify(script[agent.name]?.shift() ?? { thought: "done", calls: [], answer: `${agent.name} ok` })
  const schedule = Object.assign(new Schedule({ defaultGoal: "read the market" }), { owner: "desk" })
  const quote = new Tool({ name: "quote", input: { symbol: "s" }, run: ({ symbol }) => `${symbol} 217.4` })
  const spec = {
    name: "lead",
    team: "desk",
    goal: "find the trade",
    report: false,
    artifacts: [(agent) => Object.assign(new Checklist({ id: `${agent.name}.checklist`, items: ["names: scout reported"] }), { owner: "desk", keep: "run" }), schedule],
    tools: [{ type: "agent", name: "scout", report: false, tools: [quote] }],
  }
  let woke = null
  return {
    desk: { state: mkdtempSync(join(tmpdir(), "kt-")), workspace: "/tmp", start: async () => ({ desk: buildDesk(spec, { infer }), run: ({ wake }) => ((woke = wake), () => {}) }) },
    wake: (...a) => woke(...a),
  }
}

test("code desk as a team: registry, artifacts, a run, Live page fields", async () => {
  const fx = fixtureDesk()
  const team = await createKernelTeam({ desk: fx.desk, port: 0, live: false })
  const events = []
  const res = team.stream({ signal: new AbortController().signal })
  const reader = res.body.getReader()
  const first = JSON.parse(new TextDecoder().decode((await reader.read()).value).replace(/^data: /, ""))
  expect(first.registry.requiredId).toBe("lead")
  expect(first.registry.engines.length).toBe(2)
  expect(first.registry.engines.find((e) => e.id === "lead").agent.agents).toEqual(["scout"])
  expect(Object.keys(first.kernel.artifacts)).toEqual(expect.arrayContaining(["desk.board", "desk.schedule", "lead.checklist"]))
  expect(first.kernel.artifacts["desk.schedule"].brief).toBe("no next run booked")
  expect(first.kernel.tree.agents[0].tools).toEqual([{ name: "quote", type: "function" }])
  expect(first.states.lead.live).toBeUndefined() // 2026-10-17: no second copy of the desk's artifacts in the lead's state
  const booked = await team.call({ target: "desk", method: "schedule", args: [{ at: "2099-01-01T14:46:00Z", goal: "read the market" }] })
  expect(booked.value.goal).toBe("read the market")
  expect(fx.wake("rescan", "watch")).toBe(true)
  const answer = await team.call({ target: "lead", method: "ask", args: ["go"] })
  expect(answer.ok).toBe(true)
  for (;;) {
    const { value, done } = await Promise.race([reader.read(), Bun.sleep(50).then(() => ({ done: true }))])
    if (done) break
    for (const line of new TextDecoder().decode(value).split("\n\n")) if (line.startsWith("data: ")) events.push(JSON.parse(line.slice(6)))
  }
  const lead = events.filter((e) => e.id === "lead")
  expect(lead.some((e) => e.patch.status === "running")).toBe(true)
  expect(lead.some((e) => e.patch.activity?.calls?.[0]?.name === "scout")).toBe(true)
  const scoutMsgs = events.filter((e) => e.id === "scout").flatMap((e) => e.patch.messages?.items ?? [])
  const toolMsg = scoutMsgs.find((m) => m.role === "tool")
  expect(toolMsg.inputs).toEqual({ symbol: "GAMMA" })
  expect(toolMsg.output).toBe("GAMMA 217.4")
  expect(team.work()).toEqual([])
})

// Reads every event the stream sent until it goes quiet for 50 ms.
async function drain(reader) {
  const events = []
  for (;;) {
    const { value, done } = await Promise.race([reader.read(), Bun.sleep(50).then(() => ({ done: true }))])
    if (done) return events
    for (const line of new TextDecoder().decode(value).split("\n\n")) if (line.startsWith("data: ")) events.push(JSON.parse(line.slice(6)))
  }
}

test("every kernel element reaches the stream: definitions, tool views, refused answers, stats, the desk log", async () => {
  const script = {
    lead: [
      { thought: "too early", calls: [], answer: "done" }, // refused: the checklist is open
      { thought: "read", calls: [{ tool: "web.page", input: { url: "https://example.com" } }] },
      { thought: "tick", calls: [{ tool: "lead.checklist.tick", input: { id: "read", evidence: "page read" } }] },
      { thought: "done", calls: [], answer: "read it" },
    ],
  }
  const infer = async (_, agent) => JSON.stringify(script[agent.name]?.shift() ?? { thought: "done", calls: [], answer: "ok" })
  const page = new Tool({ name: "web.page", view: "web", description: "a page as text", input: { url: "the page" }, run: () => "Example Domain" })
  const spec = { name: "lead", team: "desk", role: "Read the page.\nThen answer.", report: false, folder: "/desks/d/agents/lead", tools: [page], artifacts: [(agent) => Object.assign(new Checklist({ id: `${agent.name}.checklist`, items: ["read: the page was read"] }), { owner: "desk", keep: "run" })] }
  const team = await createKernelTeam({
    desk: { name: "d", state: mkdtempSync(join(tmpdir(), "kt-")), folder: "/desks/d", start: async ({ log }) => (log("watch: 3 movers"), { desk: buildDesk(spec, { infer }) }) },
    port: 0,
    live: false,
  })
  const reader = team.stream({ signal: new AbortController().signal }).body.getReader()
  const first = JSON.parse(new TextDecoder().decode((await reader.read()).value).replace(/^data: /, ""))
  const lead = first.registry.engines[0].agent
  expect(lead.role).toBe("Read the page.\nThen answer.")
  expect(lead.folder).toBe("agents/lead")
  expect(lead.artifacts).toContain("lead.checklist")
  expect(lead.tools.find((t) => t.name === "web.page")).toEqual({ name: "web.page", type: "function", view: "web", description: "a page as text", input: { url: "the page" }, outside: true }) // its results count as outside reads (tool.js readsOutside)
  expect(lead.tools.find((t) => t.name === "lead.checklist.tick").view).toBe("checklist") // an artifact command draws as its artifact
  expect(first.log.map((l) => [l.source, l.text])).toContainEqual(["watch", "watch: 3 movers"])

  await team.call({ target: "lead", method: "ask", args: ["go"] })
  team.log("telegram: sent")
  const events = await drain(reader)
  const messages = events.filter((e) => e.id === "lead").flatMap((e) => e.patch.messages?.items ?? [])
  expect(messages.find((m) => m.action === "gate")).toMatchObject({ kind: "gate", content: expect.stringContaining("Answer refused") })
  expect(messages.find((m) => m.role === "tool" && m.name === "web.page").view).toBe("web")
  const stats = events.filter((e) => e.id === "lead" && e.patch.stats).at(-1).patch.stats
  expect(stats.calls).toBe(4)
  expect(stats.promptChars).toBeGreaterThan(0)
  expect(events.filter((e) => e.type === "log").map((e) => e.source)).toEqual(expect.arrayContaining(["desk", "telegram"]))
  team.terminate()
})

test("owner guidance: delivered to a running agent, seen at its next step, a thread row; idle, not delivered", async () => {
  let team
  let guided = null
  const prompts = []
  const script = [{ thought: "look", calls: [{ tool: "look", input: {} }] }, { thought: "owner: focus GAMMA", calls: [], answer: "GAMMA" }]
  const infer = async (prompt) => (prompts.push(prompt), JSON.stringify(script.shift() ?? { thought: "done", calls: [], answer: "ok" }))
  // The owner guides while the lead's first call runs.
  const look = new Tool({ name: "look", run: async () => ((guided = await team.call({ target: "lead", method: "guide", args: ["focus GAMMA"] })), "ACME BETA GAMMA") })
  const spec = { name: "lead", team: "desk", report: false, tools: [look] }
  team = await createKernelTeam({ desk: { name: "d", state: mkdtempSync(join(tmpdir(), "kt-")), start: async () => ({ desk: buildDesk(spec, { infer }) }) }, port: 0, live: false })
  const reader = team.stream({ signal: new AbortController().signal }).body.getReader()
  await reader.read() // the snapshot

  expect(await team.call({ target: "lead", method: "guide", args: ["too early"] })).toEqual({ ok: true, value: { delivered: false } })
  expect((await team.call({ target: "lead", method: "guide", args: ["  "] })).ok).toBe(false)
  expect((await team.call({ target: "lead", method: "ask", args: ["go"] })).value).toBe("GAMMA")
  expect(guided).toEqual({ ok: true, value: { delivered: true } })
  expect(prompts[1]).toContain("# OWNER GUIDANCE")
  expect(prompts[1]).toContain("> owner: focus GAMMA")

  const events = await drain(reader)
  const messages = events.filter((e) => e.id === "lead").flatMap((e) => e.patch.messages?.items ?? [])
  const row = messages.find((m) => m.kind === "guidance")
  expect(row).toMatchObject({ role: "user", kind: "guidance", from: "owner", content: "focus GAMMA" })
  // In the thread between the call it interrupted and the answer.
  expect(messages.indexOf(row)).toBeGreaterThan(messages.findIndex((m) => m.action === "tool"))
  expect(messages.indexOf(row)).toBeLessThan(messages.findIndex((m) => m.action === "answer"))
  expect(events.filter((e) => e.type === "log").map((e) => e.text)).toContain("desk: owner guides lead: focus GAMMA")
  team.terminate()
})

test("every desk gets its own folder in the memory folder at ASKK's root: memory/<desk>/ (ASKK_MEMORY moves it)", async () => {
  const root = mkdtempSync(join(tmpdir(), "desks-"))
  const before = process.env.ASKK_MEMORY
  process.env.ASKK_MEMORY = join(root, "mem")
  const seen = []
  try {
    for (const [name, memory] of [["alpha"], ["beta"], ["gamma", join(root, "own")]]) {
      const fx = fixtureDesk()
      const start = fx.desk.start
      const desk = { ...fx.desk, name, folder: join(root, "custom", name), ...(memory ? { memory } : {}), start: (opts) => (seen.push(opts.memory), start(opts)) }
      const team = await createKernelTeam({ desk, port: 0, live: false })
      team.terminate?.()
    }
  } finally {
    if (before === undefined) delete process.env.ASKK_MEMORY
    else process.env.ASKK_MEMORY = before
  }
  expect(seen).toEqual([join(root, "mem", "alpha"), join(root, "mem", "beta"), join(root, "own")])
})

test("the snapshot's definitions and artifact views are the kernel twins, in the fields the browser reads", async () => {
  const fx = fixtureDesk()
  const team = await createKernelTeam({ desk: fx.desk, port: 0, live: false })
  const reader = team.stream({ signal: new AbortController().signal }).body.getReader()
  const first = JSON.parse(new TextDecoder().decode((await reader.read()).value).replace(/^data: /, ""))
  const agent = first.registry.engines[0].agent
  expect(Object.keys(agent)).toEqual(expect.arrayContaining(["name", "description", "role", "folder", "tools", "agents", "artifacts", "model", "team", "kernel"]))
  expect(agent).toMatchObject({ name: "lead", team: "desk", folder: null, model: null, desk: null, kernel: true, agents: ["scout"] })
  expect(agent.artifacts).toEqual(["lead.checklist", "desk.schedule", "desk.board"])
  expect(agent.tools.find((t) => t.name === "scout")).toEqual({ name: "scout", type: "agent", view: "quest", description: "", input: expect.any(Object), agent: "scout" })
  expect(agent.tools.every((t) => !("element" in t) && !("id" in t))).toBe(true) // tool specs, as before
  const board = first.kernel.artifacts["desk.board"]
  expect(Object.keys(board)).toEqual(expect.arrayContaining(["id", "kind", "view", "owner", "title", "holders", "brief", "state"]))
  expect(board).toMatchObject({ id: "desk.board", kind: "board", view: "board", owner: "desk", holders: ["lead", "scout"], state: { goal: "find the trade", entries: {} } })
  expect(first.kernel.artifacts["lead.checklist"]).toMatchObject({ kind: "checklist", holders: ["lead"], brief: "0/1 done", keep: "run" })
  team.terminate()
})

test("work(): runs accepted but not started (waiting on ready(), or behind the agent's run) count as work", async () => {
  let openReady
  let openModel
  const readyGate = new Promise((r) => (openReady = r))
  const modelGate = new Promise((r) => (openModel = r))
  const infer = async () => (await modelGate, JSON.stringify({ thought: "done", calls: [], answer: "ok" }))
  const desk = { state: mkdtempSync(join(tmpdir(), "kt-")), workspace: "/tmp", start: async () => ({ desk: buildDesk({ name: "lead", report: false }, { infer }), ready: () => readyGate }) }
  const team = await createKernelTeam({ desk, port: 0, live: false })
  expect(team.send({ text: "first" }).ok).toBe(true)
  expect(team.send({ text: "second" }).ok).toBe(true)
  expect(team.work()).toEqual([
    { agent: "lead", lead: true, run: "first", step: "waiting to start", since: expect.any(String) },
    { agent: "lead", lead: true, run: "second", step: "waiting to start", since: expect.any(String) },
  ])
  openReady()
  await Bun.sleep(10)
  expect(team.work().map((w) => [w.run, w.step === "waiting to start"])).toEqual([["first", false], ["second", true]]) // second queues behind first
  openModel()
  for (let i = 0; i < 100 && team.work().length; i++) await Bun.sleep(5)
  expect(team.work()).toEqual([])
  team.terminate()
})

test("stop aborts every run of the agent: the one in progress and the ones queued behind it", async () => {
  let open
  const gate = new Promise((r) => (open = r))
  let calls = 0
  // Step 1 waits on the gate and calls a tool; step 2 would answer — reached only if the run was not stopped.
  const infer = async () => {
    const n = ++calls
    await gate
    return JSON.stringify(n > 1 ? { thought: "done", calls: [], answer: "ok" } : { thought: "look", calls: [{ tool: "look", input: {} }] })
  }
  const look = new Tool({ name: "look", run: () => "seen" })
  const kernel = buildDesk({ name: "lead", report: false, tools: [look] }, { infer })
  const events = []
  kernel.on((e) => events.push(e))
  const desk = { state: mkdtempSync(join(tmpdir(), "kt-")), workspace: "/tmp", start: async () => ({ desk: kernel }) }
  const team = await createKernelTeam({ desk, port: 0, live: false })
  team.send({ text: "first" })
  team.send({ text: "second" })
  for (let i = 0; i < 100 && !team.work().some((w) => w.run === "first" && w.step !== "waiting to start"); i++) await Bun.sleep(5)
  expect((await team.call({ target: "lead", method: "stop" })).ok).toBe(true)
  open()
  for (let i = 0; i < 100 && team.work().length; i++) await Bun.sleep(5)
  expect(team.work()).toEqual([])
  expect(events.filter((e) => e.event === "answer")).toEqual([]) // neither run answered
  expect(events.filter((e) => e.event === "error").map((e) => e.error)).toEqual(["stopped", "stopped"])
  expect(calls).toBe(1) // first's step 1 only: "second" never reached the model
  team.terminate()
})

// 2026-10-17: agents made at run time (agent.spawn → kernel Desk.spawn). The team is not fixed at start: a spawn reaches
// every tab as a registry event (with the new agent's state) and a kernel tree, its run streams state patches, its
// history.md records under state/spawned/<name>/; a dismiss takes it out again, with the artifacts only it held.
test("a spawned agent reaches every tab: registry with its state, the tree, its run, its history.md; dismissed, it leaves", async () => {
  const root = mkdtempSync(join(tmpdir(), "kt-spawn-"))
  const state = join(root, "state")
  mkdirSync(state)
  let release
  const hold = new Promise((r) => (release = r))
  const quest = { requirement: "the corpus is data/tiny.txt", ask: "how many tokens?", outcome: "the count" }
  const script = {
    lead: [
      { thought: "a helper", calls: [{ tool: "agent.spawn", input: { name: "counter", role: "Counts tokens.", goal: "count the corpus", tools: ["corpus.count"], artifacts: ["plan", "notes"], keep: "desk" } }] },
      { thought: "ask it", calls: [{ tool: "counter", input: quest }] },
      { thought: "done", calls: [], answer: "1200 tokens" },
      { thought: "let it go", calls: [{ tool: "agent.dismiss", input: { name: "counter" } }] },
      { thought: "done", calls: [], answer: "dismissed" },
    ],
    counter: [async () => (await hold, { thought: "count", calls: [{ tool: "corpus.count", input: { path: "data/tiny.txt" } }] }), { thought: "done", calls: [], answer: "1200" }],
  }
  const infer = async (_, agent) => {
    const next = script[agent.name].shift()
    return JSON.stringify(typeof next === "function" ? await next() : next)
  }
  const count = new Tool({ name: "corpus.count", description: "count tokens", input: { path: "file" }, run: ({ path }) => `${path}: 1200 tokens` })
  const plan = new Plan()
  // The lead's folder outside the desk's agents/: its keep: desk helper is recorded under state/spawned/ (a helper whose
  // spawner is in agents/ is written there as a kept agent.md — the next test).
  const spec = { name: "lead", team: "lab", report: false, folder: join(root, "lead"), artifacts: [plan], tools: [spawnTool(), dismissTool(), count, { type: "agent", name: "coder", report: false }] }
  const env = { infer, artifacts: { notes: (agent) => Object.assign(new Artifact({ name: `${agent.name}.notes` }), { keep: "always" }) } }
  const desk = { name: "lab", state, folder: root, start: async () => ({ desk: buildDesk(spec, env) }) }
  const team = await createKernelTeam({ desk, port: 0, live: true })
  const reader = team.stream({ signal: new AbortController().signal }).body.getReader()
  await reader.read() // the snapshot
  const controller = new AbortController()
  const mirrored = []
  const { view } = mirrorTeam(team, controller.signal, (e) => mirrored.push(e.type))
  expect(team.agents).toEqual(["lead", "coder"])

  const asked = team.call({ target: "lead", method: "ask", args: ["count the corpus"] })
  for (let i = 0; i < 100 && !team.work().some((w) => w.agent === "counter"); i++) await Bun.sleep(5)
  // While the helper runs, it is work (a desk reload waits for it) and it counts.
  expect(team.work().map((w) => w.agent)).toEqual(["lead", "counter"])
  expect(team.agents).toEqual(["lead", "coder", "counter"])
  release()
  expect((await asked).value).toBe("1200 tokens")
  const events = await drain(reader)

  // registry: the whole registry (the lead's definition now holds counter) and counter's state, before any patch of it.
  const reg = events.findIndex((e) => e.type === "registry")
  expect(reg).toBeGreaterThanOrEqual(0)
  const registry = events[reg]
  expect(registry.registry.engines.map((e) => e.id)).toEqual(["lead", "coder", "counter"])
  expect(registry.registry.engines.find((e) => e.id === "lead").agent.agents).toEqual(["coder", "counter"])
  const def = registry.registry.engines.find((e) => e.id === "counter").agent
  expect(def).toMatchObject({ name: "counter", role: "Counts tokens.", folder: join("state", "spawned", "counter"), team: "lab", spawned: { by: "lead", goal: "count the corpus", keep: "desk", at: expect.any(String) }, kernel: true, artifacts: ["plan", "counter.notes", "lab.board"] })
  expect(Object.keys(registry.states)).toEqual(["counter"])
  expect(registry.states.counter).toMatchObject({ status: "idle", messages: [], revision: 0 })
  expect(events.findIndex((e) => e.type === "state" && e.id === "counter")).toBeGreaterThan(reg)
  // kernel: the tree with the helper under its caller; the artifacts it now holds, sent again with their holders.
  const tree = events.find((e) => e.type === "kernel" && e.tree)
  expect(tree.tree.agents.map((n) => [n.name, n.spawned?.by ?? null])).toEqual([["coder", null], ["counter", "lead"]])
  const sent = events.filter((e) => e.type === "kernel" && e.artifact).map((e) => [e.artifact.id, e.artifact.holders])
  expect(sent).toContainEqual(["lab.board", ["lead", "coder", "counter"]])
  expect(sent).toContainEqual(["plan", ["lead", "counter"]])
  expect(sent).toContainEqual(["counter.notes", ["counter"]])
  // Its run streamed as any agent's: running, its call with inputs, its answer.
  const patches = events.filter((e) => e.type === "state" && e.id === "counter")
  expect(patches.some((e) => e.patch.status === "running")).toBe(true)
  const rows = patches.flatMap((e) => e.patch.messages?.items ?? [])
  expect(rows.find((m) => m.role === "tool")).toMatchObject({ name: "corpus.count", inputs: { path: "data/tiny.txt" }, output: "data/tiny.txt: 1200 tokens" })
  expect(rows.find((m) => m.action === "answer").content).toBe("1200")
  // The spawn call itself draws with view "spawn" in the lead's thread.
  const leadRows = events.filter((e) => e.id === "lead").flatMap((e) => e.patch.messages?.items ?? [])
  expect(leadRows.find((m) => m.role === "tool" && m.name === "agent.spawn")).toMatchObject({ view: "spawn", ok: true })
  // 2026-10-23: the spawn itself is a row in the spawner's thread (not only the tree and the log)
  expect(leadRows.find((m) => m.action === "lifecycle")).toMatchObject({ kind: "spawn", agent: "counter", content: "Spawned counter: count the corpus" })
  expect(leadRows.find((m) => m.role === "tool" && m.name === "agent.spawn").ms).toBeGreaterThanOrEqual(0)
  expect(events.filter((e) => e.type === "log").map((e) => e.text)).toContain("desk: lead spawned counter: count the corpus")
  // Its folder: an agent.md record of what it was made for, and its history.md beside it.
  const folder = join(state, "spawned", "counter")
  const md = readFileSync(join(folder, "agent.md"), "utf8")
  expect(md).toContain("by: lead")
  expect(md).toContain('goal: "count the corpus"')
  expect(md).toContain('tools: ["corpus.count"]')
  expect(md.endsWith("---\nCounts tokens.\n")).toBe(true)
  const runs = parseHistory(readFileSync(join(folder, "history.md"), "utf8"))
  expect(runs.map((r) => [r.from, r.answer])).toEqual([["lead", "1200"]])
  // A tab that connects now reads the helper in its snapshot; the server's own mirror (Telegram status) has it.
  const snap = JSON.parse(new TextDecoder().decode((await team.stream({ signal: new AbortController().signal }).body.getReader().read()).value).replace(/^data: /, ""))
  expect(snap.registry.engines.map((e) => e.id)).toEqual(["lead", "coder", "counter"])
  expect(snap.states.counter.status).toBe("idle")
  expect(snap.kernel.tree.agents.map((n) => n.name)).toEqual(["coder", "counter"])
  expect(mirrored).toContain("registry")
  expect(view.registry.agents.map((a) => a.name)).toEqual(["lead", "coder", "counter"])
  expect(view.states.counter.status).toBe("idle")
  expect(view.kernel.tree.agents.map((n) => n.name)).toEqual(["coder", "counter"])

  // Dismissed: out of the registry and the tree; the artifacts only it held leave; its folder stays.
  expect((await team.call({ target: "lead", method: "ask", args: ["let it go"] })).value).toBe("dismissed")
  const after = await drain(reader)
  const gone = after.find((e) => e.type === "registry")
  expect(gone.registry.engines.map((e) => e.id)).toEqual(["lead", "coder"])
  expect(gone.registry.engines[0].agent.agents).toEqual(["coder"])
  expect(gone.states).toEqual({})
  const pruned = after.find((e) => e.type === "kernel" && e.tree)
  expect(pruned.tree.agents.map((n) => n.name)).toEqual(["coder"])
  expect(pruned.removed).toEqual(["counter.notes"])
  expect(after.filter((e) => e.type === "kernel" && e.artifact).map((e) => [e.artifact.id, e.artifact.holders])).toContainEqual(["lab.board", ["lead", "coder"]])
  expect(after.filter((e) => e.type === "log").map((e) => e.text)).toContain("desk: lead dismissed counter")
  expect(after.filter((e) => e.id === "lead").flatMap((e) => e.patch.messages?.items ?? []).find((m) => m.action === "lifecycle")).toMatchObject({ kind: "dismiss", agent: "counter" })
  expect(team.agents).toEqual(["lead", "coder"])
  expect(existsSync(join(folder, "history.md"))).toBe(true)
  // 2026-10-23: the lead's runs keep their desk-event rows where they fell (history.md notes), each call's time too
  const leadRuns = parseHistory(readFileSync(join(root, "lead", "history.md"), "utf8"))
  expect(leadRuns[0].notes.map((n) => [n.row.action, n.row.kind, n.row.agent])).toEqual([["lifecycle", "spawn", "counter"]])
  expect(leadRuns[1].notes.map((n) => n.row.kind)).toEqual(["dismiss"])
  expect(leadRuns[0].steps[0].results[0].ms).toBeGreaterThanOrEqual(0)
  await Bun.sleep(20)
  expect(view.registry.agents.map((a) => a.name)).toEqual(["lead", "coder"])
  expect(view.states.counter).toBeUndefined()
  const fresh = JSON.parse(new TextDecoder().decode((await team.stream({ signal: new AbortController().signal }).body.getReader().read()).value).replace(/^data: /, ""))
  expect(Object.keys(fresh.states)).toEqual(["lead", "coder"])
  expect(fresh.kernel.artifacts["counter.notes"]).toBeUndefined()
  controller.abort()
  team.terminate()
})

// 2026-10-20 owner ("The agent might want to keep the sub-agents alive … written as .MD files in the same folder"): a
// keep: desk helper of an agent in the desk's agents/ is written as agents/<lead>/<name>/<name>.md (2026-10-21; its team's members
// as subfolders), its history.md beside it; a restart spawns it again with its runs; dismissed, the folder moves to
// memory/<desk>/archive/agents/.
test("a kept helper: its agent.md under its spawner's folder, back after a restart with its runs, archived when dismissed", async () => {
  const root = mkdtempSync(join(tmpdir(), "kt-kept-"))
  const state = join(root, "state")
  const memory = join(root, "memory", "lab")
  mkdirSync(state)
  const quest = (ask) => ({ requirement: "the corpus is data/tiny.txt", ask, outcome: "the count" })
  const count = new Tool({ name: "corpus.count", description: "count tokens", input: { path: "file" }, run: ({ path }) => `${path}: 1200 tokens` })
  const script = {
    lead: [
      { thought: "a kept team", calls: [{ tool: "agent.spawn", input: { name: "counter", role: "Counts tokens.", goal: "count the corpus", description: "counts the corpus", tools: ["corpus.count"], artifacts: ["notes"], model: "haiku", keep: "desk", members: [{ name: "checker", role: "Checks the sum.", tools: ["corpus.count"] }] } }] },
      { thought: "ask it", calls: [{ tool: "counter", input: quest("how many tokens?") }] },
      { thought: "done", calls: [], answer: "1200 tokens" },
    ],
    counter: [{ thought: "done", calls: [], answer: "1200" }],
  }
  const infer = async (_, agent) => JSON.stringify(script[agent.name]?.shift() ?? { thought: "d", calls: [], answer: "ok" })
  const build = () => buildDesk({ name: "lead", team: "lab", report: false, folder: join(root, "agents", "lead"), tools: [spawnTool(), dismissTool(), count] }, { infer, artifacts: { notes: (agent) => Object.assign(new Artifact({ name: `${agent.name}.notes` }), { keep: "always" }) } })
  const deskOf = () => ({ name: "lab", state, folder: root, memory, start: async () => ({ desk: build() }) })
  const team = await createKernelTeam({ desk: deskOf(), port: 0, live: true })
  expect((await team.call({ target: "lead", method: "ask", args: ["count the corpus"] })).value).toBe("1200 tokens")
  const folder = join(root, "agents", "lead", "counter")
  const md = readFileSync(join(folder, "counter.md"), "utf8")
  expect(md).toStartWith('---\nname: counter\ndescription: "counts the corpus"\ngoal: "count the corpus"\nkeep: desk\nby: lead\nat: "')
  expect(md).toContain('model: haiku\ntools: ["corpus.count"]\nartifacts: ["notes"]\nagents: ["checker"]\n---\nCounts tokens.\n')
  expect(readFileSync(join(folder, "checker", "checker.md"), "utf8")).toBe('---\nname: checker\nmember_of: counter\ntools: ["corpus.count"]\nartifacts: []\n---\nChecks the sum.\n')
  expect(parseHistory(readFileSync(join(folder, "history.md"), "utf8")).map((r) => r.answer)).toEqual(["1200"])
  expect(existsSync(join(state, "spawned", "counter"))).toBe(false)
  team.terminate()

  // A restart: the kept team is spawned again by its spawner, its runs restored from the history.md beside it.
  const again = await createKernelTeam({ desk: deskOf(), port: 0, live: true })
  expect(again.agents).toEqual(["lead", "counter", "checker"])
  const snap = JSON.parse(new TextDecoder().decode((await again.stream({ signal: new AbortController().signal }).body.getReader().read()).value).replace(/^data: /, ""))
  expect(snap.registry.engines.find((e) => e.id === "counter").agent).toMatchObject({ folder: join("agents", "lead", "counter"), model: "haiku", spawned: { by: "lead", keep: "desk", team: "counter" } })
  expect(snap.states.counter.messages.find((m) => m.action === "answer")?.content).toBe("1200")
  expect(snap.log.map((l) => l.text)).toContain("desk: kept helpers back: counter")
  expect(readFileSync(join(folder, "counter.md"), "utf8")).toBe(md) // rewritten as it was (its first time kept)

  // Dismissed for good: the folder (members inside) moves to memory/<desk>/archive/agents/.
  script.lead.push({ thought: "go", calls: [{ tool: "agent.dismiss", input: { name: "counter" } }] }, { thought: "done", calls: [], answer: "dismissed" })
  expect((await again.call({ target: "lead", method: "ask", args: ["let it go"] })).value).toBe("dismissed")
  expect(existsSync(folder)).toBe(false)
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date())
  const archived = join(memory, "archive", "agents", `${day}-counter`)
  expect(readFileSync(join(archived, "counter.md"), "utf8")).toBe(md)
  expect(existsSync(join(archived, "checker", "checker.md"))).toBe(true)
  again.terminate()
  const third = await createKernelTeam({ desk: deskOf(), port: 0, live: true })
  expect(third.agents).toEqual(["lead"])
  third.terminate()
})

// 2026-10-20 (kernel builtin/spawn.js): a keep: desk from a run that read the web is for that run only — nothing in
// agents/ until the owner accepts (team call target desk, accept | drop [{helper}]); then its agent.md is written as a
// kept spawn's. A kept helper's update from such a run waits on it; the owner's drop leaves its agent.md as it was.
test("a keep proposed by a run that read the web: no agent.md until the owner accepts; a proposed update dropped leaves it as kept", async () => {
  const root = mkdtempSync(join(tmpdir(), "kt-held-"))
  const state = join(root, "state")
  mkdirSync(state)
  const count = new Tool({ name: "corpus.count", description: "count tokens", input: { path: "file" }, run: ({ path }) => `${path}: 1200 tokens` })
  let kernel
  const infer = async () => JSON.stringify({ thought: "d", calls: [], answer: "ok" })
  const desk = { name: "lab", state, folder: root, memory: join(root, "memory", "lab"), start: async () => ({ desk: (kernel = buildDesk({ name: "lead", team: "lab", report: false, folder: join(root, "agents", "lead"), tools: [spawnTool(), dismissTool(), updateTool(), count] }, { infer })) }) }
  const team = await createKernelTeam({ desk, port: 0, live: true })
  const lead = kernel.lead
  const web = { agent: lead, outside: new Set(["web.read"]) }
  await spawnTool().run({ name: "counter", role: "Counts tokens.", goal: "count the corpus", tools: ["corpus.count"], keep: "desk", members: [{ name: "checker", role: "Checks the sum." }] }, web)
  const folder = join(root, "agents", "lead", "counter")
  expect(existsSync(folder)).toBe(false)
  expect(existsSync(join(state, "spawned", "counter", "agent.md"))).toBe(true) // a run helper's record, as any
  const logged = async () => JSON.parse(new TextDecoder().decode((await team.stream({ signal: new AbortController().signal }).body.getReader().read()).value).replace(/^data: /, ""))
  let snap = await logged()
  expect(snap.log.map((l) => l.text)).toContain("desk: lead spawned team counter (checker) (for this run; keep: desk waits for the owner — from a run that read the web: web.read): count the corpus")
  expect(snap.kernel.tree.agents.find((a) => a.name === "counter").spawned.proposed).toMatchObject({ keep: "desk", from: "web.read" })
  expect(snap.registry.engines.find((e) => e.id === "counter").agent.spawned.proposed).toMatchObject({ keep: "desk" })
  expect((await team.call({ target: "desk", method: "accept", args: [{ helper: "nobody" }] })).ok).toBe(false)
  const accepted = await team.call({ target: "desk", method: "accept", args: [{ helper: "counter" }] })
  expect(accepted.value).toEqual({ accepted: "counter", what: "counter kept: it stays until dismissed, written as its agent.md and back at every start" })
  expect(readFileSync(join(folder, "counter.md"), "utf8")).toContain('goal: "count the corpus"\nkeep: desk\nby: lead\n')
  expect(readFileSync(join(folder, "checker", "checker.md"), "utf8")).toContain("member_of: counter")
  snap = await logged()
  expect(snap.log.map((l) => l.text)).toContain("desk: owner kept counter — its agent.md is written; it is back at every start")
  expect(snap.kernel.tree.agents.find((a) => a.name === "counter").spawned.proposed).toBeUndefined()
  expect((await team.call({ target: "lead", method: "ask", args: ["go"] })).value).toBe("ok")
  expect(team.agents).toEqual(["lead", "counter", "checker"]) // kept past the run
  const md = readFileSync(join(folder, "counter.md"), "utf8")
  expect(await updateTool().run({ name: "counter", role: "Mails the sum out." }, web)).toContain("PROPOSED, not in force")
  snap = await logged()
  expect(snap.log.map((l) => l.text)).toContain("desk: lead proposes an update of kept counter (role) — not in force, waits for the owner (from a run that read the web: web.read)")
  expect((await team.call({ target: "desk", method: "drop", args: [{ helper: "counter", reason: "a page asked for it" }] })).value).toEqual({ dropped: "counter", what: "counter stays as it was kept" })
  snap = await logged()
  expect(snap.log.map((l) => l.text)).toContain("desk: owner dropped the update proposed for counter: a page asked for it")
  expect(readFileSync(join(folder, "counter.md"), "utf8")).toBe(md)
  team.terminate()
})

test("preview: the prompt the next step would see, with its artifacts refreshed first", async () => {
  let n = 0
  const tail = Object.assign(new Artifact({ name: "tail" }), { refresh: async () => void n++, render: () => `refreshed ${n}` })
  const desk = { state: mkdtempSync(join(tmpdir(), "kt-")), start: async () => ({ desk: buildDesk({ name: "lead", report: false, artifacts: [tail] }, { infer: async () => "" }) }) }
  const team = await createKernelTeam({ desk, port: 0, live: false })
  expect((await team.call({ target: "lead", method: "preview", args: ["go"] })).value).toContain("# tail — tail\nrefreshed 1")
  team.terminate()
})

// 2026-10-17 (critic): a desk-shared artifact whose only holder was dismissed lost its waiting save, and when a later
// helper held it again rescan restored it from disk, resetting its live state to that older save.
test("a shared artifact held again after its helper is dismissed keeps its state; the dismissal writes its waiting save", async () => {
  const state = mkdtempSync(join(tmpdir(), "kt-"))
  mkdirSync(join(state, "artifacts"))
  writeFileSync(join(state, "artifacts", "notes.json"), JSON.stringify({ id: "notes", day: "2026-01-01", state: { n: 0 } }))
  const notes = Object.assign(new Artifact({ name: "notes" }), { keep: "always", state: { n: 1 } }) // one per desk
  const kernel = buildDesk({ name: "lead", report: false }, { infer: async () => "", artifacts: { notes: () => notes } })
  const team = await createKernelTeam({ desk: { state, start: async () => ({ desk: kernel }) }, port: 0, live: false })
  const saved = () => JSON.parse(readFileSync(join(state, "artifacts", "notes.json"), "utf8")).state
  kernel.spawn({ name: "one", role: "r", goal: "g", keep: "desk", artifacts: ["notes"] }, kernel.lead)
  expect(notes.state).toEqual({ n: 0 }) // first held: read back from disk (keep: always)
  notes.state = { n: 2 }
  notes.changed() // its save waits out the debounce
  kernel.dismiss("one")
  expect(saved()).toEqual({ n: 2 }) // written when it left, not dropped
  notes.state = { n: 3 } // live state while nobody holds it
  kernel.spawn({ name: "two", role: "r", goal: "g", keep: "desk", artifacts: ["notes"] }, kernel.lead)
  expect(notes.state).toEqual({ n: 3 }) // held again: not reset to the last save
  notes.changed()
  await Bun.sleep(350)
  expect(saved()).toEqual({ n: 3 }) // and watched again
  team.terminate()
})

// 2026-10-17 (critic): the host's sanitiser (/[^\w.-]/) let ".." through, so a spawned ".." wrote its agent.md and
// transcript into state/. Desk.spawn refuses the name; the host makes no folder for one that arrives anyway.
test("a spawned agent whose name is not a spawn name gets no folder: nothing is written outside state/spawned/<name>/", async () => {
  const root = mkdtempSync(join(tmpdir(), "kt-name-"))
  const state = join(root, "state")
  mkdirSync(state)
  const kernel = buildDesk({ name: "lead", report: false }, { infer: async () => JSON.stringify({ thought: "d", calls: [], answer: "ok" }) })
  expect(() => kernel.spawn({ name: "..", role: "r", goal: "g" }, kernel.lead)).toThrow('name "..": lowercase letters, digits and -')
  let tap = null
  const on = kernel.on.bind(kernel)
  kernel.on = (fn) => ((tap = fn), on(fn)) // the host's listener, to emit a spawn Desk.spawn would refuse
  const team = await createKernelTeam({ desk: { name: "lab", state, folder: root, start: async () => ({ desk: kernel }) }, port: 0, live: true })
  const odd = buildAgent({ name: "..", role: "Escapes.", report: false }, kernel.ctx)
  odd.home = kernel
  tap({ event: "spawn", agent: "..", by: "lead", goal: "g", keep: "desk", at: Date.now() })
  expect(odd.config.folder).toBeUndefined()
  await odd.ask("go")
  expect(existsSync(join(state, "agent.md"))).toBe(false)
  expect(existsSync(join(state, "history.md"))).toBe(false)
  expect(existsSync(join(state, "spawned"))).toBe(false)
  const snap = JSON.parse(new TextDecoder().decode((await team.stream({ signal: new AbortController().signal }).body.getReader().read()).value).replace(/^data: /, ""))
  expect(snap.log.map((l) => l.text)).toContain('desk: ".." is not a spawn name: no folder, its runs are not recorded')
  expect(snap.registry.engines.map((e) => e.id)).toEqual(["lead", ".."]) // still streamed
  team.terminate()
})

// Polls `ok()` every 5 ms, up to 1 s.
const until = async (ok) => {
  for (let i = 0; i < 200 && !ok(); i++) await Bun.sleep(5)
  expect(ok()).toBe(true)
}

// 2026-10-17 owner ("I want to be able to talk with the lead to understand what is currently already there and what I
// want to check"): team/call chat is one model call beside the runs (kernel Agent.chat).
test("chat: the answer beside the runs — two chat rows, its model call in the stats; QUEUE: is a proposal the host never starts, GUIDE: reaches the run in progress; a failed chat fails", async () => {
  const root = mkdtempSync(join(tmpdir(), "kt-chat-"))
  const state = join(root, "state")
  const folder = join(root, "agents", "lead")
  mkdirSync(state)
  mkdirSync(folder, { recursive: true })
  let release
  const hold = new Promise((r) => (release = r))
  let looking = false
  const prompts = []
  const chats = ["Built: the tokenizer and a 2-layer model; val_bpb 1.41.\nQUEUE: check the loss curve of run r3", "Running step 1: reading the curve.\nGUIDE: compare r3 with r2", null]
  const steps = [{ thought: "look", calls: [{ tool: "look", input: {} }] }, { thought: "owner: compare r3 with r2", calls: [], answer: "r3 beats r2" }]
  const infer = async (prompt) => {
    prompts.push(prompt)
    if (!prompt.includes("# OWNER CHAT")) return JSON.stringify(steps.shift() ?? { thought: "done", calls: [], answer: "ok" })
    const reply = chats.shift()
    if (reply == null) throw new Error("model down")
    return reply
  }
  const look = new Tool({ name: "look", run: async () => ((looking = true), await hold, "r3 0.98, r2 1.02") })
  const spec = { name: "lead", team: "lab", report: false, folder, tools: [look] }
  const team = await createKernelTeam({ desk: { name: "lab", state, folder: root, start: async () => ({ desk: buildDesk(spec, { infer }) }) }, port: 0, live: true })
  const reader = team.stream({ signal: new AbortController().signal }).body.getReader()
  await reader.read() // the snapshot

  // Idle: the answer comes back, and its QUEUE: line is a proposal — never started by the host (2026-10-17 critic).
  expect(await team.call({ target: "lead", method: "chat", args: ["what is built?"] })).toEqual({ ok: true, value: { answer: "Built: the tokenizer and a 2-layer model; val_bpb 1.41.", guided: false, proposed: "check the loss curve of run r3" } })
  await Bun.sleep(30)
  expect(team.work()).toEqual([])
  expect(looking).toBe(false)
  // The owner starts it (the UI's "Queue it": a send of the proposal).
  team.send({ text: "check the loss curve of run r3" })
  await until(() => looking)
  expect(team.work()).toEqual([expect.objectContaining({ agent: "lead", run: "check the loss curve of run r3" })])
  // Running: the GUIDE: line reaches the run in progress; the chat's prompt showed that run and the earlier exchange.
  expect(await team.call({ target: "lead", method: "chat", args: ["what are you doing?", { from: "telegram" }] })).toEqual({ ok: true, value: { answer: "Running step 1: reading the curve.", guided: true, proposed: null } })
  const asked = prompts.filter((p) => p.includes("# OWNER CHAT")).at(-1)
  expect(asked).toContain("# REQUEST (from owner)\ncheck the loss curve of run r3")
  expect(asked).toContain("> owner: what is built?")
  expect(asked).toContain("> telegram: what are you doing?")
  expect(team.work()).toEqual([expect.objectContaining({ agent: "lead", run: "check the loss curve of run r3" })]) // a chat is never the request worked on
  // A chat whose model call throws fails, adds nothing; an empty one is refused before the model.
  expect(await team.call({ target: "lead", method: "chat", args: ["and now?"] })).toEqual({ ok: false, error: { message: "model down" } })
  expect(await team.call({ target: "lead", method: "chat", args: ["  "] })).toEqual({ ok: false, error: { message: "a chat needs text: what to ask the agent." } })
  release()
  await until(() => team.work().length === 0)

  const events = await drain(reader)
  const rows = events.filter((e) => e.id === "lead").flatMap((e) => e.patch.messages?.items ?? [])
  expect(rows.filter((m) => m.kind === "chat").map(({ id, at, ...m }) => m)).toEqual([
    { role: "user", kind: "chat", from: "owner", content: "what is built?" },
    { role: "assistant", kind: "chat", content: "Built: the tokenizer and a 2-layer model; val_bpb 1.41.", guided: false, proposed: "check the loss curve of run r3" },
    { role: "user", kind: "chat", from: "telegram", content: "what are you doing?" },
    { role: "assistant", kind: "chat", content: "Running step 1: reading the curve.", guided: true, proposed: null },
  ])
  // The guidance reached the run: its row, and the next step's prompt.
  expect(rows.find((m) => m.kind === "guidance")).toMatchObject({ role: "user", from: "telegram", content: "compare r3 with r2" })
  expect(prompts.find((p) => p.includes("# OWNER GUIDANCE") && !p.includes("# OWNER CHAT"))).toContain("> telegram: compare r3 with r2")
  expect(rows.find((m) => m.action === "answer").content).toBe("r3 beats r2")
  // `working` is the run's request row, never a chat's.
  const working = events.filter((e) => e.id === "lead" && e.patch.working).map((e) => rows.find((m) => m.id === e.patch.working.request))
  expect(working.map((m) => [m.kind, m.content])).toEqual([["request", "check the loss curve of run r3"]])
  // Two chats and two steps: four model calls.
  expect(events.filter((e) => e.id === "lead" && e.patch.stats).at(-1).patch.stats).toMatchObject({ calls: 4, promptChars: expect.any(Number) })
  const logs = events.filter((e) => e.type === "log").map((e) => e.text)
  for (const line of ["desk: owner asks lead: what is built?", "desk: lead proposes to owner (not started): check the loss curve of run r3", "desk: owner → lead: check the loss curve of run r3", "desk: telegram asks lead: what are you doing?", "desk: lead did not answer owner's chat (model down)"]) expect(logs).toContain(line)
  // The run's history row holds its own rows only (request, step, guidance, result): a restored thread keeps its times.
  const run = parseHistory(readFileSync(join(folder, "history.md"), "utf8")).at(-1)
  expect(run).toMatchObject({ request: "check the loss curve of run r3", answer: "r3 beats r2", guidance: [{ pos: 1, from: "telegram", text: "compare r3 with r2" }] })
  expect(run.times.length).toBe(4)
  team.terminate()
})

// 2026-10-17 critic: a chat in flight was outside stop and work(), and its late QUEUE:/GUIDE: line started a run after
// the owner's Stop.
test("chat in flight: listed in work() until it ends; stop reaches it (it fails \"stopped\"); its late reply starts nothing", async () => {
  const replies = []
  let releaseStep
  const stepHeld = new Promise((r) => (releaseStep = r))
  const runs = []
  const infer = (prompt) => {
    if (prompt.includes("# OWNER CHAT")) return new Promise((ok) => replies.push(ok))
    runs.push(prompt.match(/# REQUEST[^\n]*\n([^\n]*)/)?.[1])
    return stepHeld.then(() => JSON.stringify({ thought: "t", calls: [], answer: "done" }))
  }
  const team = await createKernelTeam({ desk: { name: "d", state: mkdtempSync(join(tmpdir(), "kt-chatstop-")), start: async () => ({ desk: buildDesk({ name: "lead", team: "desk", report: false, tools: [{ type: "agent", name: "coder", report: false }] }, { infer }) }) }, port: 0, live: false })
  const reader = team.stream({ signal: new AbortController().signal }).body.getReader()
  await reader.read()

  // Idle: a chat in flight is work (the lead's, then a member's), never a run.
  const first = team.call({ target: "lead", method: "chat", args: ["what is built?\nand what next?"] })
  const second = team.call({ target: "coder", method: "chat", args: ["are you busy?"] })
  await until(() => replies.length === 2)
  expect(team.work()).toEqual([
    { agent: "lead", lead: true, run: "(owner chat) what is built?", step: "answering the owner", since: expect.any(String) },
    { agent: "coder", lead: false, run: "(owner chat) are you busy?", step: "answering the owner", since: expect.any(String) },
  ])
  // The owner stops the lead: its chat ends "stopped"; the member's goes on.
  expect(await team.call({ target: "lead", method: "stop" })).toEqual({ ok: true, value: { stopped: 1 } })
  expect(await first).toEqual({ ok: false, error: { message: "stopped" } })
  expect(team.work().map((w) => w.agent)).toEqual(["coder"])
  // The stopped chat's reply arrives late with a QUEUE: line: no run starts.
  replies[0]("Built: the tokenizer.\nQUEUE: train the model")
  replies[1]("Idle.")
  expect(await second).toEqual({ ok: true, value: { answer: "Idle.", guided: false, proposed: null } })
  await Bun.sleep(30)
  expect(team.work()).toEqual([])
  expect(runs).toEqual([])

  // Running: the owner chats, then stops — the run and the chat; the chat's late GUIDE: line reaches nothing and starts
  // nothing.
  const asked = team.call({ target: "lead", method: "ask", args: ["first job"] })
  await until(() => runs.length === 1)
  const third = team.call({ target: "lead", method: "chat", args: ["please do the thing"] })
  await until(() => replies.length === 3)
  expect(team.work().map((w) => [w.agent, w.step])).toEqual([["lead", expect.any(String)], ["lead", "answering the owner"]])
  expect(await team.call({ target: "lead", method: "stop" })).toEqual({ ok: true, value: { stopped: 2 } })
  expect(await third).toEqual({ ok: false, error: { message: "stopped" } })
  releaseStep()
  expect(await asked).toEqual({ ok: false, error: { message: "stopped" } })
  replies[2]("I'll adjust.\nGUIDE: switch to plan B")
  await Bun.sleep(30)
  expect(team.work()).toEqual([])
  expect(runs).toEqual(["first job"])
  const events = await drain(reader)
  const rows = events.filter((e) => e.id === "lead").flatMap((e) => e.patch.messages?.items ?? [])
  expect(rows.some((m) => m.kind === "guidance" || m.kind === "chat")).toBe(false) // a stopped chat leaves no rows
  const logs = events.filter((e) => e.type === "log").map((e) => e.text)
  expect(logs).toContain("desk: owner stops lead: 1 owner chat stopped")
  expect(logs).toContain("desk: owner stops lead: 1 run and 1 owner chat stopped")
  expect(logs).toContain("desk: lead did not answer owner's chat (stopped)")
  team.terminate()
})

// 2026-10-17 critic: a live view froze while every holder waited (its refresh ran only before a holder's step). An artifact
// with a numeric `poll` is refreshed by the host while a tab is on the stream.
test("poll: an artifact with poll ms is refreshed with a holder while a tab is connected, never without one; a failure is one log line a minute; terminate ends it", async () => {
  const calls = []
  let fail = false
  class Gauge extends Artifact {
    poll = 20
    async refresh(agent) {
      calls.push(agent.name)
      if (fail) throw new Error("host down")
      this.state = { value: (this.state.value ?? 0) + 1 }
      this.changed()
    }
  }
  const gauge = Object.assign(new Gauge({ name: "desk.gauge" }), { keep: "run" })
  const quiet = Object.assign(new Gauge({ name: "desk.quiet" }), { keep: "run", poll: null }) // no poll: never refreshed by the host
  const infer = async () => JSON.stringify({ thought: "t", calls: [], answer: "ok" })
  const team = await createKernelTeam({ desk: { name: "d", state: mkdtempSync(join(tmpdir(), "kt-poll-")), start: async () => ({ desk: buildDesk({ name: "lead", team: "desk", report: false, artifacts: [gauge, quiet] }, { infer }) }) }, port: 0, live: false, pollMinMs: 10 })
  await Bun.sleep(80)
  expect(calls).toEqual([]) // no tab: no polls

  // The tab: every event it gets, read in the background (the polls keep the stream busy).
  const tab = new AbortController()
  const reader = team.stream({ signal: tab.signal }).body.getReader()
  const events = []
  ;(async () => {
    const decoder = new TextDecoder()
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ done: true }))
      if (done) return
      for (const line of decoder.decode(value).split("\n\n")) if (line.startsWith("data: ")) events.push(JSON.parse(line.slice(6)))
    }
  })()
  await until(() => calls.length >= 3)
  expect(new Set(calls)).toEqual(new Set(["lead"])) // its holder, though the lead takes no step
  await until(() => events.filter((e) => e.type === "kernel" && e.artifact?.id === "desk.gauge").length >= 3)
  const twins = events.filter((e) => e.type === "kernel" && e.artifact?.id === "desk.gauge").map((e) => e.artifact.state.value)
  expect(twins).toEqual([...twins].sort((a, b) => a - b)) // the twin follows every refresh
  expect(events.some((e) => e.type === "kernel" && e.artifact?.id === "desk.quiet")).toBe(false)

  // Failures: one desk-log line, however many polls fail within the minute.
  fail = true
  const failedFrom = calls.length
  await until(() => calls.length >= failedFrom + 4)
  const logs = events.filter((e) => e.type === "log").map((e) => e.text)
  expect(logs.filter((l) => l.startsWith("desk: desk.gauge refresh failed (host down)"))).toHaveLength(1)

  // The last tab gone: the polls stop.
  tab.abort()
  await Bun.sleep(30)
  const afterClose = calls.length
  await Bun.sleep(100)
  expect(calls.length).toBe(afterClose)

  // A tab again: polls again; terminate ends them even while the tab stays.
  fail = false
  const again = team.stream({ signal: new AbortController().signal }).body.getReader()
  await again.read()
  await until(() => calls.length > afterClose)
  team.terminate()
  await Bun.sleep(30)
  const afterTerminate = calls.length
  await Bun.sleep(100)
  expect(calls.length).toBe(afterTerminate)
})

// 2026-10-17: stop reached only the runs the host started; a member running its lead's quest went on.
test("stop reaches every run of the agent however it started: a member running its lead's quest stops (the lead goes on); the log counts the runs", async () => {
  let entered
  const inQuest = new Promise((r) => (entered = r))
  const lead = [{ thought: "ask", calls: [{ tool: "scout", input: { requirement: "r", ask: "names", outcome: "o" } }] }, { thought: "the scout stopped", calls: [], answer: "no names" }]
  // The scout's model never answers: only a stop ends its run.
  const infer = async (_, agent) => (agent.name === "scout" ? (entered(), new Promise(() => {})) : JSON.stringify(lead.shift() ?? { thought: "done", calls: [], answer: "ok" }))
  const kernel = buildDesk({ name: "lead", team: "desk", report: false, tools: [{ type: "agent", name: "scout", report: false }] }, { infer })
  const events = []
  kernel.on((e) => events.push(e))
  const team = await createKernelTeam({ desk: { state: mkdtempSync(join(tmpdir(), "kt-")), start: async () => ({ desk: kernel }) }, port: 0, live: false })
  const reader = team.stream({ signal: new AbortController().signal }).body.getReader()
  await reader.read()
  const asked = team.call({ target: "lead", method: "ask", args: ["go"] })
  await inQuest
  expect(team.work().map((w) => w.agent)).toEqual(["lead", "scout"])
  expect(await team.call({ target: "scout", method: "stop" })).toEqual({ ok: true, value: { stopped: 1 } })
  expect(await asked).toEqual({ ok: true, value: "no names" })
  expect(events.find((e) => e.event === "error" && e.agent === "scout").error).toBe("stopped")
  expect(events.find((e) => e.event === "result" && e.tool === "scout")).toMatchObject({ agent: "lead", ok: false, output: "stopped" })
  expect(await team.call({ target: "scout", method: "stop" })).toEqual({ ok: true, value: { stopped: 0 } })
  const logs = (await drain(reader)).filter((e) => e.type === "log").map((e) => e.text)
  expect(logs).toContain("desk: owner stops scout: 1 run stopped")
  expect(logs).toContain("desk: owner stops scout: nothing was running")
  team.terminate()
})

test("stop of a lead waiting on its quest ends both runs: the member's through the quest's signal", async () => {
  let entered
  const inQuest = new Promise((r) => (entered = r))
  const infer = async (_, agent) => (agent.name === "scout" ? (entered(), new Promise(() => {})) : JSON.stringify({ thought: "ask", calls: [{ tool: "scout", input: { requirement: "r", ask: "names", outcome: "o" } }] }))
  const kernel = buildDesk({ name: "lead", team: "desk", report: false, tools: [{ type: "agent", name: "scout", report: false }] }, { infer })
  const events = []
  kernel.on((e) => events.push(e))
  const team = await createKernelTeam({ desk: { state: mkdtempSync(join(tmpdir(), "kt-")), start: async () => ({ desk: kernel }) }, port: 0, live: false })
  const asked = team.call({ target: "lead", method: "ask", args: ["go"] })
  await inQuest
  team.send({ text: "next" }) // queued behind the run in progress: stopped too
  expect(await team.call({ target: "lead", method: "stop" })).toEqual({ ok: true, value: { stopped: 2 } })
  expect(await asked).toEqual({ ok: false, error: { message: "stopped" } })
  await until(() => team.work().length === 0)
  expect(events.filter((e) => e.event === "error").map((e) => [e.agent, e.error])).toEqual(expect.arrayContaining([["lead", "stopped"], ["scout", "stopped"]]))
  expect(events.some((e) => e.event === "answer")).toBe(false)
  team.terminate()
})

// 2026-10-17 owner ("let the lead, when required, be able to create a sub team"): a spawned team is one spawn event per
// agent (its lead first); every agent of it gets its state and folder, and leaves whole.
test("a team spawn: one registry event with every member's state, a folder each (agent.md with team:), its runs streamed and recorded; dismissed, every member's state goes", async () => {
  const root = mkdtempSync(join(tmpdir(), "kt-team-"))
  const state = join(root, "state")
  mkdirSync(state)
  const quest = (ask) => ({ requirement: "layer 3 is watched", ask, outcome: "one number" })
  const script = {
    lead: [
      { thought: "staff the probe", calls: [{ tool: "agent.spawn", input: { template: "probe", keep: "desk" } }] },
      { thought: "ask it", calls: [{ tool: "probe", input: quest("what moved?") }] },
      { thought: "done", calls: [], answer: "rms moved" },
      { thought: "let it go", calls: [{ tool: "agent.dismiss", input: { name: "probe" } }] },
      { thought: "done", calls: [], answer: "dismissed" },
    ],
    probe: [{ thought: "ask the watcher", calls: [{ tool: "probe-watcher", input: quest("what moved?") }] }, { thought: "done", calls: [], answer: "rms 1.2 → 1.9" }],
    "probe-watcher": [{ thought: "done", calls: [], answer: "rms 1.2 → 1.9" }],
  }
  const infer = async (_, agent) => JSON.stringify(script[agent.name].shift())
  const templates = { probe: { name: "probe", role: "Leads the probe.", goal: "watch layer 3", artifacts: ["notes"], members: [{ name: "watcher", role: "Watches." }, { name: "gauge", role: "Measures.", board: false }] } }
  const env = { infer, templates, artifacts: { notes: (agent) => Object.assign(new Artifact({ name: `${agent.name}.notes` }), { keep: "always" }) } }
  const spec = { name: "lead", team: "lab", report: false, folder: join(root, "lead"), tools: [spawnTool(), dismissTool(), { type: "agent", name: "coder", report: false }] }
  const team = await createKernelTeam({ desk: { name: "lab", state, folder: root, start: async () => ({ desk: buildDesk(spec, env) }) }, port: 0, live: true })
  const reader = team.stream({ signal: new AbortController().signal }).body.getReader()
  await reader.read()

  expect((await team.call({ target: "lead", method: "ask", args: ["watch layer 3"] })).value).toBe("rms moved")
  const events = await drain(reader)
  // One registry event: the whole team, each agent with its state.
  const registries = events.filter((e) => e.type === "registry")
  expect(registries.length).toBe(1)
  expect(registries[0].registry.engines.map((e) => e.id)).toEqual(["lead", "coder", "probe", "probe-watcher", "probe-gauge"])
  expect(Object.keys(registries[0].states)).toEqual(["probe", "probe-watcher", "probe-gauge"])
  expect(registries[0].registry.engines.find((e) => e.id === "probe-watcher").agent).toMatchObject({ folder: join("state", "spawned", "probe-watcher"), spawned: { by: "probe", team: "probe" } })
  expect(team.agents).toEqual(["lead", "coder", "probe", "probe-watcher", "probe-gauge"])
  // Its tree, its board (the gauge off it), the log line.
  expect(events.find((e) => e.type === "kernel" && e.tree).tree.agents.map((n) => [n.name, n.agents.map((m) => m.name)])).toEqual([["coder", []], ["probe", ["probe-watcher", "probe-gauge"]]])
  expect(events.filter((e) => e.type === "kernel" && e.artifact).map((e) => [e.artifact.id, e.artifact.holders])).toContainEqual(["probe.board", ["probe", "probe-watcher"]])
  expect(events.filter((e) => e.type === "log").map((e) => e.text)).toContain("desk: lead spawned team probe (probe-watcher, probe-gauge): watch layer 3")
  // A folder each: agent.md with team: (the lead's with its members); the member's run streamed and recorded there.
  const md = (name) => readFileSync(join(state, "spawned", name, "agent.md"), "utf8")
  expect(md("probe")).toContain("by: lead\n")
  expect(md("probe")).toContain("team: probe\nmembers: [\"probe-watcher\", \"probe-gauge\"]\n")
  expect(md("probe")).toContain('artifacts: ["probe.notes", "probe.board"]')
  expect(md("probe-watcher")).toContain("by: probe\n")
  expect(md("probe-watcher")).toContain('goal: "watch layer 3"\nkeep: desk\n')
  expect(md("probe-watcher")).toContain("team: probe\n")
  expect(md("probe-gauge").endsWith("---\nMeasures.\n")).toBe(true)
  const watcherRows = events.filter((e) => e.type === "state" && e.id === "probe-watcher").flatMap((e) => e.patch.messages?.items ?? [])
  expect(watcherRows.map((m) => [m.kind ?? m.action, m.from ?? null])).toEqual([["quest", "probe"], ["answer", null]])
  expect(parseHistory(readFileSync(join(state, "spawned", "probe-watcher", "history.md"), "utf8")).map((r) => r.from)).toEqual(["probe"])

  // Dismissed whole: one agent per event, its members first; every state goes, the team's artifacts leave.
  expect((await team.call({ target: "lead", method: "ask", args: ["let it go"] })).value).toBe("dismissed")
  const after = await drain(reader)
  const gone = after.filter((e) => e.type === "registry")
  expect(gone.map((e) => e.registry.engines.map((x) => x.id))).toEqual([
    ["lead", "coder", "probe", "probe-gauge"],
    ["lead", "coder", "probe"],
    ["lead", "coder"],
  ])
  expect(after.filter((e) => e.type === "kernel" && e.removed).flatMap((e) => e.removed).sort()).toEqual(["probe.board", "probe.notes"])
  expect(after.filter((e) => e.type === "log").map((e) => e.text)).toEqual(expect.arrayContaining(["desk: probe dismissed probe-watcher", "desk: probe dismissed probe-gauge", "desk: lead dismissed probe"]))
  const fresh = JSON.parse(new TextDecoder().decode((await team.stream({ signal: new AbortController().signal }).body.getReader().read()).value).replace(/^data: /, ""))
  expect(Object.keys(fresh.states)).toEqual(["lead", "coder"])
  expect(Object.keys(fresh.kernel.artifacts).filter((id) => id.startsWith("probe"))).toEqual([])
  expect(team.agents).toEqual(["lead", "coder"])
  team.terminate()
})

test("2026-10-17 the owner's open, back and rerun on the preview route through team/call target artifact, awaited (files read, a script run), never a run", async () => {
  const tok = (t) => JSON.stringify({ kind: "steps", steps: [`token ${t}`] })
  let host
  host = fakeHost({
    files: { "projects/x/out/tok/0.json": tok(0), "projects/x/out/tok/1.json": tok(1), "projects/x/out/trace.json": JSON.stringify({ kind: "tokens", tokens: [{ text: "a", open: { id: "tok", params: { t: 1 } } }] }), "projects/x/ckpt/a.safetensors": "w" },
    onStart: (body) => {
      const t = /--t (\S+)/.exec(body.command)?.[1]
      if (t != null) host.fs.set(`projects/x/out/tok/${t}.json`, tok(t))
      return { status: "exited", exit: 0, lines: ["ok"] }
    },
  })
  const preview = new Preview({ clock: () => new Date("2026-10-17T23:30:00Z") })
  let desk = null
  const infer = async () => JSON.stringify({ thought: "done", calls: [], answer: "ok" })
  const spec = { name: "lead", report: false, writes: ["projects/x/out/**"], reads: ["projects/x/**"], artifacts: [preview] }
  const deskSpec = { state: mkdtempSync(join(tmpdir(), "kt-drill-")), workspace: "/tmp", start: async () => ({ desk: (desk = buildDesk(spec, { infer, context: { host } })) }) }
  const team = await createKernelTeam({ desk: deskSpec, port: 0, live: false })
  const lead = desk.lead
  const show = (input) => lead.tools.get("preview.show").run(input, { ...lead.context, agent: lead })
  await show({ id: "trace", title: "Trace", visual: { file: "projects/x/out/trace.json" } })
  await show({ id: "tok", title: "Token", visual: { file: "projects/x/out/tok/{t}.json", params: { t: 0 } }, bind: { command: "python trace.py --t {t}", watch: ["projects/x/ckpt/*.safetensors"] } })
  await lead.tools.get("preview.focus").run({ id: "trace" }, { ...lead.context, agent: lead })
  const call = (method, arg = {}) => team.call({ target: "artifact", method, args: [{ id: "preview", ...arg }] })
  // open: the file for those params read before the answer comes back
  const opened = await call("open", { visual: "tok", params: { t: 1 } })
  expect(opened).toEqual({ ok: true, value: { current: { kind: "visual", id: "tok", params: { t: "1" } }, trail: [{ kind: "visual", id: "trace" }] } })
  expect(preview.state.visuals.find((v) => v.id === "tok").visual).toMatchObject({ file: "projects/x/out/tok/1.json", steps: [{ title: "token 1" }] })
  // open for params whose file is missing: its bound script runs, then the file is read — all before the answer
  await call("open", { visual: "tok", params: { t: 5 } })
  expect(host.calls.filter((c) => c.path === "term/start").map((c) => c.body.command)).toEqual(["python trace.py --t 5"])
  expect(preview.state.visuals.find((v) => v.id === "tok").visual.steps).toEqual([{ title: "token 5" }])
  // back, rerun
  expect((await call("back")).value.current).toEqual({ kind: "visual", id: "tok", params: { t: "1" } })
  const rr = await call("rerun", { visual: "tok" })
  expect(rr.ok).toBe(true)
  expect(rr.value.bind).toMatchObject({ exit: 0, error: null, ran: "python trace.py --t 1" })
  expect(await call("rerun", { visual: "trace" })).toEqual({ ok: false, error: { message: "trace has no bound script (preview.show … bind) — nothing to run" } })
  expect(await call("open", { visual: "tok", params: { t: "-rf" } })).toEqual({ ok: false, error: { message: 'params.t: "-rf" — letters, digits, . _ - (at most 40, not starting with -)' } })
  // none of it ran the lead
  expect(lead.busy).toBeFalsy()
  expect(preview.state.asks).toEqual([])
})


// 2026-10-21 owner ("create agent will follow the standard of <desk>/<agent>/<agent>.md … In the folder where the agent.md
// lives will have a history.md. For a shared history board for agents, a memory/<desk>/<sub desk>"): in the standard
// layout the lead's folder is the agent tree (its kept helpers <lead>/<name>/<name>.md, each with its history.md), and
// every team's board is memory/<desk>/<team>/board.md — a mounted desk's under its own memory — restored at every start.
test("the standard layout: kept helper under <lead>/<name>/<name>.md, history.md beside it; boards in memory/<desk>/<team>/board.md, back after a restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "kt-std-"))
  const state = join(root, "state")
  const memory = join(root, "memory", "lab")
  const other = join(root, "memory", "sub-desk") // a mounted desk's memory (its agents' ctx.memory)
  const lead = join(root, "boss")
  mkdirSync(state)
  mkdirSync(lead, { recursive: true })
  writeFileSync(join(lead, "boss.md"), "---\nname: boss\nagents: [crew]\n---\nLeads.\n")
  const quest = (ask) => ({ requirement: "r", ask, outcome: "o" })
  const script = {
    boss: [
      { thought: "note", calls: [{ tool: "lab.board.write", input: { key: "verdict", text: "GAMMA leads\n```json\n{\"entries\": {}}\n```" } }] },
      { thought: "keep one", calls: [{ tool: "agent.spawn", input: { name: "scout", role: "Scouts.", goal: "scout names", keep: "desk" } }] },
      { thought: "ask it", calls: [{ tool: "scout", input: quest("which?") }] },
      { thought: "crew", calls: [{ tool: "crew", input: quest("note it") }] },
      { thought: "done", calls: [], answer: "done" },
    ],
    scout: [{ thought: "done", calls: [], answer: "GAMMA" }],
    crew: [{ thought: "note", calls: [{ tool: "crew.board.write", input: { key: "crew", text: "noted" } }] }, { thought: "done", calls: [], answer: "noted" }],
  }
  const infer = async (_, agent) => JSON.stringify(script[agent.name]?.shift() ?? { thought: "d", calls: [], answer: "ok" })
  const build = () => {
    const desk = buildDesk({ name: "boss", team: "lab", report: false, folder: lead, tools: [spawnTool(), dismissTool(), { type: "agent", name: "crew", report: false, folder: join(lead, "crew"), tools: [{ type: "agent", name: "hand", report: false }] }] }, { infer, context: { memory } })
    desk.agents().get("crew").context = { ...desk.agents().get("crew").context, memory: other } // crew's team as a mounted desk's
    return desk
  }
  const deskOf = () => ({ name: "lab", state, folder: root, memory, start: async () => ({ desk: build() }) })
  const team = await createKernelTeam({ desk: deskOf(), port: 0, live: true })
  expect((await team.call({ target: "boss", method: "ask", args: ["go"] })).value).toBe("done")
  await Bun.sleep(400) // the 300 ms save debounce
  team.terminate()
  // The kept helper: <lead>/scout/scout.md, its runs in history.md beside it; the lead's history.md beside boss.md.
  expect(readFileSync(join(lead, "scout", "scout.md"), "utf8")).toContain("name: scout\ndescription: \"Scouts.\"\ngoal: \"scout names\"\nkeep: desk\nby: boss\n")
  expect(parseHistory(readFileSync(join(lead, "scout", "history.md"), "utf8")).map((r) => r.answer)).toEqual(["GAMMA"])
  expect(parseHistory(readFileSync(join(lead, "history.md"), "utf8")).map((r) => r.answer)).toEqual(["done"])
  // The boards: readable markdown, the state in its json block; none in state/artifacts.
  const board = readFileSync(join(memory, "lab", "board.md"), "utf8")
  expect(board).toContain("## verdict — boss · ")
  expect(board).toContain("> GAMMA leads\n> ```json\n")
  expect(readFileSync(join(other, "crew", "board.md"), "utf8")).toContain("## crew — crew · ")
  expect(existsSync(join(state, "artifacts", "lab.board.json"))).toBe(false)
  expect(existsSync(join(state, "artifacts", "crew.board.json"))).toBe(false)
  // A restart the same day: the boards and the kept helper come back.
  const again = await createKernelTeam({ desk: deskOf(), port: 0, live: true })
  const snap = JSON.parse(new TextDecoder().decode((await again.stream({ signal: new AbortController().signal }).body.getReader().read()).value).replace(/^data: /, ""))
  again.terminate()
  expect(again.agents).toEqual(["boss", "crew", "hand", "scout"])
  expect(snap.kernel.artifacts["lab.board"].state.entries.verdict).toMatchObject({ author: "boss", text: "GAMMA leads\n```json\n{\"entries\": {}}\n```" })
  expect(snap.kernel.artifacts["crew.board"].state.entries.crew).toMatchObject({ author: "crew", text: "noted" })
  expect(snap.states.scout.messages.find((m) => m.action === "answer")?.content).toBe("GAMMA")
  // A day board from an earlier day (2026-10-21 review: days-old entries flowed into every prompt): filed under
  // <team>/boards/<day>.md as history, and the board starts fresh.
  const md = readFileSync(join(memory, "lab", "board.md"), "utf8").replace(/"at":"[^"]+"/, '"at":"2026-10-01T15:00:00.000Z"')
  writeFileSync(join(memory, "lab", "board.md"), md)
  const third = await createKernelTeam({ desk: deskOf(), port: 0, live: true })
  const snap3 = JSON.parse(new TextDecoder().decode((await third.stream({ signal: new AbortController().signal }).body.getReader().read()).value).replace(/^data: /, ""))
  third.terminate()
  expect(snap3.kernel.artifacts["lab.board"].state.entries).toEqual({})
  expect(readFileSync(join(memory, "lab", "boards", "2026-10-01.md"), "utf8")).toContain("## verdict — boss · ")
  // Migration: a board saved before board.md (state/artifacts/<id>.json) comes back once — only from today.
  rmSync(join(memory, "lab", "board.md"), { force: true })
  mkdirSync(join(state, "artifacts"), { recursive: true })
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date())
  const old = (day, text) => JSON.stringify({ id: "lab.board", kind: "board", day, state: { goal: "", entries: { old: { author: "boss", text, at: "2026-10-01T14:00:00.000Z" } } } })
  writeFileSync(join(state, "artifacts", "lab.board.json"), old("2026-10-01", "from before"))
  const fourth = await createKernelTeam({ desk: deskOf(), port: 0, live: true })
  const snap4 = JSON.parse(new TextDecoder().decode((await fourth.stream({ signal: new AbortController().signal }).body.getReader().read()).value).replace(/^data: /, ""))
  fourth.terminate()
  expect(snap4.kernel.artifacts["lab.board"].state.entries.old).toBeUndefined()
  rmSync(join(memory, "lab", "board.md"), { force: true })
  writeFileSync(join(state, "artifacts", "lab.board.json"), old(today, "from today"))
  const fifth = await createKernelTeam({ desk: deskOf(), port: 0, live: true })
  const snap5 = JSON.parse(new TextDecoder().decode((await fifth.stream({ signal: new AbortController().signal }).body.getReader().read()).value).replace(/^data: /, ""))
  fifth.terminate()
  expect(snap5.kernel.artifacts["lab.board"].state.entries.old.text).toBe("from today")
})
