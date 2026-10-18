// The desk standard (compose.js): fixtures/sample-desk (lead → alpha, beta; beta mounts fixtures/mini-desk),
// composed with scripted stub models — no network, no real model.

import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { globCovers, Tool } from "../../backend/kernel/index.js"
import { fakeHost } from "../../backend/kernel/test/fake-host.js"
import { composeDesk, hostClient, loadToolFile, loadTools, MODELS, readAgentFolder, readDeskConfig } from "./compose.js"

const FIX = join(import.meta.dir, "fixtures")
const SAMPLE = join(FIX, "sample-desk")
const MINI = join(FIX, "mini-desk")
const KIT = join(FIX, "kit-desk")
const KIT_TOOLS = "agent.dismiss, agent.spawn, web.read, web.search" // the kernel's inbuilt kit, under every desk's own
const KERNEL = resolve(import.meta.dir, "../../backend/kernel/index.js")
const tmp = mkdtempSync(join(tmpdir(), "compose-"))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const report = (verdict) => `VERDICT: ${verdict}\nEVIDENCE: 1 (stub, now); 2 (stub, now)\nCONFIDENCE: 0.9\nFALSIFIER: a third result would break it\nGAPS: none`
const quest = (ask) => ({ requirement: "a fixture run", ask, outcome: "one REPORT" })

// Per agent, the replies in order; then a plain REPORT answer.
function scripted(script) {
  return async (_, agent) => JSON.stringify(script[agent.name]?.shift() ?? { thought: "done", calls: [], answer: report(`${agent.name} done`) })
}

// Every kernel event of a desk, in order.
const recorder = (desk) => {
  const events = []
  desk.on((e) => events.push(e))
  return events
}

// A desk folder in the temp root: agents/<lead>/agent.md (+ members), tools/<file>, a main.js.
function tempDesk(root, name, { agents, tools = {} }) {
  const folder = join(root, name)
  for (const [path, text] of Object.entries(agents)) {
    mkdirSync(join(folder, "agents", path), { recursive: true })
    writeFileSync(join(folder, "agents", path, "agent.md"), text)
  }
  mkdirSync(join(folder, "tools"), { recursive: true })
  for (const [file, src] of Object.entries(tools)) writeFileSync(join(folder, "tools", file), src)
  writeFileSync(join(folder, "main.js"), "export default () => ({ start: async () => ({}) })\n")
  return folder
}
const md = (front, role = "A fixture agent.") => `---\n${front}\n---\n${role}\n`
const toolSrc = (name, description = "a fixture tool") =>
  `import { defineTool } from ${JSON.stringify(KERNEL)}\nexport default defineTool({ name: ${JSON.stringify(name)}, description: ${JSON.stringify(description)}, input: {}, run: async () => ${JSON.stringify(description)} })\n`

describe("composeDesk: sample-desk", () => {
  test("the lead's quest reaches alpha, which calls echo from tools/echo.js", async () => {
    const infer = scripted({
      lead: [
        { thought: "ask alpha", calls: [{ tool: "alpha", input: quest("repeat ping") }] },
        { thought: "tick", calls: [{ tool: "lead.checklist.tick", input: { id: "alpha", evidence: "alpha heard ping" } }] },
        { thought: "done", calls: [], answer: report("alpha heard ping") },
      ],
      alpha: [{ thought: "echo", calls: [{ tool: "echo", input: { text: "ping" } }] }, { thought: "done", calls: [], answer: report("alpha heard: ping") }],
    })
    const desk = await composeDesk({ folder: SAMPLE, infer })
    const events = recorder(desk)
    expect(await desk.ask("what does alpha hear?")).toContain("VERDICT: alpha heard ping")
    const echo = events.find((e) => e.event === "result" && e.tool === "echo")
    expect(echo).toMatchObject({ agent: "alpha", ok: true, output: "alpha heard: ping", team: "sample-desk" })
    expect(events.find((e) => e.event === "result" && e.tool === "alpha")).toMatchObject({ agent: "lead", ok: true })
    expect(desk.agents().get("alpha").tools.get("echo").twin()).toMatchObject({ element: "tool", name: "echo", view: "text", description: "repeat a text back, with the caller's name" })
  })

  test("the tree: the lead leads the team named after the desk; agent.md fields reach the specs", async () => {
    const desk = await composeDesk({ folder: SAMPLE, infer: scripted({}), maxSteps: 30 })
    const tree = desk.twin().tree
    expect(tree).toMatchObject({ name: "lead", team: "sample-desk", title: "Sample board", desk: null })
    expect(tree.agents.map((a) => a.name)).toEqual(["alpha", "beta"])
    const [lead, alpha, beta] = ["lead", "alpha", "beta"].map((n) => desk.agents().get(n))
    expect(lead.config).toMatchObject({ maxSteps: 8, folder: join(SAMPLE, "agents", "lead") })
    expect(alpha.config).toMatchObject({ model: "haiku", minCalls: 1, maxSteps: 30 })
    expect(beta.config.maxSteps).toBe(30)
    expect(lead.artifacts.map((a) => a.id)).toEqual(["lead.checklist", "lead.report", "sample-desk.board"])
    expect(lead.artifacts[0]).toMatchObject({ kind: "checklist", keep: "run", owner: "sample-desk" })
  })
})

describe("composeDesk: mounted desks", () => {
  test("desks: [mini-desk] mounts mini-desk's lead under beta, with tools from ITS tools/ folder", async () => {
    const infer = scripted({
      beta: [{ thought: "to mini", calls: [{ tool: "mini", input: quest("shout hi") }] }, { thought: "done", calls: [], answer: report("mini shouted HI") }],
      mini: [{ thought: "shout", calls: [{ tool: "shout", input: { text: "hi" } }] }, { thought: "done", calls: [], answer: report("HI") }],
    })
    const desk = await composeDesk({ folder: SAMPLE, infer })
    const beta = desk.twin().tree.agents.find((a) => a.name === "beta")
    expect(beta.agents).toEqual([expect.objectContaining({ name: "mini", desk: "mini-desk", tools: [{ name: "shout", type: "function" }, { name: "where", type: "function" }] })])
    expect(desk.agents().get("mini").twin().desk).toBe("mini-desk")
    expect(desk.agents().get("lead").tools.has("shout")).toBe(false) // a mounted desk's tools stay its own
    const events = recorder(desk)
    await desk.agents().get("beta").ask("make it loud")
    expect(events.find((e) => e.event === "result" && e.tool === "shout")).toMatchObject({ agent: "mini", ok: true, output: "HI" })
  })

  test("mini-desk composes alone", async () => {
    const { compose } = await readDeskConfig(MINI) // its main.js options: its own artifact type
    const desk = await composeDesk({ folder: MINI, ...compose, infer: scripted({ mini: [{ thought: "shout", calls: [{ tool: "shout", input: { text: "solo" } }] }] }) })
    expect(desk.twin().tree).toMatchObject({ name: "mini", desk: null, tools: [{ name: "shout", type: "function" }, { name: "where", type: "function" }], agents: [] })
    expect(desk.lead.artifacts.map((a) => a.id)).toEqual(["mini.tally"]) // its own type, from its main.js (mini-desk/artifacts/tally.js)
    const events = recorder(desk)
    await desk.ask("shout solo")
    expect(events.find((e) => e.tool === "shout" && e.event === "result").output).toBe("SOLO")
  })

  test("a mounted desk composes with its own main.js options and runs as itself: ctx.desk and memory are its own", async () => {
    const memory = join(tmp, "mem", "sample-desk")
    const infer = scripted({
      mini: [{ thought: "where", calls: [{ tool: "where", input: {} }, { tool: "mini.tally.add", input: { n: 2 } }] }],
      alpha: [{ thought: "where", calls: [{ tool: "echo", input: { text: "x" } }] }],
    })
    const seen = []
    const desk = await composeDesk({ folder: SAMPLE, infer, context: { memory, log: (l) => seen.push(l) } })
    const mini = desk.agents().get("mini")
    expect(mini.artifacts.map((a) => a.id)).toEqual(["mini.tally", "beta.board"]) // mini-desk's own type, mounted
    expect(mini.config.models).toEqual(MODELS) // its catalogue, for llmInfer
    const events = recorder(desk)
    await mini.ask("where are you?")
    expect(events.find((e) => e.tool === "where" && e.event === "result").output).toBe(`mini-desk ${join(tmp, "mem", "mini-desk")}`)
    expect(desk.twin().artifacts["mini.tally"].state).toEqual({ count: 2, text: "2 counted" })
    expect(mini.context).toMatchObject({ desk: "mini-desk", memory: join(tmp, "mem", "mini-desk") })
    expect(mini.context.log).toBe(desk.lead.context.log) // the parent's log and host: it runs in the parent's process
    expect(desk.agents().get("alpha").context).toMatchObject({ desk: "sample-desk", memory })
    expect(desk.agents().get("beta").context.desk).toBe("sample-desk")
  })

  test("a mounted desk folder that is a link is refused", async () => {
    const root = join(tmp, "linked")
    tempDesk(root, "host", { agents: { lh: md("name: lh\ndesks: [ext]") } })
    tempDesk(join(tmp, "elsewhere"), "ext", { agents: { le: md("name: le") } })
    symlinkSync(join(tmp, "elsewhere", "ext"), join(root, "ext"))
    await expect(composeDesk({ folder: join(root, "host"), infer: scripted({}) })).rejects.toThrow("lh: desks: ext is a link")
  })

  test("a desks: cycle is refused, and so is a missing desk", async () => {
    const root = join(tmp, "cycle")
    tempDesk(root, "one", { agents: { lead1: md("name: lead1\ndesks: [two]") } })
    tempDesk(root, "two", { agents: { lead2: md("name: lead2\ndesks: [one]") } })
    await expect(composeDesk({ folder: join(root, "one"), infer: scripted({}) })).rejects.toThrow("lead2: desks: one → two → one is a cycle")
    tempDesk(root, "three", { agents: { lead3: md("name: lead3\ndesks: [ghost]") } })
    await expect(composeDesk({ folder: join(root, "three"), infer: scripted({}) })).rejects.toThrow("lead3: desks: no desk ghost")
    tempDesk(root, "self", { agents: { lead4: md("name: lead4\ndesks: [self]") } })
    await expect(composeDesk({ folder: join(root, "self"), infer: scripted({}) })).rejects.toThrow("self → self is a cycle")
  })

  test("readAgentFolder reads desks: as desk names", () => {
    expect(readAgentFolder(join(SAMPLE, "agents", "lead", "beta")).desks).toEqual(["mini-desk"])
    expect(readAgentFolder(join(SAMPLE, "agents", "lead")).agents.map((a) => a.name)).toEqual(["alpha", "beta"])
    const root = join(tmp, "names")
    tempDesk(root, "x", { agents: { lx: md("name: lx\ndesks: [Bad_Name]") } })
    expect(() => readAgentFolder(join(root, "x", "agents", "lx"))).toThrow('desks: "Bad_Name" — each is a desk folder name')
  })
})

describe("composeDesk: what it refuses", () => {
  test("a bad tools/*.js fails with its file name and defineTool's reason", async () => {
    const root = join(tmp, "bad")
    const noDesc = `import { defineTool } from ${JSON.stringify(KERNEL)}\nexport default defineTool({ name: "bad.tool", input: {}, run: async () => "" })\n`
    tempDesk(root, "d1", { agents: { l: md("name: l") }, tools: { "bad.js": noDesc } })
    await expect(composeDesk({ folder: join(root, "d1"), infer: scripted({}) })).rejects.toThrow(/d1\/tools\/bad\.js: defineTool bad\.tool: description is required/)
    tempDesk(root, "d2", { agents: { l: md("name: l") }, tools: { "plain.js": 'export default { name: "plain", run: () => "" }\n' } })
    await expect(composeDesk({ folder: join(root, "d2"), infer: scripted({}) })).rejects.toThrow(/plain\.js: the default export is not a Tool — wrap it: export default defineTool/)
    tempDesk(root, "d3", { agents: { l: md("name: l") }, tools: { "none.js": "export const x = 1\n" } })
    await expect(composeDesk({ folder: join(root, "d3"), infer: scripted({}) })).rejects.toThrow(/none\.js: no default export/)
    tempDesk(root, "d4", { agents: { l: md("name: l") }, tools: { "a.js": toolSrc("same"), "b.js": toolSrc("same") } })
    await expect(composeDesk({ folder: join(root, "d4"), infer: scripted({}) })).rejects.toThrow(/b\.js: tool same is defined in .*a\.js too/)
    await expect(loadToolFile(join(FIX, "bad-tool", "broken.js"))).rejects.toThrow(/broken\.js: defineTool broken: description is required/)
  })

  test("a linked tools/ folder or tools/*.js is refused, and the app's cached modules stay untouched", async () => {
    const TEAM = import.meta.dir // companion/team: compose.js, desk.js, kernel-team.js …
    const cached = () => Object.keys(require.cache).filter((k) => k.startsWith(realpathSync(TEAM) + "/")).sort()
    const before = cached()
    expect(before.length).toBeGreaterThan(3)
    const root = join(tmp, "links")
    const d1 = tempDesk(root, "l1", { agents: { l: md("name: l") } })
    rmSync(join(d1, "tools"), { recursive: true })
    symlinkSync(TEAM, join(d1, "tools"))
    await expect(composeDesk({ folder: d1, infer: scripted({}) })).rejects.toThrow(/l1\/tools is a link \(→ .*companion\/team\): a desk's tools\/ folder is a real path inside the desk/)
    const d2 = tempDesk(root, "l2", { agents: { l: md("name: l") } })
    symlinkSync(join(TEAM, "compose.js"), join(d2, "tools", "compose.js"))
    await expect(composeDesk({ folder: d2, infer: scripted({}) })).rejects.toThrow(/l2\/tools\/compose\.js is a link .*a tools\/\*\.js file is a real path inside the desk/)
    await expect(loadToolFile(join(d2, "tools", "compose.js"))).rejects.toThrow("is a link")
    // A helper folder linked to the app: tools load; nothing outside the desk's real tools/ is cleared.
    const d3 = tempDesk(root, "l3", { agents: { l: md("name: l\ntools: [ok]") }, tools: { "ok.js": toolSrc("ok") } })
    symlinkSync(TEAM, join(d3, "tools", "lib"))
    expect((await composeDesk({ folder: d3, infer: scripted({}) })).lead.tools.has("ok")).toBe(true)
    expect(cached()).toEqual(before)
  })

  test("an unknown tool name lists the available ones", async () => {
    const root = join(tmp, "unknown")
    tempDesk(root, "u", { agents: { l: md("name: l\ntools: [nope]") }, tools: { "a.js": toolSrc("alpha.read"), "b.js": toolSrc("beta.write") } })
    await expect(composeDesk({ folder: join(root, "u"), infer: scripted({}) })).rejects.toThrow("l: unknown tool nope; available: agent.dismiss, agent.spawn, alpha.read, beta.write, web.read, web.search")
    const web = new Tool({ name: "web.read", description: "a page", run: () => "" })
    await expect(composeDesk({ folder: join(root, "u"), infer: scripted({}), tools: { "web.read": web } })).rejects.toThrow("available: agent.dismiss, agent.spawn, alpha.read, beta.write, web.read, web.search")
    tempDesk(root, "v", { agents: { l: md("name: l\ntools: [web.read, alpha.read]") }, tools: { "a.js": toolSrc("alpha.read") } })
    const desk = await composeDesk({ folder: join(root, "v"), infer: scripted({}), tools: { "web.read": web } })
    expect([...desk.lead.tools.keys()]).toEqual(["web.read", "alpha.read"]) // the host's catalogue after the desk's own
    expect(desk.lead.tools.get("web.read")).toBe(web) // and before the kernel's kit
  })

  test("unknown agent.md keys, models and artifact types, and a desk without one lead", async () => {
    const root = join(tmp, "keys")
    tempDesk(root, "k1", { agents: { l: md("name: l\nmax_step: 3") } })
    await expect(composeDesk({ folder: join(root, "k1"), infer: scripted({}) })).rejects.toThrow("unknown key max_step")
    tempDesk(root, "k2", { agents: { l: md("name: l\nmodel: gpt") } })
    await expect(composeDesk({ folder: join(root, "k2"), infer: scripted({}), models: MODELS })).rejects.toThrow("l: unknown model gpt; models: opus, sonnet, haiku")
    tempDesk(root, "k3", { agents: { l: md("name: l\nartifacts: [ledger]") } })
    await expect(composeDesk({ folder: join(root, "k3"), infer: scripted({}) })).rejects.toThrow("l: unknown artifact ledger; types: charts, checklist, dispatch, files, plan, preview, report, terminal")
    tempDesk(root, "k4", { agents: { a: md("name: a"), b: md("name: b") } })
    await expect(composeDesk({ folder: join(root, "k4"), infer: scripted({}) })).rejects.toThrow("a desk has one lead folder with an agent.md (found a, b)")
  })
})

// 2026-10-17: the kernel's inbuilt kit (backend/kernel/builtin) attached by name — fixtures/kit-desk has no tools/ and
// no artifact types of its own; a fake host stands in for the server (backend/kernel/test/fake-host.js).
describe("the inbuilt kit, attached by name (kit-desk)", () => {
  const kitDesk = async (infer = scripted({}), more = {}) => {
    const host = fakeHost({ files: { "shared/x/goal.md": "# Goal\n", "projects/x/train.py": "a = 1\n", "projects/x/out/curve.csv": "step,loss\n1,3.1\n" } })
    const desk = await composeDesk({ folder: KIT, infer, context: { host }, ...more })
    return { desk, host, agent: (n) => desk.agents().get(n) }
  }
  const call = (agent, tool, input) => agent.tools.get(tool).run(input, { ...agent.context, agent })

  test("artifacts: [files, terminal, preview, {type: plan, gate: true}] and tools: [web.search, agent.spawn] compose; one instance per desk", async () => {
    const { desk, agent } = await kitDesk()
    const lead = agent("lead")
    expect([...lead.tools.keys()].slice(0, 4)).toEqual(["web.search", "agent.spawn", "coder", "critic"])
    for (const t of ["files.read", "terminal.run", "preview.open", "plan.write", "kit-desk.board.write"]) expect(lead.tools.has(t)).toBe(true)
    expect(lead.artifacts.map((a) => a.id)).toEqual(["files", "terminal", "preview", "plan", "kit-desk.board"])
    const held = Object.fromEntries([...desk.artifacts()].map(([id, { holders }]) => [id, holders]))
    expect(held).toEqual({ files: ["lead", "coder", "critic"], terminal: ["lead", "coder", "critic"], preview: ["lead", "coder", "critic"], plan: ["lead", "coder"], "kit-desk.board": ["lead", "coder"] })
    expect(agent("coder").artifacts[0]).toBe(lead.artifacts[0]) // the same files instance
    expect(agent("coder").tools.get("web.read")).toMatchObject({ type: "function", view: "web" })
    expect(desk.twin().artifacts.files).toMatchObject({ kind: "files", view: "files", holders: ["lead", "coder", "critic"] })
    // {type: plan, gate: true}: the lead's answer waits on the plan, the coder's does not.
    expect(lead.gates("done").join()).toContain("no plan yet")
    expect(agent("coder").gates("done").join()).not.toContain("plan")
    await call(agent("coder"), "plan.write", { goal: "train", items: ["loss: the loss goes down"] })
    expect(lead.gates("done").join()).toContain("plan open: loss")
  })

  test("the critic: reads: and board: false — no board, a commands subset, never the code", async () => {
    const { agent, host } = await kitDesk()
    const critic = agent("critic")
    expect(critic.config).toMatchObject({ reads: ["shared/*/goal.md", "projects/*/out/**"], writes: ["shared/*/critique.md"], board: false })
    expect(critic.artifacts.map((a) => a.id)).toEqual(["files", "terminal", "preview"])
    expect([...critic.tools.keys()].filter((t) => !t.startsWith("files."))).toEqual(["terminal.wait", "terminal.read", "terminal.list", "preview.open", "preview.text", "preview.shot"])
    await expect(call(critic, "files.read", { path: "projects/x/train.py" })).rejects.toThrow("critic reads only shared/*/goal.md, projects/*/out/** (its reads:) — projects/x/train.py is outside its lane")
    expect(await call(critic, "files.read", { path: "projects/x/out/curve.csv" })).toContain("2\t1,3.1")
    await expect(call(critic, "files.write", { path: "projects/x/train.py", content: "a = 0" })).rejects.toThrow("outside its lane")
    expect(await call(critic, "files.write", { path: "shared/x/critique.md", content: "VERDICT: not yet" })).toBe("created shared/x/critique.md (1 lines, +1 -0)")
    await call(agent("coder"), "files.write", { path: "projects/x/train.py", content: "a = 2" })
    expect(host.fs.get("projects/x/train.py")).toBe("a = 2\n")
  })

  test("agent.spawn resolves the desk's catalogue at run time: a tool the lead does not hold, a kit artifact by type", async () => {
    const infer = scripted({
      lead: [
        { thought: "spawn", calls: [{ tool: "agent.spawn", input: { name: "reader", role: "reads papers", goal: "the newest practice", tools: ["web.read"], artifacts: [{ type: "files", commands: ["read", "list"] }] } }] },
        { thought: "quest", calls: [{ tool: "reader", input: quest("which paper?") }] },
        { thought: "plan", calls: [{ tool: "plan.write", input: { goal: "g", items: ["read: the paper is read"] } }, { tool: "plan.tick", input: { id: "read", evidence: "reader answered" } }] },
        { thought: "done", calls: [], answer: report("read") },
      ],
    })
    const { desk, agent } = await kitDesk(infer)
    const spawned = new Promise((ok) => desk.on((e) => e.event === "spawn" && ok(desk.agents().get(e.agent))))
    expect(await desk.ask("go")).toContain("VERDICT: read")
    const reader = await spawned
    expect(agent("lead").tools.has("web.read")).toBe(false)
    expect([...reader.tools.keys()]).toEqual(["web.read", "files.list", "files.read", "kit-desk.board.write"]) // its subset, in the artifact's order; it joins the lead's team
    expect(reader.artifacts[0]).toBe(agent("lead").artifacts[0])
  })

  test("unknown names list the known ones; a kit entry's keys and the lanes are checked at compose time", async () => {
    const root = join(tmp, "kit")
    tempDesk(root, "a1", { agents: { l: md("name: l\nartifacts: [filez]") } })
    await expect(composeDesk({ folder: join(root, "a1"), infer: scripted({}) })).rejects.toThrow("l: unknown artifact filez; types: charts, checklist, dispatch, files, plan, preview, report, terminal")
    tempDesk(root, "a2", { agents: { l: md("name: l\ntools: [web.serch]") } })
    await expect(composeDesk({ folder: join(root, "a2"), infer: scripted({}) })).rejects.toThrow(`l: unknown tool web.serch; available: ${KIT_TOOLS}`)
    tempDesk(root, "a3", { agents: { l: md("name: l\nartifacts: [{type: plan, gat: true}]") } })
    await expect(composeDesk({ folder: join(root, "a3"), infer: scripted({}) })).rejects.toThrow("artifacts: plan takes type, id, commands, gate (not gat)")
    tempDesk(root, "a4", { agents: { l: md("name: l\nboard: no") } })
    await expect(composeDesk({ folder: join(root, "a4"), infer: scripted({}) })).rejects.toThrow("board: false keeps it off its team's board (true or false)")
    tempDesk(root, "a5", { agents: { l: md("name: l\nreads: {a: 1}") } })
    await expect(composeDesk({ folder: join(root, "a5"), infer: scripted({}) })).rejects.toThrow('reads: globs (a list of workspace paths, e.g. ["projects/**"])')
    tempDesk(root, "a6", { agents: { l: md("name: l\nartifacts: [{type: terminal, commands: [read, rm]}]") } })
    await expect(composeDesk({ folder: join(root, "a6"), infer: scripted({}) })).rejects.toThrow("l: terminal has no command rm (has run, start, wait, read, send, stop, list)")
    tempDesk(root, "a7", { agents: { l: md('name: l\nwrites: "projects/**, shared/**"\nartifacts: [{type: files, id: notes}]') } })
    const desk = await composeDesk({ folder: join(root, "a7"), infer: scripted({}) })
    expect(desk.lead.config.writes).toEqual(["projects/**", "shared/**"])
    expect(desk.lead.artifacts.map((a) => a.id)).toEqual(["notes"])
  })

  // 2026-10-17 owner ("let the lead, when required, create a sub team"): teams/<team>/agent.md are templates the lead
  // spawns at run time — read and checked at compose time, never built at start.
  test("teams/probe is read into env.templates as agent.spawn's input (members as written, lanes as lists); env.models; not built at start", async () => {
    const { desk } = await kitDesk(scripted({}), { models: MODELS })
    const { templates, models } = desk.ctx.env
    expect(Object.keys(templates)).toEqual(["probe"])
    const probe = templates.probe
    expect(Object.keys(probe)).toEqual(["name", "description", "title", "role", "goal", "tools", "artifacts", "writes", "members"])
    expect(probe).toMatchObject({
      name: "probe",
      title: "Probe desk",
      role: "SPEC\nLeads the probe: quests the watcher and the gauge, writes shared/<slug>/probe/summary.md.",
      goal: "Every number of the layer measured and written to shared/<slug>/probe/.",
      tools: ["web.search"],
      artifacts: ["files", { type: "terminal", commands: ["read", "list", "wait"] }],
      writes: ["shared/*/probe/**"],
    })
    expect(probe.members).toEqual([
      { name: "watcher", description: "Watches the layer's numbers and writes what moved.", role: expect.stringContaining("watch.md"), tools: [], artifacts: [{ type: "files", commands: ["read", "write"] }], writes: ["shared/*/probe/watch.md"], max_steps: 20, members: [] },
      { name: "gauge", description: expect.any(String), role: expect.stringContaining("gauge-<n>.md"), tools: [], artifacts: ["files", { type: "terminal", commands: ["read"] }], writes: ["shared/*/probe/gauge-*.md"], reads: ["shared/*/probe/**", "projects/*/out/**"], board: false, members: [] },
    ])
    expect(models).toEqual(["opus", "sonnet", "haiku"]) // the names agent.spawn checks a model against
    expect([...desk.agents().keys()]).toEqual(["lead", "coder", "critic"]) // a template is never built at start
    const plain = await composeDesk({ folder: SAMPLE, infer: scripted({}) })
    expect(plain.ctx.env.templates).toEqual({}) // no teams/
    expect(plain.ctx.env.models).toBeUndefined() // no models given: a spawn may ask for any
  })

  test("the lead spawns a team from its template: agent.spawn {template} → its lead and members <team>-<member>, its board under the lead's, lanes narrowed and covered", async () => {
    const infer = scripted({
      lead: [
        { thought: "staff the probe", calls: [{ tool: "agent.spawn", input: { template: "probe", keep: "desk" } }] },
        { thought: "quest it", calls: [{ tool: "probe", input: quest("what moved in layer 3?") }] },
        { thought: "plan", calls: [{ tool: "plan.write", input: { goal: "g", items: ["probe: the probe reported"] } }, { tool: "plan.tick", input: { id: "probe", evidence: "probe answered" } }] },
        { thought: "done", calls: [], answer: report("layer 3 moved") },
      ],
      probe: [{ thought: "ask the watcher", calls: [{ tool: "probe-watcher", input: quest("what moved?") }] }, { thought: "done", calls: [], answer: report("rms moved") }],
      "probe-watcher": [{ thought: "write it down", calls: [{ tool: "files.write", input: { path: "shared/x/probe/watch.md", content: "layer 3: rms 1.2 → 1.9" } }] }, { thought: "done", calls: [], answer: report("rms 1.2 → 1.9") }],
    })
    const { desk, agent, host } = await kitDesk(infer, { models: MODELS })
    const spawns = []
    desk.on((e) => e.event === "spawn" && spawns.push([e.agent, e.by, e.team, e.keep]))
    const events = recorder(desk)
    expect(await desk.ask("probe layer 3")).toContain("VERDICT: layer 3 moved")
    expect(events.find((e) => e.event === "result" && e.tool === "agent.spawn").output).toBe("spawned team probe (lead probe; members probe-watcher, probe-gauge; board probe.board) — quest or dispatch probe {requirement, ask, outcome} (stays until agent.dismiss)")
    // One spawn event per agent of the team, its lead first.
    expect(spawns).toEqual([["probe", "lead", "probe", "desk"], ["probe-watcher", "probe", "probe", "desk"], ["probe-gauge", "probe", "probe", "desk"]])
    const [lead, probe, watcher, gauge] = ["lead", "probe", "probe-watcher", "probe-gauge"].map(agent)
    expect(desk.tree().agents.find((n) => n.name === "probe")).toMatchObject({ team: "probe", spawned: { by: "lead", team: "probe" }, agents: [{ name: "probe-watcher" }, { name: "probe-gauge" }] })
    // Its board, under the lead's; the gauge (board: false) off it.
    expect(probe.board.id).toBe("probe.board")
    expect(probe.board.parent).toBe(lead.board)
    expect(watcher.artifacts.map((a) => a.id)).toEqual(["files", "probe.board"])
    expect(gauge.artifacts.map((a) => a.id)).toEqual(["files", "terminal"])
    expect([...watcher.tools.keys()]).toEqual(["files.read", "files.write", "probe.board.write"])
    expect([...gauge.tools.keys()].filter((t) => t.startsWith("terminal."))).toEqual(["terminal.read"])
    // Lanes: the template's, each covered by the lead's.
    expect(probe.config.writes).toEqual(["shared/*/probe/**"])
    expect(watcher.config).toMatchObject({ writes: ["shared/*/probe/watch.md"], maxSteps: 20 })
    expect(gauge.config).toMatchObject({ writes: ["shared/*/probe/gauge-*.md"], reads: ["shared/*/probe/**", "projects/*/out/**"], board: false })
    for (const a of [probe, watcher, gauge]) for (const g of a.config.writes) expect(lead.config.writes.some((o) => globCovers(o, g))).toBe(true)
    // The quest went down the team; the watcher wrote in its lane, and nowhere else.
    expect(events.find((e) => e.event === "result" && e.tool === "probe-watcher")).toMatchObject({ agent: "probe", ok: true })
    expect(host.fs.get("shared/x/probe/watch.md")).toBe("layer 3: rms 1.2 → 1.9\n")
    await expect(call(watcher, "files.write", { path: "shared/x/goal.md", content: "x" })).rejects.toThrow("outside its lane")
    // The input's own fields win, and are bounded by the caller: a lane outside the lead's, or a model the desk lacks,
    // builds nothing.
    await expect(call(lead, "agent.spawn", { template: "probe", name: "wide", writes: ["projects/**"] })).rejects.toThrow("writes: projects/** is outside your lane (yours: shared/**)")
    await expect(call(lead, "agent.spawn", { template: "probe", name: "odd", model: "gpt" })).rejects.toThrow("unknown model gpt; models: opus, sonnet, haiku")
    await expect(call(lead, "agent.spawn", { template: "nope" })).rejects.toThrow("unknown template nope; templates: probe")
    expect([...desk.agents().keys()].filter((n) => /^(wide|odd)/.test(n))).toEqual([])
    // A second team from the same template: its own names.
    expect(await call(lead, "agent.spawn", { template: "probe", name: "probe2", goal: "layer 4" })).toStartWith("spawned team probe2 (lead probe2; members probe2-watcher, probe2-gauge;")
    // Dismissed whole: its members go with it, its board leaves the lead's.
    expect(desk.dismiss("probe", "lead")).toEqual(["probe-watcher", "probe-gauge", "probe"]) // what agent.dismiss {name: probe} does
    expect(lead.board.children.map((b) => b.id)).toEqual(["probe2.board"])
    expect([...desk.agents().keys()]).toEqual(["lead", "coder", "critic", "probe2", "probe2-watcher", "probe2-gauge"])
  })

  test("a bad template fails the compose, naming its file: unknown key, tool, artifact, command or model; keys a spawn cannot honour; names", async () => {
    const root = join(tmp, "templates")
    // A desk with one lead (writes shared/**) and the given teams/ files.
    const withTeams = (name, teams) => {
      const folder = tempDesk(root, name, { agents: { l: md('name: l\nwrites: ["shared/**"]\ntools: [agent.spawn]') } })
      for (const [path, text] of Object.entries(teams)) {
        mkdirSync(join(folder, "teams", path), { recursive: true })
        if (text != null) writeFileSync(join(folder, "teams", path, "agent.md"), text)
      }
      return composeDesk({ folder, infer: scripted({}), models: MODELS })
    }
    const refused = async (name, teams, message) => {
      const error = await withTeams(name, teams).catch((e) => e)
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toContain(message)
      return error.message
    }
    const lead = md("name: tm\nagents: [m]", "Leads tm.")
    expect(await refused("t1", { tm: md("name: tm\ntools: [nope]") }, "unknown tool nope; available: agent.dismiss, agent.spawn, web.read, web.search")).toContain(join(root, "t1", "teams", "tm", "agent.md"))
    expect(await refused("t2", { tm: lead, "tm/m": md("name: m\nartifacts: [ledger]") }, "unknown artifact ledger; types: charts, checklist, dispatch, files, plan, preview, report, terminal")).toContain(join(root, "t2", "teams", "tm", "m", "agent.md"))
    await refused("t3", { tm: md("name: tm\nmodel: gpt") }, "t3/teams/tm/agent.md: unknown model gpt; models: opus, sonnet, haiku")
    await refused("t4", { tm: md("name: tm\nmax_step: 3") }, "t4/teams/tm/agent.md: unknown key max_step")
    await refused("t5", { tm: md("name: tm\nartifacts: [{type: terminal, commands: [read, rm]}]") }, "t5/teams/tm/agent.md: terminal has no command rm (has run, start, wait, read, send, stop, list)")
    await refused("t6", { tm: md("name: tm\nartifacts: [{type: plan, gat: true}]") }, "t6/teams/tm/agent.md: artifacts: plan takes type, id, commands, gate (not gat)")
    await refused("t7", { tm: md("name: tm\ndesks: [mini-desk]") }, "t7/teams/tm/agent.md: desks is not for a team template (a spawned team mounts no desk)")
    await refused("t8", { tm: md("name: tm\nchecklist: [a]") }, "checklist is not for a team template")
    await refused("t9", { tm: md("name: other") }, "t9/teams/tm/agent.md: name other — a template is named after its folder (tm)")
    await refused("t10", { tm: lead, "tm/m": md("name: m\ngoal: its own") }, "t10/teams/tm/m/agent.md: goal is the team's")
    await refused("t11", { tm: md("name: tm\nagents: [member-with-a-name-that-is-long]"), "tm/member-with-a-name-that-is-long": md("name: member-with-a-name-that-is-long") }, "name tm-member-with-a-name-that-is-long (tm-<its name>, as agent.spawn names a member)")
    await refused("t12", { tm: md("name: tm\nmax_steps: 0") }, "max_steps: a whole number from 1 to 300")
    await refused("t13", { tm: md("name: tm\nreads: {a: 1}") }, 'reads: globs (a list of workspace paths, e.g. ["projects/**"])')
    await refused("t14", { tm: md("name: tm\nboard: no") }, "board: false keeps it off its team's board")
    await refused("t15", { tm: md("name: tm", "") }, "t15/teams/tm/agent.md: no role")
    await refused("t16", { tm: null }, `${join(root, "t16", "teams", "tm")}: no agent.md`)
    // A good one composes beside them.
    const desk = await withTeams("ok", { tm: lead, "tm/m": md("name: m\nwrites: [shared/t/**]\nartifacts: [files]") })
    expect(desk.ctx.env.templates.tm.members).toEqual([{ name: "m", role: "A fixture agent.", tools: [], artifacts: ["files"], writes: ["shared/t/**"], members: [] }])
  })

  test("the desk wins a clash: its own files type or web.search replaces the kit's", async () => {
    const mine = new Tool({ name: "web.search", description: "the desk's own", run: () => "mine" })
    const { Files } = await import("../../backend/kernel/index.js")
    const own = new Files({ id: "files", title: "the desk's own files" })
    const root = join(tmp, "clash")
    tempDesk(root, "c1", { agents: { l: md("name: l\ntools: [web.search]\nartifacts: [files]") } })
    const desk = await composeDesk({ folder: join(root, "c1"), infer: scripted({}), tools: { "web.search": mine }, artifacts: { files: () => own } })
    expect(desk.lead.tools.get("web.search")).toBe(mine)
    expect(desk.lead.artifacts[0]).toBe(own)
  })
})

describe("the host: only through ctx.host", () => {
  // A fake fetch: records each request, answers from `reply`.
  const fake = (reply = () => Response.json({ ok: true })) => {
    const seen = []
    const fetch = async (url, init = {}) => (seen.push({ url, method: init.method, headers: init.headers, body: init.body }), reply(url, init))
    return { seen, fetch }
  }

  test("hostClient: GET with the desk header; POST with Origin and a JSON body; a non-2xx throws", async () => {
    const f = fake((url) => (url.endsWith("/missing") ? new Response("x".repeat(500), { status: 404 }) : Response.json({ path: "a.md", size: 3 })))
    const host = hostClient({ port: 4321, desk: "sample-desk", fetch: f.fetch })
    expect(await host.get("fs/read?path=a.md")).toEqual({ path: "a.md", size: 3 })
    expect(f.seen[0]).toMatchObject({ url: "http://localhost:4321/__askk/fs/read?path=a.md", method: "GET", headers: { "x-askk-desk": "sample-desk" }, body: undefined })
    expect(f.seen[0].headers.Origin).toBeUndefined()
    await host.post("/fs/write", { path: "a.md", text: "abc" })
    expect(f.seen[1]).toMatchObject({ url: "http://localhost:4321/__askk/fs/write", method: "POST", headers: { "x-askk-desk": "sample-desk", Origin: "http://localhost:4321", "Content-Type": "application/json" } })
    expect(JSON.parse(f.seen[1].body)).toEqual({ path: "a.md", text: "abc" })
    const error = await host.get("missing").catch((e) => e)
    expect(error.message).toBe(`GET missing: HTTP 404 ${"x".repeat(200)}`)
    expect(error.status).toBe(404)
  })

  test("a desk tool (tools/note.js) reaches the host through ctx.host, as its desk", async () => {
    const f = fake((url, init) => Response.json({ path: JSON.parse(init.body).path, size: 5 }))
    const infer = scripted({ alpha: [{ thought: "note", calls: [{ tool: "note.save", input: { name: "first note", text: "hello" } }] }] })
    const desk = await composeDesk({ folder: SAMPLE, infer, port: 4321, context: { host: hostClient({ port: 4321, desk: "sample-desk", fetch: f.fetch }) } })
    const events = recorder(desk)
    await desk.agents().get("alpha").ask("keep a note")
    expect(events.find((e) => e.event === "result" && e.tool === "note.save")).toMatchObject({ ok: true, output: "saved notes/first-note.md (5 bytes)" })
    expect(f.seen).toEqual([expect.objectContaining({ url: "http://localhost:4321/__askk/fs/write", method: "POST", headers: { "x-askk-desk": "sample-desk", Origin: "http://localhost:4321", "Content-Type": "application/json" } })])
  })

  test("without a host in the context, a port gives every tool a hostClient for the desk; ctx carries desk, memory, log", async () => {
    const desk = await composeDesk({ folder: SAMPLE, infer: scripted({}), port: 4321 })
    expect(desk.lead.context).toMatchObject({ desk: "sample-desk", memory: null, host: { base: "http://localhost:4321", desk: "sample-desk" } })
    expect(typeof desk.lead.context.log).toBe("function")
    expect((await composeDesk({ folder: SAMPLE, infer: scripted({}) })).lead.context.host).toBeNull()
  })
})

describe("built-in artifacts", () => {
  test("artifacts: [report] → <agent>.report.write sets the twin state and writes memory/reports/<day>-<slug>.md", async () => {
    const memory = join(tmp, "memory")
    const text = "Alpha heard ping.\n\n- one\n- two"
    const infer = scripted({
      lead: [
        { thought: "write", calls: [{ tool: "lead.report.write", input: { title: "Morning Read: Alpha!", text } }, { tool: "lead.checklist.skip", input: { id: "alpha", reason: "a report-only run" } }] },
        { thought: "done", calls: [], answer: report("report written") },
      ],
    })
    const desk = await composeDesk({ folder: SAMPLE, infer, context: { memory } })
    const events = recorder(desk)
    expect([...desk.lead.tools.keys()]).toContain("lead.report.write")
    expect(desk.lead.tools.get("lead.report.write")).toMatchObject({ type: "artifact", view: "text" })
    await desk.ask("write the report")
    const day = new Date().toLocaleDateString("en-CA")
    expect(events.find((e) => e.tool === "lead.report.write" && e.event === "result")).toMatchObject({ ok: true, output: `report "Morning Read: Alpha!" saved: reports/${day}-morning-read-alpha.md` })
    const twin = desk.twin().artifacts["lead.report"]
    expect(twin).toMatchObject({ element: "artifact", id: "lead.report", kind: "report", view: "text", keep: "always", owner: "sample-desk", holders: ["lead"] })
    expect(twin.state).toMatchObject({ title: "Morning Read: Alpha!", text, at: expect.any(String) })
    expect(twin.brief).toStartWith("Morning Read: Alpha! · ")
    const file = join(memory, "reports", `${day}-morning-read-alpha.md`)
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, "utf8")).toStartWith("# Morning Read: Alpha!\n")
    expect(readFileSync(file, "utf8")).toContain(text)
    expect(desk.lead.render({ text: "next", from: "owner" }, [])).toContain("## Morning Read: Alpha!")
  })

  test("a report write without a title is an error result; without memory it is kept, not saved", async () => {
    const infer = scripted({ lead: [{ thought: "write", calls: [{ tool: "lead.report.write", input: { text: "x" } }, { tool: "lead.report.write", input: { title: "T", text: "body" } }] }] })
    const desk = await composeDesk({ folder: SAMPLE, infer })
    const events = recorder(desk)
    await desk.ask("write").catch(() => {})
    const results = events.filter((e) => e.tool === "lead.report.write" && e.event === "result")
    expect(results.map((r) => [r.ok, r.output])).toEqual([[false, "title is required"], [true, 'report "T" kept (no memory folder to save it in)']])
  })
})

describe("conventionDesk", () => {
  test("main.js's default export: the desk named after its folder; start composes it", async () => {
    const create = (await import(join(SAMPLE, "main.js"))).default
    const config = create({ dir: SAMPLE, env: {} })
    expect(config).toMatchObject({ name: "sample-desk", title: "Sample desk", compose: { models: MODELS, defaultModel: "opus", artifacts: {}, tools: {} } })
    const { desk } = await config.start({ port: 4321, log: () => {}, memory: null, infer: scripted({}) })
    expect(desk.lead.name).toBe("lead")
    expect(desk.lead.context.host).toMatchObject({ base: "http://localhost:4321", desk: "sample-desk" })
  })

  // A fake host: each model call recorded; the models in `down` answer 500.
  const fakeModels = (down) => {
    const asked = []
    const fetch = async (url, init) => {
      const { model } = JSON.parse(init.body)
      asked.push({ url, model, desk: init.headers["x-askk-desk"] })
      if (down.includes(model)) return new Response("signed out", { status: 500 })
      return Response.json({ choices: [{ message: { content: JSON.stringify({ thought: "done", calls: [], answer: report(`answered by ${model}`) }) } }] })
    }
    return { asked, fetch }
  }
  const URL_LLM = "http://localhost:4322/__askk/llm/claude-cli/v1/chat/completions"
  const failed = (agent, key, next) => `model: ${agent}: ${key} failed (claude-${key}-5-5: POST llm/claude-cli/v1/chat/completions: HTTP 500 signed out)${next ? ` — trying ${next}` : ""}`

  test("its models: the agent's model through the host's local CLI, then each fallback, every failure logged", async () => {
    const real = globalThis.fetch
    const fake = fakeModels(["claude-opus-5-5"])
    globalThis.fetch = fake.fetch
    try {
      const lines = []
      const { desk } = await (await import(join(MINI, "main.js"))).default({ dir: MINI }).start({ port: 4322, log: (l) => lines.push(l) })
      expect(await desk.ask("hello")).toContain("answered by claude-haiku-5-5") // mini-desk's own fallbacks: [haiku]
      expect(fake.asked).toEqual([
        { url: URL_LLM, model: "claude-opus-5-5", desk: "mini-desk" },
        { url: URL_LLM, model: "claude-haiku-5-5", desk: "mini-desk" },
      ])
      expect(lines).toEqual([failed("mini", "opus", "haiku")])
    } finally {
      globalThis.fetch = real
    }
  })

  test("a mounted desk keeps its own fallbacks and step limit; the parent's agents keep theirs", async () => {
    const real = globalThis.fetch
    const fake = fakeModels(["claude-opus-5-5", "claude-haiku-5-5"])
    globalThis.fetch = fake.fetch
    try {
      const lines = []
      const { desk } = await (await import(join(SAMPLE, "main.js"))).default({ dir: SAMPLE }).start({ port: 4322, log: (l) => lines.push(l) })
      expect(desk.agents().get("mini").config).toMatchObject({ maxSteps: 5, fallbacks: ["haiku"] }) // mini-desk/main.js
      expect(desk.agents().get("beta").config.maxSteps).toBe(12) // sample-desk sets none: the kernel's
      expect(await desk.agents().get("beta").ask("hello")).toContain("answered by claude-sonnet-5-5") // sample's: [sonnet]
      await expect(desk.agents().get("mini").ask("hello")).rejects.toThrow("claude-haiku-5-5") // its own: [haiku], never sonnet
      expect(fake.asked.map((a) => [a.model, a.desk])).toEqual([
        ["claude-opus-5-5", "sample-desk"],
        ["claude-sonnet-5-5", "sample-desk"],
        ["claude-opus-5-5", "sample-desk"], // a mounted desk calls the host as the parent desk (it runs in its process)
        ["claude-haiku-5-5", "sample-desk"],
      ])
      expect(lines).toEqual([failed("beta", "opus", "sonnet"), failed("mini", "opus", "haiku"), failed("mini", "haiku")])
    } finally {
      globalThis.fetch = real
    }
  })

  test("a mounted desk without compose options gets the kernel's step limit, not the parent's", async () => {
    const root = join(tmp, "steps")
    tempDesk(root, "top", { agents: { lt: md("name: lt\ndesks: [plain]") } })
    tempDesk(root, "plain", { agents: { lp: md("name: lp") } }) // main.js without conventionDesk
    const desk = await composeDesk({ folder: join(root, "top"), infer: scripted({}), maxSteps: 30 })
    expect(desk.lead.config.maxSteps).toBe(30)
    expect(desk.agents().get("lp").config.maxSteps).toBe(12)
  })
})

describe("scripts/tool.js and scripts/desk.js", () => {
  const ROOT = resolve(import.meta.dir, "../..")
  const run = (...args) => {
    const p = Bun.spawnSync(["bun", ...args], { cwd: ROOT })
    return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() }
  }

  test("tool.js check prints each tool's twin (exit 0); a bad file exits 1 with the reason", () => {
    const ok = run("scripts/tool.js", "check", "companion/team/fixtures/sample-desk/tools/echo.js")
    expect(ok.code).toBe(0)
    expect(JSON.parse(ok.out)).toEqual({ element: "tool", id: "echo", name: "echo", type: "function", view: "text", description: "repeat a text back, with the caller's name", input: { text: "what to repeat" } })
    const bad = run("scripts/tool.js", "check", "companion/team/fixtures/bad-tool/broken.js")
    expect(bad.code).toBe(1)
    expect(bad.err).toContain("broken.js: defineTool broken: description is required")
  })

  test("tool.js run runs one tool with ctx.agent cli", () => {
    const ok = run("scripts/tool.js", "run", "companion/team/fixtures/sample-desk/tools/echo.js", "echo", '{"text":"hi"}')
    expect(ok).toMatchObject({ code: 0, out: "cli heard: hi\n" })
    expect(run("scripts/tool.js", "run", "companion/team/fixtures/sample-desk/tools/echo.js", "nope", "{}")).toMatchObject({ code: 1, err: expect.stringContaining("no tool nope; it has echo") })
    expect(run("scripts/tool.js", "run", "companion/team/fixtures/sample-desk/tools/echo.js", "echo", "{x")).toMatchObject({ code: 1, err: expect.stringContaining("input is not JSON") })
  })

  test("desk.js check prints the tree with the mounted desk and every agent's tools (exit 0)", () => {
    const ok = run("scripts/desk.js", "check", "companion/team/fixtures/sample-desk")
    expect(ok.code).toBe(0)
    const out = JSON.parse(ok.out)
    expect(out.tree.agents.find((a) => a.name === "beta").agents[0]).toMatchObject({ name: "mini", desk: "mini-desk" })
    expect(out.tools).toMatchObject({ alpha: ["echo", "note.save", "sample-desk.board.write"], mini: ["shout", "where", "mini.tally.add", "beta.board.write"] })
    expect(run("scripts/desk.js", "check", "companion/team/fixtures/bad-tool")).toMatchObject({ code: 1, err: expect.stringContaining("no main.js") })
    const kit = run("scripts/desk.js", "check", "companion/team/fixtures/kit-desk") // the kit by name, no tools/ of its own
    expect(kit.code).toBe(0)
    expect(JSON.parse(kit.out).tools.critic).toEqual(["files.list", "files.read", "files.write", "files.edit", "files.append", "files.search", "files.focus", "terminal.wait", "terminal.read", "terminal.list", "preview.open", "preview.text", "preview.shot"])
  })

  test("desk.js check lists the teams/ templates as they spawn (members <team>-<member>); a bad template fails it", () => {
    const kit = run("scripts/desk.js", "check", "companion/team/fixtures/kit-desk")
    expect(kit.code).toBe(0)
    const { templates } = JSON.parse(kit.out)
    expect(templates.probe).toMatchObject({ name: "probe", goal: expect.stringContaining("Every number"), writes: ["shared/*/probe/**"], tools: ["web.search"] })
    expect(templates.probe.members.map((m) => [m.name, m.writes])).toEqual([["probe-watcher", ["shared/*/probe/watch.md"]], ["probe-gauge", ["shared/*/probe/gauge-*.md"]]])
    expect(JSON.parse(run("scripts/desk.js", "check", "companion/team/fixtures/sample-desk").out).templates).toEqual({})
    const folder = tempDesk(join(tmp, "check"), "bad-team", { agents: { l: md("name: l") } })
    mkdirSync(join(folder, "teams", "tm"), { recursive: true })
    writeFileSync(join(folder, "teams", "tm", "agent.md"), md("name: tm\ntools: [web.serch]"))
    const bad = run("scripts/desk.js", "check", folder)
    expect(bad.code).toBe(1)
    expect(bad.err).toContain(`${join(folder, "teams", "tm", "agent.md")}: unknown tool web.serch`)
  })
})

describe("loadTools", () => {
  test("imports every tools/*.js fresh: an edit (helpers in subfolders too) shows at the next load", async () => {
    const dir = join(tmp, "fresh", "tools")
    mkdirSync(join(dir, "lib"), { recursive: true })
    writeFileSync(join(dir, "lib", "word.js"), 'export const word = "one"\n')
    const src = (n) => `import { defineTool } from ${JSON.stringify(KERNEL)}\nimport { word } from "./lib/word.js"\nexport default [defineTool({ name: "count", description: "v${n} " + word, run: async () => "" }), defineTool({ name: "count.more", description: "more", run: async () => "" })]\n`
    writeFileSync(join(dir, "count.js"), src(1))
    writeFileSync(join(dir, "count.test.js"), "throw new Error('never imported')\n")
    const first = await loadTools(dir)
    expect(Object.keys(first)).toEqual(["count", "count.more"])
    expect(first.count.description).toBe("v1 one")
    writeFileSync(join(dir, "count.js"), src(2))
    writeFileSync(join(dir, "lib", "word.js"), 'export const word = "two"\n')
    expect((await loadTools(dir)).count.description).toBe("v2 two")
    expect(await loadTools(join(tmp, "no-such-dir"))).toEqual({})
  })
})
