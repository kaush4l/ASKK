// Agent tree loading (definitions.js loadAgentTree): flat folders as before, team folders (own index.json, team.md,
// soul.md) nested, the manager flag, the YOUR TEAM block, unique names, depth and containment; agent.md toolkits.
// Run: bun test ./backend/agents

import { describe, expect, test } from "bun:test"
import { loadAgentTree, MAX_TEAM_DEPTH, validateAgent } from "./definitions"

const BASE = new URL("file:///desk/agents/")

const agentMd = (name, extra = "") => `---\nname: ${name}\ndescription: ${name} agent.\nresponse_format: toon\n${extra}---\nYou are ${name}.\n`

// A reader over a { "rel/path": text } map, like fetch over the host's sources route.
function tree(files) {
  const read = async (url, { optional = false } = {}) => {
    const rel = url.pathname.slice(BASE.pathname.length)
    if (Object.hasOwn(files, rel)) return files[rel]
    if (optional) return null
    throw new Error(`Cannot load ${url.pathname}: HTTP 404`)
  }
  return loadAgentTree({ id: "private:desk", name: "desk", base: BASE, read })
}

const json = (value) => JSON.stringify(value)

describe("flat folders (back-compat)", () => {
  test("load unchanged: no team, no manages, folder = name, shared soul", async () => {
    const agents = await tree({
      "index.json": json(["lead", "helper"]),
      "soul.md": "Be kind.",
      "lead/agent.md": agentMd("lead", "agents: [helper]\n"),
      "helper/agent.md": agentMd("helper"),
    })
    expect(agents.map((a) => a.name)).toEqual(["lead", "helper"])
    for (const a of agents) {
      expect(a.team).toBeUndefined()
      expect(a.manages).toBeUndefined()
      expect(a.soul).toBe("Be kind.")
      expect(a.source).toBe("private:desk")
      expect(a.instructions).not.toContain("YOUR TEAM")
    }
    expect(agents[1].folder).toBe("helper")
  })

  test("an entry with neither agent.md nor index.json is an error", async () => {
    await expect(tree({ "index.json": json(["lead"]) })).rejects.toThrow("neither agent.md nor index.json")
  })
})

describe("team folders", () => {
  const files = {
    "index.json": json(["lead", "research", "build"]),
    "soul.md": "Shared soul.",
    "lead/agent.md": agentMd("lead", "agents: [analyst, builder]\n"),
    "research/index.json": json(["analyst", "reader", "scout"]),
    "research/team.md": "---\nname: RESEARCH\ngoal: The brief by noon.\npurpose: Sources & citations.\n---\nResearch noise stops here.\n",
    "research/soul.md": "Research soul.",
    "research/analyst/agent.md": agentMd("analyst", "agents: [reader, scout]\n"),
    "research/reader/agent.md": agentMd("reader"),
    "research/scout/agent.md": agentMd("scout"),
    "build/index.json": json(["builder", "tester"]),
    "build/builder/agent.md": agentMd("builder", "agents: [tester, scout]\n"),
    "build/tester/agent.md": agentMd("tester"),
  }

  test("members in manifest order, team paths, manager flag, folder paths", async () => {
    const agents = await tree(files)
    expect(agents.map((a) => a.name)).toEqual(["lead", "analyst", "reader", "scout", "builder", "tester"])
    const by = Object.fromEntries(agents.map((a) => [a.name, a]))
    expect(by.lead.team).toBeUndefined()
    expect(by.analyst).toMatchObject({ team: "research", manages: "research", folder: "research/analyst" })
    expect(by.reader).toMatchObject({ team: "research", folder: "research/reader" })
    expect(by.reader.manages).toBeUndefined()
    expect(by.builder).toMatchObject({ team: "build", manages: "build" })
  })

  test("team.md becomes a YOUR TEAM block for every member, the manager included", async () => {
    const by = Object.fromEntries((await tree(files)).map((a) => [a.name, a]))
    for (const n of ["analyst", "reader", "scout"]) {
      expect(by[n].instructions).toContain("## YOUR TEAM")
      expect(by[n].instructions).toContain("RESEARCH (`research`) — manager: analyst; members: reader, scout.")
      expect(by[n].instructions).toContain("Goal: The brief by noon.")
      expect(by[n].instructions).toContain("Purpose: Sources & citations.")
      expect(by[n].instructions).toContain("Research noise stops here.")
      expect(by[n].instructions.startsWith(`You are ${n}.`)).toBe(true)
    }
    expect(by.analyst.instructions).toContain("You are its manager")
    expect(by.analyst.instructions).toContain("You report to lead (the lead).")
    expect(by.reader.instructions).toContain("You report to analyst, its manager.")
    // no team.md: the folder name, no goal line
    expect(by.tester.instructions).toContain("build (`build`) — manager: builder; members: tester.")
    expect(by.tester.instructions).not.toContain("Goal:")
    expect(by.lead.instructions).not.toContain("YOUR TEAM")
  })

  test("a team soul.md overrides the shared soul for its members; others inherit", async () => {
    const by = Object.fromEntries((await tree(files)).map((a) => [a.name, a]))
    expect(by.analyst.soul).toBe("Research soul.")
    expect(by.scout.soul).toBe("Research soul.")
    expect(by.builder.soul).toBe("Shared soul.")
    expect(by.lead.soul).toBe("Shared soul.")
  })

  test("teams in teams: two levels, each block names its own team; the sub-manager reports up", async () => {
    const agents = await tree({
      "index.json": json(["lead", "research"]),
      "lead/agent.md": agentMd("lead"),
      "research/index.json": json(["analyst", "sources"]),
      "research/analyst/agent.md": agentMd("analyst"),
      "research/sources/index.json": json(["librarian", "archivist"]),
      "research/sources/team.md": "---\nname: SOURCES\ngoal: Archives and indexes.\n---\n",
      "research/sources/librarian/agent.md": agentMd("librarian"),
      "research/sources/archivist/agent.md": agentMd("archivist"),
    })
    const by = Object.fromEntries(agents.map((a) => [a.name, a]))
    expect(by.librarian).toMatchObject({ team: "research/sources", manages: "research/sources", folder: "research/sources/librarian" })
    expect(by.archivist.team).toBe("research/sources")
    expect(by.analyst.instructions).toContain("research (`research`) — manager: analyst; members: librarian.")
    expect(by.librarian.instructions).toContain("SOURCES (`research/sources`) — manager: librarian; members: archivist.")
    expect(by.librarian.instructions).toContain("You report to analyst (research).")
    expect(by.librarian.instructions.match(/## YOUR TEAM/g)).toHaveLength(1)
  })

  test("depth is capped", async () => {
    const files = { "index.json": json(["lead", "t1"]), "lead/agent.md": agentMd("lead") }
    let path = "t1"
    for (let d = 1; d <= MAX_TEAM_DEPTH + 1; d++) {
      files[`${path}/index.json`] = json([`m${d}`, `t${d + 1}`])
      files[`${path}/m${d}/agent.md`] = agentMd(`m${d}`)
      path = `${path}/t${d + 1}`
    }
    files[`${path}/index.json`] = json(["last"])
    files[`${path}/last/agent.md`] = agentMd("last")
    await expect(tree(files)).rejects.toThrow(`nest at most ${MAX_TEAM_DEPTH} deep`)
  })

  test("agent names stay unique across the whole tree", async () => {
    await expect(
      tree({
        "index.json": json(["lead", "research"]),
        "lead/agent.md": agentMd("lead"),
        "research/index.json": json(["analyst", "dup"]),
        "research/analyst/agent.md": agentMd("analyst"),
        "research/dup/agent.md": agentMd("lead"),
      })
    ).rejects.toThrow("Duplicate agent: lead")
  })

  test("a team's first entry must be an agent (its manager)", async () => {
    await expect(
      tree({
        "index.json": json(["lead", "research"]),
        "lead/agent.md": agentMd("lead"),
        "research/index.json": json(["sub", "analyst"]),
        "research/analyst/agent.md": agentMd("analyst"),
        "research/sub/index.json": json(["x"]),
        "research/sub/x/agent.md": agentMd("x"),
      })
    ).rejects.toThrow("first entry is its manager")
  })

  test("manifests are checked: unsafe names, duplicates, an empty team", async () => {
    await expect(tree({ "index.json": json(["../x"]) })).rejects.toThrow("Invalid index.json")
    await expect(tree({ "index.json": json(["lead", "lead"]) })).rejects.toThrow("Invalid index.json")
    await expect(
      tree({ "index.json": json(["lead", "empty"]), "lead/agent.md": agentMd("lead"), "empty/index.json": "[]" })
    ).rejects.toThrow("Invalid index.json")
  })

  test("references stay inside the agents folder", async () => {
    await expect(
      tree({
        "index.json": json(["lead"]),
        "lead/agent.md": agentMd("lead", "checklist_template: ../../outside.md\n"),
      })
    ).rejects.toThrow("must be inside the agents folder")
  })
})

describe("toolkits", () => {
  const base = { name: "researcher", description: "d", response_format: "toon", strategy: "react", skills: {}, instructions: "x", tools: ["fs.read", "fs.write"], artifacts: ["shared", "team"], mcp: ["github.search", "notes.read", "github"] }

  test("a kit within the agent's tools and mcp is kept; a server grants its tools", () => {
    const agent = validateAgent({ ...base, toolkits: { source: { tools: ["fs.read"], mcp: ["github.search", "github.get_issue"], once: true, max_steps: 8, role: "One source." } } })
    expect(agent.toolkits.source.mcp).toEqual(["github.search", "github.get_issue"])
  })

  test("a kit giving more than the agent has is refused", () => {
    expect(() => validateAgent({ ...base, toolkits: { source: { mcp: ["notes.write"] } } })).toThrow("does not have: notes.write")
    expect(() => validateAgent({ ...base, toolkits: { source: { tools: ["fs.delete"] } } })).toThrow("does not have")
    expect(() => validateAgent({ ...base, toolkits: { source: { artifacts: ["team"] } } })).toThrow("does not have: team")
  })

  test("shape is checked", () => {
    expect(() => validateAgent({ ...base, toolkits: ["source"] })).toThrow("toolkits must be a map")
    expect(() => validateAgent({ ...base, toolkits: { source: "github.search" } })).toThrow("must be a map")
    expect(() => validateAgent({ ...base, toolkits: { source: { mcp: ["github.search"], model: "x" } } })).toThrow("unknown keys model")
    expect(() => validateAgent({ ...base, toolkits: { source: { max_steps: 0 } } })).toThrow("max_steps")
  })

  test("parsed from agent.md frontmatter (nested maps)", async () => {
    const agents = await tree({
      "index.json": json(["researcher"]),
      "researcher/agent.md": agentMd(
        "researcher",
        "tools: [fs.write]\nartifacts: [shared, team]\nmcp: [github.search, notes.read]\ntoolkits:\n  source:\n    mcp: [github.search]\n    once: true\n    max_steps: 8\n    role: \"One source: is it current?\"\n  notes:\n    mcp: [notes.read]\n"
      ),
    })
    expect(agents[0].toolkits).toEqual({ source: { mcp: ["github.search"], once: true, max_steps: 8, role: "One source: is it current?" }, notes: { mcp: ["notes.read"] } })
  })
})
