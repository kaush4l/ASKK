// The proposals block's words (backend/live/proposals.js, 2026-10-20): a proposed desk's agents in order, its title
// line, where its words came from, what an accept did.

import { describe, expect, test } from "bun:test"
import { acceptNote, agentRows, fromLine, proposalTitle } from "./proposals.js"

describe("proposals", () => {
  test("agentRows: the lead first, each member under its lead", () => {
    const lead = { name: "lead", role: "Leads.", members: [{ name: "critic", role: "Judges.", members: [{ name: "probe", role: "Probes." }] }, { name: "scout", role: "Scouts." }] }
    expect(agentRows(lead).map((a) => [a.depth, a.name, a.role])).toEqual([
      [0, "lead", "Leads."],
      [1, "critic", "Judges."],
      [2, "probe", "Probes."],
      [1, "scout", "Scouts."],
    ])
    expect(agentRows(lead)[0].members).toBeUndefined()
    expect(agentRows(null)).toEqual([])
  })

  test("the title, the from line, an accept's note", () => {
    expect(proposalTitle({ name: "research", title: "Research desk" })).toBe("new desk research · Research desk")
    expect(proposalTitle({ name: "research", title: "research", update: true })).toBe("update of desk research")
    expect(fromLine("web.read, scout: browse.open")).toBe("from a run that read outside: web.read, scout: browse.open")
    expect(acceptNote({ name: "research", folder: "custom/research", written: ["a", "b"], loaded: { name: "research", agents: 2, reloaded: false } })).toBe("Written custom/research/ (2 files) and loaded (2 agents).")
    expect(acceptNote({ name: "research", written: ["a"], loaded: null, loadError: "Desk is working" })).toBe("Written custom/research/ (1 files); not loaded: Desk is working")
    expect(acceptNote({ file: "feed", accepted: "custom/x/tools/feed.js", loaded: null })).toBe("Moved to custom/x/tools/feed.js; it runs when the desk is loaded next.")
    expect(acceptNote({ file: "feed", accepted: "custom/x/tools/feed.js", loaded: { name: "x", agents: 1 } })).toBe("Moved to custom/x/tools/feed.js; x loaded again (1 agents).")
  })
})
