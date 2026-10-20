// The desks a server hosts (companion/team/desk.js hostedDeskFolders, 2026-10-20): the core desks ASKK ships (desks/)
// beside the local ones (custom/), a local desk winning a name both have; --only narrows both. The repo's own core desk
// (desks/agent) composes.

import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import { checkDesk } from "./scaffold.js"
import { CORE_DESKS, hostedDeskFolders } from "./desk.js"

const root = mkdtempSync(join(tmpdir(), "hosted-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const desk = (dir, name) => {
  mkdirSync(join(dir, name), { recursive: true })
  writeFileSync(join(dir, name, "main.js"), "export default () => ({ start: async () => ({}) })\n")
}

test("core desks first, then local ones; a local desk named like a core one wins; only narrows", () => {
  const core = join(root, "desks")
  const local = join(root, "custom")
  desk(core, "agent")
  desk(core, "shared-name")
  desk(local, "mine")
  desk(local, "shared-name")
  expect(hostedDeskFolders({ desks: local, core }).map((f) => [basename(join(f, "..")), basename(f)])).toEqual([
    ["desks", "agent"],
    ["custom", "mine"],
    ["custom", "shared-name"],
  ])
  expect(hostedDeskFolders({ desks: local, core, only: new Set(["agent"]) }).map((f) => basename(f))).toEqual(["agent"])
  expect(hostedDeskFolders({ desks: join(root, "missing"), core }).map((f) => basename(f))).toEqual(["agent", "shared-name"])
  expect(hostedDeskFolders({ desks: local, core: null }).map((f) => basename(f))).toEqual(["mine", "shared-name"])
})

test("the repo's core desk: desks/agent, one agent with the capability kit, composes", async () => {
  expect(basename(CORE_DESKS)).toBe("desks")
  const check = await checkDesk(join(CORE_DESKS, "agent"))
  expect(check.lead).toBe("agent")
  expect(check.tree.agents).toEqual([])
  for (const t of ["agent.spawn", "agent.catalog", "agent.update", "agent.dismiss", "desk.create", "desk.load", "desk.ask", "dispatch.start", "agent.practice.reflect"]) expect(check.tools.agent).toContain(t)
})
