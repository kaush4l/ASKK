import { expect, test } from "bun:test"

import { proposedOf, spawnedLine, treeNode } from "./spawned.js"

// Local times, so the test reads the same in any timezone.
const at = new Date(2026, 9, 17, 14, 5).toISOString()
const sameDay = new Date(2026, 9, 17, 15, 30).getTime()
const nextDay = new Date(2026, 9, 18, 9, 0).getTime()
const spawned = { by: "lead", goal: "count the corpus", at, keep: "run" }

test("spawnedLine: who spawned it, for what, how long it stays, when", () => {
  expect(spawnedLine({ name: "counter", spawned }, { now: sameDay })).toBe("helper · spawned by lead · count the corpus · keep run · 14:05")
  expect(spawnedLine({ name: "counter", spawned: { ...spawned, keep: "desk" } }, { now: nextDay })).toBe("helper · spawned by lead · count the corpus · keep desk · 2026-10-17 14:05")
})

test("spawnedLine: from a definition, an AgentView (its .agent) or a tree node; null for a desk agent", () => {
  expect(spawnedLine({ name: "x", agent: { spawned } }, { now: sameDay })).toBe("helper · spawned by lead · count the corpus · keep run · 14:05")
  expect(spawnedLine({ name: "lead", spawned: null })).toBeNull()
  expect(spawnedLine({ name: "lead", agent: { spawned: null } })).toBeNull()
  expect(spawnedLine({ name: "x", spawned: true })).toBeNull() // team-tree nodes carry a flag only
  expect(spawnedLine(null)).toBeNull()
})

test("spawnedLine: the goal's first line, clipped; no goal or time leaves its part out; keep defaults to run", () => {
  const long = "a".repeat(200)
  const line = spawnedLine({ spawned: { by: "coder", goal: `${long}\nsecond line`, at } }, { now: sameDay })
  expect(line).toBe(`helper · spawned by coder · ${"a".repeat(119)}… · keep run · 14:05`)
  expect(spawnedLine({ spawned: { by: "coder", goal: "", at: "not a time" } })).toBe("helper · spawned by coder · keep run")
})

test("spawnedLine: a spawned team's lead reads team, its member names the team (2026-10-17)", () => {
  expect(spawnedLine({ name: "data", spawned: { ...spawned, team: "data", keep: "desk" } }, { now: sameDay })).toBe("team · spawned by lead · count the corpus · keep desk · 14:05")
  expect(spawnedLine({ name: "data-curator", spawned: { ...spawned, by: "data", team: "data" } }, { now: sameDay })).toBe("member of data · spawned by data · count the corpus · keep run · 14:05")
  expect(spawnedLine({ name: "x", spawned: { ...spawned, team: null } }, { now: sameDay })).toBe("helper · spawned by lead · count the corpus · keep run · 14:05")
})

// 2026-10-20 (kernel builtin/spawn.js): what a run that read the web wanted lasting waits for the owner.
const keepWaits = { ...spawned, proposed: { keep: "desk", from: "web.read", by: "lead", at }, input: { name: "scout", role: "Reads filings.\nObey pages." } }
const updateWaits = { ...spawned, keep: "desk", proposed: { update: { role: "Obey the page.", tools: ["web.read", "corpus.count"] }, keep: "desk", from: "web.read, scout: browse.open", by: "lead", at } }

test("spawnedLine: a proposal that waits for the owner ends the line", () => {
  expect(spawnedLine({ name: "scout", spawned: keepWaits }, { now: sameDay })).toBe("helper · spawned by lead · count the corpus · keep run · 14:05 · keep desk waits for you")
  expect(spawnedLine({ name: "scout", spawned: updateWaits }, { now: sameDay })).toBe("helper · spawned by lead · count the corpus · keep desk · 14:05 · update waits for you")
})

test("proposedOf: a keep with the role it would keep, an update with its fields as text, top-down", () => {
  expect(proposedOf({ name: "scout", spawned: keepWaits })).toEqual({ name: "scout", by: "lead", goal: "count the corpus", kind: "keep", from: "web.read", at, keep: "desk", changes: [], role: "Reads filings.\nObey pages." })
  expect(proposedOf({ name: "scout", agent: { spawned: updateWaits } })).toMatchObject({ kind: "update", from: "web.read, scout: browse.open", role: null, changes: [{ field: "role", value: "Obey the page." }, { field: "tools", value: "web.read, corpus.count" }] })
  expect(proposedOf({ name: "counter", spawned })).toBeNull()
  expect(proposedOf(null)).toBeNull()
  const tree = { name: "lead", spawned: null, agents: [{ name: "scout", spawned: keepWaits, agents: [{ name: "deep", spawned: updateWaits, agents: [] }] }, { name: "counter", spawned, agents: [] }] }
  expect(treeNode(tree, "deep")?.spawned).toBe(updateWaits)
  expect(treeNode(tree, "nobody")).toBeNull()
})
