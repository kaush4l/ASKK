// Checkpoints of a working tree: a temp git repo with a commit, the owner's own uncommitted work, then the desk's changes
// — a rollback brings back exactly the checkpoint's tree (HEAD untouched), and keeps what it undid as evidence.
import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createCheckpoints, parseStatus } from "./checkpoints.js"

const top = realpathSync(mkdtempSync(join(tmpdir(), "checkpoints-test-")))
const repo = join(top, "repo")
afterAll(() => rmSync(top, { recursive: true, force: true }))
const sh = (...args) => Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "pipe" })
const put = (p, text) => (mkdirSync(join(repo, p, ".."), { recursive: true }), writeFileSync(join(repo, p), text))
const read = (p) => (existsSync(join(repo, p)) ? readFileSync(join(repo, p), "utf8") : null)

mkdirSync(repo)
sh("init", "-q")
sh("config", "user.email", "t@t")
sh("config", "user.name", "t")
put("app/page.jsx", "page v1\n")
put("lib/a.js", "a v1\n")
put("lib/gone.js", "gone\n")
sh("add", ".")
sh("commit", "-qm", "base")

test("parseStatus: modified, untracked, deleted, a rename as new + old deleted", () => {
  expect(parseStatus(" M a.js\0?? b/c.js\0 D d.js\0R  new.js\0old.js\0")).toEqual([
    { path: "a.js", code: " M" },
    { path: "b/c.js", code: "??" },
    { path: "d.js", code: " D" },
    { path: "new.js", code: "R " },
    { path: "old.js", code: " D" },
  ])
})

describe("create and restore", () => {
  const cp = createCheckpoints({ repo, dir: join(top, "checkpoints"), clock: () => new Date("2026-10-25T22:00:00Z") })

  test("a checkpoint holds every file differing from HEAD; a rollback undoes what came after it, HEAD untouched", () => {
    // the owner's own work, uncommitted: kept by the checkpoint
    put("lib/a.js", "a v2 (owner)\n")
    put("notes/todo.md", "owner todo\n")
    unlinkSync(join(repo, "lib/gone.js"))
    const c1 = cp.create({ why: "checks pass", by: "coder", kind: "good" })
    expect(c1).toMatchObject({ id: "c1", files: 2, deleted: 1, kind: "good", why: "checks pass" })
    // the desk's change after it: edits, a new file, an edit of a clean file
    put("lib/a.js", "a v3 broken\n")
    put("app/page.jsx", "page broken\n")
    put("lib/new.js", "new\n")
    put("notes/todo.md", "owner todo\nmore\n")
    const r = cp.restore("c1", { why: "the server did not come up", by: "restart" })
    expect(r.before).toBe("c2")
    expect(r.restored.sort()).toEqual(["lib/a.js", "notes/todo.md"])
    expect(r.reverted).toEqual(["app/page.jsx"])
    expect(r.removed).toEqual(["lib/new.js"])
    expect([read("lib/a.js"), read("app/page.jsx"), read("notes/todo.md"), read("lib/new.js"), read("lib/gone.js")]).toEqual(["a v2 (owner)\n", "page v1\n", "owner todo\n", null, null])
    // the evidence: what broke, restorable
    expect(cp.get("c2")).toMatchObject({ kind: "before-rollback", why: "before rollback to c1: the server did not come up" })
    cp.restore("c2")
    expect([read("lib/a.js"), read("lib/new.js")]).toEqual(["a v3 broken\n", "new\n"])
    expect(cp.list().map((c) => c.id)).toEqual(["c3", "c2", "c1"])
  })

  test("refused when HEAD moved since the checkpoint; unknown ids refused", () => {
    sh("add", ".")
    sh("commit", "-qm", "owner commit")
    expect(() => cp.restore("c1")).toThrow(/HEAD moved since c1/)
    expect(() => cp.restore("c99")).toThrow(/No checkpoint c99/)
    expect(() => cp.restore("../x")).toThrow(/No checkpoint/)
  })
})
