import { expect, test } from "bun:test"
import { agentVisual, teamStatus } from "./desk.js"
import { CALL_KINDS, callLook } from "./visual.js"

test("engine state → visual state and bubble message", () => {
  const run = (activity, extra = {}) => agentVisual({ status: "running", activity, messages: [], ...extra }, ["world", "hunt"])
  expect(run({ phase: "llm", stage: "waiting" }).state).toBe("llm")
  expect(run({ phase: "tool", name: "market.quote" })).toMatchObject({ state: "tool", message: "Calling market.quote", active: ["market.quote"] })
  expect(run({ phase: "waiting", names: ["world", "hunt"] })).toMatchObject({ state: "waiting", message: "Waiting for world, hunt" })
  expect(run({ phase: "tools", names: ["world", "hunt"] }).state).toBe("quest")
  expect(agentVisual({ status: "error", error: "boom", activity: {} }).state).toBe("error")
  expect(agentVisual({ status: "idle", activity: { phase: "idle" }, messages: [{ action: "answer", content: "NO TRADE" }] })).toMatchObject({ state: "done", message: "NO TRADE" })
  expect(agentVisual(null).state).toBe("idle")
})

test("team status", () => {
  expect(teamStatus([{ status: "running" }, null])).toBe("working")
  expect(teamStatus([{ status: "idle", messages: [{ action: "answer" }] }])).toBe("reported")
})

test("current quest: the working request, else the last incoming", async () => {
  const { currentQuest } = await import("./desk.js")
  const messages = [{ id: "a", role: "user", content: "old", from: "lead" }, { id: "b", role: "assistant", action: "answer", content: "x" }, { id: "c", role: "user", content: "new", from: "lead" }]
  expect(currentQuest({ messages, working: { request: "a" } })).toMatchObject({ text: "old", active: true })
  expect(currentQuest({ messages, working: null })).toMatchObject({ text: "new", from: "lead", active: false })
  expect(currentQuest({ messages: [] })).toBeNull()
})

test("every artifact sits on a card: its team's, else its first holder's", async () => {
  const { artifactsFor } = await import("./desk.js")
  const artifacts = {
    "desk.board": { id: "desk.board", owner: "desk", view: "board", holders: ["lead"] },
    "lead.checklist": { id: "lead.checklist", owner: "desk", view: "checklist", holders: ["lead"] },
    "market.memory": { id: "market.memory", owner: "market", view: "text", holders: ["market", "macro"] },
    "book.memory": { id: "book.memory", owner: "book", view: "text", holders: ["keeper", "critic"] },
  }
  const teams = new Set(["desk", "market"])
  const cards = [
    { team: "desk", lead: "lead" },
    { team: "market", lead: "market" },
    { team: "keeper", lead: "keeper" }, // a lone agent: no team of its own
  ].map((c) => artifactsFor(artifacts, { ...c, teams }).map((a) => a.id))
  expect(cards[2]).toEqual(["book.memory"])
  expect(new Set(cards.flat())).toEqual(new Set(Object.keys(artifacts)))
})

test("a spawn or dismiss call has its own look (2026-10-17: agent.spawn / agent.dismiss, view spawn)", () => {
  expect(callLook({ type: "spawn", view: "spawn", name: "agent.spawn" })).toEqual({ kind: "spawn", tone: "pink", icon: "user-plus" })
  expect(callLook({ kind: "tool", view: "spawn", name: "agent.dismiss" }).kind).toBe("spawn")
  expect(callLook({ kind: "agent", view: "quest", name: "counter" }).kind).toBe("quest") // the helper itself is quested
  expect(CALL_KINDS).toContain("spawn")
  expect(callLook({ name: "talk.ask", type: "dev", view: "talk" })).toEqual({ kind: "talk", tone: "rose", icon: "messages-square" })
})

test("current quest: an owner chat is not a run's request (2026-10-17: kind chat)", async () => {
  const { currentQuest } = await import("./desk.js")
  const messages = [
    { id: "a", role: "user", content: "train the base" },
    { id: "b", role: "user", kind: "chat", from: "owner", content: "what runs now?" },
    { id: "c", role: "assistant", kind: "chat", content: "the trainer" },
    { id: "d", role: "user", kind: "guidance", content: "use the gpu lease" },
  ]
  expect(currentQuest({ messages })).toMatchObject({ text: "train the base", active: false })
  expect(currentQuest({ messages: messages.slice(1) })).toBeNull()
})

// A desk after the lead spawned team "model" (members architect, layers) and "model" a layer sub-team.
const spawnedTree = {
  name: "lead",
  team: "lead",
  agents: [
    { name: "planner", agents: [] },
    {
      name: "model",
      team: "model",
      title: "model board",
      agents: [
        { name: "model-architect", agents: [] },
        { name: "layer", team: "layer", agents: [{ name: "layer-probe", agents: [] }] },
      ],
    },
  ],
}

test("cardRows: a spawned team's members are its card's rows, a sub-team's indented under its lead", async () => {
  const { cardRows } = await import("./desk.js")
  const model = spawnedTree.agents[1]
  expect(cardRows(model).map((r) => [r.name, r.depth, r.lead])).toEqual([
    ["model-architect", 0, false],
    ["layer", 0, true],
    ["layer-probe", 1, false],
  ])
  expect(cardRows(spawnedTree.agents[0])).toEqual([])
  expect(cardRows(null)).toEqual([])
})

test("cardArtifacts: a team card has its board, and every nested sub-team's board", async () => {
  const { cardArtifacts } = await import("./desk.js")
  const artifacts = {
    "lead.board": { id: "lead.board", owner: "lead", view: "board", holders: ["lead"] },
    "model.board": { id: "model.board", owner: "model", view: "board", holders: ["model", "model-architect", "layer"] },
    "layer.board": { id: "layer.board", owner: "layer", view: "board", holders: ["layer", "layer-probe"] },
    plan: { id: "plan", owner: null, view: "checklist", holders: ["lead", "model"] },
    dispatch: { id: "dispatch", owner: null, view: "dispatch", holders: ["lead"] },
  }
  const teams = new Set(["lead", "model", "layer"])
  expect(cardArtifacts(artifacts, spawnedTree.agents[1], { teams }).map((a) => a.id)).toEqual(["model.board", "layer.board"]) // its own first
  // the lead's card: its board and the kit's plan and dispatch (no owner: on their first holder's card), reading order
  const { artifactsFor } = await import("./desk.js")
  expect(artifactsFor(artifacts, { team: "lead", lead: "lead", teams }).map((a) => a.id)).toEqual(["plan", "dispatch", "lead.board"])
})

test("dispatchRows: running first (longest on top), then ended newest first; elapsed or how long it took", async () => {
  const { dispatchRows, elapsedText } = await import("./desk.js")
  const now = Date.parse("2026-10-17T12:30:00Z")
  const state = {
    jobs: [
      { id: "j1", to: "data", by: "lead", ask: "curate\n the  shard", status: "done", startedAt: "2026-10-17T12:00:00Z", endedAt: "2026-10-17T12:12:04Z", report: "shard ready" },
      { id: "j2", to: "model", by: "lead", ask: "size the ladder", status: "running", startedAt: "2026-10-17T12:20:00Z" },
      { id: "j3", to: "eval", by: "lead", ask: "bpb", status: "failed", startedAt: "2026-10-17T12:05:00Z", endedAt: "2026-10-17T12:25:00Z", error: "no checkpoint" },
      { id: "j4", to: "training", by: "lead", ask: "train", status: "running", startedAt: "2026-10-17T11:30:00Z" },
    ],
  }
  const rows = dispatchRows(state, { now })
  expect(rows.map((r) => `${r.id} ${r.status} ${r.elapsed}`)).toEqual(["j4 running 1h00m", "j2 running 10m00s", "j3 failed 20m00s", "j1 done 12m04s"])
  expect(rows[3]).toMatchObject({ ask: "curate the shard", report: "shard ready", endedAt: "2026-10-17T12:12:04Z", running: false })
  expect(rows[2].error).toBe("no checkpoint")
  expect(dispatchRows(null)).toEqual([])
  expect([elapsedText(45000), elapsedText(724000), elapsedText(3720000), elapsedText(NaN)]).toEqual(["45s", "12m04s", "1h02m", ""])
})

test("teamTitle: a title of its own, else the team (not the kernel's default \"<team> board\"), else the name", async () => {
  const { teamTitle } = await import("./desk.js")
  expect(teamTitle({ name: "market", team: "market", title: "Market read" })).toBe("Market read")
  expect(teamTitle({ name: "model", team: "model", title: "model board" })).toBe("model")
  expect(teamTitle({ name: "planner", team: null, title: null })).toBe("planner")
  expect(teamTitle(null)).toBe("")
})

test("stopDispatchJob: the owner stops one job — team call target artifact, method stop, args [{id, job}] (amendment M3)", async () => {
  const { stopDispatchJob } = await import("./desk.js")
  const realFetch = globalThis.fetch
  const calls = []
  let reply = { ok: true, value: { stopped: "j2" } }
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return new Response(JSON.stringify(reply), { headers: { "content-type": "application/json" } })
  }
  try {
    expect(await stopDispatchJob("dispatch", "j2")).toEqual({ stopped: "j2" })
    expect(calls).toEqual([{ url: "/__askk/team/call", body: { target: "artifact", method: "stop", args: [{ id: "dispatch", job: "j2" }] } }])
    reply = { ok: false, error: { message: "no job j9" } }
    await expect(stopDispatchJob("dispatch", "j9")).rejects.toThrow("no job j9")
  } finally {
    globalThis.fetch = realFetch
  }
})

test("heldTiles: an agent's live tiles — less the desk-wide ones every agent holds and the card's own; the preview first", async () => {
  const { heldTiles } = await import("./desk.js")
  const artifacts = {
    files: { id: "files", view: "files", holders: ["lead", "coder", "critic"] },
    preview: { id: "preview", view: "preview", holders: ["lead", "coder"] },
    plan: { id: "plan", view: "checklist", holders: ["lead", "coder"] },
    "dev.board": { id: "dev.board", owner: "dev", view: "board", holders: ["lead", "coder"] },
    stage: { id: "stage", view: "stage", holders: ["lead"] }, // an old one (before the restart): a tile like any other
  }
  expect(heldTiles(artifacts, "coder", { everyone: 3 }).map((a) => a.id)).toEqual(["preview", "plan", "dev.board"])
  expect(heldTiles(artifacts, "coder", { everyone: 3, skip: ["dev.board"] }).map((a) => a.id)).toEqual(["preview", "plan"])
  expect(heldTiles(artifacts, "lead", { everyone: 3 }).map((a) => a.id)).toEqual(["preview", "plan", "dev.board", "stage"])
  expect(heldTiles(artifacts, "critic", { everyone: 1 }).map((a) => a.id)).toEqual(["files"]) // one agent: nothing is desk-wide
  expect(heldTiles(null, "lead")).toEqual([])
})

test("holdings: an agent's own tools, its artifacts and its agents — artifact commands and quests not counted as tools", async () => {
  const { holdings } = await import("./desk.js")
  const engine = {
    artifacts: ["files", "plan"],
    tools: [{ name: "web.search", kind: "tool" }, { name: "files.read", kind: "tool" }, { name: "plan.tick", kind: "tool" }, { name: "coder", kind: "agent" }],
  }
  expect(holdings(engine)).toEqual({ tools: 1, artifacts: 2, agents: 1 })
  expect(holdings(null)).toEqual({ tools: 0, artifacts: 0, agents: 0 })
  expect(holdings({ artifacts: [{ id: "talk" }], tools: [] })).toEqual({ tools: 0, artifacts: 1, agents: 0 })
})
