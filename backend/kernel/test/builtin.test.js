// The inbuilt kit's catalogue (backend/kernel/builtin/index.js, 2026-10-17): attach by name, one instance per desk,
// {type, id} a separate one, a commands subset, the plan's gate; the twin states exactly as the spec's table; agent.spawn
// resolving the catalogue at run time; board: false.

import { describe, expect, test } from "bun:test"
import { BUILTIN, buildDesk, builtinKit, deskTools, Dispatch, Files, Plan, Preview, Terminal, Tool } from "../index.js"
import { fakeHost } from "./fake-host.js"

const clock = () => new Date("2026-10-17T14:00:00Z")
function scripted(script) {
  return async (_, agent) => JSON.stringify(script[agent.name]?.shift() ?? { thought: "done", calls: [], answer: `${agent.name} done` })
}
const quest = (ask) => ({ requirement: "a kit test", ask, outcome: "one line" })

describe("BUILTIN", () => {
  test("the catalogue: tools and artifact types by name, each a factory of desk options", () => {
    expect(Object.keys(BUILTIN.tools)).toEqual(["web.search", "web.read", "agent.spawn", "agent.dismiss", "agent.catalog", "agent.update", "desk.list", "desk.create", "desk.check", "desk.load", "desk.ask", "desk.read", "desk.propose"]) // 2026-10-20: catalog, update and the desk tools
    expect(Object.keys(BUILTIN.artifacts)).toEqual(["files", "terminal", "preview", "plan", "dispatch", "browse", "talk", "studio", "workflow", "practice"]) // 2026-10-22: workflow; 2026-10-20: practice; 2026-10-17: no stage — the preview is the one pane; 2026-10-18: no charts (a dashboard is a page in it), browse and talk added
    const kit = builtinKit({ clock })
    for (const t of Object.values(kit.tools)) expect(t).toBeInstanceOf(Tool)
    expect(kit.tools["web.search"]).toMatchObject({ name: "web.search", type: "function", view: "web" })
    expect(kit.tools["agent.spawn"]).toMatchObject({ type: "spawn", view: "spawn" })
    const agent = { name: "a" }
    expect(kit.artifacts.files(agent, { type: "files" })).toBeInstanceOf(Files)
    expect(kit.artifacts.terminal(agent, {})).toBeInstanceOf(Terminal)
    expect(kit.artifacts.preview(agent, {})).toBeInstanceOf(Preview)
    expect(kit.artifacts.plan(agent, {})).toBeInstanceOf(Plan)
    expect(kit.artifacts.dispatch(agent, {})).toBeInstanceOf(Dispatch)
  })

  test("one instance per desk and id: every holder of files shares it; {type, id} is another; a second desk its own", () => {
    const kit = builtinKit({ clock })
    const desk = buildDesk(
      {
        name: "lead",
        artifacts: ["files", "terminal", "preview", { type: "plan", gate: true }],
        tools: [
          { type: "agent", name: "coder", writes: ["projects/**"], artifacts: ["files", "terminal", "plan", { type: "files", id: "notes" }] },
          { type: "agent", name: "critic", board: false, reads: ["projects/*/out/**"], artifacts: ["files", { type: "terminal", commands: ["read", "wait"] }] },
        ],
      },
      { infer: scripted({}), artifacts: kit.artifacts, tools: kit.tools },
    )
    const all = desk.artifacts()
    expect([...all.keys()]).toEqual(["files", "terminal", "preview", "plan", "lead.board", "notes"])
    expect(all.get("files").holders).toEqual(["lead", "coder", "critic"])
    expect(all.get("terminal").holders).toEqual(["lead", "coder", "critic"])
    expect(all.get("plan").holders).toEqual(["lead", "coder"])
    expect(all.get("notes")).toMatchObject({ holders: ["coder"] })
    expect(all.get("notes").artifact).not.toBe(all.get("files").artifact)
    expect([...desk.agents().get("coder").tools.keys()].filter((k) => k.startsWith("notes."))).toEqual(["notes.list", "notes.read", "notes.write", "notes.edit", "notes.append", "notes.search", "notes.focus"])
    // The plan gates only the holder that asked for it.
    expect(desk.lead.gates("done").join()).toContain("no plan yet — ask the planner to write plan")
    expect(desk.agents().get("coder").gates("done").join()).not.toContain("plan")
    // A commands subset, and board: false (the critic never sees the team's notes).
    const critic = desk.agents().get("critic")
    expect([...critic.tools.keys()].filter((k) => k.startsWith("terminal."))).toEqual(["terminal.wait", "terminal.read"])
    expect(critic.artifacts.map((a) => a.id)).toEqual(["files", "terminal"])
    expect(desk.agents().get("coder").artifacts.map((a) => a.id)).toContain("lead.board")
    // Another desk (another kit) has its own.
    expect(builtinKit().artifacts.files({ name: "x" }, {})).not.toBe(all.get("files").artifact)
    expect(() => kit.artifacts.files({ name: "x" }, { id: "Bad Id" })).toThrow('x: files id "Bad Id"')
  })

  test("the twin states, exactly as the spec's table (files, terminal, preview, plan)", async () => {
    const host = fakeHost({ files: { "projects/x/train.py": "a = 1\n" } })
    const kit = builtinKit({ clock })
    const desk = buildDesk({ name: "coder", writes: ["projects/**"], artifacts: ["files", "terminal", "preview", "plan"] }, { infer: scripted({}), artifacts: kit.artifacts, context: { host } })
    const coder = desk.lead
    const run = (tool, input) => coder.tools.get(tool).run(input, { ...coder.context, agent: coder })
    await run("files.read", { path: "projects/x/train.py" })
    await run("files.edit", { path: "projects/x/train.py", old: "a = 1", new: "a = 2" })
    await run("files.focus", { path: "projects" })
    await run("terminal.run", { command: "uv run train.py" })
    await run("preview.open", { url: "http://localhost:8001/" })
    await run("plan.write", { goal: "train", items: ["loss: the loss goes down"] })
    const twin = desk.twin().artifacts
    const keys = (o) => Object.keys(o)
    const files = twin.files
    expect(files).toMatchObject({ kind: "files", view: "files", keep: "always", holders: ["coder"] })
    expect(keys(files.state)).toEqual(["root", "tree", "truncated", "open", "modified", "focus", "unreadable"])
    expect(keys(files.state.tree[0])).toEqual(["path", "size", "mtime", "dir"])
    expect(keys(files.state.open[0])).toEqual(["path", "by", "at"])
    expect(keys(files.state.modified[0])).toEqual(["path", "by", "at", "op", "added", "removed", "diff"])
    expect(keys(files.state.focus)).toEqual(["path", "by", "at"])
    expect(files.state).toMatchObject({ root: "projects", truncated: false, focus: { path: "projects", by: "coder" }, open: [{ path: "projects/x/train.py", by: "coder" }] })
    const terminal = twin.terminal
    expect(terminal).toMatchObject({ kind: "terminal", view: "terminal", keep: "file" })
    expect(keys(terminal.state)).toEqual(["sessions"])
    expect(keys(terminal.state.sessions[0])).toEqual(["id", "name", "command", "cwd", "agent", "slot", "lease", "runs", "status", "exit", "startedAt", "endedAt", "urls", "tail"])
    const preview = twin.preview
    expect(preview).toMatchObject({ kind: "preview", view: "preview", keep: "always" })
    expect(keys(preview.state)).toEqual(["pages", "visuals", "current", "trail", "asks", "revision"])
    expect(preview.state.current).toMatchObject({ kind: "page", id: preview.state.pages[0].id })
    expect(keys(preview.state.pages[0])).toEqual(["id", "url", "title", "status", "by", "at", "shot", "console", "errors"])
    expect(keys(preview.state.pages[0].shot)).toEqual(["n", "at", "width", "height", "url"])
    const plan = twin.plan
    expect(plan).toMatchObject({ kind: "plan", view: "checklist", keep: "always" })
    expect(keys(plan.state)).toEqual(["goal", "revision", "by", "at", "items"])
    expect(keys(plan.state.items[0])).toEqual(["id", "text", "required", "status", "note", "by", "at"])
    // Their commands: type dev (never answered from the run's data cache), drawn by their view.
    for (const [name, view] of [["files.read", "files"], ["terminal.run", "terminal"], ["preview.open", "preview"]]) expect(coder.tools.get(name)).toMatchObject({ type: "dev", view })
  })

  // 2026-10-17: dispatch (work that runs while its holder works).
  test("dispatch: one instance per desk and id; its twin state as the spec's", async () => {
    const host = fakeHost()
    const kit = builtinKit({ clock })
    let release
    const held = new Promise((ok) => (release = ok))
    const infer = async (_, agent) => {
      if (agent.name === "data") await held
      return JSON.stringify({ thought: "done", calls: [], answer: `${agent.name} done` })
    }
    const desk = buildDesk(
      { name: "lead", report: false, artifacts: ["dispatch"], tools: [{ type: "agent", name: "data", report: false, artifacts: ["dispatch", { type: "dispatch", id: "probes" }] }] },
      { infer, artifacts: kit.artifacts, context: { host } },
    )
    const all = desk.artifacts()
    expect([...all.keys()]).toEqual(["dispatch", "lead.board", "probes"])
    expect(all.get("dispatch").holders).toEqual(["lead", "data"])
    expect(all.get("probes").holders).toEqual(["data"])
    expect(all.get("probes").artifact).not.toBe(all.get("dispatch").artifact)
    expect(builtinKit().artifacts.dispatch({ name: "x" }, {})).not.toBe(all.get("dispatch").artifact)
    const lead = desk.lead
    const run = (tool, input) => lead.tools.get(tool).run(input, { ...lead.context, agent: lead })
    expect(await run("dispatch.start", { to: "data", ...quest("which shard?") })).toStartWith("j1 → data started")
    const twin = desk.twin().artifacts
    const keys = (o) => Object.keys(o)
    expect(twin.dispatch).toMatchObject({ kind: "dispatch", view: "dispatch", keep: "file", brief: "1 running · 0 done", holders: ["lead", "data"] })
    expect(keys(twin.dispatch.state)).toEqual(["jobs"])
    expect(keys(twin.dispatch.state.jobs[0])).toEqual(["id", "to", "by", "ask", "status", "startedAt", "endedAt", "report", "error", "began", "delivered"])
    expect(twin.dispatch.state.jobs[0]).toMatchObject({ id: "j1", to: "data", by: "lead", ask: "which shard?", status: "running", startedAt: "2026-10-17T14:00:00.000Z" })
    for (const [name, view] of [["dispatch.start", "dispatch"], ["dispatch.wait", "dispatch"]]) expect(lead.tools.get(name)).toMatchObject({ type: "dev", view })
    expect(lead.gates("x").join()).toContain("1 job still running: j1 → data")
    release()
    expect(await run("dispatch.wait", {})).toMatch(/^j1 → data done in \d+s:\ndata done$/)
    expect(lead.gates("x")).toEqual([])
  })

  test("agent.spawn resolves the catalogue at run time: a tool the caller does not hold, a shared artifact by type", async () => {
    const host = fakeHost()
    const kit = builtinKit({ clock })
    const infer = scripted({
      lead: [
        { thought: "spawn", calls: [{ tool: "agent.spawn", input: { name: "scout", role: "reads pages", goal: "find the paper", tools: ["web.read"], artifacts: ["terminal", { type: "files", commands: ["read"] }] } }] },
        { thought: "quest", calls: [{ tool: "scout", input: quest("which paper?") }] },
        { thought: "done", calls: [], answer: "lead done" },
      ],
    })
    const desk = buildDesk({ name: "lead", board: false, tools: ["agent.spawn"], artifacts: ["terminal", "files"] }, { infer, tools: kit.tools, artifacts: kit.artifacts, context: { host } })
    const seen = []
    desk.on((e) => e.event === "spawn" && seen.push(e))
    const helper = new Promise((ok) => desk.on((e) => e.event === "spawn" && ok(desk.agents().get(e.agent))))
    expect(await desk.ask("go")).toBe("lead done")
    const scout = await helper
    expect([...scout.tools.keys()]).toEqual(["web.read", "terminal.run", "terminal.start", "terminal.wait", "terminal.read", "terminal.send", "terminal.stop", "terminal.list", "files.read"])
    expect(scout.tools.get("web.read")).toBe(kit.tools["web.read"])
    expect(scout.artifacts.find((a) => a.id === "terminal")).toBe(desk.lead.artifacts.find((a) => a.id === "terminal"))
    expect(scout.config.board).toBe(false) // a helper of a caller kept off the board is kept off it too
    expect(seen).toHaveLength(1)
  })
})

describe("desk.read", () => {
  test("a reader with a reads: lane reads another desk only where its lane names desks/<name>/…", async () => {
    const posted = []
    const host = { post: async (route, body) => (posted.push([route, body]), { path: body.path, text: "brief" }) }
    const read = deskTools()["desk.read"]
    const as = (reads) => ({ host, agent: { name: "helper", config: reads ? { reads } : {} } })
    expect(await read.run({ name: "notes-desk", path: "./out//brief.md" }, as(null))).toBe("notes-desk: out/brief.md\nbrief")
    await expect(read.run({ name: "notes-desk", path: "out/brief.md" }, as(["notes/**"]))).rejects.toThrow("helper reads only notes/** (its reads:) — desks/notes-desk/out/brief.md is outside its lane")
    expect(await read.run({ name: "notes-desk", path: "out/brief.md" }, as(["desks/notes-desk/**"]))).toContain("brief")
    await expect(read.run({ name: "notes-desk", path: "../x" }, as(null))).rejects.toThrow('".." is not a workspace path')
    expect(posted.map(([r, b]) => `${r} ${b.path}`)).toEqual(["desks/read out/brief.md", "desks/read out/brief.md"])
  })
})
