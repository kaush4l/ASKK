// The command line and the sandbox profile terminal sessions run under (sandbox.js): no shell, destructive commands
// refused, lanes as write rules, ASKK's configuration never written or read. Real sandbox-exec probes in a folder
// under ~/.askk/tmp (outside TMPDIR, which programs may write), removed after.
import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { GIT_NEVER_WRITE, groupBook, laneRegex, NEVER_WRITE, processInfo, refuseDestructive, sandboxProfile, splitCommand } from "./sandbox.js"

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

  // 2026-10-17 (critic: a lane holding projects/*/.git/** planted core.fsmonitor / a hook, run later by an agent with a
  // wider lane): a repository's config and hooks are never written in any lane; commits still work.
  test("a repository's .git/config (and its lock) and .git/hooks are never written, in any lane; git commit still is", () => {
    const repo = join(root, "projects", "tiny")
    mkdirSync(repo, { recursive: true })
    const git = (...a) => Bun.spawnSync(["/usr/bin/git", "-c", "user.email=a@b", "-c", "user.name=a", ...a], { cwd: repo, stderr: "pipe" })
    expect(git("init", "-q").exitCode).toBe(0)
    writeFileSync(join(repo, "a.txt"), "a\n")
    expect(git("add", "-A").exitCode + git("commit", "-qm", "first").exitCode).toBe(0)
    const config = readFileSync(join(repo, ".git", "config"), "utf8")
    for (const lane of [null, ["projects/**"], ["projects/*/.git/**"]]) {
      const profile = sandboxProfile(root, [], lane, { tmp })
      for (const r of GIT_NEVER_WRITE) expect(profile).toContain(`(deny file-write* (regex #"${r}"))`)
      const inBox = (...argv) => Bun.spawnSync(["/usr/bin/sandbox-exec", "-p", profile, ...argv], { cwd: repo, stderr: "pipe" })
      // core.fsmonitor through git config (writes .git/config.lock, then renames it over .git/config): refused.
      expect(inBox("/usr/bin/git", "config", "core.fsmonitor", "echo planted").exitCode).not.toBe(0)
      expect(inBox("/usr/bin/touch", join(repo, ".git", "config")).exitCode).not.toBe(0)
      expect(inBox("/usr/bin/touch", join(repo, ".git", "config.lock")).exitCode).not.toBe(0)
      expect(inBox("/bin/mkdir", "-p", join(repo, ".git", "hooks", "x")).exitCode).not.toBe(0)
      expect(inBox("/usr/bin/touch", join(repo, ".git", "hooks", "post-commit")).exitCode).not.toBe(0)
      expect(readFileSync(join(repo, ".git", "config"), "utf8")).toBe(config)
      expect(existsSync(join(repo, ".git", "hooks", "post-commit"))).toBe(false)
      if (lane?.[0] === "projects/*/.git/**") continue // the trainer's lane: nothing in the work tree to commit
      // A commit in the lane: objects, the index and refs are written.
      writeFileSync(join(repo, "a.txt"), `a ${lane}\n`)
      const commit = inBox("/usr/bin/git", "-c", "user.email=c@d", "-c", "user.name=c", "commit", "-qam", `in ${lane}`)
      expect(commit.exitCode).toBe(0)
    }
    expect(git("log", "--oneline").stdout.toString().trim().split("\n").length).toBe(3)
    // Elsewhere a file named config or hooks is written as usual.
    const profile = sandboxProfile(root, [], ["projects/**"], { tmp })
    expect(run(profile, "/usr/bin/touch", join(repo, "config")).exitCode).toBe(0)
    expect(run(profile, "/bin/mkdir", join(repo, "hooks")).exitCode).toBe(0)
  })

  // 2026-10-17 (live run: `uv run` failed to initialize its cache — uv writes a .git marker FILE in its buckets): in a
  // toolchain cache (extra) and the temp folder that one file is written; a cache's .git/config and the workspace's .git
  // entry are not.
  test("a toolchain cache keeps uv's .git marker file; config, hooks and the workspace's .git stay denied", () => {
    const cache = join(root, "..", `cache-${Date.now()}`)
    mkdirSync(join(cache, "uv", "sdists-v9"), { recursive: true })
    mkdirSync(join(cache, "uv", "git-v0", ".git"), { recursive: true })
    const profile = sandboxProfile(root, [cache], ["projects/**"], { tmp })
    expect(run(profile, "/usr/bin/touch", join(cache, "uv", "sdists-v9", ".git")).exitCode).toBe(0)
    expect(run(profile, "/usr/bin/touch", join(cache, ".git")).exitCode).toBe(0)
    expect(run(profile, "/usr/bin/touch", join(cache, "uv", "git-v0", ".git", "config")).exitCode).not.toBe(0)
    expect(run(profile, "/bin/mkdir", "-p", join(cache, "uv", "git-v0", ".git", "hooks", "x")).exitCode).not.toBe(0)
    mkdirSync(join(root, "projects", "marker"), { recursive: true })
    expect(run(profile, "/usr/bin/touch", join(root, "projects", "marker", ".git")).exitCode).not.toBe(0)
  })

  // 2026-10-17 (critic: around the config and hooks deny, the trainer wrote .git/commondir → a folder of its own with a
  // core.fsmonitor config, and the lead's `git status` ran it under the lead's lane; a projects/** lane renamed .git
  // away, rewrote its config and renamed it back): nothing that points git at another config or hooks folder is written.
  test("no lane points git elsewhere: commondir, the .git entry (renamed, a gitfile, a new one), modules/, worktrees/", () => {
    const repo = join(root, "projects", "other")
    mkdirSync(join(repo, "train"), { recursive: true })
    mkdirSync(join(root, "shared"), { recursive: true })
    const git = (...a) => Bun.spawnSync(["/usr/bin/git", "-c", "user.email=a@b", "-c", "user.name=a", ...a], { cwd: repo, stderr: "pipe" })
    expect(git("init", "-q").exitCode).toBe(0)
    writeFileSync(join(repo, "a.txt"), "a\n")
    expect(git("add", "-A").exitCode + git("commit", "-qm", "first").exitCode).toBe(0)
    const config = readFileSync(join(repo, ".git", "config"), "utf8")
    const pwned = join(root, "shared", "PWNED")
    const evil = `[core]\n\trepositoryformatversion = 0\n\tbare = false\n\tfsmonitor = "echo ran > ${pwned}"\n`
    const trainer = ["projects/*/train/**", "projects/*/.git/**"]
    const lead = ["shared/**", "projects/**"]
    for (const lane of [null, ["projects/**"], trainer]) {
      const profile = sandboxProfile(root, [], lane, { tmp })
      const inBox = (...argv) => Bun.spawnSync(["/usr/bin/sandbox-exec", "-p", profile, ...argv], { cwd: repo, stderr: "pipe" })
      const sh = (command) => inBox("/bin/sh", "-c", command).exitCode
      // commondir → a full common dir of the lane's own, with a planted config: the commondir write is refused.
      expect(sh(`mkdir -p .git/x && cp -R .git/objects .git/refs .git/x/ && printf '%s' '${evil}' > .git/x/config && echo x > .git/commondir`)).not.toBe(0)
      expect(existsSync(join(repo, ".git", "commondir"))).toBe(false)
      // The .git entry: never renamed (away and back), replaced by a gitfile, or made anew (any case: .GIT is .git).
      expect(inBox("/bin/mv", ".git", ".g2").exitCode).not.toBe(0)
      expect(existsSync(join(repo, ".g2"))).toBe(false)
      expect(sh("mkdir -p train/sub && echo 'gitdir: ../evil' > train/sub/.git")).not.toBe(0)
      expect(inBox("/bin/mkdir", join(repo, "train", "sub", ".git")).exitCode).not.toBe(0)
      expect(inBox("/bin/mkdir", join(repo, "train", "sub", ".GIT")).exitCode).not.toBe(0)
      expect(existsSync(join(repo, "train", "sub", ".git"))).toBe(false)
      // A submodule's or a linked worktree's git folder (each its own config and hooks), even as a folder renamed in.
      expect(sh(`mkdir -p train/evil/hooks && printf '%s' '${evil}' > train/evil/config && mkdir -p .git/modules && mv train/evil .git/modules/s`)).not.toBe(0)
      expect(inBox("/bin/mkdir", join(repo, ".git", "worktrees")).exitCode).not.toBe(0)
      expect(existsSync(join(repo, ".git", "modules")) || existsSync(join(repo, ".git", "worktrees"))).toBe(false)
      expect(readFileSync(join(repo, ".git", "config"), "utf8")).toBe(config)
      // The lead's git status then runs nothing planted; a commit in the lane still writes objects, the index and refs.
      rmSync(pwned, { force: true })
      const status = Bun.spawnSync(["/usr/bin/sandbox-exec", "-p", sandboxProfile(root, [], lead, { tmp }), "/usr/bin/git", "status", "--short"], { cwd: repo, stderr: "pipe" })
      expect(status.exitCode).toBe(0)
      expect(existsSync(pwned)).toBe(false)
      const file = lane === trainer ? "train/t.txt" : "a.txt"
      writeFileSync(join(repo, file), `${JSON.stringify(lane)}\n`)
      expect(inBox("/usr/bin/git", "-c", "user.email=c@d", "-c", "user.name=c", "add", file).exitCode).toBe(0)
      expect(inBox("/usr/bin/git", "-c", "user.email=c@d", "-c", "user.name=c", "commit", "-qm", `in ${lane}`).exitCode).toBe(0)
      rmSync(join(repo, "train", "evil"), { recursive: true, force: true })
      rmSync(join(repo, "train", "sub"), { recursive: true, force: true })
    }
    expect(git("log", "--oneline").stdout.toString().trim().split("\n").length).toBe(4)
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
