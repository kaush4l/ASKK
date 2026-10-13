// agent.md `shared:` (SHARED scope) and `tree_exclude:` (FILESYSTEM tree).
// Run: bun test ./backend/features/filesystem

import { describe, expect, mock, test } from "bun:test"

// A fake workspace: a flat map of files, the tree built from it.
const FILES = {
  "shared/handoff.md": "handoff",
  "shared/lessons.md": "lessons",
  "shared/2026-10-11/lead.md": "lead day file",
  "shared/2026-10-11/radar.md": "radar day file",
  "shared/2026-10-11/think.md": "think",
  "plan.md": "plan",
  "days/2026-10-09/shared/lead.md": "x",
  "days/2026-10-10/shared/lead.md": "x",
  "days/2026-10-10/evidence/radar.jsonl": "x",
  "archive/old.md": "x",
  "state/charters/lead.md": "x",
  "state/wakes.jsonl": "x",
}

function treeOf(prefix) {
  const root = []
  for (const path of Object.keys(FILES).filter((p) => !prefix || p.startsWith(`${prefix}/`)).sort()) {
    let level = root
    const parts = path.split("/")
    parts.forEach((name, i) => {
      if (i === parts.length - 1) return level.push({ name, type: "file" })
      let dir = level.find((e) => e.name === name && e.type === "dir")
      if (!dir) level.push((dir = { name, type: "dir", children: [] }))
      level = dir.children
    })
  }
  if (!prefix) return root
  let level = root
  for (const name of prefix.split("/")) level = level.find((e) => e.name === name)?.children ?? []
  return level
}

const ws = {
  kind: "host",
  label: "test",
  writable: true,
  tree: async (path = "") => ({ path, entries: treeOf(path) }),
  read: async (path) => {
    const key = String(path).replace(/^\/+/, "")
    if (!(key in FILES)) throw new Error(`Not found: ${key}`)
    return { path: key, text: FILES[key], size: FILES[key].length, revision: "r1", binary: false, truncated: false }
  },
}

const real = await import("@/backend/features/filesystem/workspace")
mock.module("@/backend/features/filesystem/workspace", () => ({ ...real, workspace: async () => ws }))

const { globsMatch } = await import("@/backend/features/filesystem/guard")
const { FilesystemArtifact, SharedArtifact, pruneTree, sharedShown } = await import("@/backend/features/filesystem/artifact")
const { validateAgent } = await import("@/backend/agents/definitions")

const engine = (agent) => ({ name: agent.name, agent: { artifacts: ["shared"], ...agent } })

describe("shared scope", () => {
  test("no scope = every shared file", () => {
    const e = engine({ name: "radar" })
    expect(sharedShown(e, "shared/2026-10-11/lead.md")).toBe(true)
    expect(sharedShown(e, "shared/handoff.md")).toBe(true)
  })

  test("<self>, one-segment * and !exclude", () => {
    const e = engine({ name: "radar", shared: ["handoff.md", "2*/<self>.md", "2*/think.md", "learned/**", "!learned/secret.md"] })
    expect(sharedShown(e, "shared/handoff.md")).toBe(true)
    expect(sharedShown(e, "shared/2026-10-11/radar.md")).toBe(true)
    expect(sharedShown(e, "shared/2026-10-11/lead.md")).toBe(false)
    expect(sharedShown(e, "shared/2026-10-11/think.md")).toBe(true)
    expect(sharedShown(e, "shared/2026-10-11/x/think.md")).toBe(false) // * is one segment
    expect(sharedShown(e, "shared/learned/a/flow.md")).toBe(true)
    expect(sharedShown(e, "shared/learned/secret.md")).toBe(false)
    expect(sharedShown(e, "shared/lessons.md")).toBe(false)
  })

  test("exclusions only = everything else", () => {
    expect(globsMatch("2026-10-11/lead.md", ["!2*/lead.md"])).toBe(false)
    expect(globsMatch("handoff.md", ["!2*/lead.md"])).toBe(true)
  })

  test("SHARED shows only the scope, counts the rest, show() lets hidden files through to fs.read", async () => {
    const a = new SharedArtifact({ engine: engine({ name: "radar", shared: ["handoff.md", "2*/<self>.md"] }) })
    await a.refresh()
    expect(a.order.sort()).toEqual(["shared/2026-10-11/radar.md", "shared/handoff.md"])
    const text = a.render()
    expect(text).toContain("Scoped: 3 other shared files not shown (fs.read to open one).")
    expect(text).not.toContain("lead day file")
    expect(text).toContain("radar day file")
    expect(await a.show("shared/2026-10-11/lead.md")).toBeNull()
    expect(await a.show("shared/handoff.md")).toContain("is shown with its current content in SHARED")
  })

  test("without a scope: every file, no Scoped line", async () => {
    const a = new SharedArtifact({ engine: engine({ name: "radar" }) })
    await a.refresh()
    expect(a.order.length).toBe(5)
    expect(a.render()).not.toContain("Scoped:")
  })

  test("fs.open works on a shared file outside the scope only", async () => {
    const fsa = new FilesystemArtifact({ engine: engine({ name: "radar", artifacts: ["filesystem", "shared"], shared: ["handoff.md"] }) })
    const open = fsa.commands().find((t) => t.name === "fs.open")
    expect(await open.run({ path: "shared/handoff.md" })).toContain("already shown in SHARED")
    expect(await open.run({ path: "shared/2026-10-11/lead.md" })).toContain("Opened shared/2026-10-11/lead.md")
    await fsa.refresh()
    expect(fsa.render()).toContain("lead day file")
  })
})

describe("tree_exclude", () => {
  test("no globs = tree unchanged", () => {
    const tree = treeOf("")
    expect(pruneTree(tree, null)).toBe(tree)
  })

  test("excluded folders collapse to one line with their file count", async () => {
    const a = new FilesystemArtifact({ engine: engine({ name: "lead", tree_exclude: ["days/**", "archive/**", "state/charters/**"] }) })
    await a.refresh()
    const text = a.render()
    expect(text).toContain("days/ (3 files, not listed)")
    expect(text).toContain("archive/ (1 files, not listed)")
    expect(text).toContain("  charters/ (1 files, not listed)")
    expect(text).toContain("  wakes.jsonl")
    expect(text).not.toContain("2026-10-09")
    expect(text).toContain("plan.md")
    expect(a.tree.find((e) => e.name === "days").children).toBeDefined() // live follow keeps the full tree
  })

  test("file globs drop matching files", () => {
    const tree = pruneTree(treeOf(""), ["**/*.jsonl"])
    const names = JSON.stringify(tree)
    expect(names).not.toContain("jsonl")
    expect(names).toContain("lead.md")
  })
})

describe("agent.md validation", () => {
  const base = { name: "radar", description: "d", strategy: "react", response_format: "toon", tools: [], skills: {}, instructions: "x" }
  test("shared and tree_exclude: lists of non-empty strings", () => {
    expect(validateAgent({ ...base, shared: ["handoff.md", "2*/<self>.md"], tree_exclude: ["days/**"] }).shared).toEqual(["handoff.md", "2*/<self>.md"])
    expect(() => validateAgent({ ...base, shared: "handoff.md" })).toThrow()
    expect(() => validateAgent({ ...base, shared: [""] })).toThrow()
    expect(() => validateAgent({ ...base, tree_exclude: [3] })).toThrow()
  })
})
