// Spawner: once helpers (one source, one question) end as soon as their report is in; task agents stay until killed or
// idle past their limit. Run: bun test ./backend/runtime

import { describe, expect, test } from "bun:test"
import { createSpawner } from "./spawner"

function team(extra = {}) {
  const live = []
  const removed = []
  const fake = (agent) => {
    const subs = new Set()
    const e = {
      id: `e-${agent.name}`,
      agent,
      status: "idle",
      state: { status: "idle", working: null, inbox: [], quests: [], approvals: [] },
      getSnapshot: () => e.state,
      subscribe: (fn) => (subs.add(fn), () => subs.delete(fn)),
      set(patch) {
        Object.assign(e.state, patch)
        e.status = e.state.status
        for (const fn of subs) fn()
      },
    }
    return e
  }
  const lead = fake({ name: "researcher", artifacts: ["team", "shared"], tools: ["fs.write"], mcp: ["github.search", "notes.read"], writes: ["shared/2*/researcher.md"], response_format: "toon", soul: "s", ...extra })
  const spawner = createSpawner({
    agents: () => [lead.agent],
    engines: () => live,
    add: (agent) => {
      const e = fake(agent)
      live.push(e)
      return e
    },
    remove: (e) => {
      e.status = "disposed"
      removed.push(e.agent.name)
    },
    replace: () => {},
    onceGraceMs: 20,
  })
  return { lead, live, removed, spawner }
}

const role = "Reads one source and reports what it says, with the quotes."

describe("once helpers", () => {
  test("ended after working then going idle; never before it worked", async () => {
    const { lead, live, removed, spawner } = team()
    const made = spawner.spawn(lead, { name: "researcher-docs", role, once: true, tools: [] })
    expect(made).toMatchObject({ name: "researcher-docs", once: true, keep: false })
    const h = live[0]
    expect(h.agent.tools).toEqual([]) // no fs.write: a helper cannot touch the lead's day file
    expect(h.agent.instructions).toContain("one-shot helper")
    await Bun.sleep(40)
    expect(removed).toEqual([]) // idle before its quest arrived: kept
    h.set({ status: "running", working: { origin: "q1" } })
    h.set({ status: "idle", working: null })
    await Bun.sleep(40)
    expect(removed).toEqual(["researcher-docs"])
    expect(spawner.roster(lead).ended.at(-1)).toMatchObject({ name: "researcher-docs", reason: "report delivered (once)" })
  })

  test("a task agent (no once) is not ended on idle; keep wins over once", async () => {
    const { lead, live, removed, spawner } = team()
    spawner.spawn(lead, { name: "researcher-api", role })
    spawner.spawn(lead, { name: "researcher-faq", role, once: true, keep: true })
    for (const h of live) {
      h.set({ status: "running", working: { origin: "q" } })
      h.set({ status: "idle", working: null })
    }
    await Bun.sleep(40)
    expect(removed).toEqual([])
    expect(live[1].agent.spawned.once).toBeUndefined()
  })
})

describe("laneWithin", async () => {
  const { laneWithin } = await import("@/backend/features/filesystem/guard")
  test("own glob lane, narrower, wider", () => {
    expect(laneWithin(["shared/2*/researcher.md"], ["shared/2*/researcher.md", "shared/notes.md"])).toBe(true)
    expect(laneWithin(["src/parser/**"], ["src/**"])).toBe(true)
    expect(laneWithin(["src/*.js"], ["src/**"])).toBe(true)
    expect(laneWithin(["src/**"], ["src/a.js"])).toBe(false)
    expect(laneWithin(["**"], ["src/**"])).toBe(false)
    expect(laneWithin(["shared/**"], ["shared/2*/researcher.md"])).toBe(false)
    expect(laneWithin(["src/x/"], ["src/**"])).toBe(true)
  })
})

describe("toolkits (agent.spawn {toolkit, focus})", () => {
  const toolkits = {
    source: { mcp: ["github.search"], once: true, max_steps: 8, role: "One source: what it says, with the quote that decides it." },
    notes: { tools: ["fs.write"], mcp: ["notes.read"] },
  }

  test("the kit sets tools, mcp, once, max_steps and role; focus is in the role and names the helper", () => {
    const { lead, live, spawner } = team({ toolkits })
    const made = spawner.spawn(lead, { toolkit: "source", focus: "Parser bug: is the fix still open?" })
    expect(made).toMatchObject({ name: "source-parser-bug-is", once: true, toolkit: "source" })
    const h = live[0].agent
    expect(h.tools).toEqual([])
    expect(h.mcp).toEqual(["github.search"])
    expect(h.max_steps).toBe(8)
    expect(h.instructions).toContain("One source: what it says")
    expect(h.instructions).toContain("## YOUR FOCUS\n\nParser bug: is the fix still open?")
    expect(h.description).toBe("source: Parser bug: is the fix still open?")
    expect(h.spawned).toMatchObject({ by: "researcher", once: true, toolkit: "source", focus: "Parser bug: is the fix still open?" })
    // a second helper on the same focus gets a free name
    expect(spawner.spawn(lead, { toolkit: "source", focus: "Parser bug: is the fix still open?" }).name).toBe("source-parser-bug-is-2")
  })

  test("explicit tools/mcp override the kit, still within the caller's", () => {
    const { lead, live, spawner } = team({ toolkits })
    spawner.spawn(lead, { toolkit: "notes", focus: "docs", name: "notes-docs", mcp: ["github.search", "notes.read"], tools: [] })
    expect(live[0].agent.mcp).toEqual(["github.search", "notes.read"])
    expect(live[0].agent.tools).toEqual([])
    expect(live[0].agent.spawned.once).toBeUndefined()
    expect(() => spawner.spawn(lead, { toolkit: "notes", focus: "api", mcp: ["github.merge"] })).toThrow("cannot be given: github.merge")
  })

  test("an unknown toolkit is refused, naming the caller's kits", () => {
    const { lead, spawner } = team({ toolkits })
    expect(() => spawner.spawn(lead, { toolkit: "wiki", focus: "docs" })).toThrow("Yours: source, notes")
    const bare = team()
    expect(() => bare.spawner.spawn(bare.lead, { toolkit: "source", focus: "docs" })).toThrow("none (agent.md toolkits)")
  })

  test("a kit without a role gets a research-helper role", () => {
    const { lead, live, spawner } = team({ toolkits })
    spawner.spawn(lead, { toolkit: "notes", focus: "release notes" })
    expect(live[0].agent.instructions).toContain("researcher's notes research helper")
  })
})
