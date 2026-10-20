// The files artifact (backend/kernel/builtin/files.js, 2026-10-17) over a fake host: lanes (writes needed, reads
// restrict), the tree from fs/list, open and modified with diffs, focus, search, the twin state as the spec says.

import { describe, expect, test } from "bun:test"
import { Agent, Files, globRegex, hostFiles, inLane, lineDiff, mayContain } from "../index.js"
import { fakeHost } from "./fake-host.js"

const clock = () => new Date("2026-10-17T14:00:00Z")
// An agent as a command sees it (ctx.agent) and holds the artifact (its commands as tools).
function holder(name, files, config = {}, host) {
  const agent = new Agent({ name, report: false, ...config }, { infer: async () => "", artifacts: [files], context: { host } })
  const run = (cmd, input = {}) => agent.tools.get(`${files.id}.${cmd}`).run(input, { ...agent.context, agent })
  return { agent, run }
}
const WORKSPACE = {
  "shared/x/goal.md": "# Goal\nA small LLM in 5 minutes.\n",
  "projects/x/train.py": "import math\n\ndef train():\n    return math.pi\n",
  "projects/x/out/result.txt": "val_bpb 1.42\n",
  "projects/x/node_modules/pkg/index.js": "module.exports = 1\n",
  ".env": "SECRET=1\n",
}

describe("lanes", () => {
  test("a write needs writes: — none refused (the error says to add writes:), outside the lane refused", async () => {
    const host = fakeHost({ files: WORKSPACE })
    const files = new Files({ clock })
    const none = holder("planner", files, {}, host)
    await expect(none.run("write", { path: "shared/x/plan.md", content: "plan" })).rejects.toThrow("planner has no write lane: add writes: [globs] to its agent.md")
    const coder = holder("coder", files, { writes: ["projects/**"] }, host)
    await expect(coder.run("write", { path: "shared/x/goal.md", content: "mine now" })).rejects.toThrow("coder writes only projects/** (its writes:) — shared/x/goal.md is outside its lane")
    await expect(coder.run("edit", { path: "shared/x/goal.md", old: "Goal", new: "Mine" })).rejects.toThrow("outside its lane")
    await expect(coder.run("append", { path: "shared/x/goal.md", text: "more" })).rejects.toThrow("outside its lane")
    expect(host.fs.get("shared/x/goal.md")).toBe(WORKSPACE["shared/x/goal.md"])
    expect(await coder.run("write", { path: "projects/x/data.py", content: "rows = 3" })).toBe("created projects/x/data.py (1 lines, +1 -0)")
    expect(host.fs.get("projects/x/data.py")).toBe("rows = 3\n")
    expect(host.calls.find((c) => c.path === "fs/write").body).toEqual({ path: "projects/x/data.py", text: "rows = 3\n", revision: null })
  })

  test(".env and .mcp.json are never read or written, whatever the lane", async () => {
    const host = fakeHost({ files: WORKSPACE })
    const files = new Files({ clock })
    const lead = holder("lead", files, { writes: ["**"] }, host)
    await expect(lead.run("read", { path: ".env" })).rejects.toThrow(".env: ASKK's configuration")
    await expect(lead.run("write", { path: "projects/.env.local", content: "K=1" })).rejects.toThrow("agents never write it")
    await expect(lead.run("write", { path: ".mcp.json", content: "{}" })).rejects.toThrow("agents never write it")
  })

  // 2026-10-17 (critic): a member's lane "projects/*/.git/**" planted a core.fsmonitor command that the lead's git ran.
  test("what git runs as code — a .git config, a hook, a .git file — is never written, whatever the lane; it is still read", async () => {
    const host = fakeHost({ files: { ...WORKSPACE, "projects/x/.git/config": "[core]\n\tbare = false\n", "projects/x/.git/HEAD": "ref: refs/heads/main\n" } })
    const files = new Files({ clock })
    const trainer = holder("trainer", files, { writes: ["projects/*/.git/**", "projects/**", "**"] }, host)
    const refused = [
      "projects/x/.git/config",
      "projects/x/.git/config.lock",
      "projects/x/.git/config.worktree",
      "projects/x/.git/hooks/post-commit",
      "projects/x/.git/hooks/pre-commit.sample",
      "projects/x/.git/hooks",
      "projects/x/.GIT/CONFIG", // macOS: one file whatever the case
      "projects/x/.git/modules/sub/config", // a submodule's
      "projects/x/.git/modules/sub/hooks/post-checkout",
      "projects/x/.git/worktrees/w/config.worktree",
      ".git/config",
      "projects/y/.git", // a .git file: "gitdir: <a config elsewhere>"
    ]
    for (const path of refused)
      for (const [cmd, input] of [
        ["write", { content: "[core]\n\tfsmonitor = sh -c evil\n" }],
        ["append", { text: "[core]\n\tfsmonitor = sh -c evil" }],
        ["edit", { old: "bare = false", new: "fsmonitor = evil" }],
      ])
        await expect([path, cmd, await trainer.run(cmd, { path, ...input }).catch((e) => e.message)]).toEqual([path, cmd, `${path.replace(/^\.?\/+/, "")}: git runs this as code (a .git config, hook or gitdir file) — agents never write it; commit with git in the terminal`])
    expect(host.fs.get("projects/x/.git/config")).toBe("[core]\n\tbare = false\n")
    expect(host.calls.some((c) => c.path === "fs/write")).toBe(false)
    // reads stay; the rest of .git (refs, HEAD, objects) and look-alikes outside .git stay writable in the lane
    expect(await trainer.run("read", { path: "projects/x/.git/config" })).toContain("bare = false")
    expect(await trainer.run("write", { path: "projects/x/.git/HEAD", content: "ref: refs/heads/dev" })).toStartWith("wrote projects/x/.git/HEAD")
    expect(await trainer.run("write", { path: "projects/x/config", content: "lr = 3e-4" })).toStartWith("created projects/x/config")
    expect(await trainer.run("write", { path: "projects/x/hooks/notes.md", content: "x" })).toStartWith("created projects/x/hooks/notes.md")
    expect(await trainer.run("write", { path: "projects/x/.github/config", content: "x" })).toStartWith("created")
    expect(await trainer.run("write", { path: "projects/x/.gitignore", content: "out/" })).toStartWith("created")
  })

  test("reads: restricts read, list, search, focus and what the prompt shows — the critic never sees the code", async () => {
    const host = fakeHost({ files: WORKSPACE })
    const files = new Files({ clock })
    const critic = holder("critic", files, { reads: ["shared/*/goal.md", "projects/*/out/**"], writes: ["shared/*/critique.md"] }, host)
    await expect(critic.run("read", { path: "projects/x/train.py" })).rejects.toThrow("critic reads only shared/*/goal.md, projects/*/out/** (its reads:) — projects/x/train.py is outside its lane")
    expect(await critic.run("read", { path: "projects/x/out/result.txt" })).toBe("projects/x/out/result.txt — 1 lines\n1\tval_bpb 1.42")
    expect(await critic.run("list", { path: "projects/x" })).toBe("projects/x/ — 1 entry\nout/")
    await expect(critic.run("list", { path: "projects/x/node_modules" })).rejects.toThrow("outside its lane")
    expect(await critic.run("search", { text: "math" })).toStartWith('no line holds "math"')
    expect(await critic.run("search", { text: "BPB" })).toContain("projects/x/out/result.txt:1: val_bpb 1.42")
    await expect(critic.run("focus", { path: "projects/x/node_modules" })).rejects.toThrow("outside its lane")
    await files.refresh(critic.agent)
    const prompt = critic.agent.render({ text: "judge", from: "lead" }, [])
    expect(prompt).toContain("you read only: shared/*/goal.md, projects/*/out/**")
    expect(prompt).toContain("result.txt")
    expect(prompt).not.toContain("train.py")
    expect(prompt).not.toContain("node_modules")
    // The twin (the owner's view) still shows every file.
    expect(files.twin().state.tree.map((e) => e.path)).toContain("projects/x/train.py")
  })

  test("globs: the sandbox's rules (* in a folder, ** across, a trailing /, !exclusions)", () => {
    expect(globRegex("projects/**").test("projects/x/a/b.py")).toBe(true)
    expect(globRegex("shared/*/goal.md").test("shared/x/goal.md")).toBe(true)
    expect(globRegex("shared/*/goal.md").test("shared/x/y/goal.md")).toBe(false)
    expect(globRegex("projects/").test("projects/x.py")).toBe(true)
    expect(globRegex("**/out/**").test("projects/x/out/a.png")).toBe(true)
    expect(inLane(["projects/**", "!projects/*/secret/**"], "projects/x/secret/k")).toBe(false)
    expect(inLane(["projects/**", "!projects/*/secret/**"], "projects/x/ok")).toBe(true)
    expect(mayContain(["projects/*/out/**"], "projects")).toBe(true)
    expect(mayContain(["projects/*/out/**"], "projects/x")).toBe(true)
    expect(mayContain(["projects/*/out/**"], "shared")).toBe(false)
    expect(mayContain(["projects/*/out/**"], "projects/x/src")).toBe(false)
  })
})

describe("the tree, open and modified", () => {
  test("refresh pulls the tree from fs/list (sizes, times; heavy folders listed, not walked); changed() only on a change", async () => {
    const host = fakeHost({ files: WORKSPACE })
    const files = new Files({ clock })
    const lead = holder("lead", files, { writes: ["**"] }, host)
    let changes = 0
    files.onChange(() => changes++)
    await files.refresh(lead.agent)
    const tree = files.twin().state.tree
    expect(tree.find((e) => e.path === "projects/x/train.py")).toEqual({ path: "projects/x/train.py", size: 45, mtime: 1_700_000_000_001, dir: false })
    expect(tree.find((e) => e.path === "projects/x/node_modules")).toMatchObject({ dir: true })
    expect(tree.some((e) => e.path.startsWith("projects/x/node_modules/"))).toBe(false)
    expect(changes).toBe(1)
    files.pulled = 0 // past REFRESH_MS: pulled again, nothing changed on disk
    await files.refresh(lead.agent)
    expect(changes).toBe(1)
    expect(host.calls.filter((c) => c.path.startsWith("fs/list")).length).toBeGreaterThan(4)
    // Holders refreshing together share one pull.
    files.pulled = 0
    const before = host.calls.length
    await Promise.all([files.refresh(lead.agent), files.refresh(lead.agent)])
    const lists = host.calls.slice(before).filter((c) => c.path === "fs/list?path=").length
    expect(lists).toBe(1)
  })

  test("read marks open (≤ 12, one per path); a write, edit and append are modified with a diff (one per path, ≤ 30)", async () => {
    const host = fakeHost({ files: WORKSPACE })
    const files = new Files({ clock })
    const coder = holder("coder", files, { writes: ["projects/**"] }, host)
    expect(await coder.run("read", { path: "projects/x/train.py", from: 3, lines: 2 })).toBe("projects/x/train.py — 4 lines, lines 3–4\n3\tdef train():\n4\t    return math.pi")
    expect(files.state.open).toEqual([{ path: "projects/x/train.py", by: "coder", at: "2026-10-17T14:00:00.000Z" }])
    expect(await coder.run("edit", { path: "projects/x/train.py", old: "math.pi", new: "math.e" })).toBe("edited projects/x/train.py: 1 replacement (+1 -1)")
    expect(host.fs.get("projects/x/train.py")).toContain("return math.e")
    const m = files.state.modified[0]
    expect(m).toEqual({ path: "projects/x/train.py", by: "coder", at: "2026-10-17T14:00:00.000Z", op: "edit", added: 1, removed: 1, diff: "@@ -1,4 +1,4 @@\n import math\n \n def train():\n-    return math.pi\n+    return math.e" })
    await expect(coder.run("edit", { path: "projects/x/train.py", old: "nothing like it", new: "x" })).rejects.toThrow("old matches nothing")
    await coder.run("write", { path: "projects/x/twice.py", content: "a = 1\na = 1\n" })
    await expect(coder.run("edit", { path: "projects/x/twice.py", old: "a = 1", new: "b" })).rejects.toThrow("old matches 2 times — make it unique (more lines around it) or pass all: true")
    expect(await coder.run("edit", { path: "projects/x/twice.py", old: "a = 1", new: "b = 2", all: true })).toBe("edited projects/x/twice.py: 2 replacements (+2 -2)")
    expect(await coder.run("append", { path: "projects/x/log.txt", text: "step 1" })).toBe("appended to projects/x/log.txt (+1 lines, 1 now)")
    expect(await coder.run("append", { path: "projects/x/log.txt", text: "step 2" })).toBe("appended to projects/x/log.txt (+1 lines, 2 now)")
    expect(host.fs.get("projects/x/log.txt")).toBe("step 1\nstep 2\n")
    expect(files.state.modified.map((x) => [x.path, x.op])).toEqual([["projects/x/train.py", "edit"], ["projects/x/twice.py", "edit"], ["projects/x/log.txt", "append"]])
    for (let i = 0; i < 40; i++) await coder.run("write", { path: `projects/x/f${i}.py`, content: `x = ${i}` })
    expect(files.state.modified).toHaveLength(30)
    expect(files.state.modified.at(-1).path).toBe("projects/x/f39.py")
    for (let i = 0; i < 15; i++) await coder.run("read", { path: `projects/x/f${i}.py` })
    expect(files.state.open).toHaveLength(12)
    expect(files.state.open.at(-1).path).toBe("projects/x/f14.py")
  })

  test("a diff is at most 80 lines, its last one says how many more; a file changed meanwhile is a 409, said plainly", async () => {
    const long = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n")
    const d = lineDiff(null, long)
    expect(d.diff.split("\n")).toHaveLength(80)
    expect(d.diff.split("\n")[0]).toBe("@@ -0,0 +1,200 @@")
    expect(d.diff.split("\n").at(-1)).toBe(" … 122 more lines")
    expect(d).toMatchObject({ added: 200, removed: 0, lines: 200 })
    const host = fakeHost({ files: { "projects/a.txt": "one\n" } })
    const racing = { ...hostFiles, read: async (p, ctx) => ({ ...(await hostFiles.read(p, ctx)), revision: "stale" }) }
    const files = new Files({ clock, adapter: racing })
    const coder = holder("coder", files, { writes: ["projects/**"] }, host)
    await expect(coder.run("write", { path: "projects/a.txt", content: "two" })).rejects.toThrow("projects/a.txt changed while you wrote it (another agent or the owner): read it again, then write")
  })

  test("the tree is at most 800 entries (truncated), breadth first; focus moves its root for every holder", async () => {
    const many = Object.fromEntries(Array.from({ length: 900 }, (_, i) => [`data/d${String(i % 30).padStart(2, "0")}/f${i}.csv`, "1"]))
    const host = fakeHost({ files: { ...many, "README.md": "hi", "projects/x/a.py": "a = 1" } })
    const files = new Files({ clock })
    const lead = holder("lead", files, {}, host)
    await files.refresh(lead.agent)
    const s = files.twin().state
    expect(s.tree).toHaveLength(800)
    expect(s.truncated).toBe(true)
    expect(s.tree.slice(0, 3).map((e) => e.path)).toEqual(["data", "projects", "README.md"]) // the top first
    expect(await lead.run("focus", { path: "projects/x" })).toBe("the tree shows projects/x/ now: 1 file")
    expect(files.twin().state).toMatchObject({ root: "projects/x", truncated: false, focus: { path: "projects/x", by: "lead", at: "2026-10-17T14:00:00.000Z" }, tree: [{ path: "projects/x/a.py", size: 5, mtime: expect.any(Number), dir: false }] })
    expect(lead.agent.render({ text: "x", from: "owner" }, [])).toContain("ROOT projects/x/ (focused by lead) — 1 files\na.py  5 B")
    await expect(lead.run("focus", { path: "nope" })).rejects.toThrow("nope/: HTTP 404: Not found: nope")
  })

  test("the prompt: commands it holds, its lanes, the tree (≤ 60 lines), open, the last 8 modified", async () => {
    const host = fakeHost({ files: { ...WORKSPACE, ...Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`projects/x/m${String(i).padStart(2, "0")}.py`, "x"])) } })
    const files = new Files({ clock })
    const coder = new Agent({ name: "coder", report: false, writes: ["projects/**"] }, { infer: async () => "", context: { host } }).addArtifact(files, { commands: ["read", "write"] })
    for (let i = 0; i < 10; i++) await coder.tools.get("files.write").run({ path: `projects/x/m${String(i).padStart(2, "0")}.py`, content: `v${i}` }, { host, agent: coder })
    await coder.tools.get("files.read").run({ path: "shared/x/goal.md" }, { host, agent: coder })
    await files.refresh(coder)
    const block = coder.render({ text: "x", from: "owner" }, []).split("# files — files — the workspace\n")[1].split("\n\n# REQUEST")[0]
    const lines = block.split("\n")
    expect(lines[0]).toBe("the desk's files (workspace paths, shared by the agents that hold them): files.read, files.write")
    expect(lines[1]).toBe("you write only: projects/**")
    expect(block).toContain("… ")
    expect(block).toContain("below: files.list a folder")
    const tree = lines.slice(lines.findIndex((l) => l.startsWith("ROOT ")) + 1, lines.findIndex((l) => l.startsWith("… ")))
    expect(tree).toHaveLength(60)
    expect(tree.slice(0, 4)).toEqual(["projects/", "  x/", "    node_modules/ …", "    out/"])
    expect(block).toContain("OPEN shared/x/goal.md (coder)")
    const modified = block.split("MODIFIED (newest last)\n")[1].split("\n")
    expect(modified).toHaveLength(8)
    expect(modified.at(-1)).toBe("  projects/x/m09.py write by coder +1 -1")
  })

  test("a desk's own adapter replaces the host", async () => {
    const disk = new Map([["notes/a.md", "alpha\n"]])
    const adapter = {
      list: async (path) => (path === "" ? [{ name: "notes", type: "dir", size: 0, mtime: 1 }] : [...disk.keys()].filter((p) => p.startsWith(`${path}/`)).map((p) => ({ name: p.split("/").pop(), type: "file", size: disk.get(p).length, mtime: 2 }))),
      read: async (path) => (disk.has(path) ? { text: disk.get(path), binary: false, truncated: false, size: disk.get(path).length } : null),
      write: async (path, text) => (disk.set(path, text), { created: true }),
    }
    const files = new Files({ clock, adapter })
    const writer = holder("writer", files, { writes: ["notes/**"] }, null)
    expect(await writer.run("append", { path: "notes/a.md", text: "beta" })).toBe("appended to notes/a.md (+1 lines, 2 now)")
    expect(disk.get("notes/a.md")).toBe("alpha\nbeta\n")
    await files.refresh(writer.agent)
    expect(files.state.tree.map((e) => e.path)).toEqual(["notes", "notes/a.md"])
  })

  test("without a host, refresh fails in one line and the step goes on", async () => {
    const files = new Files({ clock })
    const replies = [{ thought: "done", calls: [], answer: "ok" }]
    const prompts = []
    const agent = new Agent({ name: "lone", report: false }, { infer: async (p) => (prompts.push(p), JSON.stringify(replies.shift())), artifacts: [files] })
    expect(await agent.ask("hi")).toBe("ok")
    expect(prompts[0]).toContain("(refresh failed: the tree of the workspace/: no host here (ctx.host): the desk server reaches the workspace — this is its last state)")
  })
})

// 2026-10-17: the reply parser hands `text: [...]` as a list; it went into progress.md as a JSON array.
describe("text from a list", () => {
  test("a list is one line per item (objects as key: value) in a text file; a .json file keeps JSON", async () => {
    const host = fakeHost({ files: WORKSPACE })
    const files = new Files({ clock })
    const coder = holder("coder", files, { writes: ["shared/**", "projects/**"] }, host)
    await coder.run("append", { path: "shared/x/progress.md", text: ["exp r01: val_bpb=0.94", { r02: "val_bpb 0.80" }] })
    expect(host.fs.get("shared/x/progress.md")).toBe("exp r01: val_bpb=0.94\nr02: val_bpb 0.80\n")
    await coder.run("write", { path: "projects/x/out/runs.json", content: [{ run: "r01" }] })
    expect(JSON.parse(host.fs.get("projects/x/out/runs.json"))).toEqual([{ run: "r01" }])
  })
})

// 2026-10-17: the coder searched projects/sample-app/train.py and got "Not a folder" three times.
describe("search in one file", () => {
  test("a file as path is searched alone; a reader's lane still holds", async () => {
    const host = fakeHost({ files: WORKSPACE })
    const files = new Files({ clock })
    const coder = holder("coder", files, { writes: ["projects/**"] }, host)
    expect(await coder.run("search", { text: "PI", path: "projects/x/train.py" })).toBe('1 lines hold "PI" (projects/x/train.py)\nprojects/x/train.py:4: return math.pi')
    expect(await coder.run("search", { text: "zeta", path: "projects/x/train.py" })).toBe('no line holds "zeta" (projects/x/train.py)')
    const critic = holder("critic", files, { reads: ["projects/*/out/**"] }, host)
    await expect(critic.run("search", { text: "math", path: "projects/x/train.py" })).rejects.toThrow("outside its lane")
    await expect(coder.run("search", { text: "x", path: "projects/nope" })).rejects.toThrow("projects/nope/: ")
  })
})
