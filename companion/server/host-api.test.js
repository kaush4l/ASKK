// The host API's terminal, preview and watch routes through handle() (the Host / Origin / JSON rules included), GET
// handlers answering with their own Response, close() ending every session and page, and the header comment
// documenting every route. A stub desk in a folder under ~/.askk/tmp (outside TMPDIR, which programs may write);
// no tool servers, no integrations; the "desk server" port is a Bun.serve no page or program may reach.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { createHostApi } from "./host-api.js"
import { loadDesk } from "../team/desk.js"
import { HOST_CAPABILITIES } from "../../backend/live/host.js"

const base = join(homedir(), ".askk", "tmp")
mkdirSync(base, { recursive: true })
const top = realpathSync(mkdtempSync(join(base, "host-api-test-")))
const folder = join(top, "desk")
const desksRoot = join(top, "custom")
for (const dir of [join(folder, "data"), join(folder, "state"), join(desksRoot, "alpha"), join(top, "integrations")]) mkdirSync(dir, { recursive: true })
writeFileSync(join(desksRoot, "alpha", ".mounted"), "")
writeFileSync(join(desksRoot, "alpha", "notes.md"), "alpha\n")

let server // the desk server's port: the API's own
let app // an app on another port
let api
let readOnly
let PORT
const deskOf = () => ({
  name: "host-test",
  description: "a stub desk",
  folder,
  workspace: join(folder, "data"),
  state: join(folder, "state"),
  port: null,
  integrations: [],
  terminal: { programs: ["sleep", "cat", "curl"] },
  mounts: { desks: { root: desksRoot, allow: (name) => existsSync(join(desksRoot, name, ".mounted")) } },
})
const isolated = { mcpFile: join(top, "none.mcp.json"), integrationsDir: join(top, "integrations") }

beforeAll(async () => {
  server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("desk server") })
  PORT = server.port
  app = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("<title>App</title><h1>app</h1>", { headers: { "content-type": "text/html" } }) })
  api = await createHostApi({ root: join(folder, "data"), desk: deskOf(), port: PORT, ...isolated })
  readOnly = await createHostApi({ root: join(folder, "data"), desk: deskOf(), port: PORT, readOnly: true, ...isolated })
})
afterAll(async () => {
  await api?.close()
  await readOnly?.close()
  server?.stop(true)
  app?.stop(true)
  rmSync(top, { recursive: true, force: true })
})

const request = (path, { method = "GET", body, origin = method === "POST" ? `http://localhost:${PORT}` : null, type = "application/json", signal } = {}) =>
  new Request(`http://localhost:${PORT}/__askk/${path}`, {
    method,
    signal,
    headers: { host: `localhost:${PORT}`, ...(origin ? { origin } : {}), ...(method === "POST" ? { "content-type": type } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const call = async (handler, path, opts) => {
  const res = await handler.handle(request(path, opts))
  return { status: res.status, body: res.headers.get("content-type") === "application/json" ? await res.json() : res }
}
const post = (path, body, opts = {}) => call(api, path, { method: "POST", body, ...opts })

describe("capabilities", () => {
  test("whoami lists term and browser; a read-only API has neither, and their routes are gone", async () => {
    expect((await call(api, "whoami")).body.capabilities).toEqual(expect.arrayContaining(["fs.read", "fs.write", "term", "browser"]))
    const ro = (await call(readOnly, "whoami")).body.capabilities
    expect(ro).not.toContain("term")
    expect(ro).not.toContain("browser")
    expect((await call(readOnly, "term/start", { method: "POST", body: { command: "sleep 1" } })).status).toBe(404)
    expect((await call(readOnly, "browser/open", { method: "POST", body: { url: `http://127.0.0.1:${app.port}/` } })).status).toBe(404)
    expect((await call(readOnly, "term/list")).status).toBe(404)
    expect((await call(readOnly, "term/stream")).status).toBe(404)
  })

  test("backend/live/host.js describes term and browser, and fs.read mentions the watch", () => {
    const ids = HOST_CAPABILITIES.map((c) => c.id)
    expect(ids).toEqual(expect.arrayContaining(["term", "browser"]))
    expect(HOST_CAPABILITIES.find((c) => c.id === "fs.read").label).toMatch(/watch/i)
  })

  test("H10: every route this API answers is in host-api.js's header comment", () => {
    const header = readFileSync(resolve(import.meta.dir, "host-api.js"), "utf8").split("\nimport ")[0]
    const routes = [...api.routes.GET.map((r) => ["GET", r]), ...api.routes.POST.map((r) => ["POST", r])]
    for (const r of ["term/start", "term/write", "term/wait", "term/stop", "term/list", "term/read", "term/stream", "browser/open", "browser/navigate", "browser/click", "browser/type", "browser/press", "browser/scroll", "browser/eval", "browser/text", "browser/shot", "browser/console", "browser/close", "browser/list", "fs/watch"]) {
      expect(routes.some(([, route]) => route === r)).toBe(true)
    }
    for (const [method, route] of routes) expect(header.includes(`${method} ${route}`)).toBe(true)
  })
})

describe("term through handle()", () => {
  test("POST needs a same-origin JSON request", async () => {
    expect((await post("term/start", { command: "sleep 1" }, { origin: "http://evil.example" })).status).toBe(403)
    expect((await post("term/start", { command: "sleep 1" }, { origin: null })).status).toBe(403)
    expect((await post("term/start", { command: "sleep 1" }, { type: "text/plain" })).status).toBe(415)
  })

  test("start, list, read, stream; the desk's programs only; mounts as cwd", async () => {
    const started = await post("term/start", { command: "sleep 30", name: "keeper", agent: "coder" })
    expect(started.status).toBe(200)
    const { session } = started.body
    expect(session).toMatchObject({ name: "keeper", agent: "coder", status: "running" })
    expect((await call(api, "term/list?tail=5")).body.sessions[0]).toMatchObject({ id: session.id, status: "running", tail: [] })
    expect((await call(api, `term/read?id=${session.id}`)).body.session.id).toBe(session.id)
    const abort = new AbortController()
    const stream = await api.handle(request(`term/stream?id=${session.id}`, { signal: abort.signal }))
    expect(stream.headers.get("content-type")).toBe("text/event-stream")
    const first = new TextDecoder().decode((await stream.body.getReader().read()).value)
    expect(JSON.parse(first.replace(/^data: /, ""))).toMatchObject({ type: "snapshot", session: { id: session.id } })
    abort.abort()
    expect((await call(api, "term/stream?id=nope")).status).toBe(404)
    expect((await post("term/start", { command: "python3 -c 1" })).status).toBe(403)
    const notes = await post("term/start", { command: "cat notes.md", cwd: "desks/alpha", wait: 10 })
    expect(notes.body.session).toMatchObject({ status: "exited", exit: 0, tail: ["alpha"] })
    expect((await post("term/stop", { id: session.id })).body.session.status).toBe("stopped")
  })

  // 2026-10-17: until is literal text (includes), no longer a regex the one process hosting every desk could stall on.
  test("term/wait: until is literal text or a list (any one); a regex-looking text is looked for as is; 400 for a non-string, over 300 characters or more than 8", async () => {
    const { session } = (await post("term/start", { command: "cat" })).body
    for (const until of [42, "x".repeat(301), Array(9).fill("ok"), ["ok", null]]) expect((await post("term/wait", { id: session.id, seconds: 1, until })).status).toBe(400)
    expect((await post("term/wait", { id: session.id, seconds: 1, until: "(a+)+b" })).body).toMatchObject({ matched: false, timedOut: true })
    const waiting = post("term/wait", { id: session.id, seconds: 10, until: ["never printed", "val_bpb:"] })
    expect((await post("term/write", { id: session.id, text: "step 9 val_bpb: 0.97" })).status).toBe(200)
    expect((await waiting).body).toMatchObject({ matched: true, timedOut: false, line: "step 9 val_bpb: 0.97" })
    expect((await post("term/stop", { id: session.id })).body.session.status).toBe("stopped")
  })

  test("a session's program cannot reach the API's own port", async () => {
    const res = await post("term/start", { command: `curl -s -m 5 http://127.0.0.1:${PORT}/`, wait: 10 })
    expect(res.body.session.exit).not.toBe(0)
    expect(res.body.session.tail.join("\n")).not.toContain("desk server")
  })
})

describe("browser and fs/watch through handle()", () => {
  test("the API's own port is refused; another loopback port opens; GET browser/shot answers image/png", async () => {
    expect((await post("browser/open", { url: `http://127.0.0.1:${PORT}/` })).status).toBe(403)
    expect((await post("browser/open", { url: `http://localhost:${PORT}/__askk/whoami` })).status).toBe(403)
    expect((await post("browser/open", { url: "https://example.com/" })).status).toBe(403)
    const opened = await post("browser/open", { url: `http://127.0.0.1:${app.port}/`, by: "critic" })
    expect(opened.status).toBe(200)
    const { page } = opened.body
    const shot = await api.handle(request(page.shot.url.replace("/__askk/", "")))
    expect(shot.status).toBe(200)
    expect(shot.headers.get("content-type")).toBe("image/png")
    expect([...new Uint8Array(await shot.arrayBuffer()).slice(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe("PNG")
    expect((await post("browser/text", { id: page.id })).body).toMatchObject({ title: "App", text: "# app" })
    expect((await call(api, "browser/list")).body.pages[0]).toMatchObject({ id: page.id, status: "open", by: "critic" })
    expect((await post("browser/close", { id: page.id })).body.page.status).toBe("closed")
  })

  test("fs/watch is an event stream of the workspace", async () => {
    const abort = new AbortController()
    const res = await api.handle(request("fs/watch?path=", { signal: abort.signal }))
    expect(res.headers.get("content-type")).toBe("text/event-stream")
    const reader = res.body.getReader()
    expect(JSON.parse(new TextDecoder().decode((await reader.read()).value).replace(/^data: /, ""))).toEqual({ type: "ready", path: "" })
    await Bun.sleep(150)
    writeFileSync(join(folder, "data", "seen.txt"), "x")
    const next = JSON.parse(new TextDecoder().decode((await reader.read()).value).replace(/^data: /, ""))
    expect(next).toEqual({ type: "change", paths: ["seen.txt"] })
    abort.abort()
  })
})

describe("close()", () => {
  test("ends every session and page of the desk", async () => {
    const other = await createHostApi({ root: join(folder, "data"), desk: deskOf(), port: PORT, ...isolated })
    const a = (await other.handle(request("term/start", { method: "POST", body: { command: "sleep 60" } })).then((r) => r.json())).session
    const b = (await other.handle(request("term/start", { method: "POST", body: { command: "sleep 60" } })).then((r) => r.json())).session
    const page = (await other.handle(request("browser/open", { method: "POST", body: { url: `http://127.0.0.1:${app.port}/` } })).then((r) => r.json())).page
    for (const s of [a, b]) expect(() => process.kill(s.pid, 0)).not.toThrow()
    await other.close()
    for (const s of [a, b]) expect(() => process.kill(s.pid, 0)).toThrow()
    const listed = await other.handle(request("term/list")).then((r) => r.json())
    expect(listed.sessions.map((s) => s.status)).toEqual(["stopped", "stopped"])
    const pages = await other.handle(request("browser/list")).then((r) => r.json())
    expect(pages.pages.find((p) => p.id === page.id)).toMatchObject({ status: "closed", reason: "the desk stopped" })
  })
})

describe("the desk's main.js", () => {
  test("terminal and mounts reach the host API through the desk loader (mounts.root relative to the desk)", async () => {
    const loaded = join(top, "loaded")
    mkdirSync(join(loaded, "data"), { recursive: true })
    writeFileSync(
      join(loaded, "main.js"),
      `export default () => ({
  name: "loader-test",
  terminal: { programs: ["sleep"], backgroundMinutes: 5 },
  mounts: { desks: { root: "../custom", allow: (name) => name === "alpha" } },
  start: async () => ({ desk: null }),
})
`
    )
    const desk = await loadDesk(loaded)
    expect(desk.terminal).toEqual({ programs: ["sleep"], backgroundMinutes: 5 })
    expect(desk.mounts.desks.root).toBe(desksRoot)
    const own = await createHostApi({ root: desk.workspace, desk, port: PORT, ...isolated })
    try {
      const listed = (await call(own, "term/list")).body
      expect(listed.policy).toMatchObject({ backgroundMinutes: 5 })
      expect(listed.policy.programs).toContain("sleep")
      expect((await call(own, "fs/list?path=desks")).body.entries.map((e) => e.name)).toEqual(["alpha"])
      expect((await call(own, "fs/read?path=desks/alpha/notes.md")).body.text).toBe("alpha\n")
    } finally {
      await own.close()
    }
  })
})

// 2026-10-17 owner ("I can load a new project location and the agent can work on the project"): a desk with
// `projects` loads a folder outside ASKK — projects/<name>/ in fs/* — kept in memory/<desk>/projects.json, its .agents/
// made (ignoring itself), and the lead gets its first-setup run.
describe("projects: load a folder outside ASKK", () => {
  test("GET projects, POST projects/load → mounted, saved, .agents/ made, setup sent; unload; read-only cannot load", async () => {
    const outsideApp = join(top, "elsewhere", "shop")
    mkdirSync(outsideApp, { recursive: true })
    writeFileSync(join(outsideApp, "README.md"), "shop\n")
    const sent = []
    const team = { log: () => {}, send: (body) => (sent.push(body), { ok: true, value: { agent: "lead", queued: true } }) }
    const desk = { ...deskOf(), projects: true, memory: join(top, "memory", "host-test") }
    const rules = { projectRules: { home: join(top, "home"), system: [] } }
    const own = await createHostApi({ root: desk.workspace, desk, team, port: PORT, ...isolated, ...rules })
    const ro = await createHostApi({ root: desk.workspace, desk, port: PORT, readOnly: true, ...isolated, ...rules })
    try {
      expect((await call(own, "whoami")).body.capabilities).toContain("projects")
      expect((await call(own, "projects")).body.projects).toEqual([])
      const loaded = await own.handle(request("projects/load", { method: "POST", body: { path: outsideApp } }))
      const value = await loaded.json()
      expect(loaded.status).toBe(200)
      expect(value).toMatchObject({ created: true, setup: "sent", project: { name: "shop", path: outsideApp, source: "owner", workspace: "projects/shop" } })
      expect(sent[0].from).toBe("owner")
      expect(sent[0].text).toMatch(/projects\/shop\/.*project-setup/)
      expect(readFileSync(join(outsideApp, ".agents", ".gitignore"), "utf8")).toMatch(/^\*$/m)
      expect(JSON.parse(readFileSync(join(desk.memory, "projects.json"), "utf8")).projects.shop.path).toBe(outsideApp)
      expect((await call(own, "fs/read?path=projects/shop/README.md")).body.text).toBe("shop\n")
      expect((await call(own, "projects")).body.projects.map((p) => [p.name, p.setup, p.workspace])).toEqual([["shop", false, "projects/shop"]])
      const refused = await own.handle(request("projects/load", { method: "POST", body: { path: join(top, "home-missing") } }))
      expect(refused.status).toBe(404)
      expect((await ro.handle(request("projects/load", { method: "POST", body: { path: outsideApp } }))).status).toBe(404)
      expect((await call(ro, "projects")).body.projects.map((p) => p.name)).toEqual(["shop"])
      const gone = await own.handle(request("projects/unload", { method: "POST", body: { name: "shop" } }))
      expect(await gone.json()).toEqual({ name: "shop" })
      expect((await call(own, "fs/read?path=projects/shop/README.md")).status).toBe(404)
    } finally {
      await own.close()
      await ro.close()
    }
  })
})
