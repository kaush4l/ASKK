// desk.create's host side (companion/team/scaffold.js, 2026-10-20): a desk written from a spec — agents, practice seeds,
// templates, the init folders — checked before it is in place; refusals leave nothing behind; an update keeps the desk's
// data, state and kept helpers; proposed tool code never lands in tools/.

import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { composeDesk, readDeskConfig } from "./compose.js"
import { checkDesk, CREATE_MARK, proposeTool, scaffoldDesk } from "./scaffold.js"

const root = mkdtempSync(join(tmpdir(), "scaffold-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const clock = () => new Date("2026-10-20T13:00:00Z")

const SPEC = {
  title: "Research desk",
  description: "Answers research questions with sources.",
  request: "make me a desk that researches a question and writes a sourced brief",
  model: "sonnet",
  folders: ["notes", "sources/raw"],
  lead: {
    name: "lead",
    description: "Researches the owner's question; spawns readers for each angle; writes the brief.",
    goal: "A sourced brief that answers the owner's question.",
    role: "SPEC\nQuestion: what does the owner want to know?\n\nRUNBOOK\n1. Split the question into angles.\n2. Spawn a reader per angle.",
    tools: ["web.search", "web.read", "agent.spawn", "agent.dismiss", "agent.catalog"],
    artifacts: ["practice", "dispatch", "files", { type: "plan", gate: true }],
    writes: ["notes/**"],
    practice: { checklist: ["!angles: three angles, each with a reader", "brief: notes/brief.md written"], quality: ["every claim has a link"], instructions: ["prefer primary sources"] },
    members: [{ name: "critic", description: "Judges the brief only.", role: "Reads notes/brief.md and grades each claim.", tools: ["web.read"], artifacts: ["files"], reads: ["notes/**"], board: false }],
  },
  teams: [{ name: "panel", description: "Three readers that argue a point.", role: "Leads the panel.", tools: ["web.search"], members: [{ name: "pro", description: "Argues for.", role: "Argues for." }] }],
}

describe("scaffoldDesk", () => {
  test("writes the desk in the standard's shape, composed before it is in place", async () => {
    const made = await scaffoldDesk({ root, name: "research-desk", spec: SPEC, by: "agent", clock })
    const folder = join(root, "research-desk")
    expect(made.written).toEqual(["README.md", "agents/lead/agent.md", "agents/lead/critic/agent.md", "agents/lead/practice.md", "main.js", "teams/panel/agent.md", "teams/panel/pro/agent.md"])
    const main = readFileSync(join(folder, "main.js"), "utf8")
    expect(main.startsWith(`${CREATE_MARK} (agent, 2026-10-20T13:00): Research desk`)).toBe(true)
    expect(main).toContain('defaultModel: "sonnet"')
    expect(main).toContain('const FOLDERS = ["notes","sources/raw"]')
    const lead = readFileSync(join(folder, "agents", "lead", "agent.md"), "utf8")
    expect(lead).toContain('tools: ["web.search","web.read","agent.spawn","agent.dismiss","agent.catalog"]')
    expect(lead).toContain('artifacts: ["practice","dispatch","files",{"type":"plan","gate":true}]')
    expect(lead).toContain('agents: ["critic"]')
    expect(lead.endsWith("2. Spawn a reader per angle.\n")).toBe(true)
    expect(readFileSync(join(folder, "agents", "lead", "practice.md"), "utf8")).toContain("## Checklist\n- !angles: three angles, each with a reader\n- brief: notes/brief.md written\n\n## Quality\n- every claim has a link")
    expect(readFileSync(join(folder, "agents", "lead", "critic", "agent.md"), "utf8")).toContain('reads: ["notes/**"]\nboard: false')
    expect(readFileSync(join(folder, "README.md"), "utf8")).toContain('from the request: "make me a desk that researches')
    expect(existsSync(join(folder, "tools"))).toBe(true)
    expect(made.check.tree.name).toBe("lead")
    expect(made.check.tree.agents.map((a) => a.name)).toEqual(["critic"])
    expect(made.check.tools.lead).toContain("lead.practice.reflect")
    expect(Object.keys(made.check.templates)).toEqual(["panel"])
    // It runs: its init makes the workspace folders; a run's first prompt carries the practice seeded from practice.md.
    const config = await readDeskConfig(folder)
    const memory = join(root, "memory", "research-desk")
    const prompts = []
    const { desk } = await config.start({ memory, infer: async (prompt) => (prompts.push(prompt), JSON.stringify({ thought: "d", calls: [], answer: "x" })) })
    expect(existsSync(join(folder, "data", "sources", "raw"))).toBe(true)
    desk.lead.config.maxSteps = 2
    await desk.lead.ask("what is a desk?").catch(() => {})
    expect(prompts[0]).toContain("RUN CHECKLIST\n[ ] !angles: three angles, each with a reader")
    expect(prompts[0]).toContain("QUALITY BAR\n- every claim has a link")
    expect(existsSync(join(memory, "practice", "lead.md"))).toBe(true) // the seed became its own file at the first run
    expect((await checkDesk(folder)).lead).toBe("lead")
  })

  test("refusals write nothing: a bad name, a missing role, a name twice, an unknown tool or artifact (the compose's reason)", async () => {
    const bad = async (name, spec, msg, status) => {
      const error = await scaffoldDesk({ root, name, spec, clock }).catch((e) => e)
      expect(error.message).toContain(msg)
      expect(error.status).toBe(status)
      expect(existsSync(join(root, name))).toBe(false)
    }
    await bad("Bad_Name", SPEC, "name: a desk's folder name", 400)
    await bad("x-desk", { ...SPEC, lead: { ...SPEC.lead, role: "" } }, "lead (lead): role is required", 400)
    await bad("x-desk", { ...SPEC, lead: { ...SPEC.lead, members: [{ ...SPEC.lead.members[0], name: "lead" }] } }, "agent name lead twice", 400)
    await bad("x-desk", { ...SPEC, lead: { ...SPEC.lead, tools: ["web.serch"] } }, "the desk does not compose — nothing written: lead: unknown tool web.serch", 422)
    await bad("x-desk", { ...SPEC, lead: { ...SPEC.lead, artifacts: ["ledger"] } }, "unknown artifact ledger", 422)
    await bad("x-desk", { ...SPEC, model: "gpt" }, "model gpt: one of opus, sonnet, haiku", 400)
    await bad("x-desk", { ...SPEC, folders: ["../up"] }, "folders:", 400)
    await bad("x-desk", { ...SPEC, max_steps: "lots" }, "max_steps", 400)
    await bad("x-desk", { ...SPEC, lead: { ...SPEC.lead, max_steps: 900 } }, "max_steps 900", 400)
    await bad("x-desk", { ...SPEC, lead: { ...SPEC.lead, model: "opus\nwrites: [\"**\"]" } }, "model", 400)
    expect(readdirSync(root).some((n) => n.startsWith(".draft-"))).toBe(false)
  })

  test("a title never leaves main.js's first comment (\\r, U+2028, U+2029 end a // comment): nothing in it runs", async () => {
    globalThis.__scaffoldRan = 0
    const title = "Notes\rglobalThis.__scaffoldRan = 1\u2028globalThis.__scaffoldRan = 2\u2029globalThis.__scaffoldRan = 3"
    const made = await scaffoldDesk({ root, name: "title-desk", spec: { ...SPEC, title, by: null }, by: "agent\u2028globalThis.__scaffoldRan = 4", clock })
    expect(made.check.lead).toBe("lead")
    expect(globalThis.__scaffoldRan).toBe(0)
    const first = readFileSync(join(root, "title-desk", "main.js"), "utf8").split("\n")[0]
    expect(first).toStartWith(CREATE_MARK)
    expect(first).not.toMatch(/[\r\u2028\u2029]/)
    rmSync(join(root, "title-desk"), { recursive: true, force: true })
  })

  test("update: only a desk desk.create made; its data, state and kept helpers stay; dropped agents' agent.md go", async () => {
    const folder = join(root, "research-desk")
    expect((await scaffoldDesk({ root, name: "research-desk", spec: SPEC, clock }).catch((e) => e)).status).toBe(409)
    writeFileSync(join(folder, "data", "notes", "keep.md"), "mine")
    mkdirSync(join(folder, "agents", "lead", "scout"), { recursive: true })
    writeFileSync(join(folder, "agents", "lead", "scout", "agent.md"), '---\nname: scout\ngoal: "g"\nkeep: desk\nby: lead\ntools: []\nartifacts: []\n---\nScouts.\n')
    const next = { ...SPEC, lead: { ...SPEC.lead, members: [], practice: { checklist: ["!brief: notes/brief.md written"] } } }
    const made = await scaffoldDesk({ root, name: "research-desk", spec: next, update: true, clock })
    expect(made.check.tree.agents).toEqual([])
    expect(existsSync(join(folder, "agents", "lead", "critic", "agent.md"))).toBe(false)
    expect(readFileSync(join(folder, "data", "notes", "keep.md"), "utf8")).toBe("mine")
    expect(existsSync(join(folder, "agents", "lead", "scout", "agent.md"))).toBe(true)
    expect(readFileSync(join(folder, "agents", "lead", "agent.md"), "utf8")).not.toContain("agents:")
    // A spec that drops the agent whose folder holds kept helpers would orphan them: refused, nothing written.
    const orphan = await scaffoldDesk({ root, name: "research-desk", spec: { ...next, lead: { ...next.lead, name: "boss" } }, update: true, clock }).catch((e) => e)
    expect(orphan.status).toBe(409)
    expect(orphan.message).toContain("agents/lead holds kept helpers (scout)")
    expect(existsSync(join(folder, "agents", "lead", "agent.md"))).toBe(true)
    expect(existsSync(join(folder, "agents", "boss"))).toBe(false)
    // A desk folder that is a link is never written through.
    symlinkSync(folder, join(root, "linked-desk"))
    expect((await scaffoldDesk({ root, name: "linked-desk", spec: next, update: true, clock }).catch((e) => e)).status).toBe(403)
    expect(() => proposeTool({ root, name: "linked-desk", file: "x", code: "1", why: "w" })).toThrow("is a link")
    rmSync(join(root, "linked-desk"))
    // The owner's desk (no mark) is never rewritten.
    mkdirSync(join(root, "owners"), { recursive: true })
    writeFileSync(join(root, "owners", "main.js"), "export default () => ({})\n")
    expect((await scaffoldDesk({ root, name: "owners", spec: SPEC, update: true, clock }).catch((e) => e)).message).toContain("was not made by desk.create")
  })

  test("proposeTool: the code under proposed/tools/ with who and why — never in tools/, never loaded", async () => {
    const r = proposeTool({ root, name: "research-desk", file: "notes", code: "export default 1", why: "save notes by title", by: "lead", clock })
    expect(r.path).toBe("custom/research-desk/proposed/tools/notes.js")
    const text = readFileSync(join(root, "research-desk", "proposed", "tools", "notes.js"), "utf8")
    expect(text).toStartWith("// proposed by lead at 2026-10-20T13:00 — not loaded: the owner moves it to tools/ to accept it.\n// why: save notes by title\nexport default 1")
    expect(existsSync(join(root, "research-desk", "tools", "notes.js"))).toBe(false)
    expect(() => proposeTool({ root, name: "research-desk", file: "../x", code: "1", why: "w" })).toThrow("file:")
    const desk = await composeDesk({ folder: join(root, "research-desk"), infer: async () => "" })
    expect([...desk.lead.tools.keys()].some((k) => k.startsWith("notes"))).toBe(false)
  })
})
