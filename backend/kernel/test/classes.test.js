import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"

import { BUILTIN, kernelClasses, KIND_TYPES } from "../index.js"
import { conformance } from "../classes.js"

// The kernel's self-description (classes.js) is the composition the /compose page and docs/composition.md read: it must
// list every kit artifact, every config key the loop reads, and every class must meet the standard.

test("every kit artifact type is listed in KINDS", () => {
  expect([...KIND_TYPES].sort()).toEqual(Object.keys(BUILTIN.artifacts).sort())
})

test("every class meets the standard (about, declared commands, a bare instance)", () => {
  const off = kernelClasses().kinds.filter((k) => k.problems.length).map((k) => `${k.name}: ${k.problems.join("; ")}`)
  expect(off).toEqual([])
})

test("every config key agent.js reads is a listed Agent variable", () => {
  const src = readFileSync(new URL("../agent/agent.js", import.meta.url), "utf8")
  const read = new Set([...src.matchAll(/config\.([a-zA-Z]+)/g)].map((m) => m[1]))
  const agent = kernelClasses().bases.find((b) => b.name === "Agent")
  const listed = new Set(agent.variables.filter((x) => x.where === "config").map((x) => x.name))
  expect([...read].filter((k) => !listed.has(k))).toEqual([])
})

test("kinds are read from the code: kind, view, keep, commands", () => {
  const files = kernelClasses().kinds.find((k) => k.name === "Files")
  expect(files).toMatchObject({ type: "files", kind: "files", view: "files", keep: "always", extends: "Artifact" })
  expect(files.commands.map((c) => c.name)).toContain("write")
  expect(kernelClasses().kinds.find((k) => k.name === "Plan").extends).toBe("Checklist")
  expect(kernelClasses().kinds.find((k) => k.name === "Dev").options).toHaveProperty("checks")
})

test("conformance names what a class lacks", () => {
  expect(conformance({ says: "", commands: [{ name: "x", says: "", hasInput: false }], kind: null, handWritten: true })).toEqual([
    "no static about",
    "command x: needs a description and an input",
    "a bare instance could not be made (kind, view and keep unknown)",
    "commands() written by hand: declare static commands",
  ])
})

test("the kit's tools are listed with their type", () => {
  const tools = kernelClasses().tools
  expect(tools.find((t) => t.name === "web.search")).toMatchObject({ type: "function" })
  expect(tools.map((t) => t.name).sort()).toEqual(Object.keys(BUILTIN.tools).sort())
})
