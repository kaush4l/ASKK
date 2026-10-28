// Dev (2026-10-25 owner: "a goal based live dev artifact"): the project made ready (dev.init through the host's
// projects/init), its checks run in the holder's terminal and recorded, git status, the gate while a change is
// unchecked, and one prompt block composed from the holder's goal, files, terminal and preview.

import { describe, expect, test } from "bun:test"
import { Agent, BUILTIN, builtinKit } from "../index.js"
import { fakeHost } from "./fake-host.js"

const clock = () => new Date("2026-10-25T21:00:00Z")
const CONFIG = { project: "app", checks: { test: "bun test", lint: "bun run lint" }, preview: { command: "bun run dev --port 3030", url: "http://localhost:3030" } }

function desk({ fail = new Set(), self = false } = {}) {
  const host = fakeHost({
    files: { "projects/app/src/a.js": "export const a = 1\n" },
    onStart: (body) =>
      body.command.startsWith("git status")
        ? { status: "exited", exit: 0, lines: ["## dev-desk", " M src/a.js", "?? src/b.js"] }
        : { status: "exited", exit: fail.has(body.command) ? 1 : 0, lines: [fail.has(body.command) ? "1 fail: a.test.js" : "12 pass"] },
  })
  const post = host.post
  host.post = (path, body, o) => (path === "projects/init" ? (host.calls.push({ method: "POST", path, body }), self ? { name: body.name, path: "/code/askk", branch: null, created: false, setup: null, self: true } : { name: body.name, path: "/code/app-dev", branch: "dev-desk", created: true, setup: { command: "bun install", exit: 0, tail: [] } }) : post(path, body, o))
  const kit = builtinKit({ clock, dev: CONFIG })
  const coder = new Agent({ name: "coder", report: false, writes: ["projects/**"] }, { infer: async () => "", context: { host } })
  for (const type of ["goal", "files", "terminal", "preview", "dev"]) coder.addArtifact(kit.artifacts[type](coder, {}))
  const run = (cmd, input = {}) => coder.tools.get(cmd).run(input, { ...coder.context, agent: coder })
  const dev = coder.artifacts.find((a) => a.kind === "dev")
  return { host, coder, run, dev }
}

describe("dev: the project a dev desk changes", () => {
  test("in the kit by name; init makes the project ready through the host", async () => {
    expect(typeof BUILTIN.artifacts.dev).toBe("function")
    const { run, dev, host } = desk()
    expect(dev.brief()).toBe("not initialized · test never · lint never")
    await expect(run("dev.check")).rejects.toThrow("projects/app is not ready: dev.init first")
    expect(await run("dev.init")).toBe("projects/app made: branch dev-desk, /code/app-dev — bun install: exit 0")
    expect(host.calls.at(-1)).toMatchObject({ method: "POST", path: "projects/init", body: { name: "app" } })
    expect(dev.state.project).toMatchObject({ name: "app", workspace: "projects/app", branch: "dev-desk", ready: true })
    expect(dev.state.links).toEqual({ goal: "goal", files: "files", terminal: "terminal", preview: "preview" })
  })

  test("ASKK itself (main.js self: true): the block says the live server runs it — no worktree, never commit", async () => {
    const { run, dev, coder } = desk({ self: true })
    expect(await run("dev.init")).toBe("projects/app ready: ASKK itself (the repository the live server runs), /code/askk")
    expect(dev.state.project).toMatchObject({ ready: true, self: true, branch: null })
    expect(dev.render(coder)).toMatch(/^PROJECT projects\/app — ASKK itself, the repository the live server runs: a saved UI change is live at once/)
  })

  test("checks run in the holder's terminal, in the project; a change since they passed holds the answer", async () => {
    const { run, dev, coder, host } = desk({ fail: new Set(["bun run lint"]) })
    await run("dev.init")
    await run("files.edit", { path: "projects/app/src/a.js", old: "1", new: "2" })
    expect(dev.gate(coder)).toBe("1 file of the project changed since the checks last passed (projects/app/src/a.js): dev.check, fix what fails, then answer")
    const out = await run("dev.check")
    expect(out).toContain("✓ test (bun test) pass exit 0")
    expect(out).toContain("✗ lint (bun run lint) fail exit 1")
    expect(out).toContain("  1 fail: a.test.js")
    expect(out).toEndWith("failing: lint — fix it, then dev.check again")
    expect(host.calls.filter((c) => c.path === "term/start").map((c) => [c.body.command, c.body.cwd])).toEqual([["bun test", "projects/app"], ["bun run lint", "projects/app"], ["git status --porcelain=v1 -b", "projects/app"]])
    expect(dev.state.passed_at).toBeNull()
    expect(dev.state.git).toMatchObject({ branch: "dev-desk", files: [{ code: "M", path: "src/a.js" }, { code: "??", path: "src/b.js" }] })
    expect(dev.gate(coder)).toContain("dev.check")
    const block = coder.render({ text: "x", from: "owner" }, []).split("# dev — the project the desk changes\n")[1].split("\n\n#")[0]
    expect(block.split("\n")).toEqual([
      "PROJECT projects/app — branch dev-desk (its own worktree: change it freely; the owner merges)",
      "GIT dev-desk at 21:00: M src/a.js, ?? src/b.js",
      "UNCHECKED since the checks last passed: src/a.js",
      "CHECK test: bun test — pass exit 0 21:00 by coder in 0.0 s",
      "CHECK lint: bun run lint — fail exit 1 21:00 by coder in 0.0 s",
      "  1 fail: a.test.js",
      'PREVIEW none open — terminal.start {command: "bun run dev --port 3030", cwd: "projects/app"}, then preview.open {url: "http://localhost:3030"}',
    ])
  })

  test("every check passing clears the gate; the goal shows in the block; restore keeps the checks' last runs", async () => {
    const { run, dev, coder } = desk()
    await run("dev.init")
    await run("goal.set", { text: "ship the inbox count", measure: "the feature works, every check passes" })
    await run("files.edit", { path: "projects/app/src/a.js", old: "1", new: "2" })
    expect(await run("dev.check")).toEndWith("every check passes")
    expect(dev.state.passed_at).toBe("2026-10-25T21:00:00.000Z")
    // the edit came at the same instant as the checks: checked (≤ passed_at)
    expect(dev.gate(coder)).toBeNull()
    expect(coder.render({ text: "x", from: "owner" }, [])).toContain("GOAL ship the inbox count · measure: the feature works, every check passes")
    const back = builtinKit({ clock, dev: CONFIG }).artifacts.dev(coder, {})
    back.restore(JSON.parse(JSON.stringify(dev.snapshot())))
    expect(back.state.checks.map((c) => [c.name, c.status])).toEqual([["test", "pass"], ["lint", "pass"]])
    expect(back.state.project).toMatchObject({ ready: true, branch: "dev-desk" })
  })
})

test("a check with a cwd runs in that folder of the project", async () => {
  const host = fakeHost({ onStart: () => ({ status: "exited", exit: 0, lines: ["9 pass"] }) })
  const post = host.post
  host.post = (path, body, o) => (path === "projects/init" ? { name: body.name, path: "/code/askk", branch: null, created: false, setup: null, self: true } : post(path, body, o))
  const kit = builtinKit({ clock, dev: { project: "app", checks: { backend: { command: "bun test", cwd: "backend" } } } })
  const coder = new Agent({ name: "coder", report: false, writes: ["projects/**"] }, { infer: async () => "", context: { host } })
  for (const type of ["goal", "files", "terminal", "dev"]) coder.addArtifact(kit.artifacts[type](coder, {}))
  const run = (cmd, input = {}) => coder.tools.get(cmd).run(input, { ...coder.context, agent: coder })
  await run("dev.init")
  expect(await run("dev.check")).toMatch(/✓ backend \(bun test in backend\) pass/)
  expect(host.calls.find((c) => c.path === "term/start" && c.body.command === "bun test").body.cwd).toBe("projects/app/backend")
})

// 2026-10-25 owner: "If any changes break the application, we should be able to roll back, capture this evidence and
// start from that point" — checkpoints, rollback, health and restart over the host (capabilities/restart.js).
describe("checkpoints, rollback, health and restart (ASKK itself)", () => {
  function safeDesk({ healthy = true } = {}) {
    const host = fakeHost({ onStart: () => ({ status: "exited", exit: 0, lines: ["9 pass"] }) })
    const post = host.post
    const get = host.get
    const cps = []
    const restarts = []
    host.post = async (path, body, o) => {
      host.calls.push({ method: "POST", path, body })
      if (path === "projects/init") return { name: body.name, path: "/code/askk", branch: null, created: false, setup: null, self: true }
      if (path === "projects/health") return healthy ? { ok: true, problems: [], desks: ["dev"], pages: [{ path: "/", status: 200, ms: 40 }] } : { ok: false, problems: ["GET /live: 500 — Module not found"], desks: ["dev"], pages: [] }
      if (path === "projects/checkpoint") return { checkpoint: (cps.unshift({ id: `c${cps.length + 1}`, kind: body.kind, why: body.why, at: "2026-10-25T21:00:00Z", files: 3, deleted: 0, by: body.by }), cps[0]) }
      if (path === "projects/rollback") return { rollback: { id: body.id, before: `c${cps.length + 1}`, restored: ["a.js"], reverted: ["b.js"], removed: [] } }
      if (path === "projects/restart") return { restart: (restarts.unshift({ id: "r1", status: "pending", why: body.why, by: body.by, project: "app", before: body.before, pre: "c9", good: cps.find((c) => c.kind === "good")?.id ?? null, at: "2026-10-25T21:01:00Z" }), restarts[0]) }
      return post(path, body, o)
    }
    host.get = async (path) => (path.startsWith("projects/checkpoints") ? { checkpoints: cps } : path === "projects/restarts" ? { restarts } : get(path))
    const kit = builtinKit({ clock, dev: { project: "app", checks: { backend: { command: "bun test", cwd: "backend" } } } })
    const coder = new Agent({ name: "coder", report: false, writes: ["projects/**"] }, { infer: async () => "", context: { host } })
    for (const type of ["goal", "files", "terminal", "dev"]) coder.addArtifact(kit.artifacts[type](coder, {}))
    const run = (cmd, input = {}) => coder.tools.get(cmd).run(input, { ...coder.context, agent: coder })
    const dev = coder.artifacts.find((a) => a.kind === "dev")
    const goal = coder.artifacts.find((a) => a.kind === "goal")
    return { host, run, dev, goal, coder, restarts }
  }

  test("every check passing and the server healthy keeps a good checkpoint; unhealthy keeps none", async () => {
    const a = safeDesk()
    await a.run("dev.init")
    const out = await a.run("dev.check")
    expect(out).toMatch(/✓ health: every desk hosted, \/ 200 in 40 ms/)
    expect(out).toMatch(/good checkpoint c1 kept/)
    const b = safeDesk({ healthy: false })
    await b.run("dev.init")
    expect(await b.run("dev.check")).toMatch(/✗ health: GET \/live: 500/)
    expect(b.host.calls.some((c) => c.path === "projects/checkpoint")).toBe(false)
    expect(await b.run("dev.health")).toMatch(/^NOT healthy:\n {2}GET \/live: 500/)
  })

  test("restart: refused with a check not passing or no reason; started → the goal resumes soon; its outcome lands in the goal's ledger once", async () => {
    const { run, dev, goal, restarts, coder, host } = safeDesk()
    await run("dev.init")
    await run("goal.set", { text: "a better desk", measure: "features", cadence_minutes: 60, why: "owner" })
    await expect(run("dev.restart", { why: "kernel change" })).rejects.toThrow(/backend not passing: dev.check first/)
    await run("dev.check")
    await expect(run("dev.restart", {})).rejects.toThrow(/why: what changed/)
    expect(await run("dev.restart", { why: "agent.js: compaction note" })).toMatch(/restart r1 started .* rolls back to c1/)
    // self-update: the restart posts the latest dev.health as before
    expect(host.calls.find((c) => c.path === "projects/restart").body.before).toMatchObject({ ok: true, problems: [] })
    expect(Date.parse(goal.state.next_at) - Date.now()).toBeLessThan(3 * 60000)
    // the server came back after a rollback: read back, noted once as a dead end with the evidence
    Object.assign(restarts[0], { status: "rolled_back", ended_at: "2026-10-25T21:03:00Z", evidence: { problems: ["GET /: 500 — SyntaxError in agent.js"], log: "x\nSyntaxError: Unexpected token\n" }, rollback: { id: "c1", before: "c3", restored: ["backend/kernel/agent/agent.js"], reverted: [], removed: [] } })
    await dev.refresh(coder)
    dev.pulled = 0
    await dev.refresh(coder)
    const notes = goal.state.ledger.filter((l) => l.kind === "dead_end")
    expect(notes).toHaveLength(1)
    expect(notes[0].text).toMatch(/restart r1 \(agent.js: compaction note\) broke the server: GET \/: 500 — SyntaxError in agent.js — rolled back to c1; the broken tree is checkpoint c3/)
    expect(dev.render(coder)).toMatch(/RESTART r1 rolled_back .* rolled back to c1; the broken tree is c3/)
    expect(dev.brief()).toMatch(/restart r1 rolled_back/)
    // self-update: dev state keeps the restart's health before and after
    restarts[0].after = { ok: true, ms: 900, problems: [], pages: [] }
    dev.pulled = 0
    await dev.refresh(coder)
    expect(dev.state.restarts[0]).toMatchObject({ before: { ok: true }, after: { ok: true, ms: 900 } })
  })

  test("rollback names what it undid, notes the decision, and points back to the tree before", async () => {
    const { run, goal } = safeDesk()
    await run("dev.init")
    await run("goal.set", { text: "a better desk", measure: "features", why: "owner" })
    await run("dev.checkpoint", { why: "before the refactor" })
    expect(await run("dev.rollback", { id: "c1", why: "the canvas went blank" })).toMatch(/back at c1: restored a.js; reverted to HEAD b.js; removed none — the tree before is checkpoint c2/)
    expect(goal.state.ledger.at(-1)).toMatchObject({ kind: "decision", text: "rolled back to c1: the canvas went blank — the tree before is c2" })
  })
})

test("refresh takes the project's identity from the host's registry (a save from a worktree desk is not trusted)", async () => {
  const host = fakeHost({})
  const get = host.get
  host.get = async (path) => (path === "projects" ? { projects: [{ name: "app", path: "/code/askk", self: true }] } : path.startsWith("projects/") ? { checkpoints: [], restarts: [] } : get(path))
  const kit = builtinKit({ clock, dev: { project: "app", checks: { test: "bun test" } } })
  const coder = new Agent({ name: "coder", report: false }, { infer: async () => "", context: { host } })
  for (const type of ["goal", "files", "terminal", "dev"]) coder.addArtifact(kit.artifacts[type](coder, {}))
  const dev = coder.artifacts.find((a) => a.kind === "dev")
  dev.restore({ project: { ready: true, path: "/code/askk-dev", branch: "dev-desk" } })
  await dev.refresh(coder)
  expect(dev.state.project).toMatchObject({ ready: true, path: "/code/askk", self: true, branch: null })
  expect(dev.render(coder)).toMatch(/^PROJECT projects\/app — ASKK itself/)
})
// warm-line-twin (2026-10-26): the health reply's warm pass (logs/warm.json) is kept in state.health for the dev view
test("health keeps the last warm pass in state.health; a reply without one gives null", async () => {
  let warm = { at: "2026-10-26T06:35:00Z", pages: [{ path: "/", status: 200, ms: 483 }, { path: "/live", status: 0, ms: 12, error: "ECONNREFUSED" }] }
  const host = fakeHost({})
  const post = host.post
  host.post = async (path, body, o) =>
    path === "projects/init"
      ? { name: body.name, path: "/code/askk", branch: null, created: false, setup: null, self: true }
      : path === "projects/health"
        ? { ok: true, problems: [], desks: ["dev"], pages: [{ path: "/", status: 200, ms: 9 }], ...(warm ? { warm } : {}) }
        : post(path, body, o)
  const kit = builtinKit({ clock, dev: { project: "app", checks: { test: "bun test" } } })
  const coder = new Agent({ name: "coder", report: false }, { infer: async () => "", context: { host } })
  for (const type of ["goal", "files", "terminal", "dev"]) coder.addArtifact(kit.artifacts[type](coder, {}))
  const run = (cmd, input = {}) => coder.tools.get(cmd).run(input, { ...coder.context, agent: coder })
  const dev = coder.artifacts.find((a) => a.kind === "dev")
  await run("dev.init")
  expect(await run("dev.health")).toMatch(/warm at 06:35: \/ 483 ms · \/live ECONNREFUSED in 12 ms/)
  expect(dev.state.health.warm).toEqual(warm)
  warm = null
  expect(await run("dev.health")).toMatch(/warm: none$/)
  expect(dev.state.health.warm).toBeNull()
})

test("snapshotLine: what a tab loads on open, by part, the largest named", async () => {
  const { snapshotLine } = await import("../builtin/dev.js")
  expect(snapshotLine({ bytes: 1016698, parts: { states: 558190, kernel: 339371, registry: 113362, log: 51148 }, states: [{ id: "planner", bytes: 211377 }], artifacts: [{ id: "files", bytes: 158736 }, { id: "goal", bytes: 100550 }] })).toBe("SNAPSHOT 993 KB a tab loads on open — states 545 KB, artifacts 331 KB, registry 111 KB, log 50 KB; largest: planner 206 KB, files 155 KB, goal 98 KB")
})
test("snapshotLine: the goal's KB is named even when it is not among the 4 largest (goal-kb-exact)", async () => {
  const { snapshotLine } = await import("../builtin/dev.js")
  const line = snapshotLine({ bytes: 465920, parts: { states: 219136, kernel: 143360, registry: 54272, log: 49152 }, states: [{ id: "planner", bytes: 91136 }, { id: "coder", bytes: 46080 }, { id: "critic", bytes: 44032 }, { id: "dev", bytes: 36864 }], artifacts: [{ id: "files", bytes: 30720 }, { id: "goal", bytes: 25600 }] })
  expect(line).toEndWith("largest: planner 89 KB, coder 45 KB, critic 43 KB, dev 36 KB; goal 25 KB")
  expect(line.match(/goal/g)).toHaveLength(1)
})
