// The command line and the sandbox profile terminal sessions run under (sandbox.js): no shell, destructive commands
// refused, lanes as write rules, ASKK's configuration never written or read. Real sandbox-exec probes in a folder
// under ~/.askk/tmp (outside TMPDIR, which programs may write), removed after.
import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { groupBook, laneRegex, NEVER_WRITE, processInfo, refuseDestructive, sandboxProfile, splitCommand } from "./sandbox.js"

const base = join(homedir(), ".askk", "tmp")
mkdirSync(base, { recursive: true })
const root = realpathSync(mkdtempSync(join(base, "sandbox-test-")))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const run = (profile, ...argv) => Bun.spawnSync(["/usr/bin/sandbox-exec", "-p", profile, ...argv], { stderr: "pipe" })

describe("splitCommand", () => {
  test("programs and arguments, quotes, && chains", () => {
    expect(splitCommand("uv run 'train it.py' --steps 3")).toEqual([["uv", "run", "train it.py", "--steps", "3"]])
    expect(splitCommand('cd projects/x && bun "a b" c\\ d')).toEqual([["cd", "projects/x"], ["bun", "a b", "c d"]])
  })
  test.each(["a | b", "a; b", "a > f", "a < f", "echo $(x)", "echo `x`", "a & b", "echo $HOME"])("refuses shell syntax: %s", (c) => {
    expect(() => splitCommand(c)).toThrow(/shell syntax/)
  })
  test("refuses an unclosed quote and an empty step", () => {
    expect(() => splitCommand("echo 'x")).toThrow(/Unclosed/)
    expect(() => splitCommand("a && && b")).toThrow(/Empty/)
  })
})

describe("refuseDestructive", () => {
  test.each([["git", "reset", "--hard"], ["git", "clean", "-fd"], ["git", "-C", "x", "push", "--force"], ["find", ".", "-delete"], ["find", ".", "-exec", "rm", "{}", ";"], ["python3", "-c", "import shutil; shutil.rmtree('x')"]])("%s %s", (...argv) => {
    expect(() => refuseDestructive(argv)).toThrow(/refused/)
  })
  test("ordinary work passes", () => {
    for (const argv of [["git", "commit", "-m", "x"], ["git", "status"], ["find", ".", "-name", "*.py"], ["python3", "-c", "print(1)"]]) expect(() => refuseDestructive(argv)).not.toThrow()
  })
})

describe("sandboxProfile", () => {
  const tmp = realpathSync(mkdtempSync(join(base, "sandbox-tmp-")))
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  test("laneRegex: globs on real paths", () => {
    const re = (g) => new RegExp(laneRegex("/w", g))
    expect(re("projects/**").test("/w/projects/a/b.py")).toBe(true)
    expect(re("projects/**").test("/w/shared/a")).toBe(false)
    expect(re("shared/*/critique.md").test("/w/shared/x/critique.md")).toBe(true)
    expect(re("shared/*/critique.md").test("/w/shared/x/y/critique.md")).toBe(false)
  })

  test("no lane: the whole workspace; a lane: only its globs; [] none of it", () => {
    mkdirSync(join(root, "out"), { recursive: true })
    const touch = (lane, rel) => run(sandboxProfile(root, [], lane, { tmp }), "/usr/bin/touch", join(root, rel)).exitCode
    expect(touch(null, "free.txt")).toBe(0)
    expect(touch(["out/**"], "out/a.txt")).toBe(0)
    expect(touch(["out/**"], "b.txt")).not.toBe(0)
    expect(touch([], "c.txt")).not.toBe(0)
    expect(existsSync(join(root, "out", "a.txt"))).toBe(true)
    expect(existsSync(join(root, "b.txt"))).toBe(false)
    expect(existsSync(join(root, "c.txt"))).toBe(false)
  })

  test(".env and .mcp.json are never written; .env is never read, .env.example is", () => {
    writeFileSync(join(root, ".env"), "SECRET=1\n")
    writeFileSync(join(root, ".env.example"), "SECRET=\n")
    const profile = sandboxProfile(root, [], null, { tmp })
    expect(run(profile, "/usr/bin/touch", join(root, ".env.local")).exitCode).not.toBe(0)
    expect(run(profile, "/usr/bin/touch", join(root, ".mcp.json")).exitCode).not.toBe(0)
    expect(existsSync(join(root, ".mcp.json"))).toBe(false)
    const cat = run(profile, "/bin/cat", join(root, ".env"))
    expect(cat.exitCode).not.toBe(0)
    expect(cat.stdout.toString()).not.toContain("SECRET=1")
    expect(run(profile, "/bin/cat", join(root, ".env.example")).stdout.toString()).toContain("SECRET=")
  })

  test("allowWrites / denyWrites add rules on real paths; bin folders stay denied", () => {
    const other = realpathSync(mkdtempSync(join(base, "sandbox-other-")))
    try {
      const profile = sandboxProfile(root, [], [], { tmp, allowWrites: [laneRegex(other, "**")], denyWrites: [laneRegex(other, "keep/**")] })
      mkdirSync(join(other, "keep"))
      expect(run(profile, "/usr/bin/touch", join(other, "ok.txt")).exitCode).toBe(0)
      expect(run(profile, "/usr/bin/touch", join(other, "keep", "no.txt")).exitCode).not.toBe(0)
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
    expect(NEVER_WRITE).toContain(join(homedir(), ".bun", "bin"))
    expect(sandboxProfile(root, [join(homedir(), ".bun")], null, { tmp })).toContain(`(deny file-write* (subpath "${join(homedir(), ".bun", "bin")}")`)
  })
})

describe("groupBook", () => {
  test("add books a live group with its start time and this server; remove drops it; a gone pid is not booked", async () => {
    const path = join(root, "book", "running.json")
    const book = groupBook(path)
    const p = Bun.spawn(["/bin/sleep", "30"], { detached: true, stdio: ["ignore", "ignore", "ignore"] })
    try {
      const entry = book.add({ pid: p.pid, session: "s1", command: "sleep 30" })
      expect(entry).toMatchObject({ pid: p.pid, pgid: p.pid, session: "s1", server: { pid: process.pid, started: processInfo([process.pid]).get(process.pid).started } })
      expect(entry.started).toMatch(/^\w{3} \w{3} +\d+ \d\d:\d\d:\d\d \d{4}$/)
      expect(book.reap()).toEqual([]) // its server (this one) runs: not an orphan
      expect(JSON.parse(readFileSync(path, "utf8")).map((r) => r.pid)).toEqual([p.pid])
      book.remove(p.pid)
      expect(existsSync(path)).toBe(false) // an empty book is no file
    } finally {
      p.kill("SIGKILL")
    }
    await p.exited
    expect(book.add({ pid: p.pid })).toBeNull()
  })
})
