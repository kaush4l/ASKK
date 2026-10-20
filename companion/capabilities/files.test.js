// fs/* with mounts (desks/<name>/… = a mounted desk's folder, only when allowed) and fs/watch (SSE change events).
// A temp workspace and mount root, removed after.
import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createFiles, deskMounts } from "./files.js"

const top = realpathSync(mkdtempSync(join(tmpdir(), "files-test-")))
const root = join(top, "data")
const desks = join(top, "custom")
const outside = join(top, "outside")
for (const dir of [join(root, "projects"), join(desks, "alpha", "tools"), join(desks, "beta"), outside]) mkdirSync(dir, { recursive: true })
for (const name of ["alpha", "gamma"]) writeFileSync(join(top, `${name}.marker`), "")
writeFileSync(join(desks, "alpha", "main.js"), "export default {}\n")
writeFileSync(join(desks, "beta", "secret.txt"), "beta\n")
writeFileSync(join(outside, "loot.txt"), "loot\n")
writeFileSync(join(root, "projects", "a.py"), "print(1)\n")
symlinkSync(join(outside), join(desks, "gamma")) // allowed by name, but a link out of the mount root
symlinkSync(join(outside, "loot.txt"), join(desks, "alpha", "loot.txt")) // a link out of a mounted desk
const mounts = { desks: { root: desks, allow: (name) => existsSync(join(top, `${name}.marker`)) } }
const files = createFiles({ root, mounts })
afterAll(() => {
  files.close()
  rmSync(top, { recursive: true, force: true })
})
const get = (path, params) => files.GET[path](new URLSearchParams(params))

describe("H9: mounts", () => {
  test("desks/<name> resolves to the mounted desk only when allowed (a link is never a mount)", async () => {
    expect(deskMounts(mounts).list().map((d) => d.name)).toEqual(["alpha"])
    expect((await get("fs/list", { path: "desks" })).entries.map((e) => e.name)).toEqual(["alpha"])
    expect((await get("fs/read", { path: "desks/alpha/main.js" })).text).toBe("export default {}\n")
    await expect(get("fs/read", { path: "desks/beta/secret.txt" })).rejects.toMatchObject({ status: 403 })
    await expect(get("fs/read", { path: "desks/gamma/loot.txt" })).rejects.toMatchObject({ status: 403 })
    await expect(get("fs/list", { path: "desks/zeta" })).rejects.toMatchObject({ status: 403 })
  })

  test("escapes are refused: .. out of a mount, a link out of a mounted desk, writes through either", async () => {
    await expect(get("fs/read", { path: "desks/alpha/../beta/secret.txt" })).rejects.toMatchObject({ status: 403 })
    await expect(get("fs/read", { path: "desks/alpha/../../outside/loot.txt" })).rejects.toMatchObject({ status: 403 })
    await expect(get("fs/read", { path: "desks/alpha/loot.txt" })).rejects.toMatchObject({ status: 403 })
    await expect(files.POST["fs/write"]({ path: "desks/alpha/../beta/x.txt", text: "x" })).rejects.toMatchObject({ status: 403 })
    await expect(files.POST["fs/write"]({ path: "desks/alpha/loot.txt", text: "x" })).rejects.toMatchObject({ status: 403 })
    await expect(files.POST["fs/write"]({ path: "desks/beta/x.txt", text: "x" })).rejects.toMatchObject({ status: 403 })
    expect(readFileSync(join(outside, "loot.txt"), "utf8")).toBe("loot\n")
    expect(existsSync(join(desks, "beta", "x.txt"))).toBe(false)
  })

  test("a write into a mounted desk lands in its folder, shown as a workspace path; its root is never deleted", async () => {
    expect(await files.POST["fs/write"]({ path: "desks/alpha/tools/new.js", text: "1\n" })).toMatchObject({ path: "desks/alpha/tools/new.js", created: true })
    expect(readFileSync(join(desks, "alpha", "tools", "new.js"), "utf8")).toBe("1\n")
    await expect(files.POST["fs/write"]({ path: "desks/alpha/.env", text: "K=1" })).rejects.toMatchObject({ status: 403 })
    await expect(files.POST["fs/delete"]({ path: "desks/alpha", recursive: true })).rejects.toMatchObject({ status: 403 })
    expect(await files.POST["fs/delete"]({ path: "desks/alpha/tools/new.js" })).toEqual({ path: "desks/alpha/tools/new.js", type: "file" })
  })

  test("the workspace root lists and trees desks/ with the mounted desks; without mounts desks/ is a plain folder", async () => {
    const listed = await get("fs/list", { path: "" })
    expect(listed.entries.find((e) => e.name === "desks")).toMatchObject({ type: "dir", mount: true })
    const tree = await get("fs/tree", { path: "" })
    const mounted = tree.entries.find((e) => e.name === "desks")
    expect(mounted.children.map((c) => c.name)).toEqual(["alpha"])
    expect(mounted.children[0].children.map((c) => c.name)).toContain("main.js")
    const plain = createFiles({ root })
    mkdirSync(join(root, "desks", "beta"), { recursive: true })
    writeFileSync(join(root, "desks", "beta", "own.txt"), "workspace's own\n")
    expect((await plain.GET["fs/read"](new URLSearchParams({ path: "desks/beta/own.txt" }))).text).toBe("workspace's own\n")
    await expect(get("fs/read", { path: "desks/beta/own.txt" })).rejects.toMatchObject({ status: 403 }) // mounted: desks/ is the mounts
    rmSync(join(root, "desks"), { recursive: true })
  })
})

// Reads SSE events from a watch until `check(events)` holds or `ms` pass.
async function events(response, check, ms = 3000) {
  const reader = response.body.getReader()
  const out = []
  let buffer = ""
  const deadline = Date.now() + ms
  while (Date.now() < deadline && !check(out)) {
    const next = await Promise.race([reader.read(), Bun.sleep(Math.max(1, deadline - Date.now())).then(() => null)])
    if (!next || next.done) break
    buffer += new TextDecoder().decode(next.value)
    const blocks = buffer.split("\n\n")
    buffer = blocks.pop()
    for (const b of blocks) if (b.startsWith("data: ")) out.push(JSON.parse(b.slice(6)))
  }
  reader.cancel().catch(() => {})
  return out
}

describe("H8: fs/watch", () => {
  test("a change event within 2 s of a file write (workspace paths; node_modules left out)", async () => {
    const abort = new AbortController()
    const response = await files.watch(new URLSearchParams({ path: "" }), { signal: abort.signal })
    expect(response.headers.get("content-type")).toBe("text/event-stream")
    await Bun.sleep(150)
    const t0 = Date.now()
    mkdirSync(join(root, "node_modules", "x"), { recursive: true })
    writeFileSync(join(root, "node_modules", "x", "index.js"), "noise")
    writeFileSync(join(root, "projects", "train.py"), "print('train')\n")
    const seen = await events(response, (out) => out.some((e) => e.type === "change" && e.paths.includes("projects/train.py")))
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(seen[0]).toEqual({ type: "ready", path: "" })
    const changed = seen.filter((e) => e.type === "change").flatMap((e) => e.paths)
    expect(changed).toContain("projects/train.py")
    expect(changed.some((p) => p.includes("node_modules"))).toBe(false)
    abort.abort()
  })

  test("a mounted desk's changes come as desks/<name>/… paths; close() ends every watch", async () => {
    const response = await files.watch(new URLSearchParams({ path: "" }), null)
    await Bun.sleep(150)
    writeFileSync(join(desks, "alpha", "tools", "watched.js"), "1")
    const seen = await events(response.clone(), (out) => out.some((e) => e.type === "change" && e.paths.includes("desks/alpha/tools/watched.js")))
    expect(seen.filter((e) => e.type === "change").flatMap((e) => e.paths)).toContain("desks/alpha/tools/watched.js")
    files.close()
    const reader = response.body.getReader()
    let done = false
    for (let i = 0; i < 10 && !done; i++) done = (await reader.read()).done
    expect(done).toBe(true)
  })

  test("a folder outside the workspace or a disallowed mount is refused", async () => {
    await expect(files.watch(new URLSearchParams({ path: "../outside" }), null)).rejects.toMatchObject({ status: 403 })
    await expect(files.watch(new URLSearchParams({ path: "desks/beta" }), null)).rejects.toMatchObject({ status: 403 })
  })
})

// 2026-10-17 owner ("the project can be outside of our project"): a loaded project is projects/<name>/ in the workspace,
// beside the desk's own projects/ folders; files read, written, listed, watched and deleted in it like the desk's own.
describe("loaded projects: projects/<name>/ is the project's own folder", () => {
  const ws = join(top, "ws2")
  const app = join(top, "elsewhere", "app")
  mkdirSync(join(ws, "projects", "own"), { recursive: true })
  mkdirSync(join(app, "src"), { recursive: true })
  writeFileSync(join(ws, "projects", "own", "a.txt"), "own\n")
  writeFileSync(join(app, "src", "index.js"), "export {}\n")
  const loaded = new Map([["app", app]])
  const projects = { folder: (name) => loaded.get(name) ?? null, list: () => [...loaded.keys()].map((name) => ({ name })) }
  const pf = createFiles({ root: ws, mounts: { projects } })
  const pget = (path, params) => pf.GET[path](new URLSearchParams(params))

  test("projects/ lists the desk's own and the loaded ones; read and write go to the project's folder", async () => {
    expect((await pget("fs/list", { path: "projects" })).entries.map((e) => [e.name, !!e.mount])).toEqual([["app", true], ["own", false]])
    expect((await pget("fs/read", { path: "projects/app/src/index.js" })).text).toBe("export {}\n")
    expect((await pget("fs/read", { path: "projects/own/a.txt" })).text).toBe("own\n")
    const w = await pf.POST["fs/write"]({ path: "projects/app/.agents/project.md", text: "# app\n" })
    expect(w).toMatchObject({ path: "projects/app/.agents/project.md", created: true })
    expect(readFileSync(join(app, ".agents", "project.md"), "utf8")).toBe("# app\n")
    expect((await pget("fs/list", { path: "projects/app" })).path).toBe("projects/app")
  })

  test("the tree shows the project under projects/; deleting the project itself is refused, a file in it is not", async () => {
    const tree = await pget("fs/tree", { path: "" })
    const pr = tree.entries.find((e) => e.name === "projects")
    expect(pr.children.map((c) => c.name)).toEqual(["app", "own"])
    expect(pr.children.find((c) => c.name === "app").children.map((c) => c.name)).toContain("src")
    await expect(pf.POST["fs/delete"]({ path: "projects/app", recursive: true })).rejects.toMatchObject({ status: 403 })
    await pf.POST["fs/delete"]({ path: "projects/app/.agents/project.md" })
    expect(existsSync(join(app, ".agents", "project.md"))).toBe(false)
  })

  test("an unloaded name is the desk's own folder again; a link out of the project is refused", async () => {
    symlinkSync(outside, join(app, "out-link"))
    await expect(pget("fs/read", { path: "projects/app/out-link/loot.txt" })).rejects.toMatchObject({ status: 403 })
    loaded.delete("app")
    await expect(pget("fs/read", { path: "projects/app/src/index.js" })).rejects.toMatchObject({ status: 404 })
    expect((await pget("fs/list", { path: "projects" })).entries.map((e) => e.name)).toEqual(["own"])
    loaded.set("app", app)
  })

  test("a desk with no projects/ of its own lists the loaded ones there (and at the root)", async () => {
    const bare = join(top, "ws3")
    mkdirSync(bare)
    const bf = createFiles({ root: bare, mounts: { projects } })
    expect((await bf.GET["fs/list"](new URLSearchParams({ path: "" }))).entries.map((e) => e.name)).toEqual(["projects"])
    expect((await bf.GET["fs/list"](new URLSearchParams({ path: "projects" }))).entries.map((e) => e.name)).toEqual(["app"])
    bf.close()
  })

  test("a change in a loaded project comes as projects/<name>/…", async () => {
    const response = await pf.watch(new URLSearchParams({ path: "projects" }), null)
    await Bun.sleep(150)
    writeFileSync(join(app, "src", "changed.js"), "1")
    const seen = await events(response, (out) => out.some((e) => e.type === "change" && e.paths.includes("projects/app/src/changed.js")))
    expect(seen[0]).toEqual({ type: "ready", path: "projects" })
    pf.close()
  })
})

describe("P1: tail reads (2026-10-17: a long metrics.jsonl showed only its oldest rows)", () => {
  test("tail=1 on a file past the read cap: its last bytes from a whole line, its first line as head; a small file reads whole", async () => {
    const { HOST_LIMITS } = await import("../shared/config.js")
    const cap = HOST_LIMITS.files.readBytes
    const rows = ["step\tloss"]
    let size = 0
    for (let i = 0; size < cap * 2; i++) {
      const line = `${i}\t${(8 - i / 1e5).toFixed(5)}`
      rows.push(line)
      size += line.length + 1
    }
    writeFileSync(join(root, "projects", "metrics.tsv"), `${rows.join("\n")}\n`)
    const head = await get("fs/read", { path: "projects/metrics.tsv" })
    expect(head).toMatchObject({ truncated: true })
    expect(head.text.startsWith("step\tloss\n0\t")).toBe(true)
    const tail = await get("fs/read", { path: "projects/metrics.tsv", tail: "1" })
    expect(tail).toMatchObject({ truncated: true, tail: true, head: "step\tloss", revision: null })
    expect(tail.text.length).toBeLessThanOrEqual(cap)
    expect(tail.text.endsWith(`${rows.at(-1)}\n`)).toBe(true) // the newest row is there
    expect(tail.text.split("\n")[0]).toMatch(/^\d+\t\d\.\d{5}$/) // starts on a whole row
    expect(readFileSync(join(root, "projects", "metrics.tsv")).subarray(tail.from).toString()).toBe(tail.text)
    const small = await get("fs/read", { path: "projects/a.py", tail: "1" })
    expect(small).toMatchObject({ truncated: false, text: "print(1)\n" })
    expect(small.tail).toBeUndefined()
  })

  test("a cut that falls right after a newline keeps the first line whole (critic)", async () => {
    const { HOST_LIMITS } = await import("../shared/config.js")
    const cap = HOST_LIMITS.files.readBytes
    const head = "step\tloss\n" + "0\t9.0\n".repeat(100)
    const last = `${"7".repeat(cap - 3)}\t1\n` // exactly cap bytes: the cut is right after head's last "\n"
    writeFileSync(join(root, "projects", "edge.tsv"), head + last)
    const tail = await get("fs/read", { path: "projects/edge.tsv", tail: "1" })
    expect(tail.from).toBe(head.length)
    expect(tail.text).toBe(last)
    expect(tail.head).toBe("step\tloss")
  })
})

