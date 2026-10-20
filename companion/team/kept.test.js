// Kept helpers on disk (companion/team/kept.js, 2026-10-20): an agent.md's members are its own subfolders only, each read
// once; a kept helper's folder never replaces an agent.md that is not a kept helper's.

import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { keptFolderOf, readKept } from "./kept.js"

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
})
