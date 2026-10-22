// Kept helpers on disk (companion/team/kept.js, 2026-10-20): an agent.md's members are its own subfolders only, each read
// once; a kept helper's folder never replaces an agent.md that is not a kept helper's.

import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { keptFolderOf, readKept, writeKept } from "./kept.js"
import { agentTreeRoot } from "./layout.js"

const root = mkdtempSync(join(tmpdir(), "kept-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const md = (folder, head, role = "Works.") => {
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, "agent.md"), `---\n${head}\n---\n${role}\n`)
}

describe("kept helpers", () => {
  test("members: a spawn name under the folder only — never .., never the folder itself, never a loop", () => {
    const lead = join(root, "agents", "lead")
    md(lead, "name: lead\ntools: []")
    md(join(root, "agents", "secret"), "name: secret\ntools: []", "The owner's other agent.")
    md(join(lead, "scout"), 'name: scout\nkeep: desk\nby: lead\ntools: []\nagents: ["../../secret", ".", "scout", "pair"]', "Scouts.")
    md(join(lead, "scout", "pair"), 'name: pair\nmember_of: scout\ntools: []\nagents: ["pair"]', "Pairs.")
    const kept = readKept([{ name: "lead", folder: lead }])
    expect(kept.map((k) => k.input.name)).toEqual(["scout"])
    expect(kept[0].input.members.map((m) => m.name)).toEqual(["pair"])
    expect(kept[0].input.members[0].members).toBeUndefined()
  })

  test("keptFolderOf: inside its spawner's folder, unless an agent.md there is not a kept helper's", () => {
    const lead = join(root, "agents", "lead")
    md(join(lead, "mine"), "name: mine\ntools: []", "The owner's member.")
    const agents = new Map([["lead", { name: "lead", config: { folder: lead } }]])
    const helper = (name) => ({ name, config: { spawned: { by: "lead", keep: "desk" } } })
    expect(keptFolderOf(helper("fresh"), { agentsRoot: join(root, "agents"), agents })).toBe(join(lead, "fresh"))
    expect(keptFolderOf(helper("scout"), { agentsRoot: join(root, "agents"), agents })).toBe(join(lead, "scout"))
    expect(keptFolderOf(helper("mine"), { agentsRoot: join(root, "agents"), agents })).toBeNull()
  })

  // 2026-10-21: the standard layout — the lead is <desk>/<lead>/<lead>.md, the agent tree its folder; a kept helper is
  // <spawner folder>/<name>/<name>.md, read back as agent.md ones are; nothing is kept outside the lead's folder.
  test("the standard layout: <spawner>/<name>/<name>.md written and read back; the tree is the lead's folder", () => {
    const desk = join(root, "std")
    const lead = join(desk, "boss")
    mkdirSync(lead, { recursive: true })
    writeFileSync(join(lead, "boss.md"), "---\nname: boss\ntools: []\n---\nLeads.\n")
    expect(agentTreeRoot(desk)).toBe(lead)
    expect(agentTreeRoot(join(root, "nothing-here"))).toBe(join(root, "nothing-here", "agents")) // no lead: the legacy path (nothing there)
    const boss = { name: "boss", config: { folder: lead } }
    const scout = { name: "scout", config: { role: "Scouts.", spawned: { by: "boss", keep: "desk", goal: "scout", at: "2026-10-21T13:00:00.000Z", input: { name: "scout", role: "Scouts.", tools: ["web.read"] } } }, children: [] }
    const agents = new Map([["boss", boss], ["scout", scout]])
    const folder = keptFolderOf(scout, { agentsRoot: agentTreeRoot(desk), agents })
    expect(folder).toBe(join(lead, "scout"))
    writeKept(scout, folder, agents)
    expect(readFileSync(join(folder, "scout.md"), "utf8")).toContain("name: scout\ngoal: \"scout\"\nkeep: desk\nby: boss\n")
    expect(existsSync(join(folder, "agent.md"))).toBe(false)
    expect(readKept([{ name: "boss", folder: lead }]).map((k) => [k.by, k.input.name, k.input.tools, k.folder])).toEqual([["boss", "scout", ["web.read"], folder]])
    // a helper of a run helper (its folder in state/spawned/) is never kept; neither is a helper named history or practice
    const runHelper = { name: "temp", config: { folder: join(desk, "state", "spawned", "temp") } }
    agents.set("temp", runHelper)
    expect(keptFolderOf({ name: "deep", config: { spawned: { by: "temp", keep: "desk" } } }, { agentsRoot: agentTreeRoot(desk), agents })).toBeNull()
    expect(keptFolderOf({ name: "history", config: { spawned: { by: "boss", keep: "desk" } } }, { agentsRoot: agentTreeRoot(desk), agents })).toBeNull()
    // a kept helper written before as agent.md stays agent.md when rewritten
    const old = join(lead, "elder")
    md(old, 'name: elder\nkeep: desk\nby: boss\ntools: []', "Old.")
    writeKept({ name: "elder", config: { role: "Old.", spawned: { by: "boss", keep: "desk", input: { name: "elder", role: "Older.", tools: [] } } } }, old, agents)
    expect(readFileSync(join(old, "agent.md"), "utf8")).toContain("Older.")
    expect(existsSync(join(old, "elder.md"))).toBe(false)
  })
})
